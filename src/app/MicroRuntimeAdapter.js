import {
  Scalar,
  StructRef,
  NoneValue,
  BoolValue,
  StringValue,
  DictValue,
  ArrayRefValue,
  evaluate,
  exprLabel,
  exprDependencies,
  rawToValue,
  tupleToRaw,
} from '../interpreter/evaluator.js';
import { PyTuple } from '../interpreter/pytuple.js';
import { frameScope } from './frameScope.js';
import {
  pyHash,
  tableValues,
  tableInsert,
  tableDiscard,
  tablePop,
  buildFromItems,
  serializeTable,
  deserializeTable,
} from '../interpreter/pyset.js';
import { nextId } from '../core/id.js';
import { MAX_ARRAY_SIZE } from '../core/micro/MicroModel.js';
import { microLayoutKey } from './microLayoutKey.js';

/** `MicroModel` guarda variável/célula de array como um JS puro
 * (number|boolean|string|PyTuple) — decide
 * o `kind` do valor tipado pelo tipo JS real guardado, não por um campo à
 * parte no modelo (ver MicroModel.js#addVariable/#addArray). */
function wrapValue(raw) {
  if (typeof raw === 'boolean') return BoolValue(raw);
  if (typeof raw === 'string') return StringValue(raw);
  if (raw instanceof PyTuple) return rawToValue(raw);
  return Scalar(raw);
}

/** Valor tipado -> valor cru guardável numa variável/célula de dict do
 * modelo (number|boolean|string|PyTuple), ou `undefined` se não cabe. */
function storableRaw(v) {
  if (v.kind === 'scalar' || v.kind === 'bool' || v.kind === 'string') return v.value;
  if (v.kind === 'tuple') return tupleToRaw(v);
  return undefined;
}

/** Ponteiro-rótulo de uma coleção (mostra o nome dela no canvas, ver
 * App#_createArrayLabelPointer) — decoração, não um nome do código. */
const isLabel = (p) => !!(p.isArrayLabel || p.isDictLabel || p.isMatrixLabel);

/** Nome de coleção que o código escreve. As sem nome (lista de célula de
 * dict ou de lista de listas, a antiga de "x = x + [2]") têm um nome que não
 * é identificador. */
const isIdentifier = (name) => /^[A-Za-z_]\w*$/.test(name);

/** Valor tipado que é uma lista (viva ou nova) — vai numa célula de lista de
 * listas (ver evaluator.js, 'nestedlist'). */
const LIST_VALUE_KINDS = new Set(['arrayref', 'array', 'nodelist', 'set', 'deque', 'nestedlist', 'matrix']);

/** Quantas células o conteúdo `spec` (ver MicroRuntimeAdapter#_listSpec) tem. */
const specLength = (spec) => (spec.items ?? spec.cells).length;

/** Índice negativo conta do fim ("nums[-1]" é o último), igual Python — o
 * resultado ainda pode estar fora do intervalo (quem chama confere). */
function fromEnd(index, length) {
  return index < 0 ? index + length : index;
}

/** Reconstrói o `Map<chave, TypedValue>` que `DictValue` espera a partir das
 * `cells` (kind POR célula, ver MicroModel.js) de um dict já vivo no
 * modelo — chamado a cada `resolveName` (leitura sempre "fresca", nunca uma
 * referência que precise ficar em dia sozinha). Escrita ("d[chave] =
 * valor") passa por `assignDictKey`, não por este Map — ver evaluator.js#assign.
 * `arrayRef` (ver MicroRuntimeAdapter#_arrayRef) só é usado pra célula
 * `kind:'arrayref'`, que guarda o ID do array (estável mesmo se renomeado). */
function dictCellsToMap(cells, micro, arrayRef) {
  const map = new Map();
  cells.forEach((c) => {
    if (c.kind === 'ref') {
      map.set(c.key, c.value ? StructRef(c.value) : NoneValue);
    } else if (c.kind === 'arrayref') {
      const arr = c.value ? micro.arrays.get(c.value) : null;
      map.set(c.key, arr ? arrayRef(arr) : NoneValue);
    } else {
      map.set(c.key, wrapValue(c.value));
    }
  });
  return map;
}

/**
 * Implementa a interface `Environment` que o avaliador (src/interpreter/evaluator.js)
 * espera, em cima de um `MicroModel` — é o único lugar que traduz entre
 * "valor tipado" (scalar/struct/none/array) e as entidades concretas do
 * modelo (ponteiro/variável/array/struct). Não sabe nada de canvas/SVG/
 * viewport: onde posicionar um nó recém-criado é responsabilidade de quem
 * instancia (`createPosition`), e re-renderizar é avisado via `onChange`.
 */
export class MicroRuntimeAdapter {
  constructor(micro, { createPosition, onChange, onStructCreated, onArrayCreated, onDictCreated, onMatrixCreated } = {}) {
    this.micro = micro;
    this.createPosition = createPosition || (() => ({ x: 0, y: 0 }));
    this.onChange = onChange || (() => {});
    // chamado logo após "Node(v)"/"TreeNode(v)"/"GraphNode(v)" criar um nó
    // (já com a lista de vizinhos, no de grafo) — o App põe a lista ao lado
    // do nó (ver App#_microTidyOwned)
    this.onStructCreated = onStructCreated || (() => {});
    // chamado logo após o código criar um array/dict novo (ex: "arr = [1, 2,
    // 3]"/"d = {...}") — quem instancia o adapter usa isso pra criar o
    // ponteiro-rótulo que mostra o nome no canvas (ver
    // App#_createArrayLabelPointer/_createDictLabelPointer); nenhum dos dois
    // tem mais barra de título própria.
    this.onArrayCreated = onArrayCreated || (() => {});
    this.onDictCreated = onDictCreated || (() => {});
    this.onMatrixCreated = onMatrixCreated || (() => {});
    // toques (leituras via cursor de array E escritas) desde a última vez
    // que foi lido/limpo — quem executa uma instrução (App#_executeStatement
    // no modo manual, ou MicroProgramRunner por passo no modo Executar) lê
    // essa lista logo depois de avaliar+aplicar, pra destacar TODOS os
    // elementos que aquela instrução tocou — não só o alvo final da
    // atribuição, também toda célula de array lida pelo caminho.
    this.touched = [];
    // pilha de frames de chamada — sempre tem pelo menos o frame 'global' (o
    // programa de topo, fora de qualquer função). Toda chamada recursiva
    // empilha um frame novo (ver pushFrame/popFrame, usados por
    // interpreter.js#callFunction); resolveName/assignName sempre trabalham
    // no frame do TOPO da pilha. Structs e arrays não são afetados por isso —
    // são o "heap" compartilhado, sem frameId (ver MicroModel.js).
    this.frameStack = [{ id: 'global', label: 'global' }];
    // linhas escritas por "print(...)" (ver evaluator.js) — acumula durante
    // toda a execução; quem consome (App#_renderMicroConsole) decide se
    // mostra tudo (modo manual) ou só até o passo atual da reprodução (modo
    // Executar, via MicroProgramRunner#run capturando um snapshot por passo).
    this.output = [];
    // listas que saíram de uma célula de lista de listas ("res.pop()") e que
    // podem ter ficado sem ninguém — conferidas no fim da instrução (ver
    // `collectOrphans`), não na hora: "x = res.pop()" ainda vai guardá-las
    this.pendingOrphans = [];
    // semente do hash de texto/nó dos sets (ver newHashSeed, pyset.js)
    this.newHashSeed();
  }

  get currentFrameId() {
    return this.frameStack[this.frameStack.length - 1].id;
  }

  /** Empilha um frame novo de chamada (ver interpreter.js#callFunction) —
   * `label` é só pra exibição (ex: "fib(3)"), o id é interno. Devolve o id
   * do frame recém-criado. */
  pushFrame(label) {
    const id = nextId('frame');
    this.frameStack.push({ id, label });
    return id;
  }

  /** Foto dos valores do frame (parâmetros e locais), pro pop-up da árvore de
   * chamadas — ver frameScope.js. */
  frameScope(frameId) {
    return frameScope(this.micro, frameId);
  }

  /** Desempilha o frame do topo — nunca desempilha o 'global' (guarda de
   * segurança; `callFunction` sempre empilha antes de rodar o corpo e
   * desempilha depois, então isso só protegeria contra um bug de chamada
   * desbalanceada). */
  popFrame() {
    if (this.frameStack.length > 1) this.frameStack.pop();
  }

  /** "Coleta de lixo" das coleções (lista, dict, matriz) criadas dentro de
   * chamadas — chamada por interpreter.js#callFunction logo depois de
   * `popFrame`. Uma coleção cujo nome pertence a um frame que já terminou
   * (`frameId` fora da pilha) só continua no canvas se ainda é alcançável:
   * pelos valores em `keepValues` (o retorno da chamada e os valores
   * intermediários que quem chamou ainda vai usar, ex: o resultado da 1ª
   * chamada em "f(g(a), g(b))"), por um ponteiro de um frame ainda ATIVO
   * (incluindo o global), por uma célula de dict ou pela lista de vizinhos de
   * um nó, ou por uma célula de uma lista de listas que fica (em cadeia). O
   * resto some — ex: no merge sort, os "leftHalf"/"rightHalf"/
   * "result" de cada chamada que não foram devolvidos pra cima. Coleção
   * criada fora de chamada (global, à mão no canvas) nunca é candidata.
   * Passos anteriores da reprodução continuam mostrando a coleção (cada passo
   * tem seu snapshot). */
  releaseDeadArrays(keepValues = []) {
    const live = new Set(this.frameStack.map((f) => f.id));
    const isDead = (n) => !live.has(n.frameId ?? 'global');
    const reachable = new Set();
    const keep = (v) => {
      // "return (lista, n)", "return list(grupos.values())"
      if (v?.kind === 'tuple' || v?.kind === 'nestedlist') v.items.forEach(keep);
      const node = this._collectionOf(v);
      if (node) reachable.add(node.id);
    };
    keepValues.forEach(keep);
    // cursor de leitura e rótulo não "seguram" a coleção — são decoração dela
    this.micro.pointers.forEach((p) => {
      if (p.readCursorKey || isLabel(p) || isDead(p)) return;
      if (p.target?.kind === 'arrayCell') reachable.add(p.target.arrayId);
      else if (p.target?.kind === 'dictCell') reachable.add(p.target.dictId);
      else if (p.target?.kind === 'matrixCell') reachable.add(p.target.matrixId);
      else if (p.target?.id) reachable.add(p.target.id);
    });
    // dicts primeiro: as listas das células de um dict que some vão junto
    // (elas nascem no frame do dict, ver `_writeDictCell`)
    this.micro.dicts.forEach((d) => {
      if (isDead(d) && !reachable.has(d.id)) this.micro.removeDict(d.id);
    });
    this.micro.matrices.forEach((m) => {
      if (isDead(m) && !reachable.has(m.id)) this.micro.removeMatrix(m.id);
    });
    this.micro.dicts.forEach((d) =>
      d.cells.forEach((c) => {
        if (c.kind === 'arrayref' && c.value) reachable.add(c.value);
      }),
    );
    this.micro.structs.forEach((s) => {
      if (s.neighborsArrayId) reachable.add(s.neighborsArrayId);
    });
    // listas dentro de uma lista de listas que fica — que pode estar dentro
    // de outra, então repete até não achar mais nenhuma
    for (let grew = true; grew; ) {
      grew = false;
      this.micro.arrays.forEach((a) => {
        if (a.kind !== 'arrayref' || (isDead(a) && !reachable.has(a.id))) return;
        a.cells.forEach((id) => {
          if (id && !reachable.has(id)) {
            reachable.add(id);
            grew = true;
          }
        });
      });
    }
    Array.from(this.micro.arrays.values()).forEach((a) => {
      if (isDead(a) && !reachable.has(a.id)) this.micro.removeArray(a.id);
    });
  }

