// MicroRuntimeAdapter: o Environment que liga o interpretador ao MicroModel.
// Aqui ficam os detalhes que os programas de tests/dsl não deixam ver
// direto: ganchos de criação, frames, cursores adotados e "coleta" de listas.
import { describe, expect, test, vi } from 'vitest';
import { MicroModel } from '../../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../../src/app/MicroRuntimeAdapter.js';
import { parseExpression } from '../../src/interpreter/parser.js';
import { linhas, runDsl, valores } from '../helpers/runDsl.js';

describe('frames', () => {
  test('pilha começa no global e nunca desempilha o global', () => {
    const env = new MicroRuntimeAdapter(new MicroModel());
    expect(env.currentFrameId).toBe('global');
    const id = env.pushFrame('f(1)');
    expect(env.currentFrameId).toBe(id);
    env.popFrame();
    env.popFrame();
    expect(env.currentFrameId).toBe('global');
    expect(env.frameStack).toHaveLength(1);
  });
});

describe('ganchos de criação (usados pelo App pra criar o ponteiro-rótulo)', () => {
  test('onArrayCreated/onDictCreated/onMatrixCreated recebem o elemento novo', () => {
    const onArrayCreated = vi.fn();
    const onDictCreated = vi.fn();
    const onMatrixCreated = vi.fn();
    const r = runDsl(linhas('nums = [1]', 'd = {}', 'm = [[1, 2], [3, 4]]'), { onArrayCreated, onDictCreated, onMatrixCreated });
    expect(r.error).toBeNull();
    expect(onArrayCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'nums' }));
    expect(onDictCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'd' }));
    expect(onMatrixCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'm' }));
  });

  test('createPosition decide onde cada elemento nasce', () => {
    const { micro } = runDsl('x = 1', { createPosition: () => ({ x: 42, y: 24 }) });
    expect(valores(micro.variables)[0]).toMatchObject({ x: 42, y: 24 });
  });
});

describe('print e warn', () => {
  test('acumulam no output; aviso ganha o prefixo ⚠', () => {
    const onChange = vi.fn();
    const env = new MicroRuntimeAdapter(new MicroModel(), { onChange });
    env.print('oi');
    env.warn('cuidado');
    expect(env.output).toEqual(['oi', '⚠ cuidado']);
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});

describe('adoptReadCursor (ponteiro digitado como "nums[i]" no canvas)', () => {
  test('vira um cursor de leitura que acompanha o índice', () => {
    const { micro, env } = runDsl(linhas('nums = [4, 5, 6]', 'i = 2'));
    const p = micro.addPointer(0, 0, 'tmp');
    const id = env.adoptReadCursor(p.id, parseExpression('nums[i]').ast);
    expect(id).toBe(p.id);
    expect(p).toMatchObject({ readCursorKey: 'nums[i]', label: 'nums[i]', target: { kind: 'arrayCell', index: 2 } });
  });

  test('cursor igual já existente: o novo é descartado e o antigo reaparece', () => {
    const { micro, env } = runDsl(linhas('nums = [4, 5, 6]', 'i = 0', 'x = nums[i]'));
    const existente = valores(micro.pointers).find((q) => q.readCursorKey === 'nums[i]');
    const p = micro.addPointer(0, 0, 'tmp');
    expect(env.adoptReadCursor(p.id, parseExpression('nums[i]').ast)).toBe(existente.id);
    expect(micro.pointers.has(p.id)).toBe(false);
  });

  test('cursor de matriz', () => {
    const { micro, env } = runDsl('m = [[1, 2], [3, 4]]');
    const p = micro.addPointer(0, 0, 'tmp');
    env.adoptReadCursor(p.id, parseExpression('m[1][0]').ast);
    expect(p.target).toMatchObject({ kind: 'matrixCell', row: 1, col: 0 });
  });

  test('expressão que não é posição de lista viva devolve null', () => {
    const { micro, env } = runDsl('s = {1, 2}');
    const p = micro.addPointer(0, 0, 'tmp');
    expect(env.adoptReadCursor(p.id, parseExpression('nada[0]').ast)).toBeNull();
    expect(env.adoptReadCursor(p.id, parseExpression('s[0]').ast)).toBeNull();
    expect(env.adoptReadCursor(p.id, parseExpression('x').ast)).toBeNull();
  });
});

describe('coleta das listas criadas dentro de chamadas', () => {
  test('lista local não devolvida some ao fim da chamada; a devolvida fica', () => {
    const { micro, output } = runDsl(
      linhas('def f():', '    lixo = [9, 9]', '    res = [1, 2]', '    return res', 'r = f()', 'print(r)'),
    );
    expect(output).toEqual(['[1, 2]']);
    const celulas = valores(micro.arrays).map((a) => a.cells);
    expect(celulas).toContainEqual([1, 2]);
    expect(celulas).not.toContainEqual([9, 9]);
  });

  test('lista global nunca é coletada', () => {
    const { micro } = runDsl(linhas('nums = [1]', 'def f():', '    return 0', 'f()'));
    expect(valores(micro.arrays)).toHaveLength(1);
  });
});
