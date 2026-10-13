// Geometria pura das setas e réguas do canvas (anotações, fora do MicroModel).
// Uma linha guarda o ponto inicial (x, y) e o vetor até o final (dx, dy) —
// assim x/y funcionam como a posição de qualquer outro elemento (mover,
// arraste de grupo, alinhar) e as extremidades saem de `lineEnds`.

/** Comprimento (mundo) de uma linha criada com um clique simples. */
export const LINE_DEFAULT_LENGTH = 96;
/** Abaixo disso, um arraste de criação vale como clique simples. */
export const LINE_MIN_LENGTH = 8;

/** Extremidades `{x1,y1,x2,y2}` de uma linha `{x,y,dx,dy}`. */
export function lineEnds(line) {
  return { x1: line.x, y1: line.y, x2: line.x + line.dx, y2: line.y + line.dy };
}

/** Linha `{x,y,dx,dy}` a partir das duas extremidades. */
export function lineFromEnds(x1, y1, x2, y2) {
  return { x: x1, y: y1, dx: x2 - x1, dy: y2 - y1 };
}

/** Encaixa `to` na horizontal ou na vertical que passa por `from` (a de
 * maior deslocamento vence) — Shift durante o desenho/edição. */
export function snapToAxis(from, to) {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
}

/** Distância do ponto `p` ao segmento `a`–`b`. */
export function distToSegment(p, a, b) {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2));
  return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
}

/** Caixa envolvente `{x,y,w,h}` de uma linha. */
export function lineBounds(line) {
  const { x1, y1, x2, y2 } = lineEnds(line);
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

/** Linha de uma criação por arraste de `a` até `b` (`snap`: eixo). Abaixo do
 * comprimento mínimo devolve null — o chamador cria uma de tamanho padrão. */
export function lineFromDrag(a, b, snap) {
  const end = snap ? snapToAxis(a, b) : b;
  if (Math.hypot(end.x - a.x, end.y - a.y) < LINE_MIN_LENGTH) return null;
  return lineFromEnds(a.x, a.y, end.x, end.y);
}

/** Linha de tamanho padrão (horizontal) com o início em `a`. */
export function defaultLine(a) {
  return { x: a.x, y: a.y, dx: LINE_DEFAULT_LENGTH, dy: 0 };
}

/** Move a extremidade `end` ('a' = início, 'b' = fim) de `line` para `pt`,
 * mantendo a outra fixa; `snap` encaixa no eixo da extremidade fixa. */
export function moveLineEnd(line, end, pt, snap) {
  const { x1, y1, x2, y2 } = lineEnds(line);
  const fixed = end === 'a' ? { x: x2, y: y2 } : { x: x1, y: y1 };
  const to = snap ? snapToAxis(fixed, pt) : pt;
  return end === 'a' ? lineFromEnds(to.x, to.y, x2, y2) : lineFromEnds(x1, y1, to.x, to.y);
}

/** Ponta de seta: os 3 vértices do triângulo em `(x2,y2)` apontando de `(x1,y1)`. */
export function arrowHeadPoints(x1, y1, x2, y2, size = 12) {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const wing = (delta) => ({ x: x2 - size * Math.cos(ang + delta), y: y2 - size * Math.sin(ang + delta) });
  const a = wing(Math.PI / 7);
  const b = wing(-Math.PI / 7);
  return [{ x: x2, y: y2 }, a, b];
}

/** Travessas da régua: um segmento perpendicular centrado em cada extremidade. */
export function rulerTicks(x1, y1, x2, y2, half = 7) {
  const len = Math.hypot(x2 - x1, y2 - y1) || 1;
  const nx = -(y2 - y1) / len;
  const ny = (x2 - x1) / len;
  const tick = (x, y) => ({ x1: x - nx * half, y1: y - ny * half, x2: x + nx * half, y2: y + ny * half });
  return [tick(x1, y1), tick(x2, y2)];
}
