import { describe, expect, test } from 'vitest';
import { PyTuple, makeTuple, rawRepr, reviveRaw } from '../../src/interpreter/pytuple.js';

describe('PyTuple', () => {
  test('tuplas iguais são o mesmo objeto (internadas)', () => {
    expect(makeTuple([1, 'a'])).toBe(makeTuple([1, 'a']));
    expect(makeTuple([1, 2])).not.toBe(makeTuple([2, 1]));
  });

  test('1 == True: (1, 2) e (True, 2) são a mesma chave, com a grafia da primeira', () => {
    const primeira = makeTuple([1, 2]);
    expect(makeTuple([true, 2])).toBe(primeira);
    expect(String(makeTuple([true, 2]))).toBe('(1, 2)');
  });

  test('funciona como chave de Map', () => {
    const m = new Map([[makeTuple([0, 1]), 'x']]);
    expect(m.get(makeTuple([0, 1]))).toBe('x');
  });

  test('repr igual ao do Python', () => {
    expect(String(makeTuple([1, 'a', null, false]))).toBe("(1, 'a', None, False)");
    expect(String(makeTuple([7]))).toBe('(7,)');
    expect(String(makeTuple([]))).toBe('()');
    expect(String(makeTuple([makeTuple([1, 2]), 3]))).toBe('((1, 2), 3)');
    expect(rawRepr("it's")).toBe("'it\\'s'");
  });

  test('é imutável', () => {
    const t = makeTuple([1, 2]);
    expect(Object.isFrozen(t)).toBe(true);
    expect(Object.isFrozen(t.items)).toBe(true);
    expect(t.length).toBe(2);
  });

  test('JSON e volta (reviveRaw), inclusive aninhada', () => {
    const t = makeTuple([1, makeTuple(['a', null])]);
    const json = JSON.parse(JSON.stringify({ v: t }));
    expect(json.v).toEqual({ tuple: [1, { tuple: ['a', null] }] });
    expect(reviveRaw(json.v)).toBe(t);
  });

  test('reviveRaw deixa outros valores intactos', () => {
    expect(reviveRaw(3)).toBe(3);
    expect(reviveRaw('x')).toBe('x');
    expect(reviveRaw(null)).toBe(null);
    const t = makeTuple([9]);
    expect(reviveRaw(t)).toBe(t);
    expect(t).toBeInstanceOf(PyTuple);
  });
});
