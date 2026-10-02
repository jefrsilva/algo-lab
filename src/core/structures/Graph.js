import { nextId } from '../id.js';

/**
 * Grafo genérico (lista de adjacência). Suporta modo direcionado/não-direcionado.
 */
export class Graph {
  constructor({ directed = false } = {}) {
    this.directed = directed;
    this.nodes = new Map(); // id -> { id, value }
    this.adjacency = new Map(); // id -> Set(neighborId)
    this.edges = new Map(); // edgeId -> { id, source, target }
  }

  addNode(value) {
    const id = nextId('graph');
    this.nodes.set(id, { id, value });
    this.adjacency.set(id, new Set());
    return this.nodes.get(id);
  }

  removeNode(id) {
    if (!this.nodes.has(id)) return;
    this.nodes.delete(id);
    this.adjacency.delete(id);
    for (const set of this.adjacency.values()) set.delete(id);
    for (const [edgeId, edge] of this.edges) {
      if (edge.source === id || edge.target === id) this.edges.delete(edgeId);
    }
  }

  addEdge(sourceId, targetId) {
    if (sourceId === targetId) return null;
    if (!this.nodes.has(sourceId) || !this.nodes.has(targetId)) return null;
    const edgeId = `${sourceId}~${targetId}`;
    if (this.edges.has(edgeId) || (!this.directed && this.edges.has(`${targetId}~${sourceId}`))) {
      return null; // já existe
    }
    this.edges.set(edgeId, { id: edgeId, source: sourceId, target: targetId });
    this.adjacency.get(sourceId).add(targetId);
    if (!this.directed) this.adjacency.get(targetId).add(sourceId);
    return this.edges.get(edgeId);
  }

  removeEdge(edgeId) {
    const edge = this.edges.get(edgeId);
    if (!edge) return;
    this.edges.delete(edgeId);
    this.adjacency.get(edge.source)?.delete(edge.target);
    if (!this.directed) this.adjacency.get(edge.target)?.delete(edge.source);
  }

  clear() {
    this.nodes.clear();
    this.adjacency.clear();
    this.edges.clear();
  }

  neighborsOf(id) {
    return Array.from(this.adjacency.get(id) ?? []);
  }

  toGraph() {
    const nodes = Array.from(this.nodes.values()).map((n) => ({ id: n.id, label: String(n.value) }));
    const edges = Array.from(this.edges.values()).map((e) => ({ ...e, directed: this.directed }));
    return { nodes, edges };
  }

  /** Gera um grafo aleatório simples e conectado com n nós. */
  static random(n = 6, extraEdgeChance = 0.25, directed = false) {
    const g = new Graph({ directed });
    const ids = [];
    for (let i = 0; i < n; i += 1) ids.push(g.addNode(i + 1).id);
    // conecta em cadeia para garantir conectividade
    for (let i = 0; i < ids.length - 1; i += 1) g.addEdge(ids[i], ids[i + 1]);
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 2; j < ids.length; j += 1) {
        if (Math.random() < extraEdgeChance) g.addEdge(ids[i], ids[j]);
      }
    }
    return g;
  }
}
