/**
 * Avaliador: anda pela AST (ver ast.js) resolvendo expressões em VALORES
 * TIPADOS, e aplica atribuições através de uma interface `Environment`
 * (duck-typed, ver MicroRuntimeAdapter.js) que é a única coisa aqui que sabe
 * o que é MicroModel/struct/ponteiro/array/variável — evaluator.js em si não
 * importa nada de fora de interpreter/.
 *
 * Um "valor tipado" é sempre `{kind, ...}`:
 *   - {kind:'scalar', value: number}
 *   - {kind:'struct', id: string}      — referência a um struct concreto
 *   - {kind:'none'}                    — ausência de referência (o "None" do
 *                                        modelo: campo vazio, ponteiro sem
 *                                        alvo, célula de array de refs vazia)
 *   - {kind:'bool', value: boolean}
 *   - {kind:'string', value: string}   — ao contrário de array/struct, É um
 *                                        valor de primeira classe: circula
 *                                        livremente (variável, célula de
 *                                        array, campo de retorno de função,
 *                                        argumento...), com indexação/slice
 *                                        próprios (ver casos 'Index'/'Slice')
 *   - {kind:'array', elements: (number|string|PyTuple)[]} — só existe como valor de
 *                                        um literal "[1, 2, 3]"/"['a', 'b']",
 *                                        nunca circula além disso (arrays não
 *                                        são valores de primeira classe no
 *                                        modelo)
 *   - {kind:'nodelist', items: TypedValue[]} — irmã de 'array' pra uma lista
 *                                        de NÓS ("[raiz]", "[None] * n", "[a,
 *                                        b]"): itens só 'struct'/'none', já
 *                                        tipados. Mesma vida curta de 'array'
 *                                        — atribuída a um nome vira uma lista
 *                                        de referências no modelo
 *   - {kind:'dict', entries: Map<number|string|PyTuple, TypedValue>} — AO
 *                                        CONTRÁRIO de array, É valor de
 *                                        primeira classe (mesma família de
 *                                        string): circula livremente,
 *                                        guardável numa variável comum. Chave
 *                                        scalar/string ou tupla (internada,
 *                                        ver pytuple.js e `valueToKey`/
 *                                        `keyToValue`). `entries` é mutado IN
 *                                        PLACE por "d[chave] = valor" (ver
 *                                        `assign`) — o mesmo Map que já
 *                                        estava na variável, não um novo
 *   - {kind:'set', elements: TypedValue[]} — só existe como valor de um
 *                                        literal "{1, 2, 3}"/"set(...)" (mesma
 *                                        família de 'array'): sem repetidos,
 *                                        ordem de inserção; atribuído a um nome
 *                                        vira um array marcado `isSet` no
 *                                        modelo (ver MicroRuntimeAdapter), e
 *                                        daí em diante circula como 'arrayref'
 *                                        (len/in/for/sorted funcionam igual)
 *   - {kind:'deque', elements: TypedValue[], maxlen: number|null} — só
 *                                        existe como valor de "deque(...)"
 *                                        (mesma família de 'set'): atribuído
 *                                        a um nome vira um array marcado
 *                                        `isDeque` no modelo e daí em diante
 *                                        circula como 'arrayref' — tem
 *                                        índice, e os métodos das duas
 *                                        pontas (appendleft/popleft...).
 *                                        Itens: só valores ou só nós/None
 *   - {kind:'tuple', items: TypedValue[]} — "(a, b)", imutável, valor de
 *                                        primeira classe (mesma família de
 *                                        string). Com itens imutáveis (número,
 *                                        texto, bool, None, tupla), pode ser
 *                                        chave de dict e ser guardada em
 *                                        variável/célula de dict — no modelo,
 *                                        como uma `PyTuple` crua (ver
 *                                        pytuple.js e `tupleToRaw`)
 *   - {kind:'range', start, stop}      — só existe como valor de uma chamada
 *                                        "range(...)", só consumido pelo "for"
 *                                        (ver interpreter.js#resolveIterable),
 *                                        nunca circula além disso
 *   - {kind:'matrix', rows: (number|string|boolean)[][]} — mesma família de
 *                                        'array' (só existe como valor de um
 *                                        literal "[[1, 2], [3, 4]]" ou de uma
 *                                        list comprehension), retangular
 *   - {kind:'matrixref', name, rows}   — "m" quando "m" é uma matriz já viva
 *                                        no modelo (irmã de 'arrayref'); `rows`
 *                                        é uma CÓPIA do conteúdo, só pra
 *                                        leitura (len/print/igualdade)
 *   - {kind:'matrixrow', name, row, cells} — "m[i]": só existe como passo
 *                                        intermediário de "m[i][j]" (leitura
 *                                        e escrita), "len(m[i])", "sum(m[i])",
 *                                        "print(m[i])", "x in m[i]", "for x in
 *                                        m[i]" — nunca vira variável própria
 *
 * `evaluate` retorna `undefined` quando a expressão não pôde ser resolvida
 * (nome desconhecido, campo/índice inválido, chamada de função que não seja
 * uma das reconhecidas — "Node(valor)", "TreeNode(valor)", "GraphNode(valor)", "len(nome)", "range(...)",
 * "sum(...)", "min(...)", "max(...)", "sorted(...)", "enumerate(...)",
 * "list(...)", "set(...)", "tuple(...)", "deque(...)" (e os métodos de deque,
 * ver `callDequeMethod`), "str(valor)", "abs(x)", "int(x[, base])",
 * "sep.join(...)", "texto.upper()",
 * "texto.lower()", "texto.split(...)", "texto.replace(...)",
 * "texto.strip(...)", "texto.lstrip(...)", "texto.rstrip(...)", "texto.startswith(...)", "texto.endswith(...)",
 * "texto.find(...)", "texto.count(...)",
 * "print(...)", "nome.append(valor)", "nome.pop([índice])",
 * "nome.insert(i, valor)", "nome.remove(valor)",
 * "nome.get(chave)", "nome.keys()", "nome.values()", "nome.items()"; as
 * demais só têm a sintaxe aceita, não são
 * executadas) — o mesmo critério de "ignora a linha silenciosamente" que a
 * ferramenta já usava.
 *
 * ## Interface `Environment` esperada
 *   resolveName(name) -> TypedValue | undefined
 *   getAttr(structValue, attr) -> TypedValue | undefined
 *   getIndex(arrayName, indexNumber) -> TypedValue | undefined
 *   getLength(arrayName) -> number | undefined        — "len(nome)"
 *   createStruct(dataNumber, tipo) -> structId         — "Node(valor)" (tipo
 *                                                        'list', campos
 *                                                        next/prev) ou
 *                                                        "TreeNode(valor)"
 *                                                        (tipo 'tree', campos
 *                                                        left/right)
 *   arrayAppend(arrayName, value) -> void              — "nome.append(valor)"
 *   arrayPop(arrayName, index?) -> TypedValue           — "nome.pop()"/"nome.pop(i)"
 *                                                         (e "nome.remove(x)",
 *                                                         que acha o índice)
 *   arrayInsert(arrayName, index, value) -> void (opcional) — "nome.insert(i, x)",
 *                                                         índice já entre 0 e
 *                                                         o tamanho
 *   assignName(name, value) -> void
 *   assignAttr(structValue, attr, value) -> void
 *   assignIndex(arrayName, indexNumber, value) -> void
 *   iterateArray(arrayName) -> TypedValue[] | undefined (opcional) — "for nome
 *                                                         in array:", "in"/"not
 *                                                         in", slice, sum/min/
 *                                                         max/sorted/enumerate
 *   print(text) -> void (opcional)                     — "print(...)"; sem
 *                                                         ele a chamada só
 *                                                         devolve None sem
 *                                                         efeito
 *   matrixInfo(name) -> {name, rows} | undefined (opcional) — "m" é uma matriz
 *                                                         viva no modelo?
 *   getMatrixCell(name, rowNode, row, colNode, col) -> TypedValue | undefined
 *                                                         (opcional) — "m[i][j]"
 *   assignMatrixCell(name, row, col, value) -> void (opcional) — "m[i][j] = v"
 *   warn(texto) -> void (opcional)                     — aviso no console
 *                                                         (ex: lista irregular)
 *   isSet(arrayName) -> boolean (opcional)             — o array vivo "nome"
 *                                                         é um set?
 *   setTable(arrayName) -> tabela (opcional)           — a tabela hash do
 *                                                         set vivo (ver
 *                                                         pyset.js), pra
 *                                                         "set(outro_set)"
 *   hashSeed: BigInt (opcional)                        — semente do hash de
 *                                                         texto/nó (ver
 *                                                         pyset.js); sem ela, 0
 *   setPop(arrayName) -> TypedValue (opcional)         — "s.pop()"
 *   setAdd(arrayName, value) -> void (opcional)        — "s.add(x)"
 *   setRemove(arrayName, value, strict) -> void (opcional) — "s.remove(x)"
 *                                                         (strict: avisa se
 *                                                         não existe) /
 *                                                         "s.discard(x)"
 *   isDeque(arrayName) -> boolean (opcional)           — o array vivo "nome"
 *                                                         é um deque?
 *   dequeMaxlen(arrayName) -> number | null (opcional) — "deque(..., maxlen=n)"
 *   dequeSetItems(arrayName, items) -> boolean (opcional) — troca TODOS os
 *                                                         itens do deque
 *                                                         (rotate/reverse/
 *                                                         clear); false se
 *                                                         não coube
 *   assignDictKey(name, key, value) -> void (opcional) — "d[chave] = valor";
 *                                                         sem ele, cai no
 *                                                         fallback de mutar
 *                                                         o Map resolvido +
 *                                                         reatribuir via
 *                                                         `assignName` (ver
 *                                                         `assign`)
 */

import { formatWithSpec, formatTextWithSpec, FormatError } from './format.js';
import {
  isHashable,
  setKeyEq,
  emptyTable,
  tableValues,
  buildSetLiteral,
  buildFromItems,
  buildFromTable,
  buildFromDictKeys,
} from './pyset.js';
import { PyTuple, makeTuple } from './pytuple.js';

export const Scalar = (value) => ({ kind: 'scalar', value });
export const StructRef = (id) => ({ kind: 'struct', id });
export const NoneValue = { kind: 'none' };
export const BoolValue = (value) => ({ kind: 'bool', value });
export const StringValue = (value) => ({ kind: 'string', value });
export const ArrayValue = (elements) => ({ kind: 'array', elements });
/** Ver cabeçalho do arquivo — lista de nós/None. */
export const NodeListValue = (items) => ({ kind: 'nodelist', items });
const isNodeItem = (v) => v?.kind === 'struct' || v?.kind === 'none';
/** Ver cabeçalho do arquivo. `table` é a tabela hash (ver pyset.js) e
 * `elements` os elementos na ordem dela — a ordem que o Python usaria ao
 * percorrer/imprimir, não a de inserção. */
export const SetValue = (table) => ({ kind: 'set', elements: tableValues(table), table });
/** Ver cabeçalho do arquivo. `maxlen` null = sem limite. */
export const DequeValue = (elements, maxlen = null) => ({ kind: 'deque', elements, maxlen });
/** `sourceName` (opcional) é o nome CANÔNICO do dict de onde esse Map veio —
 * só preenchido quando o valor nasceu de ler um dict já vivo no modelo (ver
 * MicroRuntimeAdapter#resolveName), nunca de um `DictLiteral` novo. É o que
 * permite `assignName` distinguir "outro = dict" (deve virar ALIAS do mesmo
 * dict, ver `assignName` caso 'dict') de "outro = {...}" (deve criar um dict
 * novo) sem precisar de um `kind` à parte — ao contrário de array
 * (`ArrayRefValue`), dict É valor de primeira classe pra tudo mais (Index,
 * print, comparação, 'in'...), então um `kind:'dictref'` separado obrigaria
 * replicar esse tratamento em todo canto que já lida com `kind:'dict'`. */
export const DictValue = (entries, sourceName) => ({ kind: 'dict', entries, ...(sourceName ? { sourceName } : {}) });
/** `step` pode ser negativo (contagem regressiva), nunca zero — ver o caso
 * "range" em `evaluate`. */
export const RangeValue = (start, stop, step = 1) => ({ kind: 'range', start, stop, step });
/** Só existe como valor de "enumerate(nome)", só consumido pelo "for" (mesma
 * família de 'range' — ver interpreter.js#resolveIterable). Cada
 * par é uma tupla JS `[Scalar(índice), valorTipado]`, não um valor tipado —
 * é o que permite "for i, v in enumerate(arr):" fazer bind de DUAS variáveis
 * por item (ver ast.js#For). */
export const PairsValue = (pairs) => ({ kind: 'pairs', pairs });
/** Só existe como valor de "dict.keys()"/"dict.values()", só consumido pelo
 * "for" (mesma família de 'range'/'pairs' — ver
 * interpreter.js#resolveIterable). `items` já são valores tipados prontos. */
export const IterValue = (items) => ({ kind: 'iter', items });
/** "nome" quando "nome" é um array já vivo no modelo — array não é valor de
 * primeira classe pra encadear expressão nenhuma (ver `evaluate`, caso
 * 'Name'), mas precisa fluir como ALGUM valor pra alimentar "d[chave] =
 * nome" (ver `assign`, que repassa pro Environment via `assignDictKey` —
 * MicroRuntimeAdapter resolve o array por esse `name` e liga a célula do
 * dict a ele, igual "d[chave] = Node(...)" liga a um struct). Fora desse
 * caminho (dict), a maioria das operações não sabe o que fazer com esse
 * `kind` e devolve `undefined`/`false` — mesmo critério de "ignora
 * silenciosamente" de sempre. */