  /** Fim de uma instrução (ver interpreter.js#tick; no Sandbox, App): as
   * listas que saíram de uma lista de listas ("res.pop()", "res.remove(x)")
   * e não foram guardadas em lugar nenhum somem — o lixo do Python. */
  collectOrphans() {
    if (!this.pendingOrphans.length) return;
    const ids = this.pendingOrphans;
    this.pendingOrphans = [];
    ids.forEach((id) => this._dropIfOrphan({ kind: 'array', id }));
  }

  _note(kind, id) {
    this.touched.push({ kind, id });
  }

  /** "print(nome)" — leitura que destaca (seleciona no passo) o que o nome
   * é: o ponteiro/variável/coleção e, se for ponteiro, o elemento para onde
   * ele aponta. Só marca, não muda nada no modelo (sem `onChange`). */
  noteNameRead(name) {
    const binding = this._lookup(name);
    if (!binding) return;
    const { type, node } = binding;
    this._note(type, node.id);
    if (type === 'pointer' && node.target) this._note(node.target.kind, node.target.id);
  }

  /** "print(p.next)", "print(a[0])"…: destaca o elemento que o valor
   * referencia (nó de estrutura). */
  noteValueRead(value) {
    if (value?.kind === 'struct') this._note('struct', value.id);
  }

  /** O que "nome" é DENTRO do frame `frameId` — `{type, node}`, com `type`
   * 'pointer' | 'variable' | 'array' | 'dict' | 'matrix' —, ou `undefined`.
   * Um nome tem UMA ligação por frame (atribuir troca a anterior, ver
   * `assignName`). O ponteiro-rótulo de uma coleção (mesmo texto que o nome
   * dela, ver App#_createArrayLabelPointer) e o cursor de leitura não contam:
   * são decoração de outro elemento — sem excluí-los, "d = {...}" e depois
   * "d[chave]" achariam o rótulo antes do dict de verdade. Coleções (heap)
   * pertencem pelo NOME ao frame onde nasceram (`frameId`, ausente = global
   * — criada à mão no canvas ou de projeto antigo). */
  _bindingIn(frameId, name) {
    const here = (n) => (n.frameId ?? 'global') === frameId;
    const find = (map, matches) => {
      for (const n of map.values()) if (here(n) && matches(n)) return n;
      return undefined;
    };
    const candidates = [
      ['pointer', this.micro.pointers, (p) => p.label === name && !p.readCursorKey && !isLabel(p)],
      ['variable', this.micro.variables, (v) => v.name === name],
      ['array', this.micro.arrays, (a) => a.name === name],
      ['dict', this.micro.dicts, (d) => d.name === name],
      ['matrix', this.micro.matrices, (m) => m.name === name],
    ];
    for (const [type, map, matches] of candidates) {
      const node = find(map, matches);
      if (node) return { type, node };
    }
    return undefined;
  }

  /** Resolve um nome igual Python: o frame ATUAL primeiro e, se não achar, o
   * 'global' — uma função enxerga o escopo global + os próprios locais, nunca
   * os locais de quem a chamou (sem escopo dinâmico). Um nome local, de
   * qualquer tipo, esconde o global de mesmo nome (o parâmetro "a" de "def
   * merge(a, b)" não cai numa lista global chamada "a"). */
  _lookup(name) {
    const local = this._bindingIn(this.currentFrameId, name);
    if (local || this.currentFrameId === 'global') return local;
    return this._bindingIn('global', name);
  }

  /** Coleção (`type` 'array' | 'dict' | 'matrix') que "nome" é, por QUALQUER
   * caminho válido: o ID dela (referência estável, ver `stableRef`), o nome
   * CANÔNICO (`.name`) ou um ponteiro que aponta pra ela inteira (um alias
   * criado por "outro = arr"/"outro = d[chave]", ver `assignName`). É o que
   * faz vários nomes apontarem pra MESMA coleção (igual struct sempre
   * permitiu com vários ponteiros) — usado em toda leitura/escrita "por
   * nome" (getIndex/getLength/arrayAppend/iterateArray/assignDictKey...). */
  _resolveCollection(type, name) {
    const map = this._collectionMap(type);
    const byId = map.get(name);
    if (byId) return byId;
    const binding = this._lookup(name);
    if (binding?.type === type) return binding.node;
    if (binding?.type === 'pointer' && binding.node.target?.kind === type) return map.get(binding.node.target.id);
    return undefined;
  }

  _collectionMap(type) {
    return type === 'array' ? this.micro.arrays : type === 'dict' ? this.micro.dicts : this.micro.matrices;
  }

  _resolveArrayByName(name) {
    return this._resolveCollection('array', name);
  }

  _resolveDictByName(name) {
    return this._resolveCollection('dict', name);
  }

  _resolveMatrixByName(name) {
    return this._resolveCollection('matrix', name);
  }

  /** Coleção viva que um valor tipado referencia ('arrayref', 'matrixref' ou
   * dict lido de um nome — `sourceName`), ou `undefined`. */
  _collectionOf(v) {
    if (v?.kind === 'arrayref') return this._resolveArrayByName(v.name);
    if (v?.kind === 'matrixref') return this._resolveMatrixByName(v.name);
    if (v?.kind === 'dict' && v.sourceName) return this._resolveDictByName(v.sourceName);
    return undefined;
  }

  /** Referência a coleção que precisa sobreviver a uma troca de frame
   * (argumento/retorno de função, ver interpreter.js#callFunction; os
   * valores de "a, b = b, a", ver evaluator.js#assignTuple): o nome vira o ID
   * da coleção, que `_resolveCollection` aceita em qualquer frame (id nunca
   * colide com identificador — tem "-", ver core/id.js). Qualquer outro valor
   * volta intacto. */
  stableRef(value) {
    // "return [a, b]" com listas locais: cada item também
    if (value?.kind === 'nestedlist') return { ...value, items: value.items.map((v) => this.stableRef(v)) };
    const node = this._collectionOf(value);
    if (!node) return value;
    if (value.kind === 'arrayref') return ArrayRefValue(node.id);
    if (value.kind === 'matrixref') return { ...value, name: node.id };
    return DictValue(value.entries, node.id);
  }

  /** Valores que o código ainda vai atribuir (ver evaluator.js#assignTuple —
   * "a, b = b, a" com listas): enquanto valem, as coleções que eles
   * referenciam contam como "compartilhadas" e não somem quando o primeiro
   * nome é reatribuído (ver `_isShared`). */
  holdValues(values) {
    this.heldValues = values;
  }

  /** `ArrayRefValue` de um array já em mãos (célula de dict, "nó.neighbors")
   * — pelo nome, se ele ainda leva a ESTE array no frame atual (mensagens e
   * rótulos legíveis); senão pelo id (ex: lista criada numa chamada, guardada
   * num dict global e lida depois do fim da chamada). */
  _arrayRef(arr) {
    return this._resolveArrayByName(arr.name) === arr ? ArrayRefValue(arr.name) : ArrayRefValue(arr.id);
  }

  /** Valor tipado guardado numa célula do array `arr`: valor cru, nó/None ou,
   * numa lista de listas, a lista de dentro (`ArrayRefValue`)/None. */
  _cellValue(arr, cell) {
    if (arr.kind === 'value') return wrapValue(cell);
    if (arr.kind === 'arrayref') {
      const inner = cell ? this.micro.arrays.get(cell) : null;
      return inner ? this._arrayRef(inner) : NoneValue;
    }
    return cell ? StructRef(cell) : NoneValue;
  }

  /** Valor tipado de um dict vivo: o `Map` reconstruído a partir das células
   * (leitura sempre "fresca", ver `dictCellsToMap`) e, como `sourceName`, o
   * nome que leva a ELE aqui (ou o id) — ver `DictValue`/`assignName`. */
  _dictValue(dict) {
    const ref = this._resolveDictByName(dict.name) === dict ? dict.name : dict.id;
    return DictValue(dictCellsToMap(dict.cells, this.micro, (arr) => this._arrayRef(arr)), ref);
  }

  _touch(kind, id) {
    this._note(kind, id);
    this.onChange();
  }

  // ---- Environment: leitura ----

  /** Valor de "nome": variável -> o valor; dict -> o `Map` (dict é valor de
   * primeira classe, ver evaluator.js); ponteiro -> o nó/None, ou o dict pra
   * onde ele aponta (alias criado por "outro = dict"). Lista e matriz (nome
   * canônico ou alias) devolvem `undefined` de propósito: não são valores de
   * primeira classe aqui — o `evaluate` (caso 'Name') cai pros caminhos que
   * resolvem coleção por nome (`iterateArray`/`matrixInfo`), que enxergam o
   * mesmo nome via `_resolveCollection`. */
  resolveName(name) {
    const binding = this._lookup(name);
    if (!binding) return undefined;
    const { type, node } = binding;
    if (type === 'variable') return wrapValue(node.value);
    if (type === 'dict') return this._dictValue(node);
    if (type !== 'pointer') return undefined;
    if (!node.target) return NoneValue;
    if (node.target.kind === 'struct') return StructRef(node.target.id);
    if (node.target.kind === 'dict') {
      const dict = this.micro.dicts.get(node.target.id);
      return dict ? this._dictValue(dict) : undefined;
    }
    return undefined;
  }

