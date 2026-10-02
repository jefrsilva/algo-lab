import { Scalar, StructRef, NoneValue, ReflistValue, rawToValue } from '../interpreter/evaluator.js';
import { nextId } from '../core/id.js';

/**
 * Implementa a interface `Environment` que o avaliador (src/interpreter/
 * evaluator.js) espera, em cima de uma estrutura do modo MACRO (`Graph`/
 * `LinkedList`/etc. de core/structures) em vez do `MicroModel` — ver
 * MicroRuntimeAdapter.js, que é o equivalente do modo micro.
 *
 * Diferença central: é SOMENTE-LEITURA sobre a estrutura. O modo "Executar"
 * do macro serve pra escrever o ALGORITMO sobre uma estrutura que já existe
 * (montada no sandbox) — não pra construir/religar a estrutura em si (isso é
 * trabalho do sandbox). Por isso `createStruct` não cria nada de verdade e
 * `assignAttr` não tem efeito nenhum; só `getAttr` (leitura/travessia) é
 * suportado.
 *
 * Variáveis e arrays são "de rascunho": vivem só durante esta execução, não
 * fazem parte da estrutura nem do frame — cada `run()` novo começa do zero
 * (ver `runMacroProgram.js`).
 */
export class MacroRuntimeAdapter {
  constructor(structure, { startId } = {}) {
    this.structure = structure;
    this.variables = new Map(); // `${frameId}:${name}` -> TypedValue
    this.arrays = new Map(); // name -> TypedValue[] (globais, mesmo padrão do MicroModel)
    this.dequeMaxlens = new Map(); // name -> maxlen|null, só dos arrays que são deque
    this.touched = [];
    this.nodeStates = new Map(); // structId -> 'current' | 'visited'
    this.frameStack = [{ id: 'global', label: 'global' }];
    // linhas escritas por "print(...)" (ver evaluator.js) — como cada
    // "Rodar" cria um `MacroRuntimeAdapter` novo (ver App#_runMacroCode),
    // sempre começa vazio; runMacroProgram.js captura um snapshot por passo,
    // igual já faz com `visited`/`currentId`.
    this.output = [];
    if (startId != null) this.variables.set('global:inicio', StructRef(startId));
  }

  get currentFrameId() {
    return this.frameStack[this.frameStack.length - 1].id;
  }

  pushFrame(label) {
    const id = nextId('frame');
    this.frameStack.push({ id, label });
    return id;
  }

  popFrame() {
    if (this.frameStack.length > 1) this.frameStack.pop();
  }

  _note(kind, id) {
    this.touched.push({ kind, id });
  }

  _varKey(name) {
    return `${this.currentFrameId}:${name}`;
  }

  // ---- Environment: leitura ----

  resolveName(name) {
    const local = this.variables.get(this._varKey(name));
    if (local !== undefined) return local;
    if (this.currentFrameId !== 'global') {
      const glob = this.variables.get(`global:${name}`);
      if (glob !== undefined) return glob;
    }
    return undefined;
  }

  /** Só `neighbors`/`vizinhos` (grafo, via `structure.neighborsOf`) e
   * `value`/`valor`/`data`/`dado` (o rótulo do nó) são reconhecidos hoje —
   * cobre o suficiente pra BFS/DFS sobre grafo. `left`/`right`/`next`/`prev`
   * ficam de fora até uma próxima iteração cobrir árvore/lista. */
  getAttr(structValue, attr) {
    if (structValue.kind !== 'struct') return undefined;
    if (attr === 'neighbors' || attr === 'vizinhos') {
      if (typeof this.structure.neighborsOf !== 'function') return undefined;
      return ReflistValue(this.structure.neighborsOf(structValue.id));
    }
    if (attr === 'value' || attr === 'valor' || attr === 'data' || attr === 'dado') {
      const node = this.structure.nodes?.get(structValue.id);
      return node ? Scalar(node.value) : undefined;
    }
    return undefined;
  }

  getIndex(arrayName, _indexNode, index) {
    const arr = this.arrays.get(arrayName);
    if (arr && index < 0) index += arr.length; // "fila[-1]" conta do fim
    if (!arr || index < 0 || index >= arr.length) return undefined;
    return arr[index];
  }

  getLength(arrayName) {
    const arr = this.arrays.get(arrayName);
    return arr ? arr.length : undefined;
  }

