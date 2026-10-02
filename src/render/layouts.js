/**
 * Cada função de layout recebe os nós/arestas "crus" de uma estrutura
 * (formato genérico exportado por toGraph()) e devolve posições LOCAIS
 * (origem 0,0 no canto superior-esquerdo da área de conteúdo de um frame),
 * junto com o tamanho de conteúdo necessário para acomodá-las. Quem chama
 * (App) soma o offset do frame para obter coordenadas de mundo.
 */

export const NODE_RADIUS = 26;
export const PAD = 44;
export const GAP = 88; // lista/fila
export const STACK_GAP = 64;
export const LEVEL_HEIGHT = 84;
export const LEAF_GAP = 64;

export function listLayout(nodes) {
  const y = PAD;
  const positioned = nodes.map((n, i) => ({ ...n, x: PAD + i * GAP, y }));
  const width = nodes.length ? PAD * 2 + (nodes.length - 1) * GAP : PAD * 2 + 30;
  const height = PAD * 2;
  return { nodes: positioned, width, height };
}

export const queueLayout = listLayout;

export function stackLayout(nodes) {
  const height = nodes.length ? PAD * 2 + (nodes.length - 1) * STACK_GAP : PAD * 2 + 30;
  const x = PAD;
  const positioned = nodes.map((n, i) => ({ ...n, x, y: height - PAD - i * STACK_GAP }));
  const width = PAD * 2;
  return { nodes: positioned, width, height };
}

export function treeLayout(nodes, edges, rootId) {
  if (!rootId || nodes.length === 0) {
    return { nodes: [], width: PAD * 2 + 40, height: PAD * 2 + 40 };
  }

  const childrenOf = new Map();
  edges.forEach((e) => {
    if (!childrenOf.has(e.source)) childrenOf.set(e.source, []);
    childrenOf.get(e.source).push(e);
  });

  const positions = new Map();
  let leafCounter = 0;

  const visit = (nodeId, depth) => {
    const kids = (childrenOf.get(nodeId) ?? []).slice().sort((a, b) => (a.side === 'left' ? -1 : 1));
    if (kids.length === 0) {
      const x = PAD + leafCounter * LEAF_GAP;
      leafCounter += 1;
      positions.set(nodeId, { x, y: PAD + depth * LEVEL_HEIGHT });
      return x;
    }
    const childXs = kids.map((edge) => visit(edge.target, depth + 1));
    const x = childXs.reduce((a, b) => a + b, 0) / childXs.length;
    positions.set(nodeId, { x, y: PAD + depth * LEVEL_HEIGHT });
    return x;
  };
  visit(rootId, 0);

  const xs = Array.from(positions.values()).map((p) => p.x);
  const ys = Array.from(positions.values()).map((p) => p.y);
  const width = Math.max(...xs) + PAD;
  const height = Math.max(...ys) + PAD;

  const positioned = nodes.map((n) => ({ ...n, ...(positions.get(n.id) ?? { x: PAD, y: PAD }) }));
  return { nodes: positioned, width, height };
}

/**
 * Layout de forças simples (repulsão entre nós + mola nas arestas + gravidade
 * central), resolvido de forma síncrona por N iterações. Usado apenas para
 * "gerar aleatório" em frames de grafo — nós criados manualmente mantêm a
 * posição onde foram soltos.
 */
export function forceLayout(nodes, edges, contentSize, seed = {}) {
  const { width, height } = contentSize;
  const positioned = nodes.map((n) => ({
    ...n,
    x: seed[n.id]?.x ?? width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: seed[n.id]?.y ?? height / 2 + (Math.random() - 0.5) * height * 0.6,
  }));
  const byId = new Map(positioned.map((n) => [n.id, n]));
  const iterations = 220;
  const k = Math.sqrt((width * height) / Math.max(1, nodes.length)) * 0.9;

  for (let iter = 0; iter < iterations; iter += 1) {
    const disp = new Map(positioned.map((n) => [n.id, { x: 0, y: 0 }]));

    for (let i = 0; i < positioned.length; i += 1) {
      for (let j = i + 1; j < positioned.length; j += 1) {
        const a = positioned[i];
        const b = positioned[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        disp.get(a.id).x += dx;
        disp.get(a.id).y += dy;
        disp.get(b.id).x -= dx;
        disp.get(b.id).y -= dy;
      }
    }

    edges.forEach((e) => {
      const a = byId.get(e.source);
      const b = byId.get(e.target);
      if (!a || !b) return;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / k;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      disp.get(a.id).x -= dx;
      disp.get(a.id).y -= dy;
      disp.get(b.id).x += dx;
      disp.get(b.id).y += dy;
    });

    const centerX = width / 2;
    const centerY = height / 2;
    const cooling = 1 - iter / iterations;

    positioned.forEach((n) => {
      const d = disp.get(n.id);
      const len = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const capped = Math.min(len, 40) * cooling;
      n.x += (d.x / len) * capped;
      n.y += (d.y / len) * capped;
      n.x += (centerX - n.x) * 0.01;
      n.y += (centerY - n.y) * 0.01;
      n.x = Math.max(NODE_RADIUS + 6, Math.min(width - NODE_RADIUS - 6, n.x));
      n.y = Math.max(NODE_RADIUS + 6, Math.min(height - NODE_RADIUS - 6, n.y));
    });
  }

  return positioned;
}

/** Tamanho de conteúdo (não fixo) para um frame de grafo, cresce com o nº de nós. */
export function graphContentSize(nodeCount) {
  const width = Math.max(380, 160 + nodeCount * 46);
  const height = Math.max(260, 140 + nodeCount * 30);
  return { width, height };
}

/** Índice de inserção numa lista/fila a partir de uma coordenada X local solta. */
export function indexFromLocalX(localX, count) {
  const idx = Math.round((localX - PAD) / GAP);
  return Math.max(0, Math.min(idx, count));
}