  /** Traduz o nome de campo que o CÓDIGO usa ('prev'/'next' num struct
   * 'list', 'left'/'right' num struct 'tree') pro nome de campo FÍSICO que o
   * modelo sempre guarda ('prev'/'next' — mesma caixa, mesmas duas portas,
   * mesma geometria de sempre, ver MicroCanvasView#structPrevPort/
   * structNextPort e MicroModel#addStruct). `left` mapeia pra `prev` (porta
   * esquerda da caixa) e `right` pra `next` (porta direita) — puro
   * relabeling visual/semântico, não uma célula nova. Devolve `undefined`
   * pro campo errado do tipo errado (ex: ".left" num struct 'list'), mesmo
   * critério de "ignora silenciosamente" de sempre. Struct 'graph' não passa
   * por aqui NUNCA — não tem next/prev/left/right, só `data` (comum aos três
   * tipos) e `neighbors` (tratado à parte em `getAttr`/`assignAttr`, é uma
   * LISTA, não um único campo-referência). */
  _structFieldForAttr(struct, attr) {
    if (struct.type === 'tree') {
      if (attr === 'left') return 'prev';
      if (attr === 'right') return 'next';
      return undefined;
    }
    if (struct.type === 'graph') return undefined;
    // ListNode (lista simplesmente ligada): só `next`, sem `prev`
    if (struct.type === 'slist') return attr === 'next' ? 'next' : undefined;
    return attr === 'prev' || attr === 'next' ? attr : undefined;
  }

  getAttr(structValue, attr) {
    if (structValue.kind !== 'struct') return undefined;
    const struct = this.micro.structs.get(structValue.id);
    if (!struct) return undefined;
    // "node.neighbors" — struct 'graph' guarda a lista num array de verdade
    // à parte (ver `createStruct`/MicroModel#setStructNeighborsArray), nunca
    // como um único id igual next/prev/left/right. Devolve o MESMO tipo de
    // valor que um array já vivo no modelo devolveria por nome comum
    // (`ArrayRefValue`, ver evaluator.js) — é o que faz "len(nó.neighbors)",
    // "nó.neighbors.append(x)" e "for v in nó.neighbors:" funcionarem de
    // graça pelos caminhos genéricos que já existem pra isso
    // (arrayNameFrom/resolveIterable), sem precisar duplicar nenhum deles.
    if (struct.type === 'graph' && attr === 'neighbors') {
      const arr = struct.neighborsArrayId ? this.micro.arrays.get(struct.neighborsArrayId) : null;
      return arr ? this._arrayRef(arr) : undefined;
    }
    // "no.data" — o valor guardado no nó (mesma caixa do meio do desenho,
    // prev|data|next), comum a todos os tipos de struct.
    if (attr === 'data') return wrapValue(struct.data);
    const field = this._structFieldForAttr(struct, attr);
    if (!field) return undefined;
    const targetId = struct[field];
    return targetId ? StructRef(targetId) : NoneValue;
  }

  /** "Node(valor)"/"TreeNode(valor)"/"GraphNode(valor)" — únicos
   * "construtores" que o avaliador reconhece (ver evaluator.js#evaluate,
   * caso 'Call'). Cria de fato um nó de estrutura novo no modelo, com `data`
   * já preenchido, na posição livre mais próxima do centro do viewport
   * (mesma lógica de qualquer elemento criado pelo código). `type` ('list',
   * 'tree' ou 'graph') decide os nomes de campo que `getAttr`/`assignAttr`
   * aceitam depois (ver `_structFieldForAttr`).
   *
   * 'graph' precisa de um segundo passo que os outros dois tipos não têm:
   * `neighbors` é uma LISTA (grau arbitrário), não cabe num único campo como
   * next/prev/left/right — então cria também um array de verdade à parte
   * (kind:'ref', vazio, SEM ponteiro-rótulo — anônimo, alcançável só através
   * de "nó.neighbors", mesmo espírito do array de "d[chave] = [1, 2, 3]", ver
   * MicroRuntimeAdapter#assignDictKey) e liga os dois via
   * `MicroModel#setStructNeighborsArray`. Devolve o id do STRUCT (não do
   * array) pra virar `StructRef` na expressão que chamou, igual os outros
   * tipos. */
  createStruct(data, type = 'list') {
    // sem chave de posição memorizável (ver microLayoutKey.js) — struct é
    // anônimo, e a mesma linha de código pode criar vários num loop, então
    // continua com o cascateamento de sempre (`App#_findFreeMicroPosition`).
    const pos = this.createPosition('struct');
    const node = this.micro.addStruct(pos.x, pos.y, data, type);
    if (type === 'graph') {
      const arrPos = this.createPosition('array', 0);
      const arrNode = this.micro.addArray(arrPos.x, arrPos.y, {
        kind: 'ref',
        orientation: 'horizontal',
        size: 0,
        // só bookkeeping interno — nunca exibido nem endereçável pelo código
        // (não é um identificador válido, mesmo truque do array anônimo de
        // dict), só precisa ser ÚNICO pra não colidir com outro array/dict.
        name: `__graph_neighbors_${node.id}`,
      });
      this.micro.setStructNeighborsArray(node.id, arrNode.id);
    }
    this.onStructCreated(node);
    this._touch('struct', node.id);
    return node.id;
  }

  /** "print(...)" (ver evaluator.js) — só acumula texto em `this.output`, não
   * mexe no modelo nenhum, mas ainda avisa `onChange` pra o console re-render
   * (modo manual: cada Ctrl+Enter já chama `_renderMicroOnly` de qualquer
   * jeito, então isso é redundante ali, mas necessário se algum dia um print
   * acontecer sem outro toque no modelo na mesma instrução). */
  print(text) {
    this.output.push(text);
    this.onChange();
  }

  /** `indexNode` é o nó da AST da expressão de índice (não só o valor já
   * resolvido) — precisamos dele pra poder reavaliar o cursor de leitura mais
   * tarde, quando alguma variável da expressão mudar (ver
   * `_refreshDependentCursors`). `objectNode` (opcional): a expressão da
   * lista quando ela não é um nome direto ("res[i]" em "res[i][j]", ver
   * `_arrayCursorSpec`). */
  getIndex(arrayName, indexNode, index, objectNode) {
    const arr = this._resolveArrayByName(arrayName);
    if (arr?.isSet) {
      this.warn(`Set não tem posições — "${arrayName}[...]" não é permitido (use "sorted(${arrayName})" pra ter uma lista).`);
      return undefined;
    }
    if (!arr) return undefined;
    index = fromEnd(index, arr.cells.length);
    if (index < 0 || index >= arr.cells.length) return undefined;
    this._showReadCursor(arrayName, arr, indexNode, index, objectNode);
    return this._cellValue(arr, arr.cells[index]);
  }

  /** Toda leitura "nome[expr]" no código (ex: "sum + nums[i]") move (ou cria,
   * na primeira vez) um ponteiro dedicado até a célula lida, rotulado com a
   * expressão de acesso completa (ex: "nums[i]") — pra dar pra acompanhar
   * visualmente ONDE a expressão está lendo, não só o alvo final da
   * atribuição.
   *
   * Um cursor por PAR (array, expressão de índice) — "a[i]" e "a[j]" (ou
   * "a[i]" e "a[i + 1]") são cursores DIFERENTES, cada um reaproveitado só
   * pelas leituras que repetem a mesma expressão; identificados por uma
   * chave normalizada (sem espaço) que também é usada pro clique com botão
   * direito no código (ver App#_toggleMicroReadCursor) achar o cursor certo.
   * Guarda a expressão (`readCursorIndexNode`) e as variáveis de que ela
   * depende (`readCursorDeps`) pra `_refreshDependentCursors` poder
   * reavaliar o cursor quando qualquer uma delas for escrita em OUTRA linha
   * — não só quando "nome[expr]" é lido de novo. */
  _showReadCursor(arrayName, arr, indexNode, index, objectNode) {
    const spec = this._arrayCursorSpec(arrayName, arr, indexNode, objectNode);
    const cursor = this._findCursor(spec.key) ?? this._newCursor(spec);
    this.micro.setPointerTarget(cursor.id, { kind: 'arrayCell', arrayId: arr.id, index });
    this._touch('pointer', cursor.id);
  }

  /** Chave, rótulo e campos de um cursor de leitura de lista ("nums[i]") —
   * a chave é a expressão normalizada (sem espaços), o que identifica o
   * cursor: "nums[i]" e "nums[i + 1]" são cursores diferentes. Lista que
   * vem de uma expressão (`objectNode` — "res[i]" em "res[i][j]", "d[k]",
   * "nó.neighbors") dá nome ao cursor pela expressão inteira, como foi
   * escrita, e o cursor guarda a expressão pra mudar de lista quando "i"
   * muda (ver `_recomputeCursor`). */
  _arrayCursorSpec(arrayName, arr, indexNode, objectNode) {
    const label = exprLabel(indexNode);
    const objectLabel = objectNode ? exprLabel(objectNode) : null;
    if (objectLabel && !objectLabel.includes('?')) {
      return {
        key: `${objectLabel.replace(/\s+/g, '')}[${label.replace(/\s+/g, '')}]`,
        label: `${objectLabel}[${label}]`,
        fields: {
          readCursorArrayId: arr.id,
          readCursorObjectNode: objectNode,
          readCursorIndexNode: indexNode,
          readCursorDeps: exprDependencies(indexNode, exprDependencies(objectNode)),
        },
      };
    }
    // `arrayName` pode ser o id da lista (referência estável, ver
    // `stableRef`) — o rótulo mostra sempre o nome dela
    const shownName = this.micro.arrays.has(arrayName) ? arr.name : arrayName;
    return {
      key: `${arrayName}[${label.replace(/\s+/g, '')}]`,
      label: `${shownName}[${label}]`,
      fields: { readCursorArrayId: arr.id, readCursorIndexNode: indexNode, readCursorDeps: exprDependencies(indexNode) },
    };
  }

  /** Irmã de `_arrayCursorSpec` pra célula de matriz ("m[i][j]"). */
  _matrixCursorSpec(name, m, rowNode, colNode) {
    const rowLabel = exprLabel(rowNode);
    const colLabel = exprLabel(colNode);
    return {
      key: `${name}[${rowLabel.replace(/\s+/g, '')}][${colLabel.replace(/\s+/g, '')}]`,
      label: `${name}[${rowLabel}][${colLabel}]`,
      fields: {
        readCursorMatrixId: m.id,
        readCursorIndexNode: rowNode,
        readCursorColNode: colNode,
        readCursorDeps: exprDependencies(colNode, exprDependencies(rowNode)),
      },
    };
  }

  /** Cursor já existente com essa chave — um cursor criado dentro de uma
   * chamada pertence ao frame dela (a expressão de índice pode depender de
   * um parâmetro/local só daquele frame), então só procura no frame atual,
   * nunca reaproveita o cursor de outra chamada mesmo com a mesma chave. */
  _findCursor(key) {
    return Array.from(this.micro.pointers.values()).find((p) => p.readCursorKey === key && p.frameId === this.currentFrameId);
  }

