import { describe, expect, test } from 'vitest';
import { collectIdentifiers, filterIdentifiers, identifierKey } from '../../src/app/microVisibility.js';

const modelo = (pointers, variables = []) => ({
  pointers: new Map(pointers.map((p, i) => [`p${i}`, p])),
  variables: new Map(variables.map((v, i) => [`v${i}`, v])),
});

describe('identifierKey', () => {
  test('cursor de leitura usa a expressão; ponteiro, o rótulo; variável, o nome', () => {
    expect(identifierKey({ label: 'nums[i]', readCursorKey: 'nums[i]' })).toBe('nums[i]');
    expect(identifierKey({ label: 'head' })).toBe('head');
    expect(identifierKey({ name: 'x' })).toBe('x');
  });
});

describe('collectIdentifiers', () => {
  test('junta os modelos sem repetir, em ordem alfabética, com o tipo', () => {
    const a = modelo([{ label: 'head' }, { label: 'nums', isArrayLabel: true }], [{ name: 'x' }]);
    const b = modelo([{ label: 'head', hidden: true }, { label: 'nums[i]', readCursorKey: 'nums[i]' }]);
    const itens = collectIdentifiers([a, b]);
    expect(itens.map((i) => [i.key, i.kind])).toEqual([
      ['head', 'ponteiro'],
      ['nums', 'coleção'],
      ['nums[i]', 'cursor'],
      ['x', 'variável'],
    ]);
  });

  test('o override do usuário vale mais que o estado do elemento', () => {
    const m = modelo([{ label: 'a', hidden: true }, { label: 'b' }]);
    const itens = collectIdentifiers([m], new Map([['a', false], ['b', true]]));
    expect(itens.map((i) => i.hidden)).toEqual([false, true]);
  });
});

describe('filterIdentifiers', () => {
  const itens = [{ key: 'head' }, { key: 'Tail' }, { key: 'nums[i]' }];
  test('filtra por trecho, sem diferenciar maiúsculas', () => {
    expect(filterIdentifiers(itens, 'ta').map((i) => i.key)).toEqual(['Tail']);
    expect(filterIdentifiers(itens, ' H ').map((i) => i.key)).toEqual(['head']);
  });
  test('busca vazia devolve tudo', () => {
    expect(filterIdentifiers(itens, '')).toHaveLength(3);
  });
});