export const ArrayRefValue = (name) => ({ kind: 'arrayref', name });
/** Ver cabeçalho do arquivo — 'matrix'/'matrixref'/'matrixrow'. */
export const MatrixValue = (rows) => ({ kind: 'matrix', rows });
export const MatrixRefValue = (name, rows) => ({ kind: 'matrixref', name, rows });
export const MatrixRowValue = (name, row, cells) => ({ kind: 'matrixrow', name, row, cells });

/** Limite de itens de um iterável materializado por uma list comprehension
 * (ex: "range(10 ** 9)") — a comprehension roda inteira num passo só, sem a
 * guarda de MAX_STEPS do interpretador, então precisa da própria. */
const MAX_COMPREHENSION_ITEMS = 100000;

/** Ver cabeçalho do arquivo. */
export const TupleValue = (items) => ({ kind: 'tuple', items });

/** Valor cru guardado numa célula de array/matriz/dict ou variável
 * (number|string|boolean|PyTuple) -> valor tipado — mesma regra de
 * MicroRuntimeAdapter#wrapValue. `null` só aparece como item de tupla. */
export function rawToValue(raw) {
  if (typeof raw === 'boolean') return BoolValue(raw);
  if (typeof raw === 'string') return StringValue(raw);
  if (raw === null) return NoneValue;
  if (raw instanceof PyTuple) return TupleValue(raw.items.map(rawToValue));
  return Scalar(raw);
}

/** Tupla tipada -> `PyTuple` crua (ver pytuple.js), ou `undefined` se algum
 * item não é imutável (nó, lista, dict...) — aí ela não vira chave de dict
 * nem é guardada no modelo. */
export function tupleToRaw(v) {
  const items = [];
  for (const it of v.items) {
    if (it.kind === 'scalar' || it.kind === 'string' || it.kind === 'bool') items.push(it.value);
    else if (it.kind === 'none') items.push(null);
    else if (it.kind === 'tuple') {
      const inner = tupleToRaw(it);
      if (inner === undefined) return undefined;
      items.push(inner);
    } else return undefined;
  }
  return makeTuple(items);
}

/** Valor tipado -> chave do `Map` de um dict (número, texto ou `PyTuple`),
 * ou `undefined` se não pode ser chave. Tupla com item mutável avisa no
 * console (no Python, é o "unhashable type"). */
function valueToKey(v, env) {
  if (v === undefined) return undefined;
  if (v.kind === 'scalar' || v.kind === 'string') return v.value;
  if (v.kind === 'tuple') {
    const key = tupleToRaw(v);
    if (key === undefined) env?.warn?.('Tupla com nó/lista/dict dentro não pode ser chave de dict — só número, texto, bool, None ou outra tupla.');
    return key;
  }
  return undefined;
}

/** Valor tipado -> valor cru de célula, ou `undefined` se não cabe numa
 * célula de valor (struct, None, lista, tupla com nó dentro...). Tupla vira
 * `PyTuple` (ver `tupleToRaw`) — é o que deixa "[(0, 0), (0, 1)]" ser uma
 * lista de valores comum. */
function valueToRaw(v) {
  if (v?.kind === 'tuple') return tupleToRaw(v);
  return v && (v.kind === 'scalar' || v.kind === 'string' || v.kind === 'bool') ? v.value : undefined;
}

/** Ordem do Python entre dois valores: número/bool entre si, texto entre si,
 * tupla com tupla (lexicográfica — o primeiro item diferente decide; se uma
 * acaba antes, ela é a menor). Negativo/zero/positivo, ou `undefined` se não
 * dá pra comparar (o TypeError do Python, ex: número com texto). */
function compareValues(a, b) {
  const num = (v) => (v.kind === 'scalar' ? v.value : v.kind === 'bool' ? Number(v.value) : undefined);
  if (num(a) !== undefined && num(b) !== undefined) return num(a) - num(b);
  if (a.kind === 'string' && b.kind === 'string') return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  if (a.kind === 'tuple' && b.kind === 'tuple') {
    const n = Math.min(a.items.length, b.items.length);
    for (let i = 0; i < n; i += 1) {
      if (setKeyEq(a.items[i], b.items[i])) continue;
      return compareValues(a.items[i], b.items[i]);
    }
    return a.items.length - b.items.length;
  }
  return undefined;
}

/** Pares do enumerate/items (tupla JS `[a, b]`, ver `PairsValue`) viram
 * tuplas de verdade quando o item é usado como VALOR — "list(d.items())",
 * "sorted(enumerate(nums))", "for par in d.items()". */
function pairsAsTuples(items) {
  return items.map((it) => (Array.isArray(it) ? TupleValue(it) : it));
}

/** Valores de UMA iteração de "for a, b in ...:" (statement ou list
 * comprehension), um por nome do laço: par do enumerate/items ou tupla ->
 * desempacotados nos `nVars` nomes; com um nome só, o item inteiro (par vira
 * tupla — "for par in d.items()"). */
export function loopValues(item, nVars) {
  if (Array.isArray(item)) return nVars > 1 ? item : [TupleValue(item)];
  if (item?.kind === 'tuple' && nVars > 1) return item.items;
  return [item];
}

/** Monta o valor de uma lista a partir dos itens já avaliados (literal
 * "[a, b, c]" ou resultado de uma list comprehension): só valores simples ->
 * 'array'; só nós/None -> 'nodelist'; só listas simples ('array', do mesmo
 * tamanho) -> 'matrix'. Lista irregular (linhas de tamanhos diferentes),
 * vazia dentro de lista ou misturando nós e valores não tem representação
 * visual — avisa no console (`env.warn`) em vez de sumir sem explicação.
 * Qualquer outra mistura devolve `undefined`, como sempre. */
function listValueFrom(items, env) {
  if (items.every((v) => valueToRaw(v) !== undefined)) return ArrayValue(items.map(valueToRaw));
  if (items.every(isNodeItem)) return NodeListValue(items);
  if (items.some(isNodeItem) && items.every((v) => isNodeItem(v) || valueToRaw(v) !== undefined)) {
    env.warn?.('Lista misturando nós e valores (número/texto) não é suportada.');
    return undefined;
  }
  if (items.some((v) => v?.kind === 'tuple' && valueToRaw(v) === undefined)) {
    env.warn?.('Lista de tuplas com nó/lista dentro ainda não é suportada — só tuplas de número, texto, bool ou None.');
    return undefined;
  }
  if (items.length > 0 && items.every((v) => v?.kind === 'array')) {
    const cols = items[0].elements.length;
    if (cols === 0) {
      env.warn?.('Matriz com linhas vazias não é suportada — cada linha precisa ter pelo menos uma coluna.');
      return undefined;
    }
    if (items.some((v) => v.elements.length !== cols)) {
      env.warn?.('Matriz com linhas de tamanhos diferentes não é suportada — todas as linhas precisam ter o mesmo número de colunas.');
      return undefined;
    }
    return MatrixValue(items.map((v) => [...v.elements]));
  }
  return undefined;
}

/** Linha `i` de uma matriz já viva (`info` vem de `env.matrixInfo`) como
 * 'matrixrow', ou `undefined` fora do intervalo. */
function matrixRowOf(info, i) {
  if (i < 0) i += info.rows.length; // "m[-1]" é a última linha
  if (!Number.isInteger(i) || i < 0 || i >= info.rows.length) return undefined;
  return MatrixRowValue(info.name, i, [...info.rows[i]]);
}

/** Itens de um valor iterável JÁ AVALIADO — usado pelo "for" do
 * interpretador (ver interpreter.js#resolveIterable, depois do atalho de
 * array por nome) e pela list comprehension. `undefined` se o valor não é
 * iterável. Cada item é um valor tipado, exceto em 'pairs' (tupla JS
 * `[Scalar(i), valor]`, ver `PairsValue`). */
export function iterableItems(value, env) {
  if (value?.kind === 'range') {
    const items = [];
    const { start, stop, step } = value;
    for (let i = start; step > 0 ? i < stop : i > stop; i += step) items.push(Scalar(i));
    return items;
  }
  if (value?.kind === 'pairs') return value.pairs;
  if (value?.kind === 'iter') return value.items;
  if (value?.kind === 'arrayref') return env.iterateArray ? env.iterateArray(value.name) : undefined;
  if (value?.kind === 'array') return value.elements.map(rawToValue);
  if (value?.kind === 'nodelist') return value.items;
  if (value?.kind === 'set' || value?.kind === 'deque') return value.elements;
  if (value?.kind === 'string') return [...value.value].map((ch) => StringValue(ch));
  if (value?.kind === 'matrixrow') return value.cells.map(rawToValue);
  if (value?.kind === 'tuple') return value.items;
  if (value?.kind === 'dict') {
    // "for chave in d:" — Python itera as CHAVES por padrão.
    return [...value.entries.keys()].map(rawToValue);
  }
  if (value?.kind === 'matrixref') {
    // "for linha in m:" — cada linha seria um APELIDO da linha da matriz
    // (não uma cópia), o que ainda não tem representação no canvas.
    env.warn?.(`Percorrer as linhas com "for linha in ${value.name}" ainda não é suportado — use índices: "for i in range(len(${value.name}))".`);
    return undefined;
  }
  return undefined;
}

/** Itens de "for x in <iterExpr>" — atalho de sempre pra array por NOME
 * direto (ver interpreter.js#resolveIterable), senão avalia e usa
 * `iterableItems`. */
function iterItemsFromExpr(iterExpr, env) {
  if (iterExpr.type === 'Name' && env.iterateArray) {
    const arrayItems = env.iterateArray(iterExpr.name);
    if (arrayItems !== undefined) return arrayItems;
  }
  return iterableItems(evaluate(iterExpr, env), env);
}

/** Itens do argumento de um builtin de coleção (sum/min/max/sorted/
 * enumerate/set/"sep".join) — QUALQUER iterável: array vivo por nome ou por
 * expressão ("d[chave]", "nó.neighbors"), linha de matriz, set, literal,
 * texto (uma letra por item), range, chaves de dict... Avalia o argumento
 * UMA vez só. `undefined` se não é iterável ou se os itens são pares
 * (enumerate/items — não são valores). */
function collectionItems(node, env) {
  const items = iterItemsFromExpr(node, env);
  return items === undefined ? undefined : pairsAsTuples(items);
}

/** Truthiness estilo Python de um valor tipado — usada tanto pra "and/or/not"
 * quanto pelo interpretador de programa (interpreter.js) pra decidir
 * if/while. Um valor não resolvido (undefined) conta como falso. `env` só é
 * usado pra lista viva no modelo ('arrayref' — "if lista:"/"while fila:"),
 * que só carrega o NOME: o tamanho vem do Environment. */
export function truthy(v, env) {
  if (!v || v.kind === 'none') return false;
  if (v.kind === 'arrayref') return (env?.getLength?.(v.name) ?? 0) > 0;
  if (v.kind === 'bool') return v.value;
  if (v.kind === 'scalar') return v.value !== 0;
  if (v.kind === 'string') return v.value.length > 0;
  if (v.kind === 'struct') return v.id != null;
  if (v.kind === 'array' || v.kind === 'set' || v.kind === 'deque') return v.elements.length > 0;
  if (v.kind === 'nodelist') return v.items.length > 0;
  if (v.kind === 'dict') return v.entries.size > 0;
  if (v.kind === 'tuple') return v.items.length > 0;
  if (v.kind === 'matrix' || v.kind === 'matrixref') return v.rows.length > 0;
  if (v.kind === 'matrixrow') return v.cells.length > 0;
  return false;
}

/** Representação curta e legível de uma expressão (ex: "i", "i + 1", "3") —
 * não é um pretty-printer completo nem nunca é re-parseada, serve só pra
 * rotular o cursor de leitura de array (ex: "nums[i]", ver
 * MicroRuntimeAdapter#_showReadCursor) com o texto que o usuário realmente
 * escreveu no índice, em vez do valor numérico já resolvido. */
export function exprLabel(node) {
  switch (node.type) {
    case 'Name':
      return node.name;
    case 'Number':
      return String(node.value);
    case 'Str':
      return JSON.stringify(node.value);
    case 'NoneLiteral':
      return 'None';
    case 'Bool':
      return node.value ? 'True' : 'False';
    case 'UnaryOp':
      return `${node.op}${exprLabel(node.operand)}`;
    case 'BinOp':
      return `${exprLabel(node.left)} ${node.op} ${exprLabel(node.right)}`;
    case 'Attribute':
      return `${exprLabel(node.object)}.${node.attr}`;
    case 'Index':
      return `${exprLabel(node.object)}[${exprLabel(node.index)}]`;
    case 'TupleLiteral':
      return node.elements.length === 1 ? `(${exprLabel(node.elements[0])},)` : `(${node.elements.map(exprLabel).join(', ')})`;
    case 'IfExp':
      return `${exprLabel(node.body)} if ${exprLabel(node.test)} else ${exprLabel(node.orelse)}`;
    default:
      return '?';
  }
}

/** Conjunto de nomes (variável/ponteiro) referenciados por uma expressão —
 * usado pelo cursor de leitura de array (MicroRuntimeAdapter) pra saber
 * quais escritas devem disparar uma reavaliação: um cursor criado por
 * "nums[i + 1]" depende de `{i}`, então qualquer atribuição a "i" (em
 * qualquer linha, não só onde "nums[i + 1]" está escrito) atualiza o cursor. */
