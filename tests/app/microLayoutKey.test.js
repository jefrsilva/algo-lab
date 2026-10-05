import { describe, expect, test } from 'vitest';
import { microLayoutKey } from '../../src/app/microLayoutKey.js';

describe('microLayoutKey', () => {
  test('ponteiro e variável: nome + escopo global/chamada (não o id do frame)', () => {
    expect(microLayoutKey('pointer', { name: 'p', frameId: 'global' })).toBe('pointer:global:p');
    expect(microLayoutKey('pointer', { name: 'p' })).toBe('pointer:global:p');
    expect(microLayoutKey('variable', { name: 'n', frameId: 'frame-1' })).toBe('variable:call:n');
    expect(microLayoutKey('variable', { name: 'n', frameId: 'frame-2' })).toBe('variable:call:n');
  });

  test('array de dentro de chamada não tem chave (um por chamada)', () => {
    expect(microLayoutKey('array', { name: 'nums', frameId: 'global' })).toBe('array:nums');
    expect(microLayoutKey('array', { name: 'res', frameId: 'frame-1' })).toBeNull();
    expect(microLayoutKey('array-label', { name: 'res', frameId: 'frame-1' })).toBeNull();
  });

  test('demais tipos', () => {
    expect(microLayoutKey('dict', { name: 'd' })).toBe('dict:d');
    expect(microLayoutKey('dict-label', { name: 'd' })).toBe('dict-label:d');
    expect(microLayoutKey('matrix', { name: 'm' })).toBe('matrix:m');
    expect(microLayoutKey('matrix-label', { name: 'm' })).toBe('matrix-label:m');
    expect(microLayoutKey('cursor', { cursorKey: 'nums[i]' })).toBe('cursor:nums[i]');
    expect(microLayoutKey('array-in-dict', { dictName: 'g', key: 0 })).toBe('array-in-dict:g.0');
    expect(microLayoutKey('array-in-list', { name: 'res', key: 1 })).toBe('array-in-list:res.1');
  });

  test('sem nome, ou tipo sem chave estável (struct anônimo), devolve null', () => {
    expect(microLayoutKey('pointer', {})).toBeNull();
    expect(microLayoutKey('struct', { name: 'x' })).toBeNull();
    expect(microLayoutKey('array-in-dict', { dictName: 'g' })).toBeNull();
    expect(microLayoutKey('desconhecido')).toBeNull();
  });
});
