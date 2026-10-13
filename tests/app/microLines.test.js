import { describe, expect, test } from 'vitest';
import {
  LINE_DEFAULT_LENGTH,
  arrowHeadPoints,
  defaultLine,
  distToSegment,
  lineBounds,
  lineEnds,
  lineFromDrag,
  moveLineEnd,
  rulerTicks,
  snapToAxis,
} from '../../src/app/microLines.js';

describe('microLines', () => {
  test('lineEnds e lineBounds', () => {
    const l = { x: 10, y: 20, dx: -4, dy: 6 };
    expect(lineEnds(l)).toEqual({ x1: 10, y1: 20, x2: 6, y2: 26 });
    expect(lineBounds(l)).toEqual({ x: 6, y: 20, w: 4, h: 6 });
  });

  test('snapToAxis escolhe o eixo de maior deslocamento', () => {
    expect(snapToAxis({ x: 0, y: 0 }, { x: 10, y: 3 })).toEqual({ x: 10, y: 0 });
    expect(snapToAxis({ x: 0, y: 0 }, { x: 2, y: -9 })).toEqual({ x: 0, y: -9 });
  });

  test('lineFromDrag: snap, e arraste curto vira null', () => {
    expect(lineFromDrag({ x: 0, y: 0 }, { x: 50, y: 10 }, true)).toEqual({ x: 0, y: 0, dx: 50, dy: 0 });
    expect(lineFromDrag({ x: 0, y: 0 }, { x: 50, y: 10 }, false)).toEqual({ x: 0, y: 0, dx: 50, dy: 10 });
    expect(lineFromDrag({ x: 0, y: 0 }, { x: 2, y: 1 }, false)).toBeNull();
    expect(defaultLine({ x: 5, y: 5 })).toEqual({ x: 5, y: 5, dx: LINE_DEFAULT_LENGTH, dy: 0 });
  });

  test('moveLineEnd mexe numa extremidade e mantém a outra', () => {
    const l = { x: 0, y: 0, dx: 10, dy: 0 };
    expect(moveLineEnd(l, 'b', { x: 30, y: 20 }, false)).toEqual({ x: 0, y: 0, dx: 30, dy: 20 });
    expect(moveLineEnd(l, 'a', { x: -5, y: 4 }, false)).toEqual({ x: -5, y: 4, dx: 15, dy: -4 });
    // com Shift, encaixa no eixo da extremidade fixa
    expect(moveLineEnd(l, 'b', { x: 30, y: 20 }, true)).toEqual({ x: 0, y: 0, dx: 30, dy: 0 });
  });

  test('distToSegment', () => {
    expect(distToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(3);
    expect(distToSegment({ x: 13, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });

  test('ponta da seta e travessas da régua', () => {
    const [tip] = arrowHeadPoints(0, 0, 10, 0);
    expect(tip).toEqual({ x: 10, y: 0 });
    const [t1, t2] = rulerTicks(0, 0, 10, 0, 5);
    expect(t1.x1).toBeCloseTo(0);
    expect(t1.y1).toBeCloseTo(-5);
    expect(t1.y2).toBeCloseTo(5);
    expect(t2.x1).toBeCloseTo(10);
  });
});