export function exprDependencies(node, out = new Set()) {
  switch (node.type) {
    case 'Name':
      out.add(node.name);
      break;
    case 'UnaryOp':
      exprDependencies(node.operand, out);
      break;
    case 'BinOp':
      exprDependencies(node.left, out);
      exprDependencies(node.right, out);
      break;
    case 'Compare':
      node.operands.forEach((o) => exprDependencies(o, out));
      break;
    case 'IfExp':
      exprDependencies(node.test, out);
      exprDependencies(node.body, out);
      exprDependencies(node.orelse, out);
      break;
    case 'Attribute':
      exprDependencies(node.object, out);
      break;
    case 'Index':
      exprDependencies(node.object, out);
      exprDependencies(node.index, out);
      break;
    case 'Slice':
      exprDependencies(node.object, out);
      if (node.start) exprDependencies(node.start, out);
      if (node.stop) exprDependencies(node.stop, out);
      if (node.step) exprDependencies(node.step, out);
      break;
    case 'Call':
      exprDependencies(node.callee, out);
      node.args.forEach((a) => exprDependencies(a, out));
      node.kwargs?.forEach((k) => exprDependencies(k.value, out));
      break;
    case 'TupleLiteral':
      node.elements.forEach((e) => exprDependencies(e, out));
      break;
    case 'FString':
      node.parts.forEach((p) => {
        if (typeof p === 'string') return;
        exprDependencies(p.expr, out);
        if (p.spec) exprDependencies(p.spec, out);
      });
      break;
    default:
      break;
  }
  return out;
}

/** Índices (0-based) selecionados por um slice `[start:stop:step]` de um
 * array de tamanho `len`, com a mesma semântica de Python (índices negativos
 * contam do fim, qualquer parte pode ser `null`/omitida, `step` negativo
 * inverte a direção). Devolve `undefined` só quando `step === 0` (inválido —
 * "step de slice não pode ser zero" em Python também). */
function sliceIndices(len, start, stop, step) {
  const s = step == null ? 1 : step;
  if (s === 0) return undefined;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
  const normalize = (v) => {
    if (v < 0) v += len;
    return s > 0 ? clamp(v, 0, len) : clamp(v, -1, len - 1);
  };
  let from = start == null ? (s > 0 ? 0 : len - 1) : normalize(start);
  let to = stop == null ? (s > 0 ? len : -1) : normalize(stop);
  const out = [];
  if (s > 0) {
    for (let i = from; i < to; i += s) out.push(i);
  } else {
    for (let i = from; i > to; i += s) out.push(i);
  }
  return out;
}

/** Nome do array referenciado por uma expressão — direto (`Name`, "arr") OU
 * indireto (qualquer outra expressão que RESOLVA pra um array por
 * referência, ex: "d[chave]" quando aquela célula guarda um array — ver
 * `ArrayRefValue`/caso 'Index' com dict, mais acima). Usada por todo builtin
 * que só sabe operar em array por NOME (len/sum/min/max/sorted/enumerate/
 * print/'in'/for, ver interpreter.js#resolveIterable) — é o que faz
 * "len(d[chave])"/"sum(d[chave])"/"for v in d[chave]:" funcionarem igual
 * "len(arr)"/"sum(arr)"/"for v in arr:", sem precisar que cada um desses
 * builtins saiba resolver a expressão sozinho. Devolve `undefined` quando a
 * expressão não é um `Name` nem resolve pra um array. */
function arrayNameFrom(node, env) {
  if (node.type === 'Name') return node.name;
  const v = evaluate(node, env);
  return v?.kind === 'arrayref' ? v.name : undefined;
}

/** "texto.split()" sem separador: quebra em qualquer sequência de espaços/
 * tabs, ignorando os das pontas ("  a  b ".split() == ['a', 'b']); com
 * `maxsplit`, o resto vai inteiro no último item, igual Python. */
function splitWhitespace(text, maxsplit) {
  const out = [];
  let rest = text.replace(/^\s+/, '');
  while (rest.length > 0) {
    if (maxsplit >= 0 && out.length === maxsplit) {
      out.push(rest);
      break;
    }
    const m = /\s/.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    out.push(rest.slice(0, m.index));
    rest = rest.slice(m.index).replace(/^\s+/, '');
  }
  return out;
}

/** "texto.split(sep)" com separador exato — "a,,b".split(",") == ['a', '', 'b']. */
function splitBy(text, sep, maxsplit) {
  const out = [];
  let rest = text;
  while (maxsplit < 0 || out.length < maxsplit) {
    const i = rest.indexOf(sep);
    if (i === -1) break;
    out.push(rest.slice(0, i));
    rest = rest.slice(i + sep.length);
  }
  out.push(rest);
  return out;
}

/** "texto.replace(velho, novo[, quantas])" — `count` negativo = todas.
 * "velho" vazio insere "novo" entre cada letra (e nas pontas), igual
 * Python: "abc".replace("", "-") == "-a-b-c-". */
function replaceText(text, oldSub, newSub, count) {
  let out = '';
  let n = 0;
  const more = () => count < 0 || n < count;
  if (oldSub === '') {
    for (let i = 0; i <= text.length; i += 1) {
      if (more()) {
        out += newSub;
        n += 1;
      }
      if (i < text.length) out += text[i];
    }
    return out;
  }
  let rest = text;
  while (more()) {
    const i = rest.indexOf(oldSub);
    if (i === -1) break;
    out += rest.slice(0, i) + newSub;
    rest = rest.slice(i + oldSub.length);
    n += 1;
  }
  return out + rest;
}

/** Trecho texto[início:fim] dos métodos que aceitam "início"/"fim" opcionais
 * (valores tipados ou undefined/None) — negativos contam do fim, "fim" além
 * do texto vira o fim do texto. `null` quando "início" passa do fim. */
function sliceRange(len, startArg, endArg) {
  const norm = (v, dflt) => (v === undefined || v.kind === 'none' ? dflt : v.value < 0 ? Math.max(0, len + v.value) : v.value);
  const start = norm(startArg, 0);
  if (start > len) return null;
  return { start, end: Math.min(norm(endArg, len), len) };
}

/** Métodos de texto (além de "sep".join, tratado à parte porque recebe um
 * iterável): upper(), lower(), strip/lstrip/rstrip([letras]), split([sep[, maxsplit]]),
 * replace(velho, novo[, quantas]), startswith/endswith/find/count(texto[,
 * início[, fim]]). Texto é imutável — todos devolvem um valor NOVO ("s =
 * s.upper()" pra mudar a variável); split devolve uma lista,
 * startswith/endswith um bool, find a posição (-1 se não achar) e count
 * quantas vezes aparece. Argumento
 * do tipo errado avisa no console. `undefined` pra qualquer outro método. */
function callStringMethod(text, method, argNodes, env) {
  const args = [];
  for (const a of argNodes) {
    const v = evaluate(a, env);
    if (v === undefined) return undefined;
    args.push(v);
  }
  const isInt = (v) => v?.kind === 'scalar' && Number.isInteger(v.value);
  const bad = (msg) => {
    env.warn?.(msg);
    return undefined;
  };

  if ((method === 'upper' || method === 'lower') && args.length === 0) {
    return StringValue(method === 'upper' ? text.toUpperCase() : text.toLowerCase());
  }

  if (method === 'split' && args.length <= 2) {
    const [sepArg, maxArg] = args;
    if (maxArg !== undefined && !isInt(maxArg)) return bad('split(sep, maxsplit): "maxsplit" precisa ser um número inteiro.');
    const maxsplit = maxArg ? maxArg.value : -1;
    if (sepArg === undefined || sepArg.kind === 'none') return ArrayValue(splitWhitespace(text, maxsplit));
    if (sepArg.kind !== 'string') return bad('split(sep): o separador precisa ser um texto, ex: frase.split(",").');
    if (sepArg.value === '') return bad('split(""): separador vazio não é permitido — pra separar as letras, use list(texto).');
    return ArrayValue(splitBy(text, sepArg.value, maxsplit));
  }

  // "texto.strip()" tira espaços/tabs/quebras das duas pontas;
  // "texto.strip(letras)" tira das pontas QUALQUER uma das letras dadas (não
  // a sequência): "xxaxbxx".strip("x") == "axb", "abcba".strip("ab") == "c".
  // lstrip/rstrip: mesma coisa, só da ponta esquerda/direita.
  if ((method === 'strip' || method === 'lstrip' || method === 'rstrip') && args.length <= 1) {
    const [charsArg] = args;
    if (charsArg !== undefined && charsArg.kind !== 'none' && charsArg.kind !== 'string') {
      return bad(`${method}(letras): o argumento precisa ser um texto, ex: s.${method}(".!").`);
    }
    const strips = charsArg === undefined || charsArg.kind === 'none' ? (ch) => /\s/.test(ch) : (ch) => charsArg.value.includes(ch);
    let start = 0;
    let end = text.length;
    if (method !== 'rstrip') while (start < end && strips(text[start])) start += 1;
    if (method !== 'lstrip') while (end > start && strips(text[end - 1])) end -= 1;
    return StringValue(text.slice(start, end));
  }

  // startswith/endswith/find/count: "texto.metodo(sub[, início[, fim]])" —
  // "início"/"fim" opcionais olham só o trecho texto[início:fim], igual
  // Python (negativos contam do fim). `range` = {start, end} do trecho, ou
  // null quando "início" passa do fim do texto (aí nada é encontrado, nem
  // texto vazio — mesma regra do Python).
  if (['startswith', 'endswith', 'find', 'count'].includes(method) && args.length >= 1 && args.length <= 3) {
    const [subArg, startArg, endArg] = args;
    if (subArg.kind !== 'string') {
      const example = { startswith: 'nome.startswith("A")', endswith: 'arquivo.endswith(".py")', find: 'frase.find("rato")', count: 'palavra.count("a")' }[method];
      return bad(`${method}(...): o argumento precisa ser um texto, ex: ${example} — converta números com str(x).`);
    }
    if ((startArg !== undefined && startArg.kind !== 'none' && !isInt(startArg)) || (endArg !== undefined && endArg.kind !== 'none' && !isInt(endArg))) {
      return bad(`${method}(texto, início, fim): "início" e "fim" precisam ser números inteiros.`);
    }
    const sub = subArg.value;
    const range = sliceRange(text.length, startArg, endArg);
    if (method === 'find' || method === 'count') {
      if (!range || range.end < range.start) return Scalar(method === 'find' ? -1 : 0);
      const part = text.slice(range.start, range.end);
      if (method === 'find') {
        const i = part.indexOf(sub);
        return Scalar(i === -1 ? -1 : range.start + i);
      }
      // ocorrências SEM sobreposição ("aaaa".count("aa") == 2); texto
      // vazio conta as posições entre as letras + 1 ("abc".count("") == 4)
      if (sub === '') return Scalar(part.length + 1);
      return Scalar(part.split(sub).length - 1);
    }
    if (!range) return BoolValue(false);
    const part = text.slice(range.start, Math.max(range.start, range.end));
    return BoolValue(method === 'startswith' ? part.startsWith(sub) : part.endsWith(sub));
  }

  if (method === 'replace' && (args.length === 2 || args.length === 3)) {
    const [oldArg, newArg, countArg] = args;
    if (oldArg.kind !== 'string' || newArg.kind !== 'string') {
      return bad('replace(velho, novo): os dois precisam ser textos — converta números com str(x).');
    }
    if (countArg !== undefined && !isInt(countArg)) return bad('replace(velho, novo, quantas): "quantas" precisa ser um número inteiro.');
    return StringValue(replaceText(text, oldArg.value, newArg.value, countArg ? countArg.value : -1));
  }

  return undefined;
}

/** "s[i]" — índice negativo conta do fim, igual Python. `undefined` fora do
 * intervalo (mesmo critério de "ignora a linha silenciosamente" de sempre). */
function stringCharAt(str, idx) {
  const i = idx < 0 ? str.length + idx : idx;
  return i < 0 || i >= str.length ? undefined : StringValue(str[i]);
}

/** Texto de um valor tipado pra "print(...)" — mesma regra de `str(valor)`
 * do Python (string "crua", sem aspas; o resto igual a `describeArg`/
 * `exprLabel`, que já usam essa mesma grafia noutros lugares da ferramenta).
 * `env` (opcional) expande uma lista viva no modelo ('arrayref') — sozinha
 * ou dentro de um dict/tupla: "{0: [7, 8]}", não "{0: <lista>}". */
function formatPrintValue(v, env) {
  switch (v.kind) {
    case 'scalar':
      return String(v.value);
    case 'string':
      return v.value;
    case 'bool':
      return v.value ? 'True' : 'False';
    case 'none':
      return 'None';
    case 'struct':
      return '<nó>';
    case 'array':
      return formatRawList(v.elements);
    case 'matrixrow':
      return formatRawList(v.cells);
    case 'matrix':
    case 'matrixref':
      return `[${v.rows.map(formatRawList).join(', ')}]`;
    case 'dict':
      return formatPrintDict(v.entries, env);
    case 'set':
      return formatPrintSet(v.elements, env);
    case 'deque':
      return formatPrintDeque(v.elements, v.maxlen, env);
    case 'nodelist':
      return formatPrintArray(v.items, env);
    case 'tuple': {
      // "(1, 'a')" — item de texto entre aspas, tupla de um item com
      // vírgula ("(1,)"), igual `repr()` do Python
      const parts = v.items.map((it) => reprItem(it, env));
      return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
    }
    case 'arrayref': {
      const items = env?.iterateArray?.(v.name);
      return items === undefined ? '<lista>' : formatLiveArray(v.name, items, env);
    }
    default:
      return '?';
  }
}

