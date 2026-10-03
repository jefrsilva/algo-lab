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
  constructor(micro, { createPosition, onChange, onArrayCreated, onDictCreated, onMatrixCreated } = {}) {
    this.micro = micro;
    this.createPosition = createPosition || (() => ({ x: 0, y: 0 }));
    this.onChange = onChange || (() => {});
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

  /** Desempilha o frame do topo — nunca desempilha o 'global' (guarda de
   * segurança; `callFunction` sempre empilha antes de rodar o corpo e
   * desempilha depois, então isso só protegeria contra um bug de chamada
   * desbalanceada). */
  popFrame() {
    if (this.frameStack.length > 1) this.frameStack.pop();
  }

  /** "Coleta de lixo" das listas criadas dentro de chamadas — chamada por
   * interpreter.js#callFunction logo depois de `popFrame`. Uma lista cujo
   * nome pertence a um frame que já terminou (`frameId` fora da pilha) só
   * continua no canvas se ainda é alcançável: pelos valores em `keepValues`
   * (o retorno da chamada e os valores intermediários que quem chamou ainda
   * vai usar, ex: o resultado da 1ª chamada em "f(g(a), g(b))"), por um
   * ponteiro de um frame ainda ATIVO (incluindo o global), por uma célula
   * de dict ou pela lista de vizinhos de um nó. O resto some — ex: no merge
   * sort, os "leftHalf"/"rightHalf"/"result" de cada chamada que não foram
   * devolvidos pra cima. Lista criada fora de chamada (global, à mão no
   * canvas) nunca é candidata. Passos anteriores da reprodução continuam
   * mostrando a lista (cada passo tem seu snapshot). */
  releaseDeadArrays(keepValues = []) {
    const live = new Set(this.frameStack.map((f) => f.id));
    const dead = Array.from(this.micro.arrays.values()).filter((a) => !live.has(a.frameId ?? 'global'));
    if (!dead.length) return;
    const reachable = new Set();
    const keep = (v) => {
      if (v?.kind === 'tuple') v.items.forEach(keep); // "return (lista, n)"
      if (v?.kind !== 'arrayref') return;
      const arr = this._resolveArrayByName(v.name);
      if (arr) reachable.add(arr.id);
    };
    keepValues.forEach(keep);
    // cursor de leitura e rótulo não "seguram" a lista — são decoração dela
    this.micro.pointers.forEach((p) => {
      if (p.readCursorKey || p.isArrayLabel || !live.has(p.frameId ?? 'global')) return;
      if (p.target?.kind === 'array') reachable.add(p.target.id);
      else if (p.target?.kind === 'arrayCell') reachable.add(p.target.arrayId);
    });
    this.micro.dicts.forEach((d) =>
      d.cells.forEach((c) => {
        if (c.kind === 'arrayref' && c.value) reachable.add(c.value);
      }),
    );
    this.micro.structs.forEach((s) => {
      if (s.neighborsArrayId) reachable.add(s.neighborsArrayId);
    });
    dead.forEach((a) => {
      if (!reachable.has(a.id)) this.micro.removeArray(a.id);
    });
  }

  _note(kind, id) {
    this.touched.push({ kind, id });
  }

  /** Resolve um nome dentro do frame ATUAL primeiro; se não achar e o frame
   * atual não for o 'global', cai pro 'global' — mesma regra do Python: uma
   * função enxerga o escopo global + os próprios locais, nunca os locais de
   * quem a chamou (sem escopo dinâmico, sem encadear por vários níveis).
   * `localOnly`: só o frame atual — a escrita (ver `assignName`). */
  _findInFrame(map, matches, { localOnly = false } = {}) {
    const currentId = this.currentFrameId;
    const local = Array.from(map.values()).find((n) => n.frameId === currentId && matches(n));
    if (local || localOnly || currentId === 'global') return local;
    return Array.from(map.values()).find((n) => n.frameId === 'global' && matches(n));
  }

  /** O ponteiro-rótulo de um array/dict (ver App#_createArrayLabelPointer/
   * _createDictLabelPointer) tem `label` IGUAL ao `name` da coleção — é só
   * decoração pro canvas (mostra o nome ao lado), nunca deve ser resolvido
   * como um ponteiro de verdade por esse mesmo nome. Sem excluí-lo aqui,
   * "d = {...}" seguido de "d[chave] = valor" (ou qualquer leitura de "d")
   * encontraria esse ponteiro ANTES do dict/array de verdade (`target.kind`
   * é 'dict'/'array', nunca 'struct', então `resolveName` devolveria
   * silenciosamente None) — mesmo problema valeria pra reatribuir "arr =
   * Node(x)" corromper o rótulo de um array já existente. */
  _findPointer(name, opts) {
    return this._findInFrame(
      this.micro.pointers,
      (p) => p.label === name && !p.isArrayLabel && !p.isDictLabel && !p.isMatrixLabel,
      opts,
    );
  }

  _findVariable(name, opts) {
    return this._findInFrame(this.micro.variables, (v) => v.name === name, opts);
  }

  _findArray(name) {
    // O array em si é "heap" (continua visível em qualquer aba), mas o NOME
    // canônico dele pertence ao frame onde foi criado (`frameId`, ausente =
    // 'global' — array criado à mão no canvas ou de projeto antigo): sem
    // isso, "leftHalf = arr[:mid]" numa chamada recursiva acharia o
    // "leftHalf" da chamada de cima e nunca criaria o seu. Mesma regra de
    // ponteiro/variável (`_findInFrame`): frame atual, depois o global. Só
    // pelo nome CANÔNICO (`.name`); leitura/escrita comuns usam
    // `_resolveArrayByName`.
    const arrays = Array.from(this.micro.arrays.values());
    const inFrame = (frameId) => arrays.find((a) => a.name === name && (a.frameId ?? 'global') === frameId);
    return inFrame(this.currentFrameId) ?? (this.currentFrameId === 'global' ? undefined : inFrame('global'));
  }

  /** Referência a array que precisa sobreviver a uma troca de frame
   * (argumento/retorno de função, ver interpreter.js#callFunction): o nome
   * vira o ID do array, que `_resolveArrayByName` aceita em qualquer frame
   * (id nunca colide com identificador — tem "-", ver core/id.js). Qualquer
   * outro valor volta intacto. */
  stableRef(value) {
    if (value?.kind !== 'arrayref') return value;
    const arr = this._resolveArrayByName(value.name);
    return arr ? ArrayRefValue(arr.id) : value;
  }

  /** `ArrayRefValue` de um array já em mãos (célula de dict, "nó.neighbors")
   * — pelo nome, se ele ainda leva a ESTE array no frame atual (mensagens e
   * rótulos legíveis); senão pelo id (ex: lista criada numa chamada, guardada
   * num dict global e lida depois do fim da chamada). */
  _arrayRef(arr) {
    return this._resolveArrayByName(arr.name) === arr ? ArrayRefValue(arr.name) : ArrayRefValue(arr.id);
  }

  /** Resolve "nome" pra um array vivo no modelo por QUALQUER caminho válido:
   * o ID dele (referência estável, ver `stableRef`), o nome CANÔNICO dele
   * (`.name`) OU um ponteiro que "aponta" pra ele
   * (`{kind:'array', id}` — o rótulo automático de todo array criado por
   * código, OU um alias criado por "outro = arr"/"outro = d[chave]", ver
   * `assignName`). É o que faz múltiplos nomes apontarem pro MESMO array
   * (igual struct sempre permitiu com múltiplos ponteiros) — usado em toda
   * leitura/escrita de array "por nome" (getIndex/getLength/arrayAppend/
   * arrayPop/iterateArray/assignIndex), nunca na guarda de criação de
   * `assignName` (essa precisa saber especificamente sobre o nome canônico). */
  _resolveArrayByName(name) {
    const byId = this.micro.arrays.get(name);
    if (byId) return byId;
    // frame atual inteiro primeiro, depois o global (mesma regra de
    // `_findInFrame`): um nome LOCAL — lista criada aqui, parâmetro/alias
    // apontando pra uma lista ou qualquer outro valor — esconde a lista
    // global de mesmo nome (o parâmetro "a" de "def merge(a, b)" não pode
    // cair numa lista global chamada "a")
    const inFrame = (frameId) => {
      const arr = Array.from(this.micro.arrays.values()).find((a) => a.name === name && (a.frameId ?? 'global') === frameId);
      if (arr) return arr;
      const pointer = Array.from(this.micro.pointers.values()).find((p) => p.label === name && (p.frameId ?? 'global') === frameId);
      if (pointer) return pointer.target?.kind === 'array' ? this.micro.arrays.get(pointer.target.id) ?? null : null;
      return Array.from(this.micro.variables.values()).some((v) => v.name === name && v.frameId === frameId) ? null : undefined;
    };
    const local = inFrame(this.currentFrameId);
    if (local !== undefined || this.currentFrameId === 'global') return local ?? undefined;
    return inFrame('global') ?? undefined;
  }

  _findDict(name) {
    // dicts não têm frameId — mesma regra de array (ver MicroModel.js).
    return Array.from(this.micro.dicts.values()).find((d) => d.name === name);
  }

  /** Resolve "nome" pra um dict vivo no modelo por QUALQUER caminho válido —
   * mesmo espírito de `_resolveArrayByName`: o nome CANÔNICO dele (`.name`)
   * OU um ponteiro que aponta pra ele (`{kind:'dict', id}` — o rótulo
   * automático, OU um alias criado por "outro = dict", ver `assignName`).
   * Usado em toda leitura/escrita de dict "por nome" (resolveName,
   * assignDictKey), nunca na guarda de criação de `assignName`. */
  _resolveDictByName(name) {
    const direct = this._findDict(name);
    if (direct) return direct;
    const pointer = this._findInFrame(this.micro.pointers, (p) => p.label === name);
    return pointer?.target?.kind === 'dict' ? this.micro.dicts.get(pointer.target.id) : undefined;
  }

  _findMatrix(name) {
    // matrizes não têm frameId — mesma regra de array (ver MicroModel.js).
    return Array.from(this.micro.matrices.values()).find((m) => m.name === name);
  }

  /** Mesmo espírito de `_resolveArrayByName`: nome canônico OU um ponteiro
   * que aponta pra matriz inteira (`{kind:'matrix', id}` — rótulo automático
   * ou alias criado por "outro = m"). */
  _resolveMatrixByName(name) {
    const direct = this._findMatrix(name);
    if (direct) return direct;
    const pointer = this._findInFrame(this.micro.pointers, (p) => p.label === name);
    return pointer?.target?.kind === 'matrix' ? this.micro.matrices.get(pointer.target.id) : undefined;
  }

  _touch(kind, id) {
    this._note(kind, id);
    this.onChange();
  }

  // ---- Environment: leitura ----

  resolveName(name) {
    const pointer = this._findPointer(name);
    if (pointer) {
      if (pointer.target?.kind === 'struct') return StructRef(pointer.target.id);
      if (!pointer.target) return NoneValue;
      if (pointer.target.kind === 'dict') {
        // ponteiro mirando um dict inteiro — alias criado por "outro = dict"
        // (ver assignName, caso 'dict' com `sourceName`) ou o rótulo
        // automático (esse nem chega aqui, já excluído por `_findPointer`).
        // Dict É representável direto aqui (ao contrário de array — ver
        // comentário abaixo), então resolve e devolve igual ao caminho do
        // nome canônico, com `sourceName` marcando de onde veio (permite
        // encadear "c = outro" depois).
        const dict = this.micro.dicts.get(pointer.target.id);
        return dict ? DictValue(dictCellsToMap(dict.cells, this.micro, (arr) => this._arrayRef(arr)), dict.name) : undefined;
      }
      // ponteiro mirando um array (inteiro ou uma célula) — ex: um alias
      // criado por "outro = arr"/"outro = d[chave]" (ver assignName, caso
      // 'arrayref'; o rótulo automático de array/dict nem chega aqui, já é
      // excluído por `_findPointer`). Esse valor não é representável aqui
      // (resolveName só sabe devolver struct/none/scalar/bool/string/dict)
      // — devolve `undefined` de propósito, não `NoneValue`: deixa o
      // fallback de `evaluate()` (caso 'Name', ver evaluator.js) ou os
      // caminhos que resolvem array diretamente por nome
      // (getIndex/getLength/iterateArray/...) cuidarem disso — eles já
      // enxergam esse mesmo ponteiro via `_resolveArrayByName`.
      return undefined;
    }
    const variable = this._findVariable(name);
    if (variable) return wrapValue(variable.value);
    // dict é valor de primeira classe (ver evaluator.js), mas TAMBÉM tem
    // entidade visual própria no modelo (irmã de array) — toda leitura
    // reconstrói um Map novo a partir das `cells` (fonte de verdade fica no
    // MicroModel, não num Map solto); escrita vai por `assignDictKey`.
    // `dict.name` como `sourceName` — ver `DictValue`/`assignName`.
    const dict = this._findDict(name);
    if (dict) return DictValue(dictCellsToMap(dict.cells, this.micro, (arr) => this._arrayRef(arr)), dict.name);
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
   * `_refreshDependentCursors`). */
  getIndex(arrayName, indexNode, index) {
    const arr = this._resolveArrayByName(arrayName);
    if (arr?.isSet) {
      this.warn(`Set não tem posições — "${arrayName}[...]" não é permitido (use "sorted(${arrayName})" pra ter uma lista).`);
      return undefined;
    }
    if (!arr) return undefined;
    index = fromEnd(index, arr.cells.length);
    if (index < 0 || index >= arr.cells.length) return undefined;
    this._showReadCursor(arrayName, arr, indexNode, index);
    const cell = arr.cells[index];
    if (arr.kind === 'value') return wrapValue(cell);
    return cell ? StructRef(cell) : NoneValue;
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
  _showReadCursor(arrayName, arr, indexNode, index) {
    const spec = this._arrayCursorSpec(arrayName, arr, indexNode);
    const cursor = this._findCursor(spec.key) ?? this._newCursor(spec);
    this.micro.setPointerTarget(cursor.id, { kind: 'arrayCell', arrayId: arr.id, index });
    this._touch('pointer', cursor.id);
  }

  /** Chave, rótulo e campos de um cursor de leitura de lista ("nums[i]") —
   * a chave é a expressão normalizada (sem espaços), o que identifica o
   * cursor: "nums[i]" e "nums[i + 1]" são cursores diferentes. */
  _arrayCursorSpec(arrayName, arr, indexNode) {
    const label = exprLabel(indexNode);
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
    } else if (ast.object.type === 'Name') {
      const arr = this._resolveArrayByName(ast.object.name);
      if (arr && !arr.isSet) spec = this._arrayCursorSpec(ast.object.name, arr, ast.index);
    }
    if (!spec) return null;
    const existing = this._findCursor(spec.key);
    if (existing) {
      this.micro.removePointer(pointerId);
      existing.readCursorHidden = false;
      return existing.id;
    }
    pointer.frameId = this.currentFrameId;
    pointer.label = spec.label;
    Object.assign(pointer, { readCursorKey: spec.key, ...spec.fields, readCursorHidden: false });
    this._recomputeCursor(pointer);
    return pointer.id;
  }

  /** Chamado depois de toda escrita bem-sucedida em "changedName" (variável
   * ou ponteiro) — reavalia todo cursor de leitura cuja expressão de índice
   * referencia esse nome, mesmo que a leitura "nome[expr]" em si não esteja
   * na linha que acabou de rodar (ex: "i = i + 1" atualiza o cursor de
   * "nums[i]" criado numa linha anterior). */
  _refreshDependentCursors(changedName) {
    // só cursores do frame atual (ou globais) — um cursor criado dentro de
    // outra chamada pode depender de um nome igual que é LOCAL daquela
    // chamada, não desta (ver _findInFrame); recalculá-lo aqui usaria o
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
    return arr.cells.map((cell) => (arr.kind === 'value' ? wrapValue(cell) : cell ? StructRef(cell) : NoneValue));
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
    if (!arr) return;
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
    if (!arr) return;
    if (arr.cells.length >= MAX_ARRAY_SIZE) {
      this.warn(`${arrayName}.insert(...): a lista já tem o máximo de ${MAX_ARRAY_SIZE} elementos que a ferramenta mostra.`);
      return;
    }
    if (!this._fitArrayKind(arr, value, arrayName)) return;
    let cell;
    if (arr.kind === 'value') {
      cell = this._cellRaw(value);
      if (cell === undefined) return;
    } else {
      if (value.kind !== 'struct' && value.kind !== 'none') return;
      cell = value.kind === 'struct' ? value.id : null;
    }
    if (this.micro.insertArrayCell(arr.id, index, cell)) this._touch('array', arr.id);
  }

  // ---- Environment: deque (array marcado `isDeque`, ver assignName) ----

  isDeque(name) {
    return !!this._resolveArrayByName(name)?.isDeque;
  }

  dequeMaxlen(name) {
    return this._resolveArrayByName(name)?.maxlen ?? null;
  }

  /** O tipo das células de uma lista/deque (valores OU nós, nunca os dois)
   * vem do que entra: vazia, assume o tipo do item novo (é o que deixa
   * "fila = []" / "fila = deque()" + "fila.append(raiz)" funcionar); com
   * itens, um do outro tipo avisa. A lista de vizinhos de um nó de grafo é
   * sempre de nós — não troca. `false` se o item não pode entrar. Um valor
   * que não é nem nó nem valor simples (lista, dict...) passa direto: quem
   * chamou já o ignora como sempre. */
  _fitArrayKind(arr, value, name) {
    const isRef = value.kind === 'struct' || value.kind === 'none';
    const isValue = ['scalar', 'string', 'bool', 'tuple'].includes(value.kind);
    if ((!isRef && !isValue) || isRef === (arr.kind === 'ref')) return true;
    const isNeighbors = [...this.micro.structs.values()].some((s) => s.neighborsArrayId === arr.id);
    if (arr.cells.length === 0 && !isNeighbors) {
      this.micro.setArrayContents(arr.id, isRef ? 'ref' : 'value', []);
      return true;
    }
    this.warn(
      isNeighbors
        ? '"neighbors" de um nó de grafo só guarda nós.'
        : `${name}: ${arr.isDeque ? 'deque' : 'lista'} misturando nós e valores (número/texto) não é suportado.`,
    );
    return false;
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
    const values = arr.cells.map((cell) => (arr.kind === 'value' ? wrapValue(cell) : cell ? StructRef(cell) : NoneValue));
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
    if (!arr || arr.cells.length === 0) return NoneValue;
    const i = index == null ? arr.cells.length - 1 : index;
    if (i < 0 || i >= arr.cells.length) return NoneValue;
    const cell = arr.cells[i];
    const result = arr.kind === 'value' ? wrapValue(cell) : cell ? StructRef(cell) : NoneValue;
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
        return { kind: 'value', cells: [...value.elements] };
      case 'nodelist':
        // "fila = [raiz]" / "pai = [None] * n" — lista de referências (cada
        // célula com o pino até o nó, ou ∅)
        if (value.items.length > MAX_ARRAY_SIZE) this.warn(`Lista com mais de ${MAX_ARRAY_SIZE} itens — só os ${MAX_ARRAY_SIZE} primeiros aparecem.`);
        return { kind: 'ref', cells: value.items.map(refCell) };
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

  /** A lista `arr` é alcançável por outro caminho além do próprio nome —
   * outro nome apontando pra ela ("y = x", parâmetro de uma chamada ainda
   * ativa), célula de dict ou lista de vizinhos de um nó? (Rótulo e cursor de
   * leitura não contam: são decoração dela, ver `releaseDeadArrays`.) */
  _isArrayShared(arr) {
    const live = new Set(this.frameStack.map((f) => f.id));
    for (const p of this.micro.pointers.values()) {
      if (p.readCursorKey || p.isArrayLabel || !live.has(p.frameId ?? 'global')) continue;
      if (p.target?.kind === 'array' && p.target.id === arr.id) return true;
    }
    for (const d of this.micro.dicts.values()) {
      if (d.cells.some((c) => c.kind === 'arrayref' && c.value === arr.id)) return true;
    }
    for (const st of this.micro.structs.values()) {
      if (st.neighborsArrayId === arr.id) return true;
    }
    return false;
  }

  /** Cursores de leitura da lista `arrayId` ("x[i]", "x[-1]") voltam a
   * apontar pra posição certa depois que o conteúdo dela foi trocado. */
  _refreshArrayCursors(arrayId) {
    Array.from(this.micro.pointers.values())
      .filter((p) => p.readCursorArrayId === arrayId && (p.frameId === this.currentFrameId || p.frameId === 'global'))
      .forEach((cursor) => this._recomputeCursor(cursor));
  }

  /** "nome = valor" — dispatcha pelo que "nome" já é no modelo (ponteiro,
   * variável ou array mantêm seu tipo; nome desconhecido é criado conforme o
   * kind do valor). Ignora silenciosamente combinações de tipo incompatíveis
   * (ex: atribuir um número a um nome que já é ponteiro) — exceto receber uma
   * lista: "nome = [..]"/"nome = outra_lista" sempre vale, igual Python,
   * qualquer que seja o tipo de antes (ver o caso da lista mais abaixo). */
  assignName(name, value) {
    // Atribuir DENTRO de uma função sempre cria/atualiza um nome LOCAL, igual
    // Python (a DSL não tem "global"): o ponteiro/variável global de mesmo
    // nome só é lido, nunca escrito. Sem isso, o parâmetro "raiz" de
    // "def inserir(raiz, v)" reescrevia o "raiz" global a cada chamada
    // recursiva ("raiz = inserir(raiz, 3)" terminava com raiz = None).
    const scope = { localOnly: true };
    const spec = this._listSpec(value);
    if (spec === null) return; // lista que não cabe no modelo — já avisou
    // `spec` (lista nova) ou "nome = outra_lista": o nome passa a ser ESSA
    // lista, seja lá o que era antes
    const rebindsToList = spec !== undefined || (value.kind === 'arrayref' && !!this._resolveArrayByName(value.name));
    const pointer = this._findPointer(name, scope);
    if (pointer) {
      if (value.kind === 'struct' || value.kind === 'none') {
        this.micro.setPointerTarget(pointer.id, value.kind === 'struct' ? { kind: 'struct', id: value.id } : null);
      } else if (value.kind === 'arrayref') {
        // "nome" já é um ponteiro (pra nó, ou alias de array — ver caso
        // 'arrayref' mais abaixo) — reatribuir redireciona ele pra OUTRO
        // array, mesma liberdade que um ponteiro-pra-struct sempre teve ("p =
        // Node(1); p = Node(2)" religa `p`, não cria outro ponteiro).
        const arr = this._resolveArrayByName(value.name);
        if (!arr) return;
        this.micro.setPointerTarget(pointer.id, { kind: 'array', id: arr.id });
      } else if (value.kind === 'matrixref') {
        // "nome" já é um ponteiro-alias de matriz — redireciona pra outra.
        const m = this._resolveMatrixByName(value.name);
        if (!m) return;
        this.micro.setPointerTarget(pointer.id, { kind: 'matrix', id: m.id });
      } else if (value.kind === 'dict' && value.sourceName) {
        // "nome" já é um ponteiro-alias de dict (ver caso 'dict' mais abaixo)
        // — reatribuir redireciona ele pra OUTRO dict, mesmo espírito de
        // array/struct logo acima. `value.sourceName` só existe quando o
        // dict veio de ler outro NOME já vivo no modelo (ver `DictValue`) —
        // sem ele é um `DictLiteral` novo, incompatível com um ponteiro-alias.
        const dict = this._resolveDictByName(value.sourceName);
        if (!dict) return;
        this.micro.setPointerTarget(pointer.id, { kind: 'dict', id: dict.id });
      } else if (spec) {
        // "res = None" e depois "res = []", ou o parâmetro "a" (alias da
        // lista de quem chamou) recebendo "a = a[1:]": o ponteiro sai e o
        // nome vira uma lista NOVA deste frame (criada abaixo) — a lista
        // pra onde ele apontava não muda, igual Python
        this.micro.removePointer(pointer.id);
      } else {
        return;
      }
      if (!spec) {
        this._touch('pointer', pointer.id);
        this._refreshDependentCursors(name);
        return;
      }
    }

    const variable = this._findVariable(name, scope);
    if (variable && rebindsToList) {
      // "x = 0" e depois "x = [1, 2]": a variável dá lugar à lista
      this.micro.removeVariable(variable.id);
    } else if (variable) {
      // uma variável já existente pode trocar de tipo (scalar/bool/string/
      // tupla) entre atribuições — mesmo dinamismo que Python tem de verdade.
      const raw = this._storableOrWarn(value);
      if (raw === undefined) return;
      this.micro.setVariableValue(variable.id, raw);
      this._touch('variable', variable.id);
      this._refreshDependentCursors(name);
      return;
    }

    // Lista com esse nome NESTE frame (um array global com o mesmo nome não
    // impede uma função de criar o seu local, igual Python). Só uma lista
    // nova ou outra lista substituem o que ela é — qualquer outro valor é
    // ignorado, como sempre.
    let arrayKey = microLayoutKey('array', { name, frameId: this.currentFrameId });
    let labelPointerId = null;
    const array = this._findArray(name);
    if (array && (array.frameId ?? 'global') === this.currentFrameId) {
      if (!rebindsToList) return;
      if (value.kind === 'arrayref' && this._resolveArrayByName(value.name) === array) return; // "x = x"
      const shared = this._isArrayShared(array);
      if (spec && !shared) {
        // "x = x + [2]", "res = res + a[i:]" — ninguém mais enxerga a lista
        // antiga, então é a MESMA caixa do canvas (posição, cor, rótulo,
        // cursores) com o conteúdo novo
        this.micro.replaceArray(array.id, spec);
        this._refreshArrayCursors(array.id);
        this._touch('array', array.id);
        return;
      }
      if (!shared) {
        // "x = outra_lista" — a antiga não tem mais quem a enxergue
        this.micro.removeArray(array.id);
      } else {
        // "y = x" e depois "x = x + [2]" — a lista antiga continua viva pra
        // quem ainda aponta pra ela, só que sem nome (`name` = id, nunca um
        // identificador). Uma lista nova leva o RÓTULO junto (a seta "x"
        // passa a apontar pra ela), num lugar livre do canvas, não na posição
        // lembrada pra "x", que é a da antiga.
        labelPointerId = array.labelPointerId;
        if (spec) arrayKey = null;
        else if (labelPointerId) this.micro.removePointer(labelPointerId);
        array.name = array.id;
      }
    }

    const dict = this._findDict(name);
    if (dict) return; // mesma regra de array — só criação na primeira atribuição

    const matrix = this._findMatrix(name);
    if (matrix) return; // mesma regra de array

    if (value.kind === 'scalar' || value.kind === 'bool' || value.kind === 'string' || value.kind === 'tuple') {
      // tupla vira variável comum, com o texto "(1, 2)" como valor
      const raw = this._storableOrWarn(value);
      if (raw === undefined) return;
      const pos = this.createPosition('variable', undefined, microLayoutKey('variable', { name, frameId: this.currentFrameId }));
      const node = this.micro.addVariable(pos.x, pos.y, name, raw, this.currentFrameId);
      this._touch('variable', node.id);
      // um cursor "nums[i]" pode ter nascido ANTES de "i" (criado à mão, ver
      // `adoptReadCursor`) — passa a apontar assim que "i" existe
      this._refreshDependentCursors(name);
    } else if (value.kind === 'struct' || value.kind === 'none') {
      const pos = this.createPosition('pointer', undefined, microLayoutKey('pointer', { name, frameId: this.currentFrameId }));
      const node = this.micro.addPointer(pos.x, pos.y, name, this.currentFrameId);
      this.micro.setPointerTarget(node.id, value.kind === 'struct' ? { kind: 'struct', id: value.id } : null);
      this._touch('pointer', node.id);
    } else if (spec) {
      // lista, lista de nós, set ou deque (ver `_listSpec`) — um array de
      // verdade, com o ponteiro-rótulo que mostra o nome. "arr = []" cria um
      // array VAZIO de verdade (0 células), não um com uma célula fantasma —
      // é o que faz "arr.append(x)" a partir do zero funcionar certo.
      const pos = this.createPosition('array', spec.cells.length, arrayKey);
      const node = this.micro.addArray(pos.x, pos.y, { kind: spec.kind, orientation: 'horizontal', size: 0, name, frameId: this.currentFrameId });
      this.micro.replaceArray(node.id, spec);
      if (labelPointerId && this.micro.pointers.has(labelPointerId)) this.micro.linkArrayLabelPointer(node.id, labelPointerId);
      else this.onArrayCreated(node);
      this._touch('array', node.id);
    } else if (value.kind === 'matrix') {
      // "m = [[1, 2], [3, 4]]" / "m = [[0] * c for _ in range(l)]" — cria a
      // matriz de verdade (grade), com ponteiro-rótulo (ver App#_createMatrixLabelPointer).
      const size = { rows: value.rows.length, cols: value.rows[0]?.length ?? 1 };
      const pos = this.createPosition('matrix', size, microLayoutKey('matrix', { name }));
      const node = this.micro.addMatrix(pos.x, pos.y, { name, cells: value.rows });
      this.onMatrixCreated(node);
      this._touch('matrix', node.id);
    } else if (value.kind === 'matrixref') {
      // "b = m" — ponteiro novo mirando a MESMA matriz (alias, igual "b = arr").
      const m = this._resolveMatrixByName(value.name);
      if (!m) return;
      const pos = this.createPosition('pointer', undefined, microLayoutKey('pointer', { name, frameId: this.currentFrameId }));
      const node = this.micro.addPointer(pos.x, pos.y, name, this.currentFrameId);
      this.micro.setPointerTarget(node.id, { kind: 'matrix', id: m.id });
      this._touch('pointer', node.id);
    } else if (value.kind === 'dict' && value.sourceName) {
      // "nome = outroDict" (ver `DictValue#sourceName`) — cria um PONTEIRO
      // novo mirando o MESMO dict (`{kind:'dict', id}`), nunca copia. Mesmo
      // comportamento que struct/array já têm pra "p2 = p1"/"b = arr":
      // vários nomes coexistem apontando pro mesmo dict, sem um roubar o
      // nome do outro (ver `_resolveDictByName`).
      const dict = this._resolveDictByName(value.sourceName);
      if (!dict) return;
      const pos = this.createPosition('pointer', undefined, microLayoutKey('pointer', { name, frameId: this.currentFrameId }));
      const node = this.micro.addPointer(pos.x, pos.y, name, this.currentFrameId);
      this.micro.setPointerTarget(node.id, { kind: 'dict', id: dict.id });
      this._touch('pointer', node.id);
    } else if (value.kind === 'dict') {
      // "d = {...}" — cria a entidade dict de verdade, célula por CHAVE, na
      // ordem do literal, pelo mesmo caminho de "d[chave] = valor" (ver
      // `_writeDictCell`): valor, nó/None ou lista ("{'a': [1, 2]}" — a
      // lista vira um array anônimo ligado à célula).
      const pos = this.createPosition('dict', value.entries.size, microLayoutKey('dict', { name }));
      const node = this.micro.addDict(pos.x, pos.y, { orientation: 'horizontal', name, cells: [] });
      value.entries.forEach((v, key) => this._writeDictCell(node, name, key, v));
      this.onDictCreated(node);
      this._touch('dict', node.id);
    } else if (value.kind === 'arrayref') {
      // "nome = outroArray" / "nome = d[chave]" (célula arrayref, ver
      // evaluator.js#ArrayRefValue) — cria um PONTEIRO novo mirando o MESMO
      // array (`{kind:'array', id}`), nunca renomeia nem copia. É o mesmo
      // comportamento que struct sempre teve (vários ponteiros pro mesmo
      // struct, ver "p2 = p1" — evaluate(Name) devolve StructRef, assignName
      // cria outro ponteiro com o mesmo alvo) — agora vale igual pra array,
      // então "a = arr" e "b = arr" coexistem apontando pro mesmo array, sem
      // um roubar o nome do outro (ver `_resolveArrayByName`, usado em toda
      // leitura/escrita de array por nome — resolve tanto pelo nome
      // CANÔNICO quanto por um ponteiro-alias como este).
      const arr = this._resolveArrayByName(value.name);
      if (!arr) return;
      const pos = this.createPosition('pointer', undefined, microLayoutKey('pointer', { name, frameId: this.currentFrameId }));
      const node = this.micro.addPointer(pos.x, pos.y, name, this.currentFrameId);
      this.micro.setPointerTarget(node.id, { kind: 'array', id: arr.id });
      this._touch('pointer', node.id);
    }
  }

  /** "d[chave] = valor" — canal dedicado (ver evaluator.js#assign) que
   * escreve direto na CÉLULA do dict (por chave, criando-a se for nova — ver
   * MicroModel#setDictCellValue/#setDictCellRef), em vez de reconstruir o
   * dict inteiro. Tipo do valor decide se a célula vira 'value' ou 'ref',
   * mesma regra de `assignIndex` pra array (mas por CÉLULA, já que dict
   * aceita mistura de tipos entre chaves diferentes). */
  /** `storableRaw` com aviso no console quando é uma tupla que não cabe no
   * modelo (nó/lista dentro) — senão a atribuição sumiria sem explicação. */
  _storableOrWarn(value) {
    const raw = storableRaw(value);
    if (raw === undefined && value.kind === 'tuple') {
      this.warn('Tupla com nó/lista/dict dentro ainda não pode ser guardada — só número, texto, bool, None ou outra tupla.');
    }
    return raw;
  }

  assignDictKey(name, key, value) {
    const dict = this._resolveDictByName(name);
    if (dict && this._writeDictCell(dict, name, key, value)) this._touch('dict', dict.id);
  }

  /** Escreve `valor` na célula `key` do dict `dict` (criando-a se for nova) —
   * "d[chave] = valor" e cada par de um literal "{...}". `false` se o valor
   * não cabe numa célula (já avisado, se não for óbvio). */
  _writeDictCell(dict, name, key, value) {
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
    const spec = this._listSpec(value);
    if (spec === null) return false;
    if (spec) {
      // "d[chave] = [1, 2, 3]" / "[no1, no2]" / "set()" / "deque()" — uma
      // lista NOVA, sem ponteiro-rótulo próprio: só é alcançável pela célula
      // do dict, mesmo espírito anônimo de "Node(valor)" criar um struct sem
      // nome.
      const pos = this.createPosition('array', spec.cells.length, microLayoutKey('array-in-dict', { dictName: name, key }));
      const node = this.micro.addArray(pos.x, pos.y, {
        kind: spec.kind,
        orientation: 'horizontal',
        size: 0,
        name: `${name}["${key}"]`, // só bookkeeping interno — nunca exibido nem endereçável pelo código (não é um identificador válido)
      });
      this.micro.replaceArray(node.id, spec);
      this.micro.setDictCellArrayRef(dict.id, key, node.id);
      this._touch('array', node.id);
      return true;
    }
    this.warn(`${name}[${typeof key === 'string' ? `'${key}'` : String(key)}]: um dict só guarda número, texto, bool, tupla, nó, None ou lista — dict dentro de dict e lista de listas ainda não são suportados.`);
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
    if (arr.kind === 'value') {
      const raw = this._cellRaw(value);
      if (raw === undefined) return;
      this.micro.setArrayCellValue(arr.id, index, raw);
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
