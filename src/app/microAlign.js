// Alinhar e distribuir elementos selecionados do canvas micro (botões da
// barra inferior que aparecem com seleção múltipla, ver AlignToolbar.js, e os
// comandos "align …"/"distribute …" do Ctrl+Espaço). Funções puras sobre
// retângulos {id, x, y, w, h} em coordenadas de mundo — quem monta os
// retângulos (a caixa desenhada de cada tipo de elemento, com a aba das
// coleções) e aplica o resultado é App#_alignMicroSelection.

/** Modos de alinhamento: eixo movido e qual ponto do retângulo se iguala. */
export const ALIGN_MODES = {
  left: { axis: 'x', at: 0 },
  center: { axis: 'x', at: 0.5 },
  right: { axis: 'x', at: 1 },
  top: { axis: 'y', at: 0 },
  middle: { axis: 'y', at: 0.5 },
  bottom: { axis: 'y', at: 1 },
};

const SIZE = { x: 'w', y: 'h' };

/** Ponto do retângulo no eixo: 0 = borda inicial, 0.5 = centro, 1 = final. */
const edge = (r, axis, at) => r[axis] + r[SIZE[axis]] * at;

/** Deslocamento de cada retângulo pra alinhar todos no modo `mode` (chave
 * de ALIGN_MODES). A referência é o retângulo `anchorId` (o primeiro
 * elemento selecionado), que não se move; sem âncora (seleção feita por
 * retângulo, ou âncora fora da lista) vale o extremo do grupo — a borda mais
 * à esquerda/direita/acima/abaixo, ou o centro da caixa que envolve todos.
 * Devolve Map<id, {dx, dy}> só com quem precisa se mover. */
export function alignRects(rects, mode, anchorId = null) {
  const { axis, at } = ALIGN_MODES[mode];
  const anchor = rects.find((r) => r.id === anchorId);
  let target;
  if (anchor) {
    target = edge(anchor, axis, at);
  } else {
    const lo = Math.min(...rects.map((r) => edge(r, axis, 0)));
    const hi = Math.max(...rects.map((r) => edge(r, axis, 1)));
    target = lo + (hi - lo) * at;
  }
  const moves = new Map();
  rects.forEach((r) => {
    const d = target - edge(r, axis, at);
    if (Math.abs(d) > 1e-9) moves.set(r.id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
  });
  return moves;
}

/** Deslocamento de cada retângulo pra deixar o MESMO espaço livre entre
 * bordas vizinhas no eixo `axis` ('x' = horizontal, 'y' = vertical). Os
 * extremos (o primeiro e o último pela posição do centro) ficam parados — o
 * primeiro pela borda inicial, o último pela final — e os do meio são
 * reposicionados em ordem. Com menos de 3 não há o que distribuir. Devolve
 * Map<id, {dx, dy}> só com quem precisa se mover. */
export function distributeRects(rects, axis) {
  const moves = new Map();
  if (rects.length < 3) return moves;
  const size = SIZE[axis];
  const sorted = [...rects].sort((a, b) => edge(a, axis, 0.5) - edge(b, axis, 0.5));
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const total = sorted.reduce((sum, r) => sum + r[size], 0);
  const gap = (edge(last, axis, 1) - first[axis] - total) / (sorted.length - 1);
  let pos = first[axis] + first[size] + gap;
  sorted.slice(1, -1).forEach((r) => {
    const d = pos - r[axis];
    if (Math.abs(d) > 1e-9) moves.set(r.id, axis === 'x' ? { dx: d, dy: 0 } : { dx: 0, dy: d });
    pos += r[size] + gap;
  });
  return moves;
}
