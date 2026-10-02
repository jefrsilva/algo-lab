import { nextId } from '../id.js';

/**
 * Lista ligada simples. Mantida como array de nós internamente para
 * simplificar a exportação para o formato genérico {nodes, edges} usado
 * pelo renderer, mas expõe a API clássica de uma lista ligada.
 */
export class LinkedList {
  constructor() {
    this.nodes = []; // ordem = ordem da lista
  }

  pushBack(value) {
    const node = { id: nextId('list'), value };
    this.nodes.push(node);
    return node;
  }

  pushFront(value) {
    const node = { id: nextId('list'), value };
    this.nodes.unshift(node);
    return node;
  }

  insertAt(index, value) {
    const node = { id: nextId('list'), value };
    const safeIndex = Math.max(0, Math.min(index, this.nodes.length));
    this.nodes.splice(safeIndex, 0, node);
    return node;
  }

  removeAt(index) {
    if (index < 0 || index >= this.nodes.length) return null;
    return this.nodes.splice(index, 1)[0] ?? null;
  }

  removeById(id) {
    const index = this.nodes.findIndex((n) => n.id === id);
    if (index === -1) return null;
    return this.nodes.splice(index, 1)[0];
  }

  clear() {
    this.nodes = [];
  }

  toGraph() {
    const nodes = this.nodes.map((n, i) => ({
      id: n.id,
      label: String(n.value),
      meta: { index: i },
    }));
    const edges = [];
    for (let i = 0; i < this.nodes.length - 1; i += 1) {
      edges.push({
        id: `${this.nodes[i].id}->${this.nodes[i + 1].id}`,
        source: this.nodes[i].id,
        target: this.nodes[i + 1].id,
        directed: true,
      });
    }
    return { nodes, edges };
  }
}
