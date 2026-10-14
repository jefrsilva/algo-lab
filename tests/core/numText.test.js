import { describe, expect, test } from 'vitest';
import { numText, jsonNumReplacer, jsonNumReviver } from '../../src/core/numText.js';

describe('numText', () => {
  test('infinitos e nan no estilo do Python', () => {
    expect(numText(Infinity)).toBe('inf');
    expect(numText(-Infinity)).toBe('-inf');
    expect(numText(NaN)).toBe('nan');
    expect(numText(3)).toBe('3');
    expect(numText(2.5)).toBe('2.5');
  });

  test('infinito sobrevive ao salvar/carregar em JSON', () => {
    const json = JSON.stringify({ a: [1, Infinity, -Infinity, NaN] }, jsonNumReplacer);
    expect(JSON.parse(json, jsonNumReviver)).toEqual({ a: [1, Infinity, -Infinity, NaN] });
  });
});