  _newCursor(spec) {
    const pos = this.createPosition('pointer', undefined, microLayoutKey('cursor', { cursorKey: spec.key }));
    const cursor = this.micro.addPointer(pos.x, pos.y, spec.label, this.currentFrameId);
    Object.assign(cursor, { readCursorKey: spec.key, ...spec.fields, readCursorHidden: false });
    return cursor;
  }

  /** "nums[i]" / "m[i][j]" digitado como NOME de um ponteiro recém-criado à
   * mão (quick action "new pointer", ver App#_quickNewPointer): em vez de um
   * ponteiro comum, ele vira o MESMO cursor de leitura que a leitura
   * "nums[i]" no código criaria — aponta pra posição já agora (se "i" já
   * existe) e anda sozinho quando "i" muda. `ast` é a expressão já parseada.
   * Se já existe um cursor igual, o ponteiro novo é descartado e o existente
   * volta a aparecer. Devolve o id do cursor, ou null se `ast` não é a
   * posição de uma lista/matriz viva (aí quem chama segue com um ponteiro
   * comum). */
  adoptReadCursor(pointerId, ast) {
    const pointer = this.micro.pointers.get(pointerId);
    if (!pointer || ast?.type !== 'Index') return null;
    let spec = null;
    if (ast.object.type === 'Index' && ast.object.object.type === 'Name') {
      const m = this._resolveMatrixByName(ast.object.object.name);
      if (m) spec = this._matrixCursorSpec(ast.object.object.name, m, ast.object.index, ast.index);
    }
    if (!spec) {
      // "nums[i]", ou uma posição de lista de listas ("m[1][0]")
      const arr = this._listAt(ast.object);
      if (arr && !arr.isSet) {
        spec = ast.object.type === 'Name' ? this._arrayCursorSpec(ast.object.name, arr, ast.index) : this._arrayCursorSpec(arr.id, arr, ast.index, ast.object);
      }
    }
    if (!spec) return null;
    const existing = this._findCursor(spec.key);
    if (existing && existing.id !== pointerId) {
      this.micro.removePointer(pointerId);
      existing.readCursorHidden = false;
      return existing.id;
    }
    // `pointer` pode já ser um cursor (religado à mão pra outra posição, ver
    // App#_relinkMicroIndexCursor) — sem limpar, um "m[0][1]" que vira
    // "nums[2]" manteria `readCursorMatrixId` e seguiria sendo recalculado
    // como célula de matriz
    this.dropReadCursor(pointer.id);
    pointer.frameId = this.currentFrameId;
    pointer.label = spec.label;
    Object.assign(pointer, { readCursorKey: spec.key, ...spec.fields, readCursorHidden: false });
    this._recomputeCursor(pointer);
    return pointer.id;
  }

  /** A lista viva que a expressão `node` é, sem efeito nenhum (sem cursor
   * de leitura): um nome ("nums") ou uma posição de lista de listas
   * ("m[1]", "m[i][0]"). `null` se não é uma lista; `undefined` se a
   * expressão é de outro formato ("d[k]", "nó.neighbors" — aí só avaliando). */
  _listAt(node) {
    if (node.type === 'Name') return this._resolveArrayByName(node.name) ?? null;
    if (node.type !== 'Index') return undefined;
    const outer = this._listAt(node.object);
    if (outer === undefined || outer === null) return outer === null && node.object.type === 'Name' ? undefined : outer;
    if (outer.kind !== 'arrayref') return null;
    const idx = evaluate(node.index, this);
    if (idx?.kind !== 'scalar' || !Number.isInteger(idx.value)) return null;
    const id = outer.cells[fromEnd(idx.value, outer.cells.length)];
    return (id && this.micro.arrays.get(id)) || null;
  }

  /** Tira de um ponteiro tudo que o faz ser cursor de leitura — ele vira um
   * ponteiro comum (o nome fica por conta de quem chama). */
  dropReadCursor(pointerId) {
    const pointer = this.micro.pointers.get(pointerId);
    if (!pointer) return;
    ['readCursorKey', 'readCursorArrayId', 'readCursorMatrixId', 'readCursorObjectNode', 'readCursorIndexNode', 'readCursorColNode', 'readCursorDeps', 'readCursorHidden'].forEach(
      (f) => delete pointer[f],
    );
  }

  /** Chamado depois de toda escrita bem-sucedida em "changedName" (variável
   * ou ponteiro) — reavalia todo cursor de leitura cuja expressão de índice
   * referencia esse nome, mesmo que a leitura "nome[expr]" em si não esteja
   * na linha que acabou de rodar (ex: "i = i + 1" atualiza o cursor de
   * "nums[i]" criado numa linha anterior). */
  _refreshDependentCursors(changedName) {
    // só cursores do frame atual (ou globais) — um cursor criado dentro de
    // outra chamada pode depender de um nome igual que é LOCAL daquela
    // chamada, não desta (ver _lookup); recalculá-lo aqui usaria o
    // valor errado.
    Array.from(this.micro.pointers.values())
      .filter(
        (p) =>
          p.readCursorDeps?.has(changedName) &&
          (p.frameId === this.currentFrameId || p.frameId === 'global'),
      )
      .forEach((cursor) => this._recomputeCursor(cursor));
  }

  _recomputeCursor(cursor) {
    if (cursor.readCursorMatrixId) {
      const m = this.micro.matrices.get(cursor.readCursorMatrixId);
      if (!m) return;
      const rowValue = evaluate(cursor.readCursorIndexNode, this);
      const colValue = evaluate(cursor.readCursorColNode, this);
      const ok = (v) => v !== undefined && v.kind === 'scalar' && Number.isInteger(v.value);
      if (!ok(rowValue) || !ok(colValue)) return;
      const row = fromEnd(rowValue.value, m.cells.length);
      const col = fromEnd(colValue.value, m.cells[0]?.length ?? 0);
      if (row < 0 || row >= m.cells.length || col < 0 || col >= m.cells[row].length) return;
      this.micro.setPointerTarget(cursor.id, { kind: 'matrixCell', matrixId: m.id, row, col });
      this._touch('pointer', cursor.id);
      return;
    }
    if (cursor.readCursorObjectNode) {
      // "res[i][j]" com "i" novo: a lista também pode ter mudado. Pelo
      // caminho sem efeito (`_listAt`) quando dá — avaliar "res[i]" moveria
      // (ou criaria) o cursor "res[i]" junto
      let target = this._listAt(cursor.readCursorObjectNode);
      if (target === undefined) {
        const obj = evaluate(cursor.readCursorObjectNode, this);
        target = obj?.kind === 'arrayref' ? this._resolveArrayByName(obj.name) : null;
      }
      if (!target) return;
      cursor.readCursorArrayId = target.id;
    }
    const arr = this.micro.arrays.get(cursor.readCursorArrayId);
    if (!arr) return;
    const value = evaluate(cursor.readCursorIndexNode, this);
    if (value === undefined || value.kind !== 'scalar' || !Number.isInteger(value.value)) return;
    const index = fromEnd(value.value, arr.cells.length);
    if (index < 0 || index >= arr.cells.length) return;
    this.micro.setPointerTarget(cursor.id, { kind: 'arrayCell', arrayId: arr.id, index });
    this._touch('pointer', cursor.id);
  }

  // ---- Environment: matriz ----

  /** "m" é uma matriz viva? Devolve o nome usado (que pode ser um alias) e
   * uma CÓPIA das linhas — o avaliador usa isso pra "m[i]", "len(m)",
   * "print(m)" (ver evaluator.js, 'matrixref'/'matrixrow'). */
  matrixInfo(name) {
    const m = this._resolveMatrixByName(name);
    return m ? { name, rows: m.cells.map((row) => [...row]) } : undefined;
  }

  /** "m[i][j]" — lê a célula e move (ou cria) o cursor de leitura "m[i][j]"
   * até ela, mesma ideia do cursor de array (ver `_showReadCursor`). */
  getMatrixCell(name, rowNode, row, colNode, col) {
    const m = this._resolveMatrixByName(name);
    if (m) {
      row = fromEnd(row, m.cells.length);
      col = fromEnd(col, m.cells[0]?.length ?? 0);
    }
    if (!m || row < 0 || row >= m.cells.length || col < 0 || col >= m.cells[row].length) return undefined;
    this._showMatrixCursor(name, m, rowNode, row, colNode, col);
    return wrapValue(m.cells[row][col]);
  }

  /** Irmã de `_showReadCursor` pra matriz — um cursor por (matriz, expressão
   * de linha, expressão de coluna), ex.: "m[i][j]" e "m[i][j + 1]" são
   * cursores diferentes. Guarda as DUAS expressões e a união das variáveis
   * de que elas dependem, pra `_refreshDependentCursors` reavaliar o cursor
   * quando "i" ou "j" mudarem em outra linha. */
  _showMatrixCursor(name, m, rowNode, row, colNode, col) {
    const spec = this._matrixCursorSpec(name, m, rowNode, colNode);
    const cursor = this._findCursor(spec.key) ?? this._newCursor(spec);
    this.micro.setPointerTarget(cursor.id, { kind: 'matrixCell', matrixId: m.id, row, col });
    this._touch('pointer', cursor.id);
  }

  /** "m[i][j] = valor" — só valores simples (número, texto, booleano). */
  assignMatrixCell(name, row, col, value) {
    const m = this._resolveMatrixByName(name);
    if (m) {
      row = fromEnd(row, m.cells.length);
      col = fromEnd(col, m.cells[0]?.length ?? 0);
    }
    if (!m || row < 0 || row >= m.cells.length || col < 0 || col >= m.cells[row].length) return;
    if (value.kind !== 'scalar' && value.kind !== 'string' && value.kind !== 'bool') return;
    this.micro.setMatrixCellValue(m.id, row, col, value.value);
    this._touch('matrix', m.id);
  }

  /** Aviso do avaliador (ex: lista de listas irregular) — vai pro mesmo
   * console do "print(...)", marcado com ⚠ (ver App#_renderConsoleLines). */
  warn(text) {
    this.output.push(`⚠ ${text}`);
    this.onChange();
  }

  /** "for nome in arrayName:" — devolve um valor tipado por célula (na ordem
   * do array), ou undefined se "arrayName" não é um array vivo. */
  iterateArray(arrayName) {
    const arr = this._resolveArrayByName(arrayName);
    if (!arr) return undefined;
    return arr.cells.map((cell) => this._cellValue(arr, cell));
  }

  /** "len(nome)" — tamanho de um array já vivo no modelo. */
  getLength(arrayName) {
    const arr = this._resolveArrayByName(arrayName);
    return arr ? arr.cells.length : undefined;
  }

