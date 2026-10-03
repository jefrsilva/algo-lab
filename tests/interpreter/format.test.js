// Especificador de formato das f-strings. Os resultados esperados são os do
// Python 3 (`format(valor, spec)`).
import { describe, expect, test } from 'vitest';
import { FormatError, formatTextWithSpec, formatWithSpec } from '../../src/interpreter/format.js';

const num = (value) => ({ kind: 'scalar', value });
const txt = (value) => ({ kind: 'string', value });
const fmt = (v, spec) => formatWithSpec(v, spec, String(v.value));

describe('formatWithSpec', () => {
  test.each([
    [42, '5d', '   42'],
    [42, '<5', '42   '],
    [42, '^7', '  42   '],
    [42, '*>6', '****42'],
    [-42, '=+8', '-     42'],
    [7, '+d', '+7'],
    [7, ' d', ' 7'],
    [255, '#x', '0xff'],
    [255, '08b', '11111111'],
    [1234567, ',', '1,234,567'],
    [1234567, '_', '1_234_567'],
    [3.14159, '.2f', '3.14'],
    [0.25, '.1%', '25.0%'],
    [12345.678, '.3e', '1.235e+04'],
    [65, 'c', 'A'],
  ])('format(%s, %j) == %j', (valor, spec, esperado) => {
    expect(fmt(num(valor), spec)).toBe(esperado);
  });

  test('texto: alinhamento e precisão', () => {
    expect(fmt(txt('ab'), '>4')).toBe('  ab');
    expect(fmt(txt('abc'), '.2')).toBe('ab');
  });

  test('bool com spec vira número, como em Python', () => {
    expect(formatWithSpec({ kind: 'bool', value: true }, 'd', 'True')).toBe('1');
  });

  test('spec vazio devolve o texto de sempre', () => {
    expect(formatWithSpec(num(3.5), '', '3.5')).toBe('3.5');
  });

  test('spec que não se aplica lança FormatError legível', () => {
    expect(() => fmt(txt('a'), 'd')).toThrow(FormatError);
    expect(() => formatWithSpec({ kind: 'none' }, 'd', 'None')).toThrow(/não se aplica/);
  });
});

describe('formatTextWithSpec', () => {
  test('só alinha um texto já pronto (caso de "{x!r:>5}")', () => {
    expect(formatTextWithSpec("'a'", '>5')).toBe("  'a'");
    expect(formatTextWithSpec('abc', '')).toBe('abc');
  });
});
