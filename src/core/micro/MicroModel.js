import { nextId } from '../id.js';
import { reviveRaw } from '../../interpreter/pytuple.js';

// 32 cobre o contador de letras "[0] * 26" (anagramas, frequência)
export const MAX_ARRAY_SIZE = 32;
export const MAX_DICT_SIZE = 24;

/** Lado de uma célula de array no canvas (= `ARRAY_CELL` de
 * MicroCanvasView.js, que importa daqui). O modelo não desenha nada, mas
 * precisa dela pra manter parada a BASE de um array em pilha quando ele
 * muda de tamanho (ver `_keepStackBase`). */
export const ARRAY_CELL_H = 44;

/** Altura da caixa de um array em pilha com `cellCount` células — vazia
 * ainda ocupa uma célula (ver MicroCanvasView.js#arrayLayout). */
export function stackHeight(cellCount) {
  return Math.max(1, cellCount) * ARRAY_CELL_H;
}

/** Array desenhado como pilha (`orientation: 'stack'`, nunca set): cresce pra
 * cima, com a base parada. */
export function isStackArray(node) {
  return node?.orientation === 'stack' && !node.isSet;
}

/** O rótulo com o nome (`pointer`, ver App#_createArrayLabelPointer) do array
 * em pilha `arr` que está ACIMA dele — onde o rótulo nasce — anda junto com
 * o topo da pilha (ver `_keepStackBase`), senão as células empilhadas
 * passariam por cima dele. Levado pra outro lugar (do lado, embaixo), fica
 * parado. */
export function ridesStackTop(pointer, arr) {
  return !!pointer && isStackArray(arr) && pointer.y < arr.y;
}

/** Tipo das células de um array: 'value' (valores crus), 'ref' (ids de
 * struct) ou 'arrayref' (ids de outros arrays — lista de listas). Qualquer
 * outra coisa (arquivo antigo/editado à mão) vira 'value'. */
function arrayKind(kind) {
  return kind === 'ref' || kind === 'arrayref' ? kind : 'value';
}

/**
 * Modelo do modo "micro": nós de estrutura (com campos internos, ex.
 * prev/data/next de uma lista duplamente ligada), arrays (de valores ou de
 * referências) e ponteiros soltos que podem apontar para um nó de estrutura
 * ou para uma posição específica de um array. Não conhece renderização —
 * apenas os dados e as relações entre eles.
 *
 * Uma célula de array de referências (`array.cells[i]`, quando
 * `array.kind === 'ref'`) guarda sempre um id de struct (ou null); numa
 * lista de listas (`array.kind === 'arrayref'`, "[[1], [2, 3]]"), o id de
 * OUTRO array (ou null) — as listas de dentro são arrays comuns, sem nome,
 * alcançáveis só pela célula (mesmo espírito da célula 'arrayref' de dict).
 * Já o alvo de um ponteiro é mais geral, podendo ser:
 *   null | { kind: 'struct', id } | { kind: 'arrayCell', arrayId, index } | { kind: 'array', id }
 *
 * `{ kind: 'array', id }` é o alvo do ponteiro-rótulo que nasce junto com todo
 * array (ver App#_createArrayLabelPointer) — o array não tem mais barra de
 * título própria, então esse ponteiro (rotulado com o nome do array) é o que
 * mostra o nome no canvas e concentra o acesso ao popup de configurações.
 * `{ kind: 'dictCell', dictId, key }` / `{ kind: 'dict', id }` são os
 * equivalentes de `arrayCell`/`array` pra dict (ver abaixo), e
 * `{ kind: 'matrixCell', matrixId, row, col }` / `{ kind: 'matrix', id }` pra
 * matriz.
 *
 * Matriz é uma grade retangular `rows x cols` de valores (number|string|
 * boolean) — `cells[linha][coluna]` — irmã de array (mesmo ponteiro-rótulo,
 * mesmo cursor de leitura), mas desenhada como tabela, com índice de linha à
 * esquerda e de coluna em cima. Sem limite de tamanho. Só guarda VALORES
 * (nada de referência a struct), e cada linha é parte da própria matriz, não
 * uma lista à parte (ver evaluator.js sobre "[[0] * c] * l").
 *
 * Dict é irmão de array (mesmo nascimento por código, mesmo popup de
 * orientação, mesmo "pino" de referência), mas com uma diferença estrutural:
 * array tem `kind:'value'|'ref'` FIXO pro nó inteiro (todas as células do
 * mesmo tipo), enquanto dict pode ter valor OU referência por CHAVE
 * individual (`{"a": 1, "b": Node(5)}` é válido) — por isso `dict.cells` é
 * `{key, kind:'value'|'ref', value}[]` (kind por CÉLULA), não um array
 * indexado de valores crus com um `kind` só no nó.
 */
export class MicroModel {
  constructor() {
    this.structs = new Map(); // id -> {id, x, y, data, type:'list'|'tree'|'graph', next, prev, neighborsArrayId}
    this.pointers = new Map(); // id -> {id, x, y, label, target, frameId}
    this.arrays = new Map(); // id -> {id, x, y, kind:'value'|'ref', orientation:'horizontal'|'vertical'|'stack', cells}
    this.dicts = new Map(); // id -> {id, x, y, orientation:'horizontal'|'vertical', cells: {key, kind:'value'|'ref', value}[], name}
    this.variables = new Map(); // id -> {id, x, y, name, value: number|boolean|string, frameId}
    this.matrices = new Map(); // id -> {id, x, y, name, cells: (number|string|boolean)[][], labelPointerId}
  }