  /** "nome.append(valor)" — cresce o array em uma célula (`MicroModel#growArray`,
   * já existia mas nunca tinha sido exposto pro interpretador) e escreve
   * `valor` na célula nova, na ponta. Tipo do valor precisa bater com o tipo
   * do array, mesma regra de `assignIndex`. */
  arrayAppend(arrayName, value) {
    const arr = this._resolveArrayByName(arrayName);
    if (!arr) return this._warnIfMatrix(arrayName, 'append');
    // cheio: crescer não faz nada, e a escrita abaixo cairia na ÚLTIMA
    // célula, sobrescrevendo um elemento sem aviso nenhum
    if (arr.cells.length >= MAX_ARRAY_SIZE) {
      this.warn(`${arrayName}.append(...): a lista já tem o máximo de ${MAX_ARRAY_SIZE} elementos que a ferramenta mostra.`);
      return;
    }
    if (!this._fitArrayKind(arr, value, arrayName)) return;
    if (arr.kind === 'value') {
      const raw = this._cellRaw(value);
      if (raw === undefined) return;
      this.micro.growArray(arr.id);
      this.micro.setArrayCellValue(arr.id, arr.cells.length - 1, raw);
    } else if (arr.kind === 'arrayref') {
      // "res.append([1, 2])" / "res.append(grupo)" — a célula nova aponta pra
      // lista (nova, ou a mesma que já existe)
      const id = this._listCellId(arr, value, arr.cells.length);
      if (id === undefined) return;
      this.micro.growArray(arr.id);
      this.micro.setArrayCellArrayRef(arr.id, arr.cells.length - 1, id);
    } else {
      if (value.kind !== 'struct' && value.kind !== 'none') return;
      this.micro.growArray(arr.id);
      this.micro.setArrayCellRef(arr.id, arr.cells.length - 1, value.kind === 'struct' ? value.id : null);
    }
    this._touch('array', arr.id);
  }

  /** "nome.insert(i, valor)" — `index` já normalizado pelo avaliador (0…
   * tamanho, ver evaluator.js). Mesma regra de tipo de `arrayAppend`
   * (valor simples em lista de valores, nó/None em lista de nós). */
  arrayInsert(arrayName, index, value) {
    const arr = this._resolveArrayByName(arrayName);
    if (!arr) return this._warnIfMatrix(arrayName, 'insert');
    if (arr.cells.length >= MAX_ARRAY_SIZE) {
      this.warn(`${arrayName}.insert(...): a lista já tem o máximo de ${MAX_ARRAY_SIZE} elementos que a ferramenta mostra.`);
      return;
    }
    if (!this._fitArrayKind(arr, value, arrayName)) return;
    let cell;
    if (arr.kind === 'value') {
      cell = this._cellRaw(value);
      if (cell === undefined) return;
    } else if (arr.kind === 'arrayref') {
      cell = this._listCellId(arr, value, index);
      if (cell === undefined) return;
    } else {
      if (value.kind !== 'struct' && value.kind !== 'none') return;
      cell = value.kind === 'struct' ? value.id : null;
    }
    if (this.micro.insertArrayCell(arr.id, index, cell)) this._touch('array', arr.id);
  }

  /** "m.append(...)" com "m" uma MATRIZ ("[[1, 2], [3, 4]]" — linhas do
   * mesmo tamanho viram grade, ver evaluator.js#listValueFrom): a grade
   * não ganha nem perde linhas, então avisa em vez de ignorar calado. */
  _warnIfMatrix(name, method) {
    if (!this._resolveMatrixByName(name)) return;
    this.warn(
      `"${name}" é uma matriz (linhas do mesmo tamanho viram grade), que não ganha nem perde linhas — "${name}.${method}(...)" foi ignorado. Pra uma lista de listas que muda de tamanho, comece com "${name} = []" e use append.`,
    );
  }

  // ---- Environment: deque (array marcado `isDeque`, ver assignName) ----

  isDeque(name) {
    return !!this._resolveArrayByName(name)?.isDeque;
  }

  dequeMaxlen(name) {
    return this._resolveArrayByName(name)?.maxlen ?? null;
  }

  /** O tipo das células de uma lista/deque (valores, nós OU listas, nunca
   * misturados) vem do que entra: vazia, assume o tipo do item novo (é o que
   * deixa "fila = []" / "fila = deque()" + "fila.append(raiz)" e "res = []"
   * + "res.append([1, 2])" funcionarem); com itens, um de outro tipo avisa.
   * None cabe em lista de nós e em lista de listas. A lista de vizinhos de
   * um nó de grafo é sempre de nós — não troca. `false` se o item não pode
   * entrar. Um valor que não é nada disso (dict...) passa direto: quem
   * chamou já o ignora como sempre. */
  _fitArrayKind(arr, value, name) {
    let kind = null;
    if (value.kind === 'struct') kind = 'ref';
    else if (value.kind === 'none') kind = arr.kind === 'value' ? 'ref' : arr.kind;
    else if (['scalar', 'string', 'bool', 'tuple'].includes(value.kind)) kind = 'value';
    else if (LIST_VALUE_KINDS.has(value.kind)) kind = 'arrayref';
    if (!kind || kind === arr.kind) return true;
    const isNeighbors = [...this.micro.structs.values()].some((s) => s.neighborsArrayId === arr.id);
    if (kind === 'arrayref' && arr.isDeque) {
      this.warn(`${name}: deque de listas ainda não é suportado — use uma lista ("[]") pra guardar listas.`);
      return false;
    }
    if (arr.cells.length === 0 && !isNeighbors) {
      this.micro.setArrayContents(arr.id, kind, []);
      return true;
    }
    const what = kind === 'arrayref' || arr.kind === 'arrayref' ? 'listas com nós ou valores (número/texto)' : 'nós e valores (número/texto)';
    this.warn(isNeighbors ? '"neighbors" de um nó de grafo só guarda nós.' : `${name}: ${arr.isDeque ? 'deque' : 'lista'} misturando ${what} não é suportado.`);
    return false;
  }

  /** Id do array que vai na célula `index` da lista de listas `outer`:
   * None -> null; uma lista viva -> ela mesma (por referência, igual
   * Python); uma lista nova -> um array SEM nome criado agora, embaixo de
   * `outer`, no frame dela (some junto, ver `releaseDeadArrays`).
   * `undefined` se não cabe (já avisado, se não for óbvio). */
  _listCellId(outer, value, index) {
    if (value.kind === 'none') return null;
    const frameId = outer.frameId ?? 'global';
    if (value.kind === 'arrayref') {
      const arr = this._resolveArrayByName(value.name);
      if (!arr) return undefined;
      if (arr === outer || this._arrayContains(arr, outer.id)) {
        this.warn('Lista guardada dentro dela mesma ainda não pode ser mostrada.');
        return undefined;
      }
      // sem nome e de uma chamada que já acabou (ex: a lista de um dict
      // local, devolvida por "return list(grupos.values())"): passa a ser do
      // frame de quem a guardou
      const live = new Set(this.frameStack.map((f) => f.id));
      if (!isIdentifier(arr.name) && !live.has(arr.frameId ?? 'global')) arr.frameId = frameId;
      return arr.id;
    }
    const spec = this._cellListSpec(value);
    if (!spec) return undefined;
    const layoutKey = frameId === 'global' && isIdentifier(outer.name) ? microLayoutKey('array-in-list', { name: outer.name, key: index }) : null;
    const pos = this.createPosition('array', specLength(spec), layoutKey, { belowArrayId: outer.id, index });
    const node = this.micro.addArray(pos.x, pos.y, {
      kind: spec.kind,
      orientation: spec.grid ? 'grid' : 'horizontal',
      size: 0,
      name: `${outer.name}[${index}]`, // só bookkeeping interno, como o de lista de dict (não é um identificador)
      frameId,
    });
    this._fillArray(node, spec);
    this._touch('array', node.id);
    return node.id;
  }

  /** A lista `arr` guarda (em qualquer profundidade) o array `id`? */
  _arrayContains(arr, id, seen = new Set()) {
    if (arr.kind !== 'arrayref' || seen.has(arr.id)) return false;
    seen.add(arr.id);
    return arr.cells.some((c) => c === id || (c && this._arrayContains(this.micro.arrays.get(c) ?? {}, id, seen)));
  }

  /** `_listSpec` de uma lista que vai DENTRO de outra coleção (célula de
   * lista de listas ou de dict): uma matriz nova ("[[1, 2], [3, 4]]") lá
   * dentro é uma lista de listas, não uma grade. */
  _cellListSpec(value) {
    if (value.kind === 'matrix') return this._listSpec({ kind: 'nestedlist', items: value.rows.map((row) => ({ kind: 'array', elements: [...row] })) });
    return this._listSpec(value);
  }

  /** Grava o conteúdo `spec` (ver `_listSpec`) no array `node`. Numa lista
   * de listas, as células começam vazias (já com o tamanho certo) e cada
   * lista de dentro é criada/ligada depois (`_listCellId`), com a de fora já
   * no lugar — elas nascem embaixo dela. */
  _fillArray(node, spec) {
    if (!spec.items) {
      this.micro.replaceArray(node.id, spec);
      return;
    }
    this.micro.replaceArray(node.id, { ...spec, cells: spec.items.map(() => null) });
    // o MESMO item repetido ("[[0] * 3] * 3", ver evaluator.js#evalBinOp) é
    // UMA lista só, em várias células — igual Python
    const made = new Map();
    const cells = spec.items.map((it, i) => {
      if (made.has(it)) return made.get(it);
      const id = this._listCellId(node, it, i) ?? null;
      made.set(it, id);
      return id;
    });
    this.micro.replaceArray(node.id, { ...spec, cells });
  }

  /** Troca todos os itens do deque (rotate/reverse/clear, ver
   * evaluator.js#callDequeMethod). */
  dequeSetItems(name, items) {
    const arr = this._resolveArrayByName(name);
    if (!arr) return false;
    const isRef = (v) => v.kind === 'struct' || v.kind === 'none';
    const kind = items.length ? (isRef(items[0]) ? 'ref' : 'value') : arr.kind;
    const cells = items.map((v) => (kind === 'value' ? storableRaw(v) : v.kind === 'struct' ? v.id : null));
    if (cells.some((c) => c === undefined)) return false;
    this.micro.setArrayContents(arr.id, kind, cells);
    this._touch('array', arr.id);
    return true;
  }

  // ---- Environment: set (array marcado `isSet`, ver assignName) ----

  isSet(name) {
    return !!this._resolveArrayByName(name)?.isSet;
  }

