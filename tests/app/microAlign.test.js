import { describe, expect, test } from 'vitest';
import { alignRects, distributeRects } from '../../src/app/microAlign.js';

const r = (id, x, y, w, h) => ({ id, x, y, w, h });

/** Aplica os deslocamentos e devolve {id: {x, y}}. */
function aplicar(rects, moves) {
  return Object.fromEntries(
    rects.map((q) => {
      const m = moves.get(q.id) ?? { dx: 0, dy: 0 };
      return [q.id, { x: q.x + m.dx, y: q.y + m.dy }];
    }),
  );
}

describe('alignRects com âncora (1º selecionado)', () => {
  const rects = [r('b', 50, 10, 40, 20), r('a', 100, 80, 20, 10), r('c', 0, 200, 100, 30)];

  test('esquerda: todo mundo na borda esquerda da âncora, só no eixo x', () => {
    const pos = aplicar(rects, alignRects(rects, 'left', 'a'));
    expect(pos).toEqual({ b: { x: 100, y: 10 }, a: { x: 100, y: 80 }, c: { x: 100, y: 200 } });
  });

  test('a âncora não se move', () => {
    expect(alignRects(rects, 'left', 'a').has('a')).toBe(false);
  });

  test('centro e direita', () => {
    expect(aplicar(rects, alignRects(rects, 'center', 'a'))).toMatchObject({ b: { x: 90 }, c: { x: 60 } });
    expect(aplicar(rects, alignRects(rects, 'right', 'a'))).toMatchObject({ b: { x: 80 }, c: { x: 20 } });
  });

  test('topo, meio e fundo mexem só no eixo y', () => {
    expect(aplicar(rects, alignRects(rects, 'top', 'b'))).toEqual({ b: { x: 50, y: 10 }, a: { x: 100, y: 10 }, c: { x: 0, y: 10 } });
    expect(aplicar(rects, alignRects(rects, 'middle', 'b'))).toMatchObject({ a: { y: 15 }, c: { y: 5 } });
    expect(aplicar(rects, alignRects(rects, 'bottom', 'b'))).toMatchObject({ a: { y: 20 }, c: { y: 0 } });
  });
});

describe('alignRects sem âncora (seleção em área): extremos do grupo', () => {
  const rects = [r('a', 50, 10, 40, 20), r('b', 0, 80, 20, 10), r('c', 30, 200, 100, 30)];

  test('esquerda = a borda mais à esquerda; direita = a mais à direita', () => {
    expect(aplicar(rects, alignRects(rects, 'left'))).toMatchObject({ a: { x: 0 }, b: { x: 0 }, c: { x: 0 } });
    expect(aplicar(rects, alignRects(rects, 'right'))).toMatchObject({ a: { x: 90 }, b: { x: 110 }, c: { x: 30 } });
  });

  test('centro = centro da caixa que envolve todos', () => {
    // caixa x: 0..130 → centro 65
    expect(aplicar(rects, alignRects(rects, 'center'))).toMatchObject({ a: { x: 45 }, b: { x: 55 }, c: { x: 15 } });
    // caixa y: 10..230 → centro 120
    expect(aplicar(rects, alignRects(rects, 'middle'))).toMatchObject({ a: { y: 110 }, b: { y: 115 }, c: { y: 105 } });
  });

  test('âncora que não está na lista também cai nos extremos', () => {
    expect(aplicar(rects, alignRects(rects, 'top', 'zzz'))).toMatchObject({ a: { y: 10 }, b: { y: 10 }, c: { y: 10 } });
  });
});

describe('distributeRects', () => {
  test('horizontal: extremos parados e o mesmo espaço livre entre vizinhos, em qualquer ordem de entrada', () => {
    // ordem na tela: a(0..20) c(25..65) b(50..60) d(200..300) — espaço livre total 300 - 170 = 130 → 130/3
    const rects = [r('d', 200, 5, 100, 10), r('b', 50, 0, 10, 10), r('a', 0, 40, 20, 10), r('c', 25, 9, 40, 10)];
    const pos = aplicar(rects, distributeRects(rects, 'x'));
    const gap = 130 / 3;
    expect(pos.a).toEqual({ x: 0, y: 40 });
    expect(pos.d).toEqual({ x: 200, y: 5 });
    // c tem centro 45, b tem centro 55: c vem antes
    expect(pos.c.x).toBeCloseTo(20 + gap);
    expect(pos.b.x).toBeCloseTo(20 + gap + 40 + gap);
    expect(pos.b.y).toBe(0);
  });

  test('vertical', () => {
    const rects = [r('a', 0, 0, 10, 10), r('b', 0, 15, 10, 30), r('c', 0, 100, 10, 20)];
    // espaço livre = 120 - 60 = 60 → 30 entre cada
    expect(aplicar(rects, distributeRects(rects, 'y'))).toEqual({ a: { x: 0, y: 0 }, b: { x: 0, y: 40 }, c: { x: 0, y: 100 } });
  });

  test('com menos de 3 não faz nada', () => {
    expect(distributeRects([r('a', 0, 0, 10, 10), r('b', 50, 0, 10, 10)], 'x').size).toBe(0);
  });
});