  // `type` decide só os NOMES dos campos que o código/canvas expõem
  // ('list' -> next/prev, 'tree' -> left/right, ver
  // MicroRuntimeAdapter#_structFieldForAttr) — o armazenamento físico
  // continua sempre `next`/`prev` (mesmas duas células da caixa, mesma
  // geometria de portas/edges já existente), então nenhum outro método
  // deste arquivo (setField/removeStruct/toGraph implícito via App.js)
  // precisa saber sobre 'tree'.
  //
  // 'graph' é diferente dos outros dois: não usa next/prev NENHUM — o campo
  // `neighbors` é uma LISTA (grau arbitrário, não um único vizinho fixo por
  // campo), então é armazenado como um array de verdade à parte (kind:'ref',
  // ver `addArray`), criado junto com o struct e ligado por
  // `neighborsArrayId` (ver MicroRuntimeAdapter#createStruct, que coordena
  // os dois). `next`/`prev` continuam presentes no objeto (mesma forma pros
  // três tipos, mais simples) mas ficam sempre `null`, nunca escritos.
  addStruct(x, y, data = 0, type = 'list') {
    const node = {
      id: nextId('struct'),
      x,
      y,
      data,
      type: type === 'tree' ? 'tree' : type === 'graph' ? 'graph' : 'list',
      next: null,
      prev: null,
      neighborsArrayId: null,
    };
    this.structs.set(node.id, node);
    return node;
  }

  /** Liga o array de vizinhos (já criado à parte, ver `addArray`) a um
   * struct 'graph' — mesmo papel de `linkArrayLabelPointer`, só que o
   * "dono" aqui é um struct, não um ponteiro-rótulo, e o array não ganha
   * label nenhum (é alcançável só através do campo `neighbors`, mesmo
   * espírito anônimo do array de "d[chave] = [1, 2, 3]"). */
  setStructNeighborsArray(structId, arrayId) {
    const node = this.structs.get(structId);
    if (node) node.neighborsArrayId = arrayId;
  }

  /** Liga/desliga a aresta DIRECIONADA `fromId` → `toId` de um struct
   * 'graph' (ferramenta "Ligar nós", ver App#_applyMicroLink):
   * se `toId` ainda não é vizinho, entra no FIM da lista de vizinhos
   * ("nó.neighbors.append(alvo)"); se já é, TODAS as ocorrências saem (a
   * seta some de vez, mesmo com o alvo repetido por código). Nunca mexe na
   * lista de `toId` (B→A continua como estava). Um 'graph' sem lista (ex.:
   * projeto salvo antes dela existir) ganha uma agora, em `newArrayPos` (ou
   * logo abaixo do nó), igual a "GraphNode(v)" cria (ver
   * MicroRuntimeAdapter#createStruct). Devolve 'added', 'removed' ou null
   * (nada mudou: autolaço, origem que não é 'graph', alvo inexistente ou
   * lista já com MAX_ARRAY_SIZE vizinhos). */
  toggleStructNeighbor(fromId, toId, newArrayPos = null) {
    const from = this.structs.get(fromId);
    if (!from || from.type !== 'graph' || fromId === toId || !this.structs.has(toId)) return null;
    let arr = from.neighborsArrayId ? this.arrays.get(from.neighborsArrayId) : null;
    if (arr?.cells.includes(toId)) {
      for (let i = arr.cells.length - 1; i >= 0; i -= 1) {
        if (arr.cells[i] === toId) this.removeArrayCell(arr.id, i);
      }
      return 'removed';
    }
    if (arr && arr.cells.length >= MAX_ARRAY_SIZE) return null;
    if (!arr) {
      const pos = newArrayPos ?? { x: from.x, y: from.y + 100 };
      arr = this.addArray(pos.x, pos.y, { kind: 'ref', size: 0, name: `__graph_neighbors_${from.id}` });
      this.setStructNeighborsArray(from.id, arr.id);
    }
    return this.insertArrayCell(arr.id, arr.cells.length, toId) ? 'added' : null;
  }

  // `frameId` identifica a "aba" (chamada de função) dona do ponteiro/variável
  // — 'global' pro escopo de topo, ou o id de um frame de chamada recursiva
  // (ver MicroRuntimeAdapter#pushFrame). Structs/arrays/dicts/matrizes são o
  // "heap" compartilhado, sempre visível em qualquer aba (ver plano de
  // recursão) — o `frameId` de uma coleção diz só a qual frame pertence o
  // NOME dela (ver MicroRuntimeAdapter#_bindingIn), não onde ela aparece.
  addPointer(x, y, label = 'ptr', frameId = 'global') {
    const node = { id: nextId('ptr'), x, y, label, target: null, frameId };
    this.pointers.set(node.id, node);
    return node;
  }