  /** Sorteia uma semente nova pro hash de texto/nó/None dos sets (ver
   * pyset.js) — chamado a cada "Rodar" (MicroProgramRunner#run), como o
   * Python sorteia a cada execução: a ordem de um set de textos muda de uma
   * execução pra outra, mas fica estável dentro dela. */
  newHashSeed() {
    let seed = 0n;
    for (let i = 0; i < 4; i += 1) seed = (seed << 16n) | BigInt(Math.floor(Math.random() * 65536));
    this.hashSeed = seed;
  }

  /** Tabela hash do set `arr` (ver pyset.js), montada a partir do que o
   * array guarda. Se a tabela guardada não bate com as células — projeto
   * carregado (outra semente), célula editada à mão no canvas — é refeita
   * inserindo as células na ordem atual. Sempre um objeto novo (pode ser
   * alterado à vontade por quem chamou). */
  _setTableOf(arr) {
    const values = arr.cells.map((cell) => this._cellValue(arr, cell));
    const stored = deserializeTable(arr.hashTable, values, this.hashSeed);
    return stored ?? buildFromItems(values, this.hashSeed);
  }

  /** Células de um set com a tabela `table`, na ordem dela: `{kind, cells}`
   * (`emptyKind` se o set está vazio). Valores e nós misturados não cabem
   * num array do modelo (é de um tipo só) — avisa e devolve `null`. */
  _setCells(table, emptyKind) {
    const values = tableValues(table);
    const isRef = (v) => v.kind === 'struct' || v.kind === 'none';
    if (values.some(isRef) && !values.every(isRef)) {
      this.warn('Set misturando nós e valores (número/texto) não é suportado.');
      return null;
    }
    const kind = values.length > 0 ? (isRef(values[0]) ? 'ref' : 'value') : emptyKind;
    const cells = values.map((v) => (kind === 'value' ? storableRaw(v) : v.kind === 'struct' ? v.id : null));
    if (cells.some((c) => c === undefined)) {
      this.warn('Set com tupla que tem nó dentro ainda não pode ser mostrado — só tuplas de número, texto, bool ou None.');
      return null;
    }
    return { kind, cells };
  }

  /** Grava `table` no set `arr`: células na ordem da tabela + a tabela.
   * `false` se não gravou (ver `_setCells`). */
  _writeSet(arr, table) {
    const contents = this._setCells(table, arr.kind);
    if (!contents) return false;
    this.micro.setSetContents(arr.id, contents.kind, contents.cells, serializeTable(table));
    return true;
  }

  /** Tabela do set vivo "nome" — pra "set(outro_set)" copiar (ver evaluator.js). */
  setTable(name) {
    const arr = this._resolveArrayByName(name);
    return arr?.isSet ? this._setTableOf(arr) : undefined;
  }

  /** "s.add(x)" — sem efeito se x já está no set (mas ainda destaca o set,
   * pra mostrar que a linha "olhou" pra ele). A posição de x (e, se a
   * tabela crescer, a de todos) segue o Python — ver pyset.js. */
  setAdd(name, value) {
    const arr = this._resolveArrayByName(name);
    if (!arr) return;
    const table = this._setTableOf(arr);
    tableInsert(table, value, pyHash(value, this.hashSeed));
    if (this._writeSet(arr, table)) this._touch('array', arr.id);
  }

  /** "s.remove(x)" (`strict`: avisa se x não está no set — o KeyError do
   * Python) / "s.discard(x)" (silencioso). */
  setRemove(name, value, strict) {
    const arr = this._resolveArrayByName(name);
    if (!arr) return;
    const table = this._setTableOf(arr);
    if (!tableDiscard(table, value, pyHash(value, this.hashSeed))) {
      if (strict) this.warn(`${name}.remove(...): o valor não está no set (use "discard" pra ignorar).`);
      return;
    }
    if (this._writeSet(arr, table)) this._touch('array', arr.id);
  }

  /** "s.pop()" — tira o elemento que o Python tiraria (ver
   * pyset.js#tablePop); set vazio avisa (o KeyError do Python). */
  setPop(name) {
    const arr = this._resolveArrayByName(name);
    if (!arr) return undefined;
    const table = this._setTableOf(arr);
    const value = tablePop(table);
    if (value === undefined) {
      this.warn(`${name}.pop(): o set está vazio.`);
      return undefined;
    }
    if (this._writeSet(arr, table)) this._touch('array', arr.id);
    return value;
  }

  /** "nome.pop()" / "nome.pop(índice)" — lê a célula (da ponta, por padrão,
   * igual Python `list.pop()`; ou de `índice`, igual `list.pop(i)`) pra
   * devolver como valor tipado, e remove ela (`MicroModel#removeArrayCell`).
   * Array vazio, índice fora do intervalo ou array desconhecido devolve
   * None, mesmo critério de "célula vazia" usado no resto do adaptador. */
  arrayPop(arrayName, index) {
    const arr = this._resolveArrayByName(arrayName);
    if (!arr) this._warnIfMatrix(arrayName, 'pop');
    if (!arr || arr.cells.length === 0) return NoneValue;
    const i = index == null ? arr.cells.length - 1 : index;
    if (i < 0 || i >= arr.cells.length) return NoneValue;
    const cell = arr.cells[i];
    const result = this._cellValue(arr, cell);
    // a lista de dentro só some se a instrução não a guardar ("x = res.pop()")
    if (arr.kind === 'arrayref' && cell) this.pendingOrphans.push(cell);
    this.micro.removeArrayCell(arr.id, i);
    this._touch('array', arr.id);
    return result;
  }

  // ---- Environment: escrita ----

  /** Conteúdo de array do modelo pra uma lista/set/deque NOVA do avaliador
   * ('array', 'nodelist', 'set', 'deque' — ver evaluator.js): `{kind, cells,
   * isSet, hashTable, isDeque, maxlen}`, o formato de
   * MicroModel#replaceArray. `null` se não cabe num array do modelo (já
   * avisado no console); `undefined` se `value` não é nenhum desses. */
  _listSpec(value) {
    const isRef = (v) => v.kind === 'struct' || v.kind === 'none';
    const refCell = (v) => (v.kind === 'struct' ? v.id : null);
    switch (value.kind) {
      case 'array':
        if (value.elements.length > MAX_ARRAY_SIZE) this.warn(`Lista com mais de ${MAX_ARRAY_SIZE} itens — só os ${MAX_ARRAY_SIZE} primeiros aparecem.`);
        return { kind: 'value', cells: [...value.elements] };
      case 'nodelist':
        // "fila = [raiz]" / "pai = [None] * n" — lista de referências (cada
        // célula com o pino até o nó, ou ∅)
        if (value.items.length > MAX_ARRAY_SIZE) this.warn(`Lista com mais de ${MAX_ARRAY_SIZE} itens — só os ${MAX_ARRAY_SIZE} primeiros aparecem.`);
        return { kind: 'ref', cells: value.items.map(refCell) };
      case 'nestedlist':
        // "res = [[1], [2, 3]]" / "list(d.values())" — lista de listas: cada
        // célula aponta pra uma lista (as novas viram arrays sem nome, ver
        // `_fillArray`). `items` com referências estáveis (por id): o nome de
        // uma lista sem nome pode repetir enquanto as novas são criadas.
        if (value.items.length > MAX_ARRAY_SIZE) this.warn(`Lista com mais de ${MAX_ARRAY_SIZE} itens — só os ${MAX_ARRAY_SIZE} primeiros aparecem.`);
        // `grid`: nasceu retangular ("[[0] * c for _ in range(l)]") —
        // desenhada como grade (orientação 'grid', ver MicroCanvasView.js#layoutGrids)
        return { kind: 'arrayref', cells: [], items: value.items.slice(0, MAX_ARRAY_SIZE).map((v) => this.stableRef(v)), grid: !!value.grid };
      case 'set': {
        // "s = {1, 2, 3}" / "s = set()" — um array de verdade marcado `isSet`
        // (desenhado sem índices, com chaves — ver MicroCanvasView). Tudo que
        // funciona "por nome" em array (len/in/for/sorted/sum...) funciona
        // igual; o que depende de posição é barrado (ver getIndex/assignIndex
        // e evaluator.js). Células na ordem da tabela hash (a do Python, ver
        // pyset.js), com a tabela guardada junto pra "add"/"remove" seguintes
        // continuarem dela.
        const table = value.table ?? buildFromItems(value.elements, this.hashSeed);
        const contents = this._setCells(table, 'value');
        return contents && { ...contents, isSet: true, hashTable: serializeTable(table) };
      }
      case 'deque': {
        // "fila = deque()" / "fila = deque([raiz])" — um array de verdade
        // marcado `isDeque` (desenhado com índices, como lista, e a marca de
        // deque — ver MicroCanvasView). Valores OU nós, nunca os dois
        // misturados (mesma regra de array).
        const hasRefs = value.elements.some(isRef);
        if (hasRefs && !value.elements.every(isRef)) {
          this.warn('Deque misturando nós e valores (número/texto) não é suportado.');
          return null;
        }
        const cells = value.elements.map((v) => (hasRefs ? refCell(v) : storableRaw(v)));
        if (cells.some((c) => c === undefined)) {
          this.warn('Deque com lista/dict (ou tupla com nó) dentro ainda não é suportado — só número, texto, bool, tupla, nós ou None.');
          return null;
        }
        if (cells.length > MAX_ARRAY_SIZE) this.warn(`Deque com mais de ${MAX_ARRAY_SIZE} itens — só os ${MAX_ARRAY_SIZE} primeiros aparecem.`);
        return { kind: hasRefs ? 'ref' : 'value', cells, isDeque: true, maxlen: value.maxlen };
      }
      default:
        return undefined;
    }
  }

  /** A coleção `node` (`type` 'array' | 'dict' | 'matrix') é alcançável por
   * outro caminho além do próprio nome — outro nome apontando pra ela ("y =
   * x", parâmetro de uma chamada ainda ativa), célula de dict, lista de
   * vizinhos de um nó ou um valor ainda por atribuir (`holdValues`)? (Rótulo
   * e cursor de leitura não contam: são decoração dela.) */
  _isShared(type, node) {
    const live = new Set(this.frameStack.map((f) => f.id));
    for (const p of this.micro.pointers.values()) {
      if (p.readCursorKey || isLabel(p) || !live.has(p.frameId ?? 'global')) continue;
      if (p.target?.kind === type && p.target.id === node.id) return true;
    }
    if ((this.heldValues ?? []).some((v) => this._collectionOf(v) === node)) return true;
    if (type !== 'array') return false;
    for (const d of this.micro.dicts.values()) {
      if (d.cells.some((c) => c.kind === 'arrayref' && c.value === node.id)) return true;
    }
    for (const a of this.micro.arrays.values()) {
      if (a.kind === 'arrayref' && a.cells.includes(node.id)) return true;
    }
    for (const st of this.micro.structs.values()) {
      if (st.neighborsArrayId === node.id) return true;
    }
    return false;
  }

