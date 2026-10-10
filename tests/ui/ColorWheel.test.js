import { describe, expect, test } from 'vitest';
import { colorWheelIndex } from '../../src/ui/ColorWheel.js';

describe('colorWheelIndex', () => {
  test('zona morta no centro não escolhe nada', () => {
    expect(colorWheelIndex(0, 0, 10)).toBeNull();
    expect(colorWheelIndex(5, -5, 10)).toBeNull();
  });

  test('a faixa 0 fica no topo e as outras seguem no sentido horário', () => {
    expect(colorWheelIndex(0, -60, 10)).toBe(0); // cima
    expect(colorWheelIndex(60, -10, 10)).toBe(2); // direita, um pouco acima
    expect(colorWheelIndex(0, 60, 10)).toBe(5); // baixo
    expect(colorWheelIndex(-60, 10, 10)).toBe(7); // esquerda, um pouco abaixo
  });

  test('com 4 faixas: cima, direita, baixo, esquerda', () => {
    expect([[0, -50], [50, 0], [0, 50], [-50, 0]].map(([x, y]) => colorWheelIndex(x, y, 4))).toEqual([0, 1, 2, 3]);
  });
});
