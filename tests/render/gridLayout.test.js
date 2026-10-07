// Geometria da grade (`orientation: 'grid'` numa lista de listas): a lista de
// fora desenha a moldura e cada lista de dentro é desenhada no lugar da sua
// linha (ver MicroCanvasView.js#layoutGrids).
import { describe, expect, test } from 'vitest';
import {
  ARRAY_CELL,
  GRID_COL_BAND_H,
  GRID_ROW_BAND_W,
  arrayDividers,
  arrayHandleRect,
  arrayLayout,
  layoutGrids,
} from '../../src/render/MicroCanvasView.js';

/** Map de arrays como o do MicroModel: `grade` (lista de fora) e `linhas`. */
function montar(linhas, { orientation = 'grid', repetir = null } = {}) {
  const arrays = new Map();
  const ids = linhas.map((cells, i) => {
    const id = `linha${i}`;
    arrays.set(id, { id, x: 900, y: 900, kind: 'value', orientation: 'horizontal', cells });
    return id;
  });
  const cells = repetir ? repetir.map((i) => (i == null ? null : ids[i])) : ids;
  arrays.set('grade', { id: 'grade', x: 100, y: 50, kind: 'arrayref', orientation, cells });
  layoutGrids(arrays);
  return arrays;
}

describe('grade', () => {
  test('cada linha vai pro lugar dela, sem faixa de índice nem puxador', () => {
    const arrays = montar([[1, 2], [3, 4]]);
    const [l0, l1] = [arrays.get('linha0'), arrays.get('linha1')];
    expect({ x: l0.x, y: l0.y }).toEqual({ x: 100 + GRID_ROW_BAND_W, y: 50 + GRID_COL_BAND_H });
    expect(l1.y).toBe(l0.y + ARRAY_CELL);
    expect(arrayLayout(l0)).toMatchObject({ height: ARRAY_CELL });
    expect(arrayLayout(l0).cells[0]).toMatchObject({ x: 0, y: 0 });
    expect(arrayHandleRect(l0)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(arrayDividers(l0)).toEqual([]);
  });

  test('a moldura tem a largura da maior linha (linhas irregulares) e uma coluna só pra todas', () => {
    const arrays = montar([[1], ['texto longo', 2, 3]]);
    const grade = arrays.get('grade');
    const { cellW } = grade.gridGeom;
    expect(cellW).toBeGreaterThan(ARRAY_CELL);
    expect(arrays.get('linha0').gridRow.cellW).toBe(cellW);
    const layout = arrayLayout(grade);
    expect(layout.width).toBe(GRID_ROW_BAND_W + 3 * cellW);
    expect(layout.height).toBe(GRID_COL_BAND_H + 2 * ARRAY_CELL);
    expect(layout.colLabels.map((l) => l.col)).toEqual([0, 1, 2]);
    // a "célula" i da lista de fora é a faixa do índice da linha i
    expect(layout.cells.map((c) => [c.x, c.y, c.w])).toEqual([
      [0, GRID_COL_BAND_H, GRID_ROW_BAND_W],
      [0, GRID_COL_BAND_H + ARRAY_CELL, GRID_ROW_BAND_W],
    ]);
  });

  test('lista repetida é embutida só na primeira linha; None não embute nada', () => {
    const arrays = montar([[0, 0]], { repetir: [0, 0, null] });
    const grade = arrays.get('grade');
    expect(grade.gridGeom.embedded).toEqual([true, false, false]);
    expect(arrays.get('linha0').gridRow.row).toBe(0);
  });

  test('fora da grade, nada muda: sem geometria derivada e layout de lista comum', () => {
    const arrays = montar([[1, 2]], { orientation: 'horizontal' });
    expect(arrays.get('grade').gridGeom).toBeUndefined();
    expect(arrays.get('linha0').gridRow).toBeUndefined();
    expect(arrays.get('linha0')).toMatchObject({ x: 900, y: 900 });
  });

  test('voltar de grade pra lista apaga a geometria derivada', () => {
    const arrays = montar([[1, 2]]);
    arrays.get('grade').orientation = 'horizontal';
    layoutGrids(arrays);
    expect(arrays.get('grade').gridGeom).toBeUndefined();
    expect(arrays.get('linha0').gridRow).toBeUndefined();
  });
});