  /** Coleção sem nome (o nome não é um identificador: lista de célula de
   * dict, a antiga de "x = x + [2]" com alias, vizinhos de um nó) que ninguém
   * mais alcança some do canvas — é o lixo do Python. Chamada depois de
   * religar/apagar quem apontava pra ela. `target` é o alvo antigo
   * ({kind, id}) de um ponteiro ou célula. */
  _dropIfOrphan(target) {
    if (!target || !['array', 'dict', 'matrix'].includes(target.kind)) return;
    const node = this._collectionMap(target.kind).get(target.id);
    if (!node || /^[A-Za-z_]\w*$/.test(node.name) || this._isShared(target.kind, node)) return;
    this._removeCollection(target.kind, node);
  }

  /** Apaga a lista `id` à mão (Delete, popup, Esc na criação — ver App):
   * numa lista de listas, as listas sem nome de dentro que ficarem sem
   * ninguém vão junto, como quando o código a solta. */
  removeArray(id) {
    const node = this.micro.arrays.get(id);
    if (node) this._removeCollection('array', node);
  }

  /** Apaga uma coleção do modelo — um dict ou uma lista de listas leva junto
   * as listas sem nome das células dele (ver `_dropIfOrphan`). */
  _removeCollection(type, node) {
    if (type === 'array') {
      const lists = node.kind === 'arrayref' ? node.cells.filter(Boolean) : [];
      this.micro.removeArray(node.id);
      lists.forEach((id) => this._dropIfOrphan({ kind: 'array', id }));
    } else if (type === 'matrix') this.micro.removeMatrix(node.id);
    else {
      const lists = node.cells.filter((c) => c.kind === 'arrayref' && c.value).map((c) => c.value);
      this.micro.removeDict(node.id);
      lists.forEach((id) => this._dropIfOrphan({ kind: 'array', id }));
    }
  }

  /** Cursores de leitura da lista `arrayId` ("x[i]", "x[-1]") ou da matriz
   * `matrixId` voltam a apontar pra posição certa depois que o conteúdo foi
   * trocado. */
  _refreshCollectionCursors(id) {
    Array.from(this.micro.pointers.values())
      .filter((p) => (p.readCursorArrayId === id || p.readCursorMatrixId === id) && (p.frameId === this.currentFrameId || p.frameId === 'global'))
      .forEach((cursor) => this._recomputeCursor(cursor));
  }

  /** Que tipo de ligação "nome = valor" cria: 'variable' (número, texto,
   * bool, tupla), 'pointer' (nó/None), 'alias' (ponteiro pra uma coleção já
   * viva — "b = a", "d2 = d", "m2 = m"), 'array' (lista/set/deque nova, ver
   * `_listSpec`), 'dict' (literal) ou 'matrix' (literal). `null` se o valor
   * não vira nome (range, enumerate...). */
  _bindingKindOf(value, spec) {
    if (spec) return 'array';
    switch (value.kind) {
      case 'scalar':
      case 'bool':
      case 'string':
      case 'tuple':
        return 'variable';
      case 'struct':
      case 'none':
        return 'pointer';
      case 'arrayref':
      case 'matrixref':
        return this._collectionOf(value) ? 'alias' : null;
      case 'dict':
        if (!value.sourceName) return 'dict';
        return this._collectionOf(value) ? 'alias' : null;
      case 'matrix':
        return 'matrix';
      default:
        return null;
    }
  }

  /** Alvo de ponteiro pra um valor 'pointer'/'alias' (ver `_bindingKindOf`). */
  _pointerTarget(value) {
    if (value.kind === 'struct') return { kind: 'struct', id: value.id };
    if (value.kind === 'none') return null;
    const node = this._collectionOf(value);
    const kind = value.kind === 'arrayref' ? 'array' : value.kind === 'matrixref' ? 'matrix' : 'dict';
    return { kind, id: node.id };
  }

  /** Alguém (ponteiro, campo de outro nó, célula de lista/dict) já aponta
   * pro struct `id`? Não — só logo depois de "Node(v)" criá-lo: a DSL não
   * tem outro jeito de chegar num nó que ninguém referencia. */
  _structReferenced(id) {
    for (const p of this.micro.pointers.values()) {
      if (p.target?.kind === 'struct' && p.target.id === id) return true;
    }
    for (const s of this.micro.structs.values()) {
      if (s.next === id || s.prev === id) return true;
    }
    for (const a of this.micro.arrays.values()) {
      if (a.kind === 'ref' && a.cells.includes(id)) return true;
    }
    for (const d of this.micro.dicts.values()) {
      if (d.cells.some((c) => c.kind === 'ref' && c.value === id)) return true;
    }
    return false;
  }

  /** "nome = valor", igual Python: "nome" passa a ser `valor`, seja lá o que
   * era antes (número, nó, lista, dict, matriz...).
   *
   * Atribuir só olha o frame ATUAL: dentro de uma função sempre cria/atualiza
   * um nome LOCAL (a DSL não tem "global"); o global de mesmo nome só é
   * lido. Sem isso, o parâmetro "raiz" de "def inserir(raiz, v)" reescrevia
   * o "raiz" global a cada chamada recursiva.
   *
   * Se o nome já existe com um tipo que comporta o valor, ele é atualizado
   * NO LUGAR (ver `_assignInPlace` — mesma caixa do canvas). Senão, a ligação
   * antiga sai (`_releaseBinding`) e uma nova é criada (`_createBinding`). */
  assignName(name, value) {
    const spec = this._listSpec(value);
    if (spec === null) return; // lista que não cabe no modelo — já avisou
    const kind = this._bindingKindOf(value, spec);
    if (!kind) return;
    let raw;
    if (kind === 'variable') {
      raw = this._storableOrWarn(value);
      if (raw === undefined) return;
    }
    const existing = this._bindingIn(this.currentFrameId, name);
    // lista de listas: as listas que ela vai guardar contam como em uso até
    // ela existir — "res = [res]" não pode reescrever (nem apagar) a "res"
    // antiga, que vai pra dentro da nova
    const held = this.heldValues;
    if (spec?.items) this.heldValues = [...(held ?? []), ...spec.items];
    try {
      if (existing && this._assignInPlace(existing, { name, kind, value, spec, raw })) return;
      const labelPointerId = existing ? this._releaseBinding(existing, kind) : null;
      this._createBinding({ name, kind, value, spec, raw, labelPointerId });
    } finally {
      this.heldValues = held;
    }
    // um cursor "nums[i]" pode depender de "i" (inclusive nascido ANTES de
    // "i", criado à mão — ver `adoptReadCursor`)
    this._refreshDependentCursors(name);
  }

  /** O nome já é algo que recebe o valor sem trocar de tipo: ponteiro
   * religado, variável com valor novo, coleção reescrita (só se mais
   * ninguém a enxerga — "x = x + [2]", "d = {}" de novo). `false` se não
   * deu (aí a ligação é trocada). */
  _assignInPlace({ type, node }, { name, kind, value, spec, raw }) {
    if (type === 'pointer' && (kind === 'pointer' || kind === 'alias')) {
      const previous = node.target;
      this.micro.setPointerTarget(node.id, this._pointerTarget(value));
      this._dropIfOrphan(previous);
      this._touch('pointer', node.id);
      this._refreshDependentCursors(name);
      return true;
    }
    if (type === 'variable' && kind === 'variable') {
      this.micro.setVariableValue(node.id, raw);
      this._touch('variable', node.id);
      this._refreshDependentCursors(name);
      return true;
    }
    if (type === 'pointer' || type === 'variable') return false;
    if (kind === 'alias' && this._collectionOf(value) === node) return true; // "x = x"
    if (kind !== type || this._isShared(type, node)) return false;
    // "m = [[0] * 3 for ...]" num nome que era uma lista simples: ela vira
    // uma caixa nova, já em grade (a orientação é escolhida ao nascer)
    if (type === 'array' && spec.grid && node.kind !== 'arrayref') return false;
    if (type === 'array') {
      // as listas de dentro da versão antiga que ficaram sem ninguém somem
      const lists = node.kind === 'arrayref' ? node.cells.filter(Boolean) : [];
      this._fillArray(node, spec);
      lists.forEach((id) => this._dropIfOrphan({ kind: 'array', id }));
    } else if (type === 'matrix') this.micro.setMatrixContents(node.id, value.rows);
    else {
      const lists = node.cells.filter((c) => c.kind === 'arrayref' && c.value).map((c) => c.value);
      this.micro.clearDict(node.id);
      value.entries.forEach((v, key) => this._writeDictCell(node, name, key, v));
      lists.forEach((id) => this._dropIfOrphan({ kind: 'array', id }));
    }
    this._refreshCollectionCursors(node.id);
    this._touch(type, node.id);
    return true;
  }

  /** Tira de "nome" a ligação `binding` (ponteiro/variável saem; uma
   * coleção some se mais ninguém a enxerga, senão continua viva, sem nome,
   * pra quem ainda aponta pra ela — "y = x" e depois "x = x + [2]"). Devolve
   * o ponteiro-rótulo da coleção antiga quando a nova é do MESMO tipo: a
   * seta "x" passa pra nova (ver `_createBinding`). */
  _releaseBinding({ type, node }, kind) {
    if (type === 'pointer') {
      this.micro.removePointer(node.id);
      this._dropIfOrphan(node.target);
      return null;
    }
    if (type === 'variable') {
      this.micro.removeVariable(node.id);
      return null;
    }
    if (!this._isShared(type, node)) {
      this._removeCollection(type, node);
      return null;
    }
    const label = node.labelPointerId;
    node.name = node.id; // nunca um identificador
    if (type === kind && label) return label;
    if (label) this.micro.removePointer(label);
    return null;
  }