  /** `isSet`: o array é um set do código ("s = {1, 2}"/"s = set()", ver
   * MicroRuntimeAdapter#assignName) — mesmos dados de sempre, só muda como é
   * desenhado (sem índices) e o que o código pode fazer com ele. `isDeque`:
   * idem pra um deque ("fila = deque()"), com `maxlen` (null = sem limite). */
  addArray(
    x,
    y,
    { kind = 'value', orientation = 'horizontal', size = 4, name = 'arr', isSet = false, isDeque = false, maxlen = null, frameId = 'global' } = {},
  ) {
    // 0 é um tamanho válido — "arr = []" (lista vazia) precisa criar um array
    // de verdade sem nenhuma célula fantasma, pra "arr.append(x)"/"len(arr)"
    // funcionarem certo a partir do zero (ver janela deslizante, plano etapa 4).
    const clampedSize = Math.max(0, Math.min(size, MAX_ARRAY_SIZE));
    const cells = Array.from({ length: clampedSize }, () => (kind === 'value' ? 0 : null));
    const node = { id: nextId('array'), x, y, kind, orientation, cells, name, frameId, ...(isSet ? { isSet: true } : {}), ...(isDeque ? { isDeque: true, maxlen } : {}) };
    this.arrays.set(node.id, node);
    return node;
  }

