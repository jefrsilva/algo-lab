// Geometria da orientação "pilha" de uma lista (`orientation: 'stack'`):
// vertical, com a posição 0 embaixo e o último elemento (o topo) em cima.
import { describe, expect, test } from 'vitest';
import { arrayDividers, arrayEndCaptions, arrayHandleRect, arrayLayout, arrayOuterBox, isVerticalOrientation } from '../../src/render/MicroCanvasView.js';

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

// Rótulos discretos das pontas (ver MicroCanvasView.js#arrayEndCaptions):
// "topo" na pilha, "início"/"fim" no deque.
describe('rótulos de ponta', () => {
  const textos = (node) => arrayEndCaptions(node).map((c) => c.text);
  const deque = (orientation, cells, maxlen = null) => ({ ...lista(orientation, cells), isDeque: true, maxlen });

  test('pilha: "topo" acima do puxador, centralizado na célula do último elemento', () => {
    const node = lista('stack');
    const [topo] = arrayEndCaptions(node);
    expect(textos(node)).toEqual(['topo']);
    expect(topo.y).toBeLessThan(arrayHandleRect(node).y);
    const c = arrayLayout(node).cells[2];
    expect(topo.x).toBe(c.x + c.w / 2);
  });

  test('pilha vazia não tem topo; lista comum e set não têm rótulo', () => {
    expect(arrayEndCaptions(lista('stack', []))).toEqual([]);
    expect(arrayEndCaptions(lista('horizontal'))).toEqual([]);
    expect(arrayEndCaptions(lista('vertical'))).toEqual([]);
    expect(arrayEndCaptions({ ...lista('horizontal'), isSet: true })).toEqual([]);
  });

  test('deque horizontal: "início" sobre a posição 0 e "fim" sobre a última, acima da caixa', () => {
    const node = deque('horizontal', [1, 2, 3]);
    const { cells } = arrayLayout(node);
    const [inicio, fim] = arrayEndCaptions(node);
    expect(inicio).toMatchObject({ text: 'início', x: cells[0].x + cells[0].w / 2 });
    expect(fim).toMatchObject({ text: 'fim', x: cells[2].x + cells[2].w / 2 });
    expect(inicio.y).toBeLessThan(0);
    expect(fim.y).toBe(inicio.y);
  });

  test('deque com um elemento: "início" e "fim" um acima do outro', () => {
    for (const o of ['horizontal', 'vertical', 'stack']) {
      const [inicio, fim] = arrayEndCaptions(deque(o, [7]));
      expect([inicio.text, fim.text]).toEqual(['início', 'fim']);
      expect(inicio.x).toBe(fim.x);
      expect(inicio.y).toBeLessThan(fim.y);
      expect(fim.y).toBeLessThan(0);
    }
  });

  test('deque vertical: início em cima, fim embaixo; na pilha, o contrário', () => {
    const v = deque('vertical', [1, 2, 3]);
    const altura = arrayLayout(v).height;
    const por = (node) => Object.fromEntries(arrayEndCaptions(node).map((c) => [c.text, c.y]));
    expect(por(v)['início']).toBeLessThan(0);
    expect(por(v).fim).toBeGreaterThan(altura);
    const p = deque('stack', [1, 2, 3]);
    expect(por(p)['início']).toBeGreaterThan(altura);
    expect(por(p).fim).toBeLessThan(0);
  });

  test('maxlen continua visível, num rótulo à parte; deque vazio só mostra ele', () => {
    expect(textos(deque('horizontal', [1, 2], 3))).toEqual(['início', 'fim', 'maxlen=3']);
    expect(textos(deque('vertical', [], 3))).toEqual(['maxlen=3']);
    expect(textos(deque('horizontal', []))).toEqual([]);
  });

  test('o espaço ocupado pelo array (pra achar lugar livre) inclui os rótulos', () => {
    const comum = lista('horizontal', [1, 2, 3]);
    const fila = deque('horizontal', [1, 2, 3], 4);
    const a = arrayOuterBox(comum);
    const b = arrayOuterBox(fila);
    const { y: topoRotulo } = arrayEndCaptions(fila)[0];
    expect(b.y).toBeLessThan(topoRotulo);
    expect(b.y).toBeLessThan(a.y);
    // "maxlen=4" à direita
    expect(b.x + b.w).toBeGreaterThan(a.x + a.w);
    // sem rótulo, é a caixa + puxador
    const { width, height } = arrayLayout(comum);
    expect(a).toEqual({ x: arrayHandleRect(comum).x, y: 0, w: width - arrayHandleRect(comum).x, h: height });
  });
});