  /** Cria a ligação nova de "nome" (ver `assignName`). `labelPointerId`: o
   * rótulo herdado da coleção antiga de mesmo tipo (ver `_releaseBinding`)
   * — a coleção nova vai pra um lugar livre do canvas, não pra posição
   * lembrada pro nome, que é a da antiga. */
  _createBinding({ name, kind, value, spec, raw, labelPointerId }) {
    const frameId = this.currentFrameId;
    const label = labelPointerId && this.micro.pointers.has(labelPointerId) ? labelPointerId : null;
    const layoutKey = (k) => (label ? null : microLayoutKey(k, { name, frameId }));
    if (kind === 'variable') {
      // tupla vira variável comum, com o texto "(1, 2)" como valor
      const pos = this.createPosition('variable', undefined, microLayoutKey('variable', { name, frameId }));
      const node = this.micro.addVariable(pos.x, pos.y, name, raw, frameId);
      this._touch('variable', node.id);
    } else if (kind === 'pointer' || kind === 'alias') {
      // "p = Node(1)", "p = None" — ou um alias: "b = a"/"d2 = d"/"m2 = m"/
      // "x = d[chave]" cria um PONTEIRO novo mirando a MESMA coleção, nunca
      // copia nem renomeia (igual "p2 = p1" com nós) — vários nomes coexistem
      // apontando pra ela, sem um roubar o nome do outro (ver
      // `_resolveCollection`, que resolve pelos dois caminhos).
      // "p = Node(1)": o nó acabou de nascer e este é o ponteiro dele — nasce
      // grudado nele (acima de Node/TreeNode, à esquerda de GraphNode, ver
      // App#_microPointerSpotNear), não solto no centro da vista
      const target = this._pointerTarget(value);
      const near = target?.kind === 'struct' && !this._structReferenced(target.id) ? { ...target, label: name, global: frameId === 'global' } : null;
      const pos = this.createPosition('pointer', undefined, microLayoutKey('pointer', { name, frameId }), near);
      const node = this.micro.addPointer(pos.x, pos.y, name, frameId);
      this.micro.setPointerTarget(node.id, target);
      this._touch('pointer', node.id);
    } else if (kind === 'array') {
      // lista, lista de nós, set ou deque (ver `_listSpec`) — um array de
      // verdade, com o ponteiro-rótulo que mostra o nome. "arr = []" cria um
      // array VAZIO de verdade (0 células), não um com uma célula fantasma —
      // é o que faz "arr.append(x)" a partir do zero funcionar certo.
      const pos = this.createPosition('array', specLength(spec), layoutKey('array'));
      const node = this.micro.addArray(pos.x, pos.y, { kind: spec.kind, orientation: spec.grid ? 'grid' : 'horizontal', size: 0, name, frameId });
      // lista de listas: por enquanto só o tamanho — as de dentro nascem
      // embaixo dela, então ela (e o rótulo) vão pro lugar antes
      this.micro.replaceArray(node.id, spec.items ? { ...spec, cells: spec.items.map(() => null) } : spec);
      if (label) this.micro.linkArrayLabelPointer(node.id, label);
      else this.onArrayCreated(node, { movable: !pos.remembered });
      if (spec.items) this._fillArray(node, spec);
      this._touch('array', node.id);
    } else if (kind === 'matrix') {
      // "m = [[1, 2], [3, 4]]" / "m = [[0] * c for _ in range(l)]" — a
      // matriz de verdade (grade), com ponteiro-rótulo (ver App#_createMatrixLabelPointer).
      const size = { rows: value.rows.length, cols: value.rows[0]?.length ?? 1 };
      const pos = this.createPosition('matrix', size, layoutKey('matrix'));
      const node = this.micro.addMatrix(pos.x, pos.y, { name, cells: value.rows, frameId });
      if (label) this.micro.linkMatrixLabelPointer(node.id, label);
      else this.onMatrixCreated(node, { movable: !pos.remembered });
      this._touch('matrix', node.id);
    } else {
      // "d = {...}" — a entidade dict de verdade, célula por CHAVE, na ordem
      // do literal, pelo mesmo caminho de "d[chave] = valor" (ver
      // `_writeDictCell`): valor, nó/None ou lista ("{'a': [1, 2]}" — a
      // lista vira um array anônimo ligado à célula).
      const pos = this.createPosition('dict', value.entries.size, layoutKey('dict'));
      const node = this.micro.addDict(pos.x, pos.y, { orientation: 'horizontal', name, cells: [], frameId });
      value.entries.forEach((v, key) => this._writeDictCell(node, name, key, v));
      if (label) this.micro.linkDictLabelPointer(node.id, label);
      else this.onDictCreated(node, { movable: !pos.remembered });
      this._touch('dict', node.id);
    }
  }

  /** `storableRaw` com aviso no console quando é uma tupla que não cabe no
   * modelo (nó/lista dentro) — senão a atribuição sumiria sem explicação. */
  _storableOrWarn(value) {
    const raw = storableRaw(value);
    if (raw === undefined && value.kind === 'tuple') {
      this.warn('Tupla com nó/lista/dict dentro ainda não pode ser guardada — só número, texto, bool, None ou outra tupla.');
    }
    return raw;
  }

  /** "d[chave] = valor" — canal dedicado (ver evaluator.js#assign) que
   * escreve direto na CÉLULA do dict (ver `_writeDictCell`), em vez de
   * reconstruir o dict inteiro. */
  assignDictKey(name, key, value) {
    const dict = this._resolveDictByName(name);
    if (dict && this._writeDictCell(dict, name, key, value)) this._touch('dict', dict.id);
  }

  /** Escreve `valor` na célula `key` do dict `dict` (criando-a se for nova —
   * ver MicroModel#setDictCellValue/#setDictCellRef) — "d[chave] = valor" e
   * cada par de um literal "{...}". O tipo do valor decide o tipo da CÉLULA
   * (dict aceita mistura entre chaves). Uma lista sem nome que a célula
   * guardava antes e ficou sem ninguém some (`_dropIfOrphan`). `false` se o
   * valor não cabe numa célula (já avisado, se não for óbvio). */
  _writeDictCell(dict, name, key, value) {
    const before = dict.cells.find((c) => c.key === key);
    const previousList = before?.kind === 'arrayref' ? before.value : null;
    const written = this._writeDictCellValue(dict, name, key, value);
    if (written && previousList) this._dropIfOrphan({ kind: 'array', id: previousList });
    return written;
  }

  _writeDictCellValue(dict, name, key, value) {
    if (value.kind === 'struct' || value.kind === 'none') {
      this.micro.setDictCellRef(dict.id, key, value.kind === 'struct' ? value.id : null);
      return true;
    }
    if (value.kind === 'scalar' || value.kind === 'bool' || value.kind === 'string' || value.kind === 'tuple') {
      const raw = this._storableOrWarn(value);
      if (raw === undefined) return false;
      this.micro.setDictCellValue(dict.id, key, raw);
      return true;
    }
    if (value.kind === 'arrayref') {
      // "d[chave] = nome" — nome já é um array vivo no modelo (ver
      // evaluator.js#ArrayRefValue); liga a célula a ELE, não copia — mesmo
      // "por referência" que uma lista Python de verdade tem (duas chaves
      // podem apontar pro MESMO array, igual dois ponteiros pro mesmo struct).
      const arr = this._resolveArrayByName(value.name);
      if (!arr) return false;
      this.micro.setDictCellArrayRef(dict.id, key, arr.id);
      return true;
    }
    const spec = this._cellListSpec(value);
    if (spec === null) return false;
    if (spec) {
      // "d[chave] = [1, 2, 3]" / "[no1, no2]" / "set()" / "deque()" — uma
      // lista NOVA, sem ponteiro-rótulo próprio: só é alcançável pela célula
      // do dict, mesmo espírito anônimo de "Node(valor)" criar um struct sem
      // nome.
      // Nasce no frame do dict (some junto com ele, ver `releaseDeadArrays`);
      // posição lembrada só pra dict global (um por chamada empilharia).
      const frameId = dict.frameId ?? 'global';
      const pos = this.createPosition('array', specLength(spec), frameId === 'global' ? microLayoutKey('array-in-dict', { dictName: name, key }) : null);
      const node = this.micro.addArray(pos.x, pos.y, {
        kind: spec.kind,
        orientation: spec.grid ? 'grid' : 'horizontal',
        size: 0,
        name: `${name}["${key}"]`, // só bookkeeping interno — nunca exibido nem endereçável pelo código (não é um identificador válido)
        frameId,
      });
      this._fillArray(node, spec);
      this.micro.setDictCellArrayRef(dict.id, key, node.id);
      this._touch('array', node.id);
      return true;
    }
    this.warn(`${name}[${typeof key === 'string' ? `'${key}'` : String(key)}]: um dict só guarda número, texto, bool, tupla, nó, None ou lista — dict dentro de dict ainda não é suportado.`);
    return false;
  }

  /** "structValue.attr = valor" — só prev/next (struct 'list') ou left/right
   * (struct 'tree'), só com um struct ou None do outro lado (não faz sentido
   * religar um campo com um número). */
  assignAttr(structValue, attr, value) {
    const struct = this.micro.structs.get(structValue.id);
    if (!struct) return;
    if (attr === 'data') {
      // "no.data = valor" — mesmo tipo de valor aceito por "Node(valor)".
      if (value.kind !== 'scalar' && value.kind !== 'string') return;
      this.micro.setData(structValue.id, value.value);
      this._touch('struct', structValue.id);
      return;
    }
    if (value.kind !== 'struct' && value.kind !== 'none') return;
    const field = this._structFieldForAttr(struct, attr);
    if (!field) return;
    this.micro.setField(structValue.id, field, value.kind === 'struct' ? value.id : null);
    this._touch('struct', structValue.id);
  }

  /** "arrayName[index] = valor" — tipo do valor precisa bater com o tipo do
   * array (escalar para array de valores, struct/None para array de refs). */
  assignIndex(arrayName, index, value) {
    const arr = this._resolveArrayByName(arrayName);
    if (arr?.isSet) {
      this.warn(`Set não tem posições — use "${arrayName}.add(valor)" / "${arrayName}.remove(valor)".`);
      return;
    }
    if (!arr) return;
    index = fromEnd(index, arr.cells.length);
    if (index < 0 || index >= arr.cells.length) return;
    if (!this._fitArrayKind(arr, value, arrayName)) return;
    if (arr.kind === 'value') {
      const raw = this._cellRaw(value);
      if (raw === undefined) return;
      this.micro.setArrayCellValue(arr.id, index, raw);
    } else if (arr.kind === 'arrayref') {
      // "res[i] = [1, 2]" / "res[i] = outra" — a lista que a célula guardava
      // some se ficou sem ninguém
      const previous = arr.cells[index];
      const id = this._listCellId(arr, value, index);
      if (id === undefined) return;
      this.micro.setArrayCellArrayRef(arr.id, index, id);
      if (previous && previous !== id) this._dropIfOrphan({ kind: 'array', id: previous });
    } else {
      if (value.kind !== 'struct' && value.kind !== 'none') return;
      this.micro.setArrayCellRef(arr.id, index, value.kind === 'struct' ? value.id : null);
    }
    this._touch('array', arr.id);
  }

  /** Valor cru pra uma célula de lista de VALORES (número, texto, bool ou
   * tupla — ver `storableRaw`); `undefined` (com aviso, se for tupla com nó
   * dentro) quando não cabe. */
  _cellRaw(value) {
    if (value.kind !== 'scalar' && value.kind !== 'string' && value.kind !== 'bool' && value.kind !== 'tuple') return undefined;
    return this._storableOrWarn(value);
  }
}
