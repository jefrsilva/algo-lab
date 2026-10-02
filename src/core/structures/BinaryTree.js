import { nextId } from '../id.js';

/**
 * Árvore binária de busca (BST). Cada nó: { id, value, left, right }.
 */
export class BinaryTree {
  constructor() {
    this.root = null;
  }

  insert(value) {
    const newNode = { id: nextId('tree'), value, left: null, right: null };
    if (!this.root) {
      this.root = newNode;
      return newNode;
    }
    let current = this.root;
    for (;;) {
      if (value === current.value) return current; // sem duplicatas
      if (value < current.value) {
        if (!current.left) {
          current.left = newNode;
          return newNode;
        }
        current = current.left;
      } else {
        if (!current.right) {
          current.right = newNode;
          return newNode;
        }
        current = current.right;
      }
    }
  }

  find(value) {
    let current = this.root;
    while (current) {
      if (value === current.value) return current;
      current = value < current.value ? current.left : current.right;
    }
    return null;
  }

  remove(value) {
    const removeNode = (node, val) => {
      if (!node) return null;
      if (val < node.value) {
        node.left = removeNode(node.left, val);
        return node;
      }
      if (val > node.value) {
        node.right = removeNode(node.right, val);
        return node;
      }
      // encontrado
      if (!node.left) return node.right;
      if (!node.right) return node.left;
      let successor = node.right;
      while (successor.left) successor = successor.left;
      node.value = successor.value;
      node.id = node.id; // mantém id do nó "vencedor" na posição
      node.right = removeNode(node.right, successor.value);
      return node;
    };
    this.root = removeNode(this.root, value);
  }

  clear() {
    this.root = null;
  }

  toGraph() {
    const nodes = [];
    const edges = [];
    const walk = (node, depth) => {
      if (!node) return;
      nodes.push({ id: node.id, label: String(node.value), meta: { depth } });
      if (node.left) {
        edges.push({ id: `${node.id}->${node.left.id}`, source: node.id, target: node.left.id, directed: true, side: 'left' });
        walk(node.left, depth + 1);
      }
      if (node.right) {
        edges.push({ id: `${node.id}->${node.right.id}`, source: node.id, target: node.right.id, directed: true, side: 'right' });
        walk(node.right, depth + 1);
      }
    };
    walk(this.root, 0);
    return { nodes, edges, root: this.root?.id ?? null };
  }

  /** Retorna vizinhos (filhos) de um nó pelo id — usado pelos algoritmos de travessia. */
  neighborsOf(id) {
    const found = this._findById(this.root, id);
    if (!found) return [];
    return [found.left?.id, found.right?.id].filter(Boolean);
  }

  getNodeById(id) {
    return this._findById(this.root, id);
  }

  isLeaf(id) {
    const node = this._findById(this.root, id);
    return !!node && !node.left && !node.right;
  }

  _findById(node, id) {
    if (!node) return null;
    if (node.id === id) return node;
    return this._findById(node.left, id) ?? this._findById(node.right, id);
  }
}