  /** Conteúdo inteiro de um set (ver MicroRuntimeAdapter#_writeSet): tipo
   * (valores ou nós — um set vazio pode trocar), células na ordem da tabela
   * hash e a própria tabela (`hashTable`, ver pyset.js#serializeTable). Tudo
   * substituído por objetos NOVOS — a reprodução do modo Executar guarda
   * snapshots que só copiam o nível de cima do array (ver
   * MicroProgramRunner#_snapshot), então a tabela antiga não pode mudar. */
  setSetContents(arrayId, kind, cells, hashTable) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    node.kind = arrayKind(kind);
    node.cells = cells.slice(0, MAX_ARRAY_SIZE);
    node.hashTable = hashTable;
  }

  /** Troca TODO o conteúdo de um array (deque: rotate/reverse/clear, ver
   * MicroRuntimeAdapter#dequeSetItems) — `kind` pode mudar num array vazio
   * (ver `setSetContents`). Cursores que apontavam pra uma posição que
   * deixou de existir ficam sem alvo. */
  setArrayContents(arrayId, kind, cells) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    node.kind = arrayKind(kind);
    const oldLen = node.cells.length;
    node.cells = cells.slice(0, MAX_ARRAY_SIZE);
    this._keepStackBase(node, oldLen);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'arrayCell' && p.target.arrayId === arrayId && p.target.index >= node.cells.length) p.target = null;
    }
  }

  /** Troca o conteúdo E o tipo (lista/set/deque) de um array — ele passa a
   * guardar uma lista nova inteira: criação pelo código e "x = x + [2]" sem
   * mais ninguém apontando pra lista antiga (ver
   * MicroRuntimeAdapter#assignName). Objetos novos, como `setArrayContents`
   * (que também cuida dos cursores que ficaram fora do intervalo). */
  replaceArray(arrayId, { kind, cells, isSet = false, hashTable = null, isDeque = false, maxlen = null }) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    this.setArrayContents(arrayId, kind, cells);
    delete node.isSet;
    delete node.hashTable;
    delete node.isDeque;
    delete node.maxlen;
    if (isSet) Object.assign(node, { isSet: true, hashTable });
    if (isDeque) Object.assign(node, { isDeque: true, maxlen });
  }

  renameArray(arrayId, name) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    node.name = name;
    if (node.labelPointerId) this.renamePointer(node.labelPointerId, name);
  }

  /** Liga um ponteiro já criado como o "rótulo" (nome visível) de um array —
   * ver App#_createArrayLabelPointer, chamado logo após todo `addArray`. */
  linkArrayLabelPointer(arrayId, pointerId) {
    const array = this.arrays.get(arrayId);
    const pointer = this.pointers.get(pointerId);
    if (!array || !pointer) return;
    // rótulo passando de um array pra outro ("x = x + [2]" com a lista antiga
    // ainda apontada por outro nome, ver MicroRuntimeAdapter#assignName): o
    // antigo fica sem rótulo
    const previous = pointer.isArrayLabel ? this.arrays.get(pointer.labelArrayId) : null;
    if (previous && previous !== array && previous.labelPointerId === pointerId) previous.labelPointerId = null;
    array.labelPointerId = pointerId;
    pointer.isArrayLabel = true;
    pointer.labelArrayId = arrayId;
    this.setPointerTarget(pointerId, { kind: 'array', id: arrayId });
  }

  /** `frameId`: igual o de array, só diz a qual frame pertence o NOME do
   * dict (ele é "heap", aparece em qualquer aba). */
  addDict(x, y, { orientation = 'horizontal', name = 'dict', cells = [], frameId = 'global' } = {}) {
    const node = { id: nextId('dict'), x, y, orientation, cells: cells.slice(0, MAX_DICT_SIZE), name, frameId };
    this.dicts.set(node.id, node);
    return node;
  }

  renameDict(dictId, name) {
    const node = this.dicts.get(dictId);
    if (!node) return;
    node.name = name;
    if (node.labelPointerId) this.renamePointer(node.labelPointerId, name);
  }

  /** Liga um ponteiro já criado como o "rótulo" (nome visível) de um dict —
   * mesmo papel de `linkArrayLabelPointer`, ver App#_createDictLabelPointer. */
  linkDictLabelPointer(dictId, pointerId) {
    const dict = this.dicts.get(dictId);
    const pointer = this.pointers.get(pointerId);
    if (!dict || !pointer) return;
    // rótulo passando de um dict pra outro (ver `linkArrayLabelPointer`)
    const previous = pointer.isDictLabel ? this.dicts.get(pointer.labelDictId) : null;
    if (previous && previous !== dict && previous.labelPointerId === pointerId) previous.labelPointerId = null;
    dict.labelPointerId = pointerId;
    pointer.isDictLabel = true;
    pointer.labelDictId = dictId;
    this.setPointerTarget(pointerId, { kind: 'dict', id: dictId });
  }

  /** "d[chave] = valor" (valor escalar/bool/string) — cria a célula se a
   * chave ainda não existir (é assim que dict "cresce": por inserção de
   * chave, não por redimensionamento — ver `resizeArray` pro contraste).
   * Sem efeito se já tiver `MAX_DICT_SIZE` chaves e a chave for nova. */
  setDictCellValue(dictId, key, value) {
    const node = this.dicts.get(dictId);
    if (!node) return;
    const cell = node.cells.find((c) => c.key === key);
    if (cell) {
      cell.kind = 'value';
      cell.value = value;
    } else if (node.cells.length < MAX_DICT_SIZE) {
      node.cells.push({ key, kind: 'value', value });
    }
  }

  /** "d[chave] = Node(...)/None" — mesma ideia de `setDictCellValue`, célula
   * vira/nasce `kind:'ref'` guardando o id do struct (ou `null`). */
  setDictCellRef(dictId, key, targetStructId) {
    const node = this.dicts.get(dictId);
    if (!node) return;
    if (targetStructId && !this.structs.has(targetStructId)) return;
    const value = targetStructId ?? null;
    const cell = node.cells.find((c) => c.key === key);
    if (cell) {
      cell.kind = 'ref';
      cell.value = value;
    } else if (node.cells.length < MAX_DICT_SIZE) {
      node.cells.push({ key, kind: 'ref', value });
    }
  }

  /** "d[chave] = [1, 2, 3]" (array literal, já criado à parte — ver
   * MicroRuntimeAdapter#assignDictKey) ou "d[chave] = nome" (array já vivo
   * no modelo) — mesma ideia de `setDictCellRef`, mas guardando o id de um
   * ARRAY em vez de struct; célula vira/nasce `kind:'arrayref'`. */
  setDictCellArrayRef(dictId, key, targetArrayId) {
    const node = this.dicts.get(dictId);
    if (!node) return;
    if (targetArrayId && !this.arrays.has(targetArrayId)) return;
    const value = targetArrayId ?? null;
    const cell = node.cells.find((c) => c.key === key);
    if (cell) {
      cell.kind = 'arrayref';
      cell.value = value;
    } else if (node.cells.length < MAX_DICT_SIZE) {
      node.cells.push({ key, kind: 'arrayref', value });
    }
  }

  /** Tira todas as células ("d = {...}" de novo, reaproveitando a mesma caixa
   * — ver MicroRuntimeAdapter#assignName). Cursores de célula ficam sem alvo. */
  clearDict(dictId) {
    const node = this.dicts.get(dictId);
    if (!node) return;
    node.cells = [];
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'dictCell' && p.target.dictId === dictId) p.target = null;
    }
  }

  setDictOrientation(dictId, orientation) {
    const node = this.dicts.get(dictId);
    if (node && (orientation === 'horizontal' || orientation === 'vertical')) node.orientation = orientation;
  }

  toggleDictOrientation(dictId) {
    const node = this.dicts.get(dictId);
    if (node) node.orientation = node.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  }

  removeDict(id) {
    const node = this.dicts.get(id);
    if (!this.dicts.delete(id)) return;
    if (node.labelPointerId) this.pointers.delete(node.labelPointerId);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'dictCell' && p.target.dictId === id) p.target = null;
      if (p.target?.kind === 'dict' && p.target.id === id) p.target = null;
    }
  }

  /** `cells` é copiado (linha a linha); todas as linhas devem ter o mesmo
   * tamanho (quem cria — MicroRuntimeAdapter — já garante isso). */
  addMatrix(x, y, { name = 'm', cells = [[0]], frameId = 'global' } = {}) {
    const node = { id: nextId('matrix'), x, y, name, cells: cells.map((row) => [...row]), frameId };
    this.matrices.set(node.id, node);
    return node;
  }

  renameMatrix(matrixId, name) {
    const node = this.matrices.get(matrixId);
    if (!node) return;
    node.name = name;
    if (node.labelPointerId) this.renamePointer(node.labelPointerId, name);
  }

  /** Mesmo papel de `linkArrayLabelPointer`, ver App#_createMatrixLabelPointer. */
  linkMatrixLabelPointer(matrixId, pointerId) {
    const matrix = this.matrices.get(matrixId);
    const pointer = this.pointers.get(pointerId);
    if (!matrix || !pointer) return;
    // rótulo passando de uma matriz pra outra (ver `linkArrayLabelPointer`)
    const previous = pointer.isMatrixLabel ? this.matrices.get(pointer.labelMatrixId) : null;
    if (previous && previous !== matrix && previous.labelPointerId === pointerId) previous.labelPointerId = null;
    matrix.labelPointerId = pointerId;
    pointer.isMatrixLabel = true;
    pointer.labelMatrixId = matrixId;
    this.setPointerTarget(pointerId, { kind: 'matrix', id: matrixId });
  }

  setMatrixCellValue(matrixId, row, col, value) {
    const node = this.matrices.get(matrixId);
    if (!node || row < 0 || row >= node.cells.length || col < 0 || col >= node.cells[row].length) return;
    node.cells[row][col] = value;
  }

  /** Troca todas as linhas ("m = [[...]]" de novo, reaproveitando a mesma
   * caixa — ver MicroRuntimeAdapter#assignName). Cursores de célula que
   * ficaram fora da grade nova ficam sem alvo. */
  setMatrixContents(matrixId, rows) {
    const node = this.matrices.get(matrixId);
    if (!node || !rows.length) return;
    node.cells = rows.map((row) => [...row]);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'matrixCell' && p.target.matrixId === matrixId && (p.target.row >= rows.length || p.target.col >= rows[0].length)) {
        p.target = null;
      }
    }
  }

  /** Redimensiona mantendo o conteúdo que ainda cabe; células novas nascem
   * com 0. Ponteiros que miravam uma célula que deixou de existir ficam sem
   * alvo. Mínimo 1x1 (uma matriz sem linha/coluna não tem desenho). */
  resizeMatrix(matrixId, rows, cols) {
    const node = this.matrices.get(matrixId);
    if (!node) return;
    const newRows = Math.max(1, Math.round(rows));
    const newCols = Math.max(1, Math.round(cols));
    node.cells = Array.from({ length: newRows }, (_, r) =>
      Array.from({ length: newCols }, (_, c) => (r < node.cells.length && c < node.cells[r].length ? node.cells[r][c] : 0)),
    );
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'matrixCell' && p.target.matrixId === matrixId && (p.target.row >= newRows || p.target.col >= newCols)) {
        p.target = null;
      }
    }
  }

  removeMatrix(id) {
    const node = this.matrices.get(id);
    if (!this.matrices.delete(id)) return;
    if (node.labelPointerId) this.pointers.delete(node.labelPointerId);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'matrixCell' && p.target.matrixId === id) p.target = null;
      if (p.target?.kind === 'matrix' && p.target.id === id) p.target = null;
    }
  }

  addVariable(x, y, name = 'var', value = 0, frameId = 'global') {
    const node = { id: nextId('var'), x, y, name, value, frameId };
    this.variables.set(node.id, node);
    return node;
  }

  renameVariable(variableId, name) {
    const node = this.variables.get(variableId);
    if (node) node.name = name;
  }

  setVariableValue(variableId, value) {
    const node = this.variables.get(variableId);
    if (node) node.value = value;
  }

  removeVariable(id) {
    this.variables.delete(id);
  }

  removeStruct(id) {
    const removed = this.structs.get(id);
    if (!this.structs.delete(id)) return;
    for (const n of this.structs.values()) {
      if (n.next === id) n.next = null;
      if (n.prev === id) n.prev = null;
    }
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'struct' && p.target.id === id) p.target = null;
    }
    for (const arr of this.arrays.values()) {
      if (arr.kind === 'ref') arr.cells = arr.cells.map((c) => (c === id ? null : c));
    }
    for (const dict of this.dicts.values()) {
      dict.cells.forEach((c) => {
        if (c.kind === 'ref' && c.value === id) c.value = null;
      });
    }
    // struct 'graph' é dono do array de vizinhos (ver `setStructNeighborsArray`)
    // — sem o struct, o array anônimo (sem label, inalcançável por código)
    // ficaria orfão pra sempre no canvas; remove junto (cascata de posse, não
    // de referência — diferente das limpezas acima, que só soltam um alvo).
    if (removed?.neighborsArrayId) this.removeArray(removed.neighborsArrayId);
  }

  removePointer(id) {
    const node = this.pointers.get(id);
    if (!this.pointers.delete(id)) return;
    if (node.isArrayLabel) {
      const array = this.arrays.get(node.labelArrayId);
      if (array && array.labelPointerId === id) array.labelPointerId = null;
    }
    if (node.isDictLabel) {
      const dict = this.dicts.get(node.labelDictId);
      if (dict && dict.labelPointerId === id) dict.labelPointerId = null;
    }
    if (node.isMatrixLabel) {
      const matrix = this.matrices.get(node.labelMatrixId);
      if (matrix && matrix.labelPointerId === id) matrix.labelPointerId = null;
    }
  }

  removeArray(id) {
    const node = this.arrays.get(id);
    if (!this.arrays.delete(id)) return;
    if (node.labelPointerId) this.pointers.delete(node.labelPointerId);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'arrayCell' && p.target.arrayId === id) p.target = null;
      if (p.target?.kind === 'array' && p.target.id === id) p.target = null;
    }
    for (const dict of this.dicts.values()) {
      dict.cells.forEach((c) => {
        if (c.kind === 'arrayref' && c.value === id) c.value = null;
      });
    }
    // lista de listas que guardava este array numa célula: a célula vira None
    for (const arr of this.arrays.values()) {
      if (arr.kind === 'arrayref' && arr.cells.includes(id)) arr.cells = arr.cells.map((c) => (c === id ? null : c));
    }
    // dono inverso de `setStructNeighborsArray` — se alguém apagar o array de
    // vizinhos DIRETO (ex: clique duplo nele no modo detalhado), o struct
    // 'graph' que o possuía fica sem lista (equivalente a "neighbors" nunca
    // ter existido), não com uma referência pra um array morto.
    for (const s of this.structs.values()) {
      if (s.neighborsArrayId === id) s.neighborsArrayId = null;
    }
  }

  setField(structId, field, targetId) {
    const node = this.structs.get(structId);
    if (!node || (field !== 'next' && field !== 'prev')) return;
    if (targetId && !this.structs.has(targetId)) return;
    node[field] = targetId ?? null;
  }

  /** target: null | {kind:'struct', id} | {kind:'arrayCell', arrayId, index} */
  setPointerTarget(pointerId, target) {
    const p = this.pointers.get(pointerId);
    if (!p) return;
    if (!target) {
      p.target = null;
      return;
    }
    if (target.kind === 'struct') {
      p.target = this.structs.has(target.id) ? { kind: 'struct', id: target.id } : null;
    } else if (target.kind === 'arrayCell') {
      const arr = this.arrays.get(target.arrayId);
      p.target =
        arr && target.index >= 0 && target.index < arr.cells.length
          ? { kind: 'arrayCell', arrayId: target.arrayId, index: target.index }
          : null;
    } else if (target.kind === 'array') {
      p.target = this.arrays.has(target.id) ? { kind: 'array', id: target.id } : null;
    } else if (target.kind === 'dictCell') {
      const dict = this.dicts.get(target.dictId);
      p.target =
        dict && dict.cells.some((c) => c.key === target.key) ? { kind: 'dictCell', dictId: target.dictId, key: target.key } : null;
    } else if (target.kind === 'dict') {
      p.target = this.dicts.has(target.id) ? { kind: 'dict', id: target.id } : null;
    } else if (target.kind === 'matrixCell') {
      const m = this.matrices.get(target.matrixId);
      p.target =
        m && target.row >= 0 && target.row < m.cells.length && target.col >= 0 && target.col < m.cells[target.row].length
          ? { kind: 'matrixCell', matrixId: target.matrixId, row: target.row, col: target.col }
          : null;
    } else if (target.kind === 'matrix') {
      p.target = this.matrices.has(target.id) ? { kind: 'matrix', id: target.id } : null;
    } else {
      p.target = null;
    }
  }

  setData(structId, value) {
    const node = this.structs.get(structId);
    if (node) node.data = value;
  }

  renamePointer(pointerId, label) {
    const p = this.pointers.get(pointerId);
    if (p) p.label = label;
  }

  setArrayCellValue(arrayId, index, value) {
    const node = this.arrays.get(arrayId);
    if (node && node.kind === 'value' && index >= 0 && index < node.cells.length) node.cells[index] = value;
  }

  setArrayCellRef(arrayId, index, targetStructId) {
    const node = this.arrays.get(arrayId);
    if (!node || node.kind !== 'ref' || index < 0 || index >= node.cells.length) return;
    if (targetStructId && !this.structs.has(targetStructId)) return;
    node.cells[index] = targetStructId ?? null;
  }

  /** Célula de uma lista de listas (`kind:'arrayref'`) passa a guardar o
   * array `targetArrayId` (ou None) — "res[i] = [1, 2]", "res[i] = outra". */
  setArrayCellArrayRef(arrayId, index, targetArrayId) {
    const node = this.arrays.get(arrayId);
    if (!node || node.kind !== 'arrayref' || index < 0 || index >= node.cells.length) return;
    if (targetArrayId && !this.arrays.has(targetArrayId)) return;
    node.cells[index] = targetArrayId ?? null;
  }

  /** 'horizontal' | 'vertical' | 'stack' | 'grid' — a pilha (vertical com a
   * posição 0 embaixo e o último elemento no topo) não vale pra set, que não
   * tem posição; a grade (as listas de dentro desenhadas como linhas de uma
   * tabela, ver MicroCanvasView.js#layoutGrids) só pra lista de listas. */
  setArrayOrientation(arrayId, orientation) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    const ok =
      orientation === 'horizontal' ||
      orientation === 'vertical' ||
      (orientation === 'stack' && !node.isSet) ||
      (orientation === 'grid' && node.kind === 'arrayref');
    if (ok) node.orientation = orientation;
  }

  /** Pilha que mudou de tamanho (tinha `oldLen` células): `y` é o TOPO da
   * caixa, então ele anda o quanto a altura mudou — a base fica onde estava
   * e a célula nova aparece em cima (o `pop` tira de cima), levando junto o
   * rótulo com o nome, se ele está acima (ver `ridesStackTop`). Os outros
   * arrays crescem pra baixo/direita a partir do canto, como sempre. */
  _keepStackBase(node, oldLen) {
    if (!isStackArray(node)) return;
    const dy = stackHeight(node.cells.length) - stackHeight(oldLen);
    const label = this.pointers.get(node.labelPointerId);
    if (ridesStackTop(label, node)) label.y -= dy;
    node.y -= dy;
  }

  toggleArrayOrientation(arrayId) {
    const node = this.arrays.get(arrayId);
    if (node) node.orientation = node.orientation === 'horizontal' ? 'vertical' : 'horizontal';
  }

  resizeArray(arrayId, size) {
    const node = this.arrays.get(arrayId);
    if (!node) return;
    // 0 é válido aqui (ver `addArray`) — é o que permite "arr.pop()" esvaziar
    // um array até o fim, célula por célula, sem travar numa última célula
    // fantasma. O campo Tamanho do ArraySettingsPopup também aceita 0, pra
    // uma lista vazia continuar vazia ao salvar o popup.
    const newSize = Math.max(0, Math.min(Math.round(size), MAX_ARRAY_SIZE));
    const oldSize = node.cells.length;
    if (newSize === oldSize) return;
    if (newSize > oldSize) {
      const fill = node.kind === 'value' ? 0 : null;
      node.cells = node.cells.concat(Array.from({ length: newSize - oldSize }, () => fill));
      this._keepStackBase(node, oldSize);
      return;
    }
    node.cells = node.cells.slice(0, newSize);
    this._keepStackBase(node, oldSize);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'arrayCell' && p.target.arrayId === arrayId && p.target.index >= newSize) p.target = null;
    }
  }

  /** Remove a célula de UM índice específico (não só da ponta, ver
   * `resizeArray`) — usado por "nome.pop(índice)" (ver evaluator.js), ex.:
   * `pop(0)` desempilhando o começo de uma fila representada como array.
   * Ponteiros que miravam a célula removida ficam sem alvo; os que miravam
   * células depois dela acompanham o deslocamento (índice - 1). */
  removeArrayCell(arrayId, index) {
    const node = this.arrays.get(arrayId);
    if (!node || index < 0 || index >= node.cells.length) return;
    node.cells.splice(index, 1);
    this._keepStackBase(node, node.cells.length + 1);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'arrayCell' && p.target.arrayId === arrayId) {
        if (p.target.index === index) p.target = null;
        else if (p.target.index > index) p.target = { ...p.target, index: p.target.index - 1 };
      }
    }
  }

  /** Insere uma célula nova no índice `index` (0…tamanho) com `value` (valor
   * cru, ou id de struct/null num array de referências) — "nome.insert(i,
   * x)". As células a partir de `index` andam uma posição pra frente, e os
   * ponteiros que miravam elas acompanham (índice + 1), espelho de
   * `removeArrayCell`. `false` se não coube (já tem `MAX_ARRAY_SIZE`
   * células) ou o índice é inválido. */
  insertArrayCell(arrayId, index, value) {
    const node = this.arrays.get(arrayId);
    if (!node || index < 0 || index > node.cells.length || node.cells.length >= MAX_ARRAY_SIZE) return false;
    if (node.kind === 'ref' && value && !this.structs.has(value)) return false;
    if (node.kind === 'arrayref' && value && !this.arrays.has(value)) return false;
    node.cells.splice(index, 0, node.kind === 'value' ? value : (value ?? null));
    this._keepStackBase(node, node.cells.length - 1);
    for (const p of this.pointers.values()) {
      if (p.target?.kind === 'arrayCell' && p.target.arrayId === arrayId && p.target.index >= index) {
        p.target = { ...p.target, index: p.target.index + 1 };
      }
    }
    return true;
  }

  growArray(arrayId) {
    const node = this.arrays.get(arrayId);
    if (node) this.resizeArray(arrayId, node.cells.length + 1);
  }

  shrinkArray(arrayId) {
    const node = this.arrays.get(arrayId);
    if (node) this.resizeArray(arrayId, node.cells.length - 1);
  }

  clear() {
    this.structs.clear();
    this.pointers.clear();
    this.arrays.clear();
    this.dicts.clear();
    this.variables.clear();
    this.matrices.clear();
  }

  // ---- serialização (salvar/carregar projeto em arquivo — ver App#_saveProject/_loadProject) ----

  /** Só os dados "de verdade" de cada elemento — nunca campos transitórios
   * de execução. Inclui elementos de QUALQUER `frameId` (não só o da aba
   * selecionada no momento) — structs/arrays/dicts nem têm frameId (são o
   * "heap" compartilhado, ver comentário da classe), e pointers/variables de
   * uma chamada recursiva que não é a aba atual são salvos do mesmo jeito, só
   * ficam sem uma aba pra alcançá-los de volta até o código rodar de novo
   * (não há callTree pra restaurar um save feito no meio de uma recursão —
   * ver App#_applyLoadedProject).
   *
   * Cursor de leitura de array (ver MicroRuntimeAdapter#_showReadCursor) é
   * EXCLUÍDO de propósito, não só "limpo" dos campos internos (readCursorKey/
   * readCursorIndexNode/readCursorDeps, um nó de AST + um Set, nenhum dos
   * dois sobrevive a JSON): sem `readCursorKey`, um cursor recarregado vira
   * indistinguível de um ponteiro comum mirando uma célula de array, e o
   * label ("nums[i]", já com a expressão embutida) ganha o índice concreto
   * DE NOVO na frente ("nums[i][3]") — ver App.js#_renderMicroOnly, que só
   * evita essa sobreposição quando `readCursorKey` está presente. Um cursor
   * só faz sentido durante uma execução ao vivo, então ele reaparece sozinho
   * (e na posição certa — ver `App#microLayout`) assim que o código rodar de
   * novo depois do load. */
  toJSON() {
    const struct = (n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      data: n.data,
      type: n.type === 'tree' ? 'tree' : n.type === 'graph' ? 'graph' : 'list',
      next: n.next,
      prev: n.prev,
      ...(n.neighborsArrayId ? { neighborsArrayId: n.neighborsArrayId } : {}),
    });
    const pointer = (n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      label: n.label,
      target: n.target ? { ...n.target } : null,
      frameId: n.frameId,
      ...(n.isArrayLabel ? { isArrayLabel: true, labelArrayId: n.labelArrayId } : {}),
      ...(n.isDictLabel ? { isDictLabel: true, labelDictId: n.labelDictId } : {}),
      ...(n.isMatrixLabel ? { isMatrixLabel: true, labelMatrixId: n.labelMatrixId } : {}),
      ...(n.hidden ? { hidden: true } : {}),
    });
    const array = (n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      kind: n.kind,
      orientation: n.orientation,
      cells: [...n.cells],
      name: n.name,
      ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
      ...(n.isSet ? { isSet: true } : {}),
      ...(n.hashTable ? { hashTable: n.hashTable } : {}),
      ...(n.isDeque ? { isDeque: true, maxlen: n.maxlen ?? null } : {}),
    });
    const dict = (n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      orientation: n.orientation,
      cells: n.cells.map((c) => ({ ...c })),
      name: n.name,
      ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
    });
    const variable = (n) => ({ id: n.id, x: n.x, y: n.y, name: n.name, value: n.value, frameId: n.frameId });
    const matrix = (n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      cells: n.cells.map((row) => [...row]),
      name: n.name,
      ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
    });
    return {
      structs: Array.from(this.structs.values()).map(struct),
      pointers: Array.from(this.pointers.values())
        .filter((n) => !n.readCursorKey)
        .map(pointer),
      arrays: Array.from(this.arrays.values()).map(array),
      dicts: Array.from(this.dicts.values()).map(dict),
      variables: Array.from(this.variables.values()).map(variable),
      matrices: Array.from(this.matrices.values()).map(matrix),
    };
  }

  /** Inverso de `toJSON()` — substitui TODO o conteúdo atual (ver `clear()`)
   * pelos dados de um projeto salvo, preservando os ids originais (pointers/
   * arrays/dicts se referenciam entre si e a structs por id — trocar os ids
   * na volta quebraria essas ligações). Entradas ausentes/malformadas viram
   * valores neutros em vez de lançar, já que o arquivo pode ter sido editado
   * à mão ou vir de uma versão futura/antiga do formato. */
  loadFrom(data = {}) {
    this.clear();
    (data.structs || []).forEach((n) => {
      this.structs.set(n.id, {
        id: n.id,
        x: n.x || 0,
        y: n.y || 0,
        data: n.data,
        type: n.type === 'tree' ? 'tree' : n.type === 'graph' ? 'graph' : 'list',
        next: n.next ?? null,
        prev: n.prev ?? null,
        neighborsArrayId: n.neighborsArrayId ?? null,
      });
    });
    (data.pointers || []).forEach((n) => {
      this.pointers.set(n.id, {
        id: n.id,
        x: n.x || 0,
        y: n.y || 0,
        label: n.label,
        // chave de célula de dict pode ser tupla (`{tuple: [...]}` no JSON)
        target: n.target ? { ...n.target, ...('key' in n.target ? { key: reviveRaw(n.target.key) } : {}) } : null,
        frameId: n.frameId || 'global',
        ...(n.isArrayLabel ? { isArrayLabel: true, labelArrayId: n.labelArrayId } : {}),
        ...(n.isDictLabel ? { isDictLabel: true, labelDictId: n.labelDictId } : {}),
        ...(n.isMatrixLabel ? { isMatrixLabel: true, labelMatrixId: n.labelMatrixId } : {}),
        ...(n.hidden ? { hidden: true } : {}),
      });
    });
    (data.arrays || []).forEach((n) => {
      this.arrays.set(n.id, {
        id: n.id,
        x: n.x || 0,
        y: n.y || 0,
        kind: arrayKind(n.kind),
        orientation:
          n.orientation === 'vertical' || (n.orientation === 'stack' && !n.isSet) || (n.orientation === 'grid' && n.kind === 'arrayref')
            ? n.orientation
            : 'horizontal',
        // célula tupla volta a ser `PyTuple` (ver pytuple.js#reviveRaw)
        cells: Array.isArray(n.cells) ? n.cells.map(reviveRaw) : [],
        name: n.name,
        ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
        ...(n.isSet ? { isSet: true } : {}),
        ...(n.isDeque ? { isDeque: true, maxlen: Number.isInteger(n.maxlen) && n.maxlen >= 0 ? n.maxlen : null } : {}),
        // conferida contra as células no primeiro uso — com outra semente de
        // hash (texto/nó), é refeita (ver MicroRuntimeAdapter#_setTableOf)
        ...(n.isSet && n.hashTable && typeof n.hashTable === 'object' ? { hashTable: n.hashTable } : {}),
      });
    });
    (data.dicts || []).forEach((n) => {
      this.dicts.set(n.id, {
        id: n.id,
        x: n.x || 0,
        y: n.y || 0,
        orientation: n.orientation === 'vertical' ? 'vertical' : 'horizontal',
        // chave/valor tupla voltam a ser `PyTuple` (ver pytuple.js#reviveRaw)
        cells: Array.isArray(n.cells)
          ? n.cells.map((c) => ({ ...c, key: reviveRaw(c.key), ...(c.kind === 'value' ? { value: reviveRaw(c.value) } : {}) }))
          : [],
        name: n.name,
        ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
      });
    });
    (data.variables || []).forEach((n) => {
      this.variables.set(n.id, { id: n.id, x: n.x || 0, y: n.y || 0, name: n.name, value: reviveRaw(n.value), frameId: n.frameId || 'global' });
    });
    (data.matrices || []).forEach((n) => {
      // linhas irregulares (arquivo editado à mão) são completadas com 0 até
      // o tamanho da maior — a grade precisa ser retangular.
      const rows = Array.isArray(n.cells) && n.cells.length ? n.cells.filter(Array.isArray) : [[0]];
      const cols = Math.max(1, ...rows.map((row) => row.length));
      this.matrices.set(n.id, {
        id: n.id,
        x: n.x || 0,
        y: n.y || 0,
        cells: rows.map((row) => Array.from({ length: cols }, (_, c) => (c < row.length ? row[c] : 0))),
        name: n.name,
        ...(n.labelPointerId ? { labelPointerId: n.labelPointerId } : {}),
      });
    });
  }
}