  arrayAppend(arrayName, value) {
    if (!this.arrays.has(arrayName)) this.arrays.set(arrayName, []);
    this.arrays.get(arrayName).push(value);
    this._note('array', arrayName);
  }

  /** "nome.insert(i, valor)" — `index` já normalizado pelo avaliador. */
  arrayInsert(arrayName, index, value) {
    if (!this.arrays.has(arrayName)) this.arrays.set(arrayName, []);
    this.arrays.get(arrayName).splice(index, 0, value);
    this._note('array', arrayName);
  }

  arrayPop(arrayName, index) {
    const arr = this.arrays.get(arrayName);
    if (!arr || arr.length === 0) return NoneValue;
    const i = index == null ? arr.length - 1 : index;
    if (i < 0 || i >= arr.length) return NoneValue;
    const [value] = arr.splice(i, 1);
    this._note('array', arrayName);
    return value ?? NoneValue;
  }

  iterateArray(arrayName) {
    const arr = this.arrays.get(arrayName);
    return arr ? [...arr] : undefined;
  }

  /** "fila = deque(...)" — mesmo array de rascunho, marcado como deque (ver
   * evaluator.js#callDequeMethod). */
  isDeque(arrayName) {
    return this.dequeMaxlens.has(arrayName);
  }

  dequeMaxlen(arrayName) {
    return this.dequeMaxlens.get(arrayName) ?? null;
  }

  dequeSetItems(arrayName, items) {
    if (!this.arrays.has(arrayName)) return false;
    this.arrays.set(arrayName, [...items]);
    this._note('array', arrayName);
    return true;
  }

  /** Não cria nó nenhum de verdade — ver docstring da classe. Devolve `null`
   * (evaluator.js trata isso como "Node(...) não resolvido", mesmo critério
   * de "ignora a linha silenciosamente" de sempre). */
  createStruct() {
    return null;
  }

  /** "print(...)" (ver evaluator.js) — só acumula texto em `this.output`,
   * consumido por runMacroProgram.js (um snapshot por passo). */
  print(text) {
    this.output.push(text);
  }

  /** Chamado por "marcar_atual(nó)"/"marcar_visitado(nó)" (ver
   * evaluator.js) — não é parte formal da interface `Environment` (é
   * opcional, checado com `env.markState?.(...)`), só o macro implementa. */
  markState(structId, estado) {
    if (structId == null) return;
    this.nodeStates.set(structId, estado);
    this._note('state', structId);
  }

  // ---- Environment: escrita ----

  assignName(name, value) {
    if (value.kind === 'array') {
      // "fila = []" — array de rascunho vazio (ou literal de números/strings;
      // ver evaluator.js#ArrayLiteral). Construção de arrays com struct dentro
      // (ex: a fila da BFS) é feita por `.append(...)` logo em seguida, não
      // pelo literal.
      this.arrays.set(name, value.elements.map(rawToValue)); // célula crua (número, texto, bool, tupla) -> valor tipado
      this.dequeMaxlens.delete(name);
      this._note('array', name);
      return;
    }
    if (value.kind === 'nodelist') {
      // "fila = [inicio]" — lista de nós, já tipados
      this.arrays.set(name, [...value.items]);
      this.dequeMaxlens.delete(name);
      this._note('array', name);
      return;
    }
    if (value.kind === 'deque') {
      // "fila = deque([inicio])" — aqui os itens já são valores tipados
      this.arrays.set(name, [...value.elements]);
      this.dequeMaxlens.set(name, value.maxlen);
      this._note('array', name);
      return;
    }
    if (
      value.kind !== 'scalar' &&
      value.kind !== 'bool' &&
      value.kind !== 'string' &&
      value.kind !== 'tuple' &&
      value.kind !== 'dict' &&
      value.kind !== 'struct' &&
      value.kind !== 'none'
    ) {
      return;
    }
    this.variables.set(this._varKey(name), value);
    this._note('variable', name);
  }

  /** Sem efeito — ver docstring da classe (Executar não religa a estrutura). */
  assignAttr() {}

  assignIndex(arrayName, index, value) {
    const arr = this.arrays.get(arrayName);
    if (arr && index < 0) index += arr.length;
    if (!arr || index < 0 || index >= arr.length) return;
    arr[index] = value;
    this._note('array', arrayName);
  }
}