/** Texto de um item DENTRO de uma coleção (lista, set, tupla, valor de
 * dict) — `repr()` do Python: texto entre aspas, o resto igual
 * `formatPrintValue`. */
function reprItem(v, env) {
  return v.kind === 'string' ? pyStringRepr(v.value) : formatPrintValue(v, env);
}

/** Texto de uma lista de valores crus (célula de array/matriz) — igual
 * `repr()` de uma lista Python: `[1, 'a', True]`. */
function formatRawList(raws) {
  return `[${raws.map((e) => (typeof e === 'string' ? pyStringRepr(e) : typeof e === 'boolean' ? (e ? 'True' : 'False') : String(e))).join(', ')}]`;
}

/** Texto de um dict (`Map<chave, TypedValue>` — ver `DictValue`) — igual
 * `repr()` de um dict Python: `{'a': 1, 'b': 2}`. Ordem de inserção (Map já
 * preserva, igual dict do Python 3.7+). `env` como em `formatPrintValue`. */
export function formatPrintDict(entries, env) {
  const parts = [];
  entries.forEach((v, k) => {
    const keyText = typeof k === 'string' ? pyStringRepr(k) : String(k);
    parts.push(`${keyText}: ${reprItem(v, env)}`);
  });
  return `{${parts.join(', ')}}`;
}

/** Texto de um array já vivo no modelo (lista de valores tipados, ver
 * `env.iterateArray`) pra "print(nome)" — igual `repr()` de uma lista Python:
 * elemento string entre aspas, resto igual `formatPrintValue`. */
function formatPrintArray(items, env) {
  return `[${items.map((v) => reprItem(v, env)).join(', ')}]`;
}

/** Mesma ideia de `formatPrintArray`, com chaves — "{1, 2, 3}"; vazio é
 * "set()", igual Python ("{}" seria um dict). */
function formatPrintSet(items, env) {
  if (items.length === 0) return 'set()';
  return `{${items.map((v) => reprItem(v, env)).join(', ')}}`;
}

/** "deque([1, 2, 3])" / "deque([1, 2], maxlen=3)" — `repr()` do Python. */
function formatPrintDeque(items, maxlen, env) {
  return `deque(${formatPrintArray(items, env)}${maxlen != null ? `, maxlen=${maxlen}` : ''})`;
}

/** Texto de um array vivo por nome pro print/f-string — set com chaves,
 * deque como "deque([...])". */
function formatLiveArray(name, items, env) {
  if (env.isSet?.(name)) return formatPrintSet(items, env);
  if (env.isDeque?.(name)) return formatPrintDeque(items, env.dequeMaxlen?.(name) ?? null, env);
  return formatPrintArray(items, env);
}

const UNHASHABLE_WARNING = 'Set só guarda valores imutáveis (número, texto, bool, tupla) ou nós — lista/dict dentro de set (ou de uma tupla do set) não é permitido.';

/** `true` se todos os itens podem ir num set; senão avisa e devolve `false`. */
function checkHashable(items, env) {
  if (items.every(isHashable)) return true;
  env.warn?.(UNHASHABLE_WARNING);
  return false;
}

/** Elemento de literal que o compilador do Python trata como CONSTANTE
 * (número, texto, True/False/None, "-número") — decide como o literal de
 * set é montado (ver pyset.js#buildSetLiteral). */
function isConstantNode(n) {
  if (n.type === 'Number' || n.type === 'Str' || n.type === 'Bool' || n.type === 'NoneLiteral') return true;
  return n.type === 'UnaryOp' && n.op === '-' && n.operand.type === 'Number';
}

const hashSeedOf = (env) => env.hashSeed ?? 0n;

/** "s" (um set vivo no modelo, chega como 'arrayref') -> valor 'set' com o
 * conteúdo atual — pra comparar com "==" ("s == {1, 2}"). Qualquer outro
 * valor volta intacto. */
function materializeSet(v, env) {
  if (v?.kind !== 'arrayref' || !env.isSet?.(v.name)) return v;
  const items = env.iterateArray(v.name);
  return items === undefined ? v : SetValue(buildFromItems(items, hashSeedOf(env)));
}

/** "deque" ou "collections.deque" (depois de "import collections"). */
function isDequeCallee(callee) {
  if (callee.type === 'Name') return callee.name === 'deque';
  return callee.type === 'Attribute' && callee.attr === 'deque' && callee.object.type === 'Name' && callee.object.name === 'collections';
}

/** "deque()", "deque(iterável)", "deque(iterável, maxlen)" ou com
 * "maxlen=n" nomeado — um deque NOVO com os itens (só os `maxlen` últimos,
 * igual Python). Itens de qualquer iterável, inclusive uma lista de nós
 * ("fila = deque([raiz])" da BFS, ver 'nodelist'). */
function evalDequeCall(node, env) {
  const extra = (node.kwargs ?? []).find((k) => k.name !== 'maxlen');
  if (node.args.length > 2 || extra || (node.args.length === 2 && node.kwargs)) {
    env.warn?.(extra ? `deque() não tem o argumento "${extra.name}" — só deque(iterável, maxlen=n).` : 'deque(iterável, maxlen=n): argumentos demais.');
    return undefined;
  }
  let items = [];
  if (node.args.length >= 1) {
    items = collectionItems(node.args[0], env);
    if (items === undefined) return undefined;
  }
  let maxlen = null;
  const maxlenNode = node.args[1] ?? node.kwargs?.[0].value;
  if (maxlenNode) {
    const m = evaluate(maxlenNode, env);
    if (m === undefined) return undefined;
    if (m.kind !== 'none') {
      if (m.kind !== 'scalar' || !Number.isInteger(m.value) || m.value < 0) {
        env.warn?.('deque(..., maxlen=n): maxlen precisa ser um inteiro >= 0 (ou None).');
        return undefined;
      }
      maxlen = m.value;
    }
  }
  if (maxlen != null && items.length > maxlen) items = items.slice(items.length - maxlen);
  return DequeValue(items, maxlen);
}

const NOT_DEQUE_METHOD = Symbol('not a deque method');

/** Métodos de um deque vivo no modelo ("nome" chega já resolvido, ver
 * `arrayNameFrom`) — as duas pontas, com `maxlen`: inserir num deque cheio
 * descarta o item da ponta OPOSTA, igual Python. `remove`, `insert` (fora
 * do deque cheio) e "d[i]" seguem pelos caminhos de lista: `NOT_DEQUE_METHOD`
 * se `method` não é tratado aqui (`undefined` é erro já avisado). */
function callDequeMethod(name, method, args, env) {
  const maxlen = env.dequeMaxlen?.(name) ?? null;
  const len = () => env.getLength(name) ?? 0;
  const full = () => maxlen != null && len() >= maxlen;
  // `left`: na frente (posição 0) — cheio, sai o último; senão no fim e sai
  // o primeiro. maxlen=0 nunca guarda nada.
  const push = (value, left) => {
    if (maxlen === 0) return;
    if (full()) env.arrayPop(name, left ? undefined : 0);
    if (left) env.arrayInsert(name, 0, value);
    else env.arrayAppend(name, value);
  };
  const emptyWarn = (m) => env.warn?.(`${name}.${m}(): o deque está vazio.`);

  if ((method === 'append' || method === 'appendleft') && args.length === 1) {
    const v = evaluate(args[0], env);
    if (v === undefined) return undefined;
    push(v, method === 'appendleft');
    return NoneValue;
  }
  // "extendleft" põe um a um na frente — a ordem fica INVERTIDA, igual Python
  if ((method === 'extend' || method === 'extendleft') && args.length === 1) {
    const items = collectionItems(args[0], env);
    if (items === undefined) return undefined;
    items.forEach((v) => push(v, method === 'extendleft'));
    return NoneValue;
  }
  if ((method === 'pop' || method === 'popleft') && args.length === 0) {
    if (len() === 0) {
      emptyWarn(method);
      return undefined;
    }
    return env.arrayPop(name, method === 'popleft' ? 0 : undefined);
  }
  if (method === 'pop') {
    env.warn?.(`${name}.pop() não recebe posição em deque — use pop() (direita) ou popleft() (esquerda).`);
    return undefined;
  }
  if (method === 'insert' && full()) {
    env.warn?.(`${name}.insert(...): o deque já está no tamanho máximo (maxlen=${maxlen}).`);
    return undefined;
  }
  const items = () => env.iterateArray(name) ?? [];
  if (method === 'clear' && args.length === 0) {
    env.dequeSetItems?.(name, []);
    return NoneValue;
  }
  if (method === 'reverse' && args.length === 0) {
    env.dequeSetItems?.(name, items().reverse());
    return NoneValue;
  }
  // "rotate(n)": n > 0 gira pra direita (o último vira o primeiro), n < 0
  // pra esquerda; sem argumento, n = 1
  if (method === 'rotate' && args.length <= 1) {
    let n = 1;
    if (args.length === 1) {
      const v = evaluate(args[0], env);
      if (v === undefined || v.kind !== 'scalar' || !Number.isInteger(v.value)) {
        env.warn?.(`${name}.rotate(n): n precisa ser um número inteiro.`);
        return undefined;
      }
      n = v.value;
    }
    const all = items();
    if (all.length > 1) {
      const k = ((n % all.length) + all.length) % all.length;
      if (k) env.dequeSetItems?.(name, [...all.slice(all.length - k), ...all.slice(0, all.length - k)]);
    }
    return NoneValue;
  }
  if (method === 'count' && args.length === 1) {
    const v = evaluate(args[0], env);
    return v === undefined ? undefined : Scalar(items().filter((x) => valuesEqual(x, v)).length);
  }
  if (method === 'index' && args.length === 1) {
    const v = evaluate(args[0], env);
    if (v === undefined) return undefined;
    const i = items().findIndex((x) => valuesEqual(x, v));
    if (i === -1) env.warn?.(`${name}.index(...): o valor não está no deque.`);
    return i === -1 ? undefined : Scalar(i);
  }
  return NOT_DEQUE_METHOD;
}

/** Lista viva no modelo ('arrayref', não set nem deque) -> o mesmo valor de
 * uma lista literal com o conteúdo atual ('array' ou 'nodelist') — pra "==",
 * "+" e "*". Qualquer outro valor volta intacto. */
function materializeList(v, env) {
  if (v?.kind !== 'arrayref' || env.isSet?.(v.name) || env.isDeque?.(v.name)) return v;
  const items = env.iterateArray?.(v.name);
  if (items === undefined) return v;
  return listValueFrom(items, env) ?? v;
}

/** Texto -> inteiro, com as regras de "int(texto, base)" do Python: espaços
 * em volta, sinal, "_" entre dígitos ("1_000") e o prefixo da base ("0x" com
 * base 16, "0b" com 2, "0o" com 8). `undefined` se não é um inteiro válido
 * nessa base. */
function parseIntText(text, base) {
  let t = text.trim();
  let sign = 1;
  if (t.startsWith('+') || t.startsWith('-')) {
    if (t.startsWith('-')) sign = -1;
    t = t.slice(1);
  }
  const prefix = { 2: 'b', 8: 'o', 16: 'x' }[base];
  if (prefix && t.length > 2 && t[0] === '0' && t[1].toLowerCase() === prefix) t = t.slice(2).replace(/^_/, '');
  if (!/^[0-9a-z]+(_[0-9a-z]+)*$/i.test(t)) return undefined;
  let n = 0;
  for (const ch of t.replace(/_/g, '')) {
    const digit = parseInt(ch, 36);
    if (digit >= base) return undefined;
    n = n * base + digit;
  }
  return sign * n;
}

/** `repr()` de uma string em Python usa aspas simples (`'texto'`) por
 * convenção — só pra elemento dentro de um array impresso (ver
 * `formatPrintArray`); `print("texto")` sozinho imprime sem aspas nenhuma
 * (ver `formatPrintValue`). */
