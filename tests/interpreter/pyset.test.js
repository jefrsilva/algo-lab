// Tabela hash do set, que imita o CPython 3.11 pra que a ORDEM dos
// elementos seja a mesma do Python. Os valores esperados vieram do
// python3.11 (`hash(x)`, `list(s)`).
import { describe, expect, test } from 'vitest';
import {
  buildFromItems,
  buildSetLiteral,
  deserializeTable,
  emptyTable,
  isHashable,
  pyHash,
  serializeTable,
  setKeyEq,
  tableDiscard,
  tableInsert,
  tablePop,
  tableValues,
} from '../../src/interpreter/pyset.js';

const SEED = 12345n;
const num = (value) => ({ kind: 'scalar', value });
const txt = (value) => ({ kind: 'string', value });
const tup = (...items) => ({ kind: 'tuple', items });
const nums = (...xs) => xs.map(num);
const ordem = (t) => tableValues(t).map((v) => v.value);

/** Set construído com "add" um a um, como `for x in xs: s.add(x)`. */
const comAdds = (xs) => {
  const t = emptyTable();
  nums(...xs).forEach((v) => tableInsert(t, v, pyHash(v, SEED)));
  return t;
};

describe('pyHash (números e tuplas são determinísticos, como no CPython)', () => {
  test.each([
    [1, 1n],
    [-1, -2n],
    [1.5, 1152921504606846977n],
    [2 ** 61, 1n],
  ])('hash(%s)', (x, h) => {
    expect(pyHash(num(x), SEED)).toBe(h);
  });

  test('bool', () => {
    expect(pyHash({ kind: 'bool', value: true }, SEED)).toBe(1n);
  });

  test('tuplas', () => {
    expect(pyHash(tup(num(1), num(2)), SEED)).toBe(-3550055125485641917n);
    expect(pyHash(tup(num(1)), SEED)).toBe(-6644214454873602895n);
    expect(pyHash(tup(), SEED)).toBe(5740354900026072187n);
  });

  test('texto depende da semente (como PYTHONHASHSEED), mas "" é sempre 0', () => {
    expect(pyHash(txt('a'), 1n)).not.toBe(pyHash(txt('a'), 2n));
    expect(pyHash(txt('a'), 1n)).toBe(pyHash(txt('a'), 1n));
    expect(pyHash(txt(''), 1n)).toBe(0n);
  });
});

describe('ordem dos elementos igual à do CPython', () => {
  test('adds em sequência, com colisões e crescimento da tabela', () => {
    expect(ordem(comAdds([17, 9, 1, 33, 25, 8, -1, 100]))).toEqual([33, 1, 100, 8, 9, 17, 25, -1]);
  });

  test('set(range(20)) com discard e add', () => {
    const t = buildFromItems(nums(...Array.from({ length: 20 }, (_, i) => i)), SEED);
    tableDiscard(t, num(3), pyHash(num(3), SEED));
    tableInsert(t, num(64), pyHash(num(64), SEED));
    expect(ordem(t)).toEqual([0, 1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 64]);
  });

  test('literal de constantes difere de inserir um a um', () => {
    expect(ordem(buildSetLiteral(nums(40, 8, 16, 32, 24), true, SEED))).toEqual([32, 16, 8, 24, 40]);
    expect(ordem(comAdds([40, 8, 16, 32, 24]))).toEqual([32, 40, 8, 16, 24]);
  });

  test('pop tira a partir do "dedo"', () => {
    const t = buildFromItems(nums(1, 2, 3), SEED);
    expect(tablePop(t).value).toBe(1);
    expect(tablePop(t).value).toBe(2);
    expect(ordem(t)).toEqual([3]);
  });

  test('pop de set vazio devolve undefined', () => {
    expect(tablePop(emptyTable())).toBeUndefined();
  });

  test('tuplas no set', () => {
    const items = [tup(num(1), num(2)), tup(num(0), num(0)), tup(num(5), num(1))];
    const t = buildSetLiteral(items, true, SEED);
    expect(tableValues(t).map((v) => v.items.map((i) => i.value))).toEqual([
      [1, 2],
      [5, 1],
      [0, 0],
    ]);
  });
});

describe('igualdade e "hashable"', () => {
  test('1 == 1.0 == True, como em Python', () => {
    expect(setKeyEq(num(1), { kind: 'bool', value: true })).toBe(true);
    expect(setKeyEq(num(0), { kind: 'bool', value: false })).toBe(true);
    expect(setKeyEq(num(1), txt('1'))).toBe(false);
  });

  test('inserir repetido não duplica', () => {
    const t = comAdds([1, 1, 2]);
    expect(tableInsert(t, num(2), pyHash(num(2), SEED))).toBe(false);
    expect(ordem(t)).toEqual([1, 2]);
  });

  test('lista/dict não são hashable; tupla só se os itens forem', () => {
    expect(isHashable(num(1))).toBe(true);
    expect(isHashable({ kind: 'array', elements: [] })).toBe(false);
    expect(isHashable(tup(num(1), txt('a')))).toBe(true);
    expect(isHashable(tup(num(1), { kind: 'dict', entries: new Map() }))).toBe(false);
  });
});

describe('serializar a tabela pro modelo', () => {
  test('ida e volta preserva a tabela', () => {
    const t = comAdds([17, 9, 1, 33]);
    tableDiscard(t, num(9), pyHash(num(9), SEED));
    const guardada = JSON.parse(JSON.stringify(serializeTable(t)));
    const volta = deserializeTable(guardada, tableValues(t), SEED);
    expect(volta).not.toBeNull();
    expect(ordem(volta)).toEqual(ordem(t));
    expect(volta.used).toBe(t.used);
  });

  test('tabela que não bate com as células é descartada (null)', () => {
    const t = comAdds([1, 2]);
    const guardada = serializeTable(t);
    expect(deserializeTable(guardada, nums(1), SEED)).toBeNull();
    expect(deserializeTable(guardada, nums(1, 99), SEED)).toBeNull();
    expect(deserializeTable(null, [], SEED)).toBeNull();
  });
});
