import { nextId } from '../id.js';

/**
 * Pilha (LIFO). index 0 = fundo da pilha, último elemento = topo.
 */
export class Stack {
  constructor() {
    this.items = [];
  }

  push(value) {
    const node = { id: nextId('stack'), value };
    this.items.push(node);
    return node;
  }

  pop() {
    return this.items.pop() ?? null;
  }

  peek() {
    return this.items[this.items.length - 1] ?? null;
  }

  clear() {
    this.items = [];
  }

  toGraph() {
    const nodes = this.items.map((n, i) => ({
      id: n.id,
      label: String(n.value),
      meta: { index: i, isTop: i === this.items.length - 1 },
    }));
    const edges = [];
    for (let i = 0; i < this.items.length - 1; i += 1) {
      edges.push({
        id: `${this.items[i].id}->${this.items[i + 1].id}`,
        source: this.items[i].id,
        target: this.items[i + 1].id,
        directed: false,
      });
    }
    return { nodes, edges };
  }
}