function pyStringRepr(str) {
  return `'${str.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

/** Texto de um valor tipado pro print e pra f-string — `str()` do Python, ou
 * `repr()` com `repr` (string entre aspas, igual "{x!r}"/"{x=}"). Um array
 * vivo chega do `evaluate` como 'arrayref' e é expandido por
 * `formatPrintValue` (set com chaves, ver `formatLiveArray`). */
function valueText(v, env, repr) {
  return repr ? reprItem(v, env) : formatPrintValue(v, env);
}

export function evaluate(node, env) {
  switch (node.type) {
    case 'Number':
      return Scalar(node.value);
    case 'Str':
      return StringValue(node.value);
    case 'FString': {
      // f"texto {expr!conv:spec} texto" (ver ast.js#FString) — cada campo é
      // avaliado da esquerda pra direita; se QUALQUER um não resolve, a
      // f-string inteira não resolve (mesmo critério do print). Spec
      // inválido pra aquele valor ("{nome:.2f}" com texto) avisa no console.
      let out = '';
      for (const part of node.parts) {
        if (typeof part === 'string') {
          out += part;
          continue;
        }
        const v = evaluate(part.expr, env);
        if (v === undefined) return undefined;
        let spec = '';
        if (part.spec) {
          const specValue = evaluate(part.spec, env);
          if (specValue === undefined) return undefined;
          spec = specValue.value;
        }
        // "{x=}" sem conversão nem spec mostra o repr, igual Python
        const conv = part.conv ?? (part.debug != null && !spec ? 'r' : null);
        try {
          const text = conv
            ? formatTextWithSpec(valueText(v, env, conv !== 's'), spec)
            : formatWithSpec(v, spec, valueText(v, env, false));
          out += (part.debug ?? '') + text;
        } catch (err) {
          if (!(err instanceof FormatError)) throw err;
          env.warn?.(`f-string: ${err.message}`);
          return undefined;
        }
      }
      return StringValue(out);
    }
    case 'Bool':
      return BoolValue(node.value);
    case 'NoneLiteral':
      return NoneValue;
    // valor já calculado — nó sintético (não sai do parser), usado por
    // interpreter.js#resolveUserCalls pra colocar o retorno de uma chamada
    // de função de usuário no meio de uma expressão maior.
    case 'Value':
      return node.value;

    case 'ArrayLiteral': {
      // "[1, 2, 3]" vira 'array'; "[[1, 2], [3, 4]]" (lista de listas do
      // mesmo tamanho) vira 'matrix' — ver `listValueFrom`.
      const items = [];
      for (const el of node.elements) {
        const v = evaluate(el, env);
        if (v === undefined) return undefined;
        items.push(v);
      }
      return listValueFrom(items, env);
    }

    case 'ListComp': {
      // "[elemento for nome in iterável (if condição)]" — roda a iteração
      // inteira aqui mesmo (num passo só da reprodução, como qualquer outra
      // expressão), com a variável do laço visível SÓ dentro da
      // comprehension, igual Python 3: em vez de `env.assignName` (que
      // criaria uma variável no canvas), cada iteração avalia o elemento num
      // escopo "por cima" do Environment real, que só sobrepõe `resolveName`
      // pros nomes do laço — todo o resto (arrays, matrizes, cursores de
      // leitura, criação de nós) continua indo pro Environment de verdade.
      const items = iterItemsFromExpr(node.iterExpr, env);
      if (items === undefined) return undefined;
      if (items.length > MAX_COMPREHENSION_ITEMS) {
        env.warn?.(`List comprehension grande demais (mais de ${MAX_COMPREHENSION_ITEMS} itens).`);
        return undefined;
      }
      const results = [];
      for (const item of items) {
        const values = loopValues(item, node.varNames.length);
        const bound = new Map();
        node.varNames.forEach((name, k) => {
          if (values[k] !== undefined) bound.set(name, values[k]);
        });
        const scope = Object.create(env);
        scope.resolveName = (name) => (bound.has(name) ? bound.get(name) : env.resolveName(name));
        if (node.cond && !truthy(evaluate(node.cond, scope), scope)) continue;
        const v = evaluate(node.element, scope);
        if (v === undefined) return undefined;
        results.push(v);
      }
      return listValueFrom(results, env);
    }

    case 'SetLiteral': {
      // "{1, 2, 3}" — repetidos somem ("{1, 1, 2}" é "{1, 2}") e a ordem é
      // a da tabela hash, igual Python (ver pyset.js).
      const items = [];
      for (const el of node.elements) {
        const v = evaluate(el, env);
        if (v === undefined) return undefined;
        items.push(v);
      }
      if (!checkHashable(items, env)) return undefined;
      return SetValue(buildSetLiteral(items, node.elements.every(isConstantNode), hashSeedOf(env)));
    }

    case 'TupleLiteral': {
      const items = [];
      for (const el of node.elements) {
        const v = evaluate(el, env);
        if (v === undefined) return undefined;
        items.push(v);
      }
      return TupleValue(items);
    }

    case 'DictLiteral': {
      const entries = new Map();
      for (const [keyNode, valNode] of node.pairs) {
        const key = valueToKey(evaluate(keyNode, env), env);
        const val = evaluate(valNode, env);
        if (key === undefined || val === undefined) return undefined;
        entries.set(key, val);
      }
      return DictValue(entries);
    }

    case 'Name': {
      const resolved = env.resolveName(node.name);
      if (resolved !== undefined) return resolved;
      // não é ponteiro/variável/dict — só resta checar se é um array já vivo
      // no modelo (arrays não são resolvidos por `resolveName`, ver
      // MicroRuntimeAdapter). Não veicula o CONTEÚDO do array (arrays
      // continuam não sendo valor de primeira classe pra isso), só o NOME,
      // suficiente pra alimentar "d[chave] = nome" — ver `ArrayRefValue`.
      if (env.iterateArray && env.iterateArray(node.name) !== undefined) return ArrayRefValue(node.name);
      // idem pra matriz — "len(m)", "print(m)", "b = m" (alias).
      const matrix = env.matrixInfo?.(node.name);
      if (matrix) return MatrixRefValue(matrix.name, matrix.rows);
      return undefined;
    }

    case 'Attribute': {
      const objectValue = evaluate(node.object, env);
      if (objectValue === undefined) return undefined;
      // "fila.maxlen" — o limite do deque (None se não tem)
      if (objectValue.kind === 'arrayref' && node.attr === 'maxlen' && env.isDeque?.(objectValue.name)) {
        const maxlen = env.dequeMaxlen?.(objectValue.name) ?? null;
        return maxlen == null ? NoneValue : Scalar(maxlen);
      }
      if (objectValue.kind === 'deque' && node.attr === 'maxlen') return objectValue.maxlen == null ? NoneValue : Scalar(objectValue.maxlen);
      return env.getAttr(objectValue, node.attr);
    }

    case 'Index': {
      // resolve o OBJETO primeiro (não o índice) — dict aceita chave
      // scalar/string (não precisa ser inteiro), string/array só aceitam
      // índice inteiro, então a validação do índice depende de que tipo de
      // objeto está sendo indexado.
      const objValue = node.object.type === 'Name' ? env.resolveName(node.object.name) : evaluate(node.object, env);

      if (objValue?.kind === 'dict') {
        const key = valueToKey(evaluate(node.index, env), env);
        if (key === undefined) return undefined;
        return objValue.entries.has(key) ? objValue.entries.get(key) : undefined;
      }

      const indexValue = evaluate(node.index, env);
      if (indexValue === undefined || indexValue.kind !== 'scalar' || !Number.isInteger(indexValue.value)) return undefined;

      // "t[i]" — tupla, índice negativo conta do fim (igual string)
      if (objValue?.kind === 'tuple') {
        const i = indexValue.value < 0 ? objValue.items.length + indexValue.value : indexValue.value;
        return objValue.items[i];
      }

      // string é valor de primeira classe (ao contrário de array): "s[i]"
      // funciona sobre QUALQUER expressão que resolva pra string, não só um
      // nome direto — ex: "(a + b)[0]". Índice negativo conta do fim, igual
      // Python.
      if (objValue?.kind === 'string') return stringCharAt(objValue.value, indexValue.value);

      // "d[chave][i]" — a chave guarda um array (`ArrayRefValue`, ver
      // `evaluate`, caso 'Index' com dict acima), então o objeto indexado
      // NÃO veio de um `Name` direto (veio de outro 'Index'), mas o NOME do
      // array já foi resolvido em tempo de execução por dentro do
      // `ArrayRefValue` — é só repassar pra `env.getIndex` como se fosse
      // "nome[i]" de verdade, mesmo caminho de sempre.
      if (objValue?.kind === 'arrayref') return env.getIndex(objValue.name, node.index, indexValue.value);

      // "m[i][j]" — o objeto indexado é "m[i]" (uma linha, ver abaixo): lê a
      // célula pelo Environment, passando as DUAS expressões de índice (linha
      // e coluna) pro cursor de leitura "m[i][j]" poder ser reavaliado depois
      // (mesma ideia do cursor de array, ver MicroRuntimeAdapter).
      if (objValue?.kind === 'matrixrow') {
        return env.getMatrixCell?.(objValue.name, node.object.index, objValue.row, node.index, indexValue.value);
      }
      if (objValue?.kind === 'matrixref') {
        const info = env.matrixInfo?.(objValue.name);
        return info ? matrixRowOf(info, indexValue.value) : undefined;
      }

      // "sorted(nums)[0]", "[3, 1, 2][-1]" — lista que é resultado de uma
      // expressão (não está no modelo, então não tem cursor de leitura)
      if (objValue?.kind === 'array' || objValue?.kind === 'nodelist') {
        const items = iterableItems(objValue, env);
        const i = indexValue.value < 0 ? items.length + indexValue.value : indexValue.value;
        return items[i];
      }

      if (node.object.type !== 'Name') return undefined;

      // "m[i]" com "m" uma matriz viva no modelo — devolve a LINHA
      // ('matrixrow'), sem cursor próprio (só "m[i][j]" cria cursor).
      const matrix = env.matrixInfo?.(node.object.name);
      if (matrix) return matrixRowOf(matrix, indexValue.value);

      // não é uma variável-string/dict com esse nome — tenta como array já
      // vivo no modelo, mesmo caminho de sempre (arrays não são valor de
      // primeira classe pra encadear expressão nenhuma, só NOME direto).
      // Passa o nó do índice (não só o valor já resolvido) pra quem
      // implementa `getIndex` poder criar um cursor de leitura reativo — ver
      // MicroRuntimeAdapter#_showReadCursor, que reavalia essa expressão
      // sempre que uma variável dela é escrita em outra linha.
      return env.getIndex(node.object.name, node.index, indexValue.value);
    }

    case 'Slice': {
      // "objeto[a:b:c]" — sobre uma STRING (valor de primeira classe,
      // qualquer expressão) ou sobre o NOME direto de um array de VALORES já
      // vivo no modelo (mesma restrição de "Index"/"len" pra array). Devolve
      // um valor novo (não uma "visão" do original, igual Python de verdade)
      // — pro array, é o mesmo tipo de valor de um literal "[1, 2, 3]", então
      // "b = a[1:3]" cria um array novo no modelo através do caminho já
      // existente de `assignName` (ver MicroRuntimeAdapter#assignName, caso
      // 'array').
      const parsePart = (partNode) => {
        if (partNode === null) return null;
        const v = evaluate(partNode, env);
        return v === undefined || v.kind !== 'scalar' || !Number.isInteger(v.value) ? NaN : v.value;
      };
      const start = parsePart(node.start);
      const stop = parsePart(node.stop);
      const step = parsePart(node.step);
      if (Number.isNaN(start) || Number.isNaN(stop) || Number.isNaN(step)) return undefined;

      const objValue = node.object.type === 'Name' ? env.resolveName(node.object.name) : evaluate(node.object, env);
      if (objValue?.kind === 'string') {
        const indices = sliceIndices(objValue.value.length, start, stop, step);
        if (indices === undefined) return undefined;
        return StringValue(indices.map((idx) => objValue.value[idx]).join(''));
      }
      if (objValue?.kind === 'tuple') {
        const indices = sliceIndices(objValue.items.length, start, stop, step);
        return indices === undefined ? undefined : TupleValue(indices.map((idx) => objValue.items[idx]));
      }

      // lista de VALORES — número, texto ou bool — ou de NÓS (uma lista de
      // referências nova, ver 'nodelist'): resultado de uma expressão
      // ("sorted(nums)[::-1]", "list('abc')[1:]", "m[i][1:]") ou lista viva
      // no modelo, por nome ou por expressão ("d[chave][1:]")
      let items;
      if (objValue?.kind === 'array' || objValue?.kind === 'matrixrow') items = iterableItems(objValue, env);
      else if (objValue?.kind === 'nodelist') items = objValue.items;
      else {
        const listName = objValue?.kind === 'arrayref' ? objValue.name : node.object.type === 'Name' ? node.object.name : null;
        if (listName == null || !env.iterateArray) return undefined;
        const shown = node.object.type === 'Name' ? node.object.name : exprLabel(node.object);
        if (env.isSet?.(listName)) {
          env.warn?.(`Set não tem posições — "${shown}[...]" não é permitido (use "sorted(${shown})" pra ter uma lista).`);
          return undefined;
        }
        if (env.isDeque?.(listName)) {
          // o TypeError do Python — deque tem índice, mas não fatia
          env.warn?.(`Deque não aceita fatia — "${shown}[a:b]" não é permitido (use "list(${shown})[a:b]").`);
          return undefined;
        }
        items = env.iterateArray(listName);
      }
      if (items === undefined) return undefined;
      const indices = sliceIndices(items.length, start, stop, step);
      if (indices === undefined) return undefined;
      if (items.length && items.every(isNodeItem)) return NodeListValue(indices.map((idx) => items[idx]));
      if (!items.every((v) => valueToRaw(v) !== undefined)) return undefined;
      return ArrayValue(indices.map((idx) => valueToRaw(items[idx])));
    }

    case 'Call': {
      // "deque(...)" / "collections.deque(...)" — o único built-in com
      // argumento nomeado ("maxlen=n"); em qualquer outro, "nome=valor" avisa
      // em vez de ser ignorado calado (função do usuário com argumento
      // nomeado nem chega aqui, ver interpreter.js#tryUserCall)
      if (isDequeCallee(node.callee)) return evalDequeCall(node, env);
      if (node.kwargs) {
        env.warn?.(`Argumento nomeado ("${node.kwargs[0].name}=...") não é suportado nessa chamada — só em deque(..., maxlen=n) e em funções definidas com "def".`);
        return undefined;
      }

      // pequena tabela de "built-ins" reconhecidos por nome — as demais
      // chamadas continuam fora do escopo da ferramenta (só a sintaxe é
      // aceita, não são executadas).
      if (node.callee.type === 'Name') {
        const fname = node.callee.name;

        // "Node(valor)" — único "construtor": cria de fato um novo nó de
        // estrutura no modelo (efeito colateral do `evaluate`, igual ao
        // cursor de leitura de array) e devolve uma referência pra ele.
        if (fname === 'Node' && node.args.length === 1) {
          const arg = evaluate(node.args[0], env);
          if (arg === undefined || (arg.kind !== 'scalar' && arg.kind !== 'string')) return undefined;
          const id = env.createStruct(arg.value, 'list');
          return id == null ? undefined : StructRef(id);
        }

        // "TreeNode(valor)" — mesma ideia de "Node(valor)", mas cria um struct
        // de tipo 'tree' (campos left/right em vez de next/prev, ver
        // MicroRuntimeAdapter#getAttr/assignAttr) — nó pré-construído pra
        // árvore binária/BST, mesmo desenho de caixa (prev|data|next vira
        // left|data|right), sem precisar de campos arbitrários no struct.
        if (fname === 'TreeNode' && node.args.length === 1) {
          const arg = evaluate(node.args[0], env);
          if (arg === undefined || (arg.kind !== 'scalar' && arg.kind !== 'string')) return undefined;
          const id = env.createStruct(arg.value, 'tree');
          return id == null ? undefined : StructRef(id);
        }

        // "GraphNode(valor)" — mesma ideia de "Node(valor)"/"TreeNode(valor)",
        // mas cria um struct de tipo 'graph': `data` (igual aos outros dois)
        // e `neighbors`, uma LISTA de verdade (não um único campo-referência
        // como next/prev/left/right) — grau arbitrário, pensado pra
        // representar grafos (lista de adjacência). Fica vazia
        // ("neighbors = []") já na criação; cresce por
        // "nó.neighbors.append(outroNó)" (ver o caso 'Attribute' de método
        // mais abaixo) — mesmo verbo que qualquer array já usa.
        if (fname === 'GraphNode' && node.args.length === 1) {
          const arg = evaluate(node.args[0], env);
          if (arg === undefined || (arg.kind !== 'scalar' && arg.kind !== 'string')) return undefined;
          const id = env.createStruct(arg.value, 'graph');
          return id == null ? undefined : StructRef(id);
        }

        // "len(nome)" — tamanho de um array já vivo no modelo (nome DIRETO ou
        // uma expressão que resolva pra um, ex: "len(d[chave])" — ver
        // `arrayNameFrom`; arrays continuam não sendo valor de primeira
        // classe pra mais nada além disso) OU "len(expr)" de uma STRING (essa
        // sim valor de primeira classe, qualquer expressão vale).
        if (fname === 'len' && node.args.length === 1) {
          const arrName = arrayNameFrom(node.args[0], env);
          if (arrName != null) {
            const n = env.getLength(arrName);
            if (n != null) return Scalar(n);
          }
          const v = evaluate(node.args[0], env);
          if (v?.kind === 'string') return Scalar(v.value.length);
          if (v?.kind === 'dict') return Scalar(v.entries.size);
          if (v?.kind === 'tuple') return Scalar(v.items.length);
          // "len(m)" = número de linhas; "len(m[i])" = número de colunas
          if (v?.kind === 'matrixref' || v?.kind === 'matrix') return Scalar(v.rows.length);
          if (v?.kind === 'matrixrow' || v?.kind === 'array') return Scalar(v.kind === 'array' ? v.elements.length : v.cells.length);
          if (v?.kind === 'set' || v?.kind === 'deque') return Scalar(v.elements.length);
          if (v?.kind === 'nodelist') return Scalar(v.items.length);
          return undefined;
        }

        // "list()" (lista vazia) ou "list(iterável)": uma lista NOVA com os
        // itens — texto vira uma letra por item ("list('abc')" == ['a', 'b',
        // 'c']), range/set/outra lista/chaves de dict entram na ordem em que
        // seriam percorridos. Mesmo tipo de valor de um literal "[...]", então
        // "letras = list(palavra)" cria o array pelo caminho de sempre.
        if (fname === 'list' && node.args.length <= 1) {
          if (node.args.length === 0) return ArrayValue([]);
          const items = collectionItems(node.args[0], env);
          if (items === undefined) return undefined;
          const list = listValueFrom(items, env);
          if (list?.kind !== 'array' && list?.kind !== 'nodelist') {
            env.warn?.('list(...): só dá pra criar listas de valores simples (número, texto, bool) ou de nós.');
            return undefined;
          }
          return list;
        }

        // "tuple()" / "tuple(iterável)" — mesmos itens de "list(...)", como
        // tupla (ex: "tuple(par)" pra usar uma lista como chave de dict).
        if (fname === 'tuple' && node.args.length <= 1) {
          if (node.args.length === 0) return TupleValue([]);
          const items = collectionItems(node.args[0], env);
          return items === undefined ? undefined : TupleValue(items);
        }

        // "set()" (set vazio — "{}" é dict) ou "set(iterável)": lista viva,
        // literal, range, texto (um elemento por letra), outro set, chaves de
        // dict... — sem repetidos, na ordem da tabela hash. Cada origem é
        // montada do jeito que o CPython monta (ver pyset.js): outro set é
        // copiado tabela a tabela, dict reserva espaço antes, o resto entra
        // um a um.
        if (fname === 'set' && node.args.length <= 1) {
          const seed = hashSeedOf(env);
          if (node.args.length === 0) return SetValue(emptyTable());
          const v = evaluate(node.args[0], env);
          if (v === undefined) return undefined;
          if (v.kind === 'set') return SetValue(buildFromTable(v.table));
          if (v.kind === 'arrayref' && env.isSet?.(v.name)) {
            const table = env.setTable?.(v.name);
            if (table) return SetValue(buildFromTable(table));
          }
          const pairs = iterableItems(v, env);
          if (pairs === undefined) return undefined;
          const items = pairsAsTuples(pairs); // "set(d.items())"
          if (!checkHashable(items, env)) return undefined;
          return SetValue(v.kind === 'dict' ? buildFromDictKeys(items, seed) : buildFromItems(items, seed));
        }

        // "range(fim)", "range(início, fim)" ou "range(início, fim, passo)" —
        // passo negativo conta pra trás ("range(n - 1, -1, -1)" percorre de
        // n-1 até 0). Só existe pra alimentar um "for" (ver
        // interpreter.js#resolveIterable), nunca circula além disso: o valor
        // devolvido aqui é só um {start, stop, step} sem efeito nenhum no
        // modelo.
        if (fname === 'range' && node.args.length >= 1 && node.args.length <= 3) {
          const argValues = node.args.map((a) => evaluate(a, env));
          if (argValues.some((v) => v === undefined || v.kind !== 'scalar' || !Number.isInteger(v.value))) return undefined;
          const [start, stop, step] =
            argValues.length === 1 ? [0, argValues[0].value, 1] : [argValues[0].value, argValues[1].value, argValues[2]?.value ?? 1];
          if (step === 0) {
            env.warn?.('range(): o passo não pode ser zero.');
            return undefined;
          }
          return RangeValue(start, stop, step);
        }

        // "sum(iterável)" — soma de números (lista, set, range... ver
        // `collectionItems`).
        if (fname === 'sum' && node.args.length === 1) {
          const items = collectionItems(node.args[0], env);
          if (items === undefined || !items.every((v) => v.kind === 'scalar')) return undefined;
          return Scalar(items.reduce((acc, v) => acc + v.value, 0));
        }

        // "min(iterável)"/"max(iterável)" (menor/maior item, números ou
        // strings) ou "min(a, b, ...)"/"max(a, b, ...)" (menor/maior de
        // vários argumentos soltos) — mesmas duas formas que o builtin de
        // Python tem. Strings comparam lexicograficamente.
        if ((fname === 'min' || fname === 'max') && node.args.length >= 1) {
          const items = node.args.length === 1 ? collectionItems(node.args[0], env) : node.args.map((a) => evaluate(a, env));
          if (items === undefined || items.length === 0 || items.some((v) => v === undefined)) return undefined;
          if (items.every((v) => v.kind === 'scalar')) {
            const values = items.map((v) => v.value);
            return Scalar(fname === 'min' ? Math.min(...values) : Math.max(...values));
          }
          if (items.every((v) => v.kind === 'string')) {
            const values = items.map((v) => v.value);
            const picked = values.reduce((acc, v) => {
              const better = fname === 'min' ? v < acc : v > acc;
              return better ? v : acc;
            });
            return StringValue(picked);
          }
          // tuplas (ou número com bool) — ordem de `compareValues`; empate
          // fica com o primeiro, igual Python
          let picked = items[0];
          for (const v of items.slice(1)) {
            const c = compareValues(v, picked);
            if (c === undefined) {
              env.warn?.(`${fname}(): esses valores não podem ser comparados entre si.`);
              return undefined;
            }
            if (fname === 'min' ? c < 0 : c > 0) picked = v;
          }
          return picked;
        }

        // "sorted(iterável)" — devolve um array NOVO (não altera o original),
        // igual ao literal "[1, 2, 3]": alimenta "b = sorted(a)" através do
        // mesmo caminho de `assignName` que cria um array a partir do zero.
        // Aceita qualquer iterável ("sorted(set(palavra))", "sorted('cba')").
        // Números ordenam numericamente, strings lexicograficamente (mesma
        // regra de "min"/"max"); misturar os dois é erro em Python também.
        if (fname === 'sorted' && node.args.length === 1) {
          const items = collectionItems(node.args[0], env);
          if (items === undefined) return undefined;
          if (items.every((v) => v.kind === 'scalar')) return ArrayValue(items.map((v) => v.value).sort((a, b) => a - b));
          if (items.every((v) => v.kind === 'string')) return ArrayValue(items.map((v) => v.value).sort());
          // tuplas ("sorted(d.items())", "sorted(pontos)") — lexicográfica,
          // estável (sort do JS também é), ver `compareValues`
          let comparable = true;
          const sorted = [...items].sort((a, b) => {
            const c = compareValues(a, b);
            if (c === undefined) comparable = false;
            return c ?? 0;
          });
          if (comparable && sorted.every((v) => valueToRaw(v) !== undefined)) return ArrayValue(sorted.map(valueToRaw));
          env.warn?.(
            comparable
              ? 'sorted(): o resultado tem itens que não cabem numa lista (ex: tupla com nó dentro).'
              : 'sorted(): os itens precisam ser comparáveis entre si — só números, só textos ou só tuplas.',
          );
          return undefined;
        }

        // "enumerate(iterável)" — só existe pra alimentar um "for i, v in
        // enumerate(...):" (ver ast.js#For, interpreter.js#resolveIterable),
        // nunca circula além disso, mesma família de "range".
        if (fname === 'enumerate' && node.args.length === 1) {
          const items = collectionItems(node.args[0], env);
          if (items === undefined) return undefined;
          return PairsValue(items.map((v, i) => [Scalar(i), v]));
        }

        // "str(valor)" — o mesmo texto que o print mostraria (ex: pra juntar
        // números com "sep".join(...), que só aceita textos).
        if (fname === 'str' && node.args.length === 1) {
          const v = evaluate(node.args[0], env);
          return v === undefined ? undefined : StringValue(valueText(v, env, false));
        }

        // "abs(x)" — valor absoluto; bool conta como 0/1, igual Python.
        if (fname === 'abs' && node.args.length === 1) {
          const v = evaluate(node.args[0], env);
          if (v === undefined) return undefined;
          if (v.kind === 'scalar' || v.kind === 'bool') return Scalar(Math.abs(Number(v.value)));
          env.warn?.('abs(x): x precisa ser um número.');
          return undefined;
        }

        // "int()" (0), "int(x)" — número sem a parte fracionária (corta em
        // direção a zero: int(-2.7) é -2), bool vira 0/1, texto é lido como
        // inteiro ("int('42')", "int(' -7 ')") — "int('3.5')" é o ValueError
        // do Python — e "int(texto, base)" lê em outra base ("int('ff', 16)",
        // "int('0b101', 2)").
        if (fname === 'int' && node.args.length <= 2) {
          if (node.args.length === 0) return Scalar(0);
          const v = evaluate(node.args[0], env);
          if (v === undefined) return undefined;
          let base = 10;
          if (node.args.length === 2) {
            const b = evaluate(node.args[1], env);
            if (b === undefined) return undefined;
            if (b.kind !== 'scalar' || !Number.isInteger(b.value) || b.value < 2 || b.value > 36) {
              env.warn?.('int(texto, base): a base precisa ser um inteiro de 2 a 36.');
              return undefined;
            }
            if (v.kind !== 'string') {
              env.warn?.('int(x, base): com base, x precisa ser um texto — ex: int("ff", 16).');
              return undefined;
            }
            base = b.value;
          }
          if (v.kind === 'scalar') return Scalar(Math.trunc(v.value));
          if (v.kind === 'bool') return Scalar(Number(v.value));
          if (v.kind === 'string') {
            const n = parseIntText(v.value, base);
            if (n === undefined) env.warn?.(`int(...): ${pyStringRepr(v.value)} não é um número inteiro${base === 10 ? '' : ` na base ${base}`}.`);
            return n === undefined ? undefined : Scalar(n);
          }
          env.warn?.('int(x): x precisa ser um número, um bool ou um texto com um número inteiro.');
          return undefined;
        }

        // "print(a, b, ...)" — escreve no console da ferramenta (ver
        // `env.print`, opcional: sem ele — ex. algum Environment futuro que
        // não tenha console — a chamada só devolve None sem efeito, mesmo
        // critério de sempre). Argumentos juntados com espaço, igual Python;
        // se QUALQUER argumento não resolve, a chamada inteira é ignorada
        // (mesmo critério de "ignora a linha silenciosamente" de sempre, em
        // vez de imprimir uma linha capenga com "None" no meio).
        if (fname === 'print') {
          const parts = [];
          // UMA avaliação por argumento (efeitos como "Node(5)" ou o aviso
          // de "s[0]" não podem acontecer duas vezes). Array vivo no modelo
          // chega como 'arrayref' (nome direto ou "d[chave]") e é expandido
          // pelo `valueText` — mesmo texto de "str()" do Python. Igual
          // Python, TODOS os argumentos são avaliados antes de virar texto:
          // "print(s, s.pop())" mostra "s" já sem o elemento retirado.
          const values = [];
          for (const a of node.args) {
            const v = evaluate(a, env);
            if (v === undefined) return undefined;
            values.push(v);
          }
          values.forEach((v) => parts.push(valueText(v, env, false)));
          env.print?.(parts.join(' '));
          return NoneValue;
        }

        return undefined;
      }

      // "nome.append(valor)" / "nome.pop()" / "nome.pop(índice)" — únicos
      // métodos reconhecidos, sempre num array já vivo no modelo (mesma
      // restrição de "len": só NOME direto, sem encadear expressão).
      // "nome.get(chave)"/"nome.get(chave, padrão)"/"nome.keys()"/
      // "nome.values()"/"nome.items()" — dict é valor de primeira classe
      // (diferente de array), então o objeto é resolvido do jeito normal
      // (Name ou qualquer expressão), não só por NOME direto.
      if (node.callee.type === 'Attribute') {
        const method = node.callee.attr;
        const objValue =
          node.callee.object.type === 'Name' ? env.resolveName(node.callee.object.name) : evaluate(node.callee.object, env);
        // "sep".join(iterável) — junta os textos com `sep` entre eles
        // ("".join(sorted(set(palavra))), ", ".join(nomes)). Só textos, igual
        // Python — números precisam de str(x) antes.
        if (objValue?.kind === 'string') {
          if (method === 'join' && node.args.length === 1) {
            const items = collectionItems(node.args[0], env);
            if (items === undefined) return undefined;
            if (!items.every((v) => v.kind === 'string')) {
              env.warn?.('"sep".join(...) só junta textos — converta números com str(x), ex: [str(x) for x in nums].');
              return undefined;
            }
            return StringValue(items.map((v) => v.value).join(objValue.value));
          }
          return callStringMethod(objValue.value, method, node.args, env);
        }
        if (objValue?.kind === 'dict') {
          if (method === 'get' && (node.args.length === 1 || node.args.length === 2)) {
            const key = valueToKey(evaluate(node.args[0], env), env);
            if (key === undefined) return undefined;
            if (objValue.entries.has(key)) return objValue.entries.get(key);
            if (node.args.length === 2) return evaluate(node.args[1], env);
            return NoneValue;
          }
          if (method === 'keys' && node.args.length === 0) {
            return IterValue([...objValue.entries.keys()].map(rawToValue));
          }
          if (method === 'values' && node.args.length === 0) {
            return IterValue([...objValue.entries.values()]);
          }
          if (method === 'items' && node.args.length === 0) {
            return PairsValue(
              [...objValue.entries.entries()].map(([k, v]) => [rawToValue(k), v]),
            );
          }
          // método de set num dict — quase sempre "s = {}" achando que cria
          // um set vazio (em Python, "{}" é SEMPRE dict; o AttributeError
          // dele). Avisa em vez de ignorar calado.
          if (method === 'add' || method === 'discard') {
            const name = node.callee.object.type === 'Name' ? node.callee.object.name : 'dict';
            env.warn?.(`"${name}" é um dict — dict não tem ".${method}()". "{}" cria um dict vazio; pra um set vazio, use "set()".`);
          }
          return undefined;
        }
      }

      if (node.callee.type === 'Attribute') {
        // "nome.append(valor)"/"nome.pop([índice])" — mesma resolução de
        // "len(nome)"/"sorted(nome)" etc (ver `arrayNameFrom`): NOME direto
        // (caso comum) OU qualquer expressão que resolva pra um array já
        // vivo no modelo via `ArrayRefValue` — é o que faz
        // "nó.neighbors.append(outroNó)" funcionar (structValue.neighbors
        // vem de `env.getAttr`, ver MicroRuntimeAdapter, kind:'arrayref'
        // igual "d[chave]"), sem precisar de um caminho novo só pra isso.
        const arrayName = arrayNameFrom(node.callee.object, env);
        const method = node.callee.attr;
        // set vivo no modelo — "s.add(x)", "s.remove(x)" (avisa se x não
        // está lá, o KeyError do Python), "s.discard(x)" (não avisa),
        // "s.pop()" (tira o elemento que o Python tiraria, ver
        // pyset.js#tablePop). Métodos de lista com posição não existem em set.
        if (arrayName != null && env.isDeque?.(arrayName)) {
          const result = callDequeMethod(arrayName, method, node.args, env);
          if (result !== NOT_DEQUE_METHOD) return result;
        }
        if (arrayName != null && env.isSet?.(arrayName)) {
          if ((method === 'add' || method === 'remove' || method === 'discard') && node.args.length === 1) {
            const arg = evaluate(node.args[0], env);
            if (arg === undefined || !checkHashable([arg], env)) return undefined;
            if (method === 'add') env.setAdd(arrayName, arg);
            else env.setRemove(arrayName, arg, method === 'remove');
            return NoneValue;
          }
          if (method === 'pop' && node.args.length === 0) return env.setPop(arrayName);
          if (method === 'append' || method === 'insert') {
            env.warn?.(`Set não tem "${method}" — use "${arrayName}.add(valor)".`);
          } else if (method === 'pop') {
            env.warn?.(`Set não tem posições — "${arrayName}.pop()" (sem índice) tira um elemento qualquer.`);
          }
          return undefined;
        }
        if (arrayName != null && method === 'append' && node.args.length === 1) {
          const arg = evaluate(node.args[0], env);
          if (arg === undefined) return undefined;
          env.arrayAppend(arrayName, arg);
          return NoneValue; // mesmo comportamento de list.append em Python
        }
        // "nome.extend(iterável)" — um "append" por item, na ordem. Os itens
        // são lidos ANTES de qualquer escrita ("a.extend(a)" duplica a lista
        // uma vez só, igual Python). Para no primeiro que não couber (lista
        // cheia — `arrayAppend` já avisou).
        if (arrayName != null && method === 'extend' && node.args.length === 1) {
          const items = collectionItems(node.args[0], env);
          if (items === undefined) return undefined;
          for (const item of items) {
            const before = env.getLength(arrayName);
            env.arrayAppend(arrayName, item);
            if (env.getLength(arrayName) === before) break;
          }
          return NoneValue;
        }
        // "nome.insert(i, valor)" — insere ANTES da posição i, igual Python:
        // i negativo conta do fim ("insert(-1, x)" entra antes do último),
        // e i fora da lista não é erro — vai pra ponta (0 ou o fim).
        if (arrayName != null && method === 'insert' && node.args.length === 2 && env.arrayInsert) {
          const idxValue = evaluate(node.args[0], env);
          if (idxValue === undefined) return undefined;
          if (idxValue.kind !== 'scalar' || !Number.isInteger(idxValue.value)) {
            env.warn?.(`${arrayName}.insert(posição, valor): a posição precisa ser um número inteiro.`);
            return undefined;
          }
          const arg = evaluate(node.args[1], env);
          if (arg === undefined) return undefined;
          const len = env.getLength(arrayName) ?? 0;
          let i = idxValue.value;
          if (i < 0) i = Math.max(0, len + i);
          if (i > len) i = len;
          env.arrayInsert(arrayName, i, arg);
          return NoneValue;
        }
        // "nome.remove(valor)" — tira a PRIMEIRA ocorrência do valor (por
        // igualdade, igual "=="), não uma posição; valor ausente é o
        // ValueError do Python — avisa. Reaproveita o "pop(i)" do Environment.
        if (arrayName != null && method === 'remove' && node.args.length === 1) {
          const arg = evaluate(node.args[0], env);
          if (arg === undefined) return undefined;
          const items = env.iterateArray?.(arrayName);
          if (items === undefined) return undefined;
          const i = items.findIndex((v) => valuesEqual(v, arg));
          if (i === -1) {
            env.warn?.(`${arrayName}.remove(...): o valor não está na lista.`);
            return undefined;
          }
          env.arrayPop(arrayName, i);
          return NoneValue;
        }
        if (arrayName != null && method === 'pop' && node.args.length <= 1) {
          let index;
          if (node.args.length === 1) {
            const idxValue = evaluate(node.args[0], env);
            if (idxValue === undefined || idxValue.kind !== 'scalar' || !Number.isInteger(idxValue.value)) return undefined;
            index = idxValue.value;
            if (index < 0) index += env.getLength(arrayName) ?? 0; // "pop(-1)" conta do fim
          }
          return env.arrayPop(arrayName, index);
        }
      }

      return undefined;
    }

    case 'UnaryOp': {
      const v = evaluate(node.operand, env);
      if (v === undefined) return undefined;
      if (node.op === 'not') return BoolValue(!truthy(v, env));
      if (node.op === '-') return v.kind === 'scalar' ? Scalar(-v.value) : undefined;
      return undefined;
    }

    case 'Compare': {
      // "a < b <= c" (ver ast.js#Compare) — cada par vira um 'BinOp' com os
      // operandos JÁ avaliados (nó sintético 'Value'), então "b" é lido uma
      // vez só (um cursor de leitura "nums[i]" no meio não anda duas vezes)
      // e toda a semântica de cada operador ('in' com lista viva, '==' de
      // set...) continua sendo a do caso 'BinOp'. Para na primeira falsa.
      let left = evaluate(node.operands[0], env);
      if (left === undefined) return undefined;
      let result;
      for (let k = 0; k < node.ops.length; k += 1) {
        const right = evaluate(node.operands[k + 1], env);
        if (right === undefined) return undefined;
        result = evaluate({ type: 'BinOp', op: node.ops[k], left: { type: 'Value', value: left }, right: { type: 'Value', value: right } }, env);
        if (result === undefined || !truthy(result, env)) return result;
        left = right;
      }
      return result;
    }

    case 'IfExp': {
      // "a if cond else b" — só o ramo escolhido é avaliado (um "Node(v)" ou
      // cursor de leitura do outro ramo não pode acontecer)
      const test = evaluate(node.test, env);
      if (test === undefined) return undefined;
      return evaluate(truthy(test, env) ? node.body : node.orelse, env);
    }

    case 'BinOp': {
      if (node.op === 'and' || node.op === 'or') {
        const left = evaluate(node.left, env);
        if (left === undefined) return undefined;
        if (node.op === 'and') return truthy(left, env) ? evaluate(node.right, env) : left;
        return truthy(left, env) ? left : evaluate(node.right, env);
      }
      if (node.op === 'in' || node.op === 'notin') {
        const left = evaluate(node.left, env);
        if (left === undefined) return undefined;

        // "sub in string" / "chave in dict" — os dois são valor de primeira
        // classe, então o lado direito é avaliado normalmente (ou por nome,
        // se for uma variável).
        const rightValue = node.right.type === 'Name' ? env.resolveName(node.right.name) : evaluate(node.right, env);
        if (rightValue?.kind === 'string') {
          if (left.kind !== 'string') return undefined;
          const found = rightValue.value.includes(left.value);
          return BoolValue(node.op === 'in' ? found : !found);
        }
        if (rightValue?.kind === 'matrixrow') {
          const found = rightValue.cells.some((raw) => valuesEqual(rawToValue(raw), left));
          return BoolValue(node.op === 'in' ? found : !found);
        }
        // "x in {1, 2, 3}" / "x in set(...)" — set literal; um set VIVO no
        // modelo ("x in meu_set") cai no caminho de array por nome, abaixo.
        if (rightValue?.kind === 'set') {
          const found = rightValue.elements.some((v) => setKeyEq(v, left));
          return BoolValue(node.op === 'in' ? found : !found);
        }
        if (rightValue?.kind === 'dict') {
          // Python testa a CHAVE, não o valor.
          const key = valueToKey(left, env);
          if (key === undefined) return undefined;
          const found = rightValue.entries.has(key);
          return BoolValue(node.op === 'in' ? found : !found);
        }
        // tupla ou lista literal ("no in [a, b]", "x in [1, 2]")
        if (rightValue?.kind === 'tuple' || rightValue?.kind === 'nodelist' || rightValue?.kind === 'array') {
          const found = iterableItems(rightValue, env).some((v) => valuesEqual(v, left));
          return BoolValue(node.op === 'in' ? found : !found);
        }

        // "expr in nome" — array já vivo no modelo, nome direto OU expressão
        // que resolva pra um (`rightValue.kind === 'arrayref'`, ex: "x in
        // d[chave]" — ver `ArrayRefValue`): `env.iterateArray` trabalha por
        // NOME, não por valor já resolvido, então extrai o nome de qualquer
        // um dos dois casos.
        if (!env.iterateArray) return undefined;
        const arrName = rightValue?.kind === 'arrayref' ? rightValue.name : node.right.type === 'Name' ? node.right.name : undefined;
        if (arrName == null) return undefined;
        const items = env.iterateArray(arrName);
        if (items === undefined) return undefined;
        // set: igualdade de set do Python ("True in {1}" é True)
        const eq = env.isSet?.(arrName) ? setKeyEq : valuesEqual;
        const found = items.some((v) => eq(v, left));
        return BoolValue(node.op === 'in' ? found : !found);
      }
      let left = evaluate(node.left, env);
      let right = evaluate(node.right, env);
      if (left === undefined || right === undefined) return undefined;
      // "x += [..]" com "x" uma lista ou deque viva (ver ast.js#BinOp,
      // `inplace`): estende a MESMA lista, igual list.__iadd__ do Python —
      // quem mais aponta pra ela ("y = x") vê os itens novos — pelo mesmo
      // caminho de "x.extend(...)". Devolve a própria lista: a atribuição
      // "x = x" que vem depois não muda nada.
      if (node.inplace && node.op === '+' && left.kind === 'arrayref' && !env.isSet?.(left.name)) {
        const extend = {
          type: 'Call',
          callee: { type: 'Attribute', object: { type: 'Value', value: left }, attr: 'extend' },
          args: [{ type: 'Value', value: right }],
        };
        return evaluate(extend, env) === undefined ? undefined : left;
      }
      // "s == {1, 2}" / "a == b" com sets vivos — compara pelo conteúdo
      if (node.op === '==' || node.op === '!=') {
        left = materializeSet(left, env);
        right = materializeSet(right, env);
      }
      // "nums == [1, 2]", "[raiz] + filhos", "nums * 2" com lista viva —
      // pelo conteúdo, igual uma lista literal
      if (['==', '!=', '+', '*'].includes(node.op)) {
        left = materializeList(left, env);
        right = materializeList(right, env);
      }
      // "[[0] * c] * l" — em Python isso cria l referências pra MESMA linha
      // (mudar uma célula muda a coluna inteira), a armadilha clássica de
      // matriz. Não dá pra mostrar isso numa grade, então avisa e sugere o
      // jeito certo em vez de criar uma matriz que se comportaria diferente.
      if (node.op === '*' && (left.kind === 'matrix' || right.kind === 'matrix')) {
        env.warn?.('"[[0] * colunas] * linhas" faz todas as linhas serem a MESMA lista em Python — use "[[0] * colunas for _ in range(linhas)]".');
        return undefined;
      }
      return evalBinOp(node.op, left, right);
    }

    default:
      return undefined;
  }
}

function evalBinOp(op, left, right) {
  if (op === '==' || op === '!=') {
    const equal = valuesEqual(left, right);
    return BoolValue(op === '==' ? equal : !equal);
  }
  // "(i, j) + (k,)" — concatenação de tuplas, devolve uma tupla nova
  if (op === '+' && left.kind === 'tuple' && right.kind === 'tuple') return TupleValue([...left.items, ...right.items]);
  // "(1, 2) < (1, 3)" — comparação lexicográfica (ver `compareValues`)
  if (left.kind === 'tuple' && right.kind === 'tuple' && ['<', '<=', '>', '>='].includes(op)) {
    const c = compareValues(left, right);
    if (c === undefined) return undefined;
    return BoolValue(op === '<' ? c < 0 : op === '<=' ? c <= 0 : op === '>' ? c > 0 : c >= 0);
  }
  // listas: "[0] * n"/"n * [0]" (repetição) e "[1, 2] + [3]" (concatenação),
  // igual Python — o resultado é uma lista NOVA, mesmo tipo de valor de um
  // literal (ver `assignName` no adaptador).
  if (op === '*' && left.kind === 'array' && right.kind === 'scalar' && Number.isInteger(right.value)) {
    return ArrayValue(Array.from({ length: Math.max(0, right.value) }, () => left.elements).flat());
  }
  if (op === '*' && right.kind === 'array' && left.kind === 'scalar' && Number.isInteger(left.value)) {
    return ArrayValue(Array.from({ length: Math.max(0, left.value) }, () => right.elements).flat());
  }
  if (op === '+' && left.kind === 'array' && right.kind === 'array') return ArrayValue([...left.elements, ...right.elements]);
  // lista de nós: "[None] * n" (ex: pai de cada vértice), "[a] + [b]" — uma
  // lista literal vazia ("[] + [raiz]") junta com qualquer uma das duas
  const nodeItems = (v) => (v.kind === 'nodelist' ? v.items : v.kind === 'array' && v.elements.length === 0 ? [] : null);
  if (op === '*' && (left.kind === 'nodelist' || right.kind === 'nodelist')) {
    const [list, n] = left.kind === 'nodelist' ? [left, right] : [right, left];
    if (n.kind !== 'scalar' || !Number.isInteger(n.value)) return undefined;
    return NodeListValue(Array.from({ length: Math.max(0, n.value) }, () => list.items).flat());
  }
  if (op === '+' && (left.kind === 'nodelist' || right.kind === 'nodelist') && nodeItems(left) && nodeItems(right)) {
    return NodeListValue([...nodeItems(left), ...nodeItems(right)]);
  }
  if (left.kind === 'string' || right.kind === 'string') {
    // "a + b" (concatenação) e "s * n"/"n * s" (repetição) — únicas duas
    // operações aritméticas que fazem sentido com string, igual Python.
    // Comparação (< <= > >=) é lexicográfica — o operador `<` do JS já faz
    // exatamente isso pra string.
    if (op === '+' && left.kind === 'string' && right.kind === 'string') return StringValue(left.value + right.value);
    if (op === '*' && left.kind === 'string' && right.kind === 'scalar' && Number.isInteger(right.value)) {
      return StringValue(left.value.repeat(Math.max(0, right.value)));
    }
    if (op === '*' && right.kind === 'string' && left.kind === 'scalar' && Number.isInteger(left.value)) {
      return StringValue(right.value.repeat(Math.max(0, left.value)));
    }
    if (left.kind === 'string' && right.kind === 'string') {
      switch (op) {
        case '<':
          return BoolValue(left.value < right.value);
        case '<=':
          return BoolValue(left.value <= right.value);
        case '>':
          return BoolValue(left.value > right.value);
        case '>=':
          return BoolValue(left.value >= right.value);
        default:
          return undefined;
      }
    }
    return undefined;
  }
  if (left.kind !== 'scalar' || right.kind !== 'scalar') return undefined;
  switch (op) {
    case '+':
      return Scalar(left.value + right.value);
    case '-':
      return Scalar(left.value - right.value);
    case '*':
      return Scalar(left.value * right.value);
    case '/':
      return right.value === 0 ? undefined : Scalar(left.value / right.value);
    case '//':
      // divisão inteira estilo Python — arredonda pra BAIXO (floor), não em
      // direção a zero: "-7 // 2" é -4 em Python (Math.trunc daria -3).
      return right.value === 0 ? undefined : Scalar(Math.floor(left.value / right.value));
    case '%':
      // módulo estilo Python — sinal segue o DIVISOR (diferente do "%" do
      // JS, que segue o dividendo), ex: "-1 % 3" é 2 em Python, -1 em JS.
      return right.value === 0 ? undefined : Scalar(((left.value % right.value) + right.value) % right.value);
    case '**':
      return Scalar(left.value ** right.value);
    case '<':
      return BoolValue(left.value < right.value);
    case '<=':
      return BoolValue(left.value <= right.value);
    case '>':
      return BoolValue(left.value > right.value);
    case '>=':
      return BoolValue(left.value >= right.value);
    default:
      return undefined;
  }
}

export function valuesEqual(a, b) {
  // set: mesmo conteúdo, qualquer ordem
  if (a.kind === 'set' && b.kind === 'set') {
    return a.elements.length === b.elements.length && a.elements.every((v) => b.elements.some((w) => setKeyEq(v, w)));
  }
  // linha de matriz compara por conteúdo com outra linha ou lista ("m[0] == [1, 2]")
  const rawList = (v) => (v.kind === 'matrixrow' ? v.cells : v.kind === 'array' ? v.elements : null);
  if ((a.kind === 'matrixrow' || b.kind === 'matrixrow') && rawList(a) && rawList(b)) {
    const x = rawList(a);
    const y = rawList(b);
    return x.length === y.length && x.every((v, i) => v === y[i]);
  }
  if (a.kind !== b.kind) return a.kind === 'none' || b.kind === 'none' ? a.kind === b.kind : false;
  if (a.kind === 'scalar') return a.value === b.value;
  if (a.kind === 'bool') return a.value === b.value;
  if (a.kind === 'string') return a.value === b.value;
  if (a.kind === 'struct') return a.id === b.id;
  if (a.kind === 'none') return true;
  if (a.kind === 'array') return a.elements.length === b.elements.length && a.elements.every((v, i) => v === b.elements[i]);
  if (a.kind === 'nodelist') return a.items.length === b.items.length && a.items.every((v, i) => valuesEqual(v, b.items[i]));
  if (a.kind === 'tuple') return a.items.length === b.items.length && a.items.every((v, i) => valuesEqual(v, b.items[i]));
  if (a.kind === 'dict') {
    if (a.entries.size !== b.entries.size) return false;
    for (const [k, v] of a.entries) {
      if (!b.entries.has(k) || !valuesEqual(v, b.entries.get(k))) return false;
    }
    return true;
  }
  return false;
}

/** "a = b = valor" (ver ast.js#ChainAssign) — `value` já avaliado UMA vez,
 * atribuído a cada alvo da esquerda pra direita. Uma coleção NOVA (literal
 * "[]"/"{...}", fatia, etc.) vira entidade no modelo na primeira atribuição;
 * os alvos seguintes recebem a referência a ESSA entidade (relendo o
 * primeiro alvo), não uma cópia — "a = b = []" é uma lista só, igual Python. */
export function assignChain(targetNodes, value, env) {
  if (value === undefined) return;
  let current = value;
  targetNodes.forEach((target, k) => {
    assign(target, current, env);
    const fresh = ['array', 'set', 'matrix'].includes(current.kind) || (current.kind === 'dict' && !current.sourceName);
    if (k === 0 && fresh && target.type === 'Name') current = evaluate(target, env) ?? current;
  });
}

/**
 * Aplica `alvo = valor` contra o Environment. `value` já deve ter sido
 * resolvido via `evaluate` — se for `undefined` (expressão não resolvida),
 * a atribuição é ignorada silenciosamente, sem tocar o ambiente.
 */
export function assign(targetNode, value, env) {
  if (value === undefined) return;

  if (targetNode.type === 'Name') {
    env.assignName(targetNode.name, value);
    return;
  }

  if (targetNode.type === 'Attribute') {
    const objectValue = evaluate(targetNode.object, env);
    if (objectValue === undefined || objectValue.kind !== 'struct' || objectValue.id == null) return;
    env.assignAttr(objectValue, targetNode.attr, value);
    return;
  }

  if (targetNode.type === 'Index') {
    // objeto indexado: nome direto resolve por `resolveName` (mesma regra do
    // 'Index' de leitura, ver `evaluate`); qualquer outra coisa (ex:
    // "d[chave1][chave2] = valor", objeto é outro 'Index') passa pelo
    // `evaluate` genérico — só assim "d[chave]" que guarda um array
    // (`ArrayRefValue`) consegue virar o alvo de uma escrita encadeada como
    // "d[chave][2] = valor".
    const objectValue = targetNode.object.type === 'Name' ? env.resolveName(targetNode.object.name) : evaluate(targetNode.object, env);

    // "d[chave] = valor" — dict é valor de primeira classe (ao contrário de
    // array): o Map já resolvido É a própria variável (ou uma RECONSTRUÇÃO
    // dele, ver MicroRuntimeAdapter#resolveName, quando dict tem entidade
    // visual própria no modelo). `env.assignDictKey` (opcional) é o canal
    // dedicado pra escrever de volta nesse caso — quando ausente (dict
    // guardado só como variável de rascunho, com o Map cru), cai no
    // fallback de sempre: muta o Map
    // resolvido IN PLACE e reatribui através de `assignName`. Só faz sentido
    // com um NOME direto (célula de dict não é endereçável por outra
    // expressão — dict aninhado não é suportado, ver DictValue).
    if (objectValue?.kind === 'dict' && targetNode.object.type === 'Name') {
      const key = valueToKey(evaluate(targetNode.index, env), env);
      if (key === undefined) return;
      if (env.assignDictKey) {
        env.assignDictKey(targetNode.object.name, key, value);
      } else {
        objectValue.entries.set(key, value);
        env.assignName(targetNode.object.name, objectValue);
      }
      return;
    }

    if (objectValue?.kind === 'tuple') {
      env.warn?.('Tupla não pode ser alterada — crie uma nova, ex: "t = (novo, t[1])".');
      return;
    }

    const indexValue = evaluate(targetNode.index, env);
    if (indexValue === undefined || indexValue.kind !== 'scalar' || !Number.isInteger(indexValue.value)) return;

    // "d[chave][i] = valor" — a chave guarda um array (`ArrayRefValue`,
    // resolvido acima via `evaluate`); o NOME do array já veio embutido nele
    // em tempo de execução, mesmo sem o objeto ser um `Name` direto (ver
    // caso 'arrayref' equivalente em `evaluate`, caso 'Index').
    if (objectValue?.kind === 'arrayref') {
      env.assignIndex(objectValue.name, indexValue.value, value);
      return;
    }

    // "m[i][j] = valor" — o objeto é "m[i]" (linha, ver `evaluate`, caso 'Index').
    if (objectValue?.kind === 'matrixrow') {
      env.assignMatrixCell?.(objectValue.name, objectValue.row, indexValue.value, value);
      return;
    }

    if (targetNode.object.type !== 'Name') return;
    env.assignIndex(targetNode.object.name, indexValue.value, value);
  }
}
