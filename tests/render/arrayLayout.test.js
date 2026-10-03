// Geometria da orientação "pilha" de uma lista (`orientation: 'stack'`):
// vertical, com a posição 0 embaixo e o último elemento (o topo) em cima.
import { describe, expect, test } from 'vitest';
import { arrayDividers, arrayHandleRect, arrayLayout, isVerticalOrientation } from '../../src/render/MicroCanvasView.js';

const lista = (orientation, cells = [10, 20, 30]) => ({ x: 0, y: 0, kind: 'value', orientation, cells });

describe('array em pilha', () => {
  test('mesma caixa da vertical, com as células em ordem invertida', () => {
    const v = arrayLayout(lista('vertical'));
    const p = arrayLayout(lista('stack'));
    expect({ w: p.width, h: p.height }).toEqual({ w: v.width, h: v.height });
    expect(p.cells.map((c) => c.index)).toEqual([0, 1, 2]);
    expect(p.cells.map((c) => c.y)).toEqual(v.cells.map((c) => c.y).reverse());
    // o topo (último elemento) começa no alto da caixa, o 0 encosta na base
    expect(p.cells[2].y).toBe(0);
    expect(p.cells[0].y + p.cells[0].h).toBe(p.height);
  });

  test('puxador em cima, como na vertical', () => {
    expect(arrayHandleRect(lista('stack'))).toEqual(arrayHandleRect(lista('vertical')));
    expect(isVerticalOrientation('stack')).toBe(true);
    expect(isVerticalOrientation('horizontal')).toBe(false);
  });

  test('a divisória de corte fica entre as células certas', () => {
    const node = lista('stack');
    const { cells } = arrayLayout(node);
    arrayDividers(node).forEach((d) => {
      const meio = d.y + d.h / 2;
      // borda de cima da célula `at - 1` = borda de baixo da célula `at`
      expect(meio).toBe(cells[d.at - 1].y);
      expect(meio).toBe(cells[d.at].y + cells[d.at].h);
    });
  });

  test('pilha vazia ainda tem uma caixa visível', () => {
    expect(arrayLayout(lista('stack', [])).height).toBeGreaterThan(0);
  });
});
