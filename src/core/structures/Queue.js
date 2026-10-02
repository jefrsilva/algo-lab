import { nextId } from '../id.js';

/**
 * Fila (FIFO). index 0 = frente da fila (próximo a sair), último = fim (chegou por último).
 */
export class Queue {
  constructor() {
    this.items = [];
  }

  enqueue(value) {
    const node = { id: nextId('queue'), value };
    this.items.push(node);
    return node;
  }

  dequeue() {
    return this.items.shift() ?? null;
  }

  /** Remoção pela parte de trás — não é uma operação clássica de fila, mas a
   * ferramenta permite arrastar nós para fora por qualquer uma das pontas. */
  dequeueBack() {
    return this.items.pop() ?? null;
  }

  peek() {
    return this.items[0] ?? null;
  }

  clear() {
    this.items = [];
  }

  toGraph() {
    const nodes = this.items.map((n, i) => ({
      id: n.id,
      label: String(n.value),
      meta: { index: i, isFront: i === 0, isBack: i === this.items.length - 1 },
    }));
    const edges = [];
    for (let i = 0; i < this.items.length - 1; i += 1) {
      edges.push({
        id: `${this.items[i].id}->${this.items[i + 1].id}`,
        source: this.items[i].id,
        target: this.items[i + 1].id,
        directed: true,
      });
    }
    return { nodes, edges };
  }
}
