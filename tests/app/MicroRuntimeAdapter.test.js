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
  test('onArrayCreated/onDictCreated recebem o elemento novo (a grade "m" é uma lista)', () => {
    const onArrayCreated = vi.fn();
    const onDictCreated = vi.fn();
    const onMatrixCreated = vi.fn();
    const r = runDsl(linhas('nums = [1]', 'd = {}', 'm = [[1, 2], [3, 4]]'), { onArrayCreated, onDictCreated, onMatrixCreated });
    expect(r.error).toBeNull();
    // posição nova (não lembrada): o App pode mover o elemento junto com o rótulo
    expect(onArrayCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'nums' }), { movable: true });
    expect(onDictCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'd' }), { movable: true });
    // as linhas, sem nome, não ganham rótulo
    expect(onArrayCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'm', orientation: 'grid' }), { movable: true });
    expect(onArrayCreated).toHaveBeenCalledTimes(2);
    expect(onMatrixCreated).not.toHaveBeenCalled();
  });

  test('onStructCreated recebe todo nó novo — o de grafo já com a lista de vizinhos', () => {
    const vistos = [];
    runDsl(linhas('a = Node(1)', 'nos = [GraphNode(2)]'), {
      onStructCreated: (no) => vistos.push([no.type, !!no.neighborsArrayId]),
    });
    expect(vistos).toEqual([
      ['list', false],
      ['graph', true],
    ]);
  });

  test('elemento numa posição lembrada não é movível pra caber o rótulo', () => {
    const onArrayCreated = vi.fn();
    runDsl('nums = [1]', { onArrayCreated, createPosition: () => ({ x: 10, y: 20, remembered: true }) });
    expect(onArrayCreated).toHaveBeenCalledWith(expect.objectContaining({ name: 'nums' }), { movable: false });
  });

  test('"p = Node(1)" pede a posição do ponteiro perto do nó novo; "q = p" não', () => {
    const chamadas = [];
    const createPosition = (kind, size, layoutKey, near) => {
      chamadas.push({ kind, near });
      return { x: 0, y: 0 };
    };
    const { micro } = runDsl(linhas('p = Node(1)', 'q = p', 'def f():', '    r = TreeNode(2)', 'f()'), { createPosition });
    const no = valores(micro.structs)[0];
    const ponteiros = chamadas.filter((c) => c.kind === 'pointer');
    expect(ponteiros[0].near).toEqual({ kind: 'struct', id: no.id, label: 'p', global: true });
    expect(ponteiros[1].near).toBeNull();
    expect(ponteiros[2].near).toMatchObject({ kind: 'struct', label: 'r', global: false });
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

  test('escrever "m[0][1] = 1" cria o cursor "m[0][1]" na célula escrita', () => {
    const { micro } = runDsl('m = [[0, 0, 0], [0, 0, 0]]\nm[0][1] = 1');
    const m = valores(micro.arrays).find((a) => a.name === 'm');
    const cursor = valores(micro.pointers).find((q) => q.readCursorKey === 'm[0][1]');
    expect(cursor).toBeDefined();
    expect(cursor.target).toEqual({ kind: 'arrayCell', arrayId: m.cells[0], index: 1 });
    expect(micro.arrays.get(m.cells[0]).cells[1]).toBe(1);
  });

  test('indexação encadeada não cria o cursor intermediário "m[0]", mas "m[0]" sozinho cria', () => {
    const { micro } = runDsl('m = [[0, 0], [0, 0]]\nm[0][1] = 1\nx = m[1][0]');
    expect(valores(micro.pointers).filter((q) => q.readCursorKey).map((q) => q.readCursorKey).sort()).toEqual(['m[0][1]', 'm[1][0]']);
    const { micro: micro2 } = runDsl('m = [[0, 0], [0, 0]]\nm[0]');
    expect(valores(micro2.pointers).map((q) => q.readCursorKey)).toEqual(['m[0]']);
  });

  test('cursor de uma posição de lista de listas ("m[1][0]"), sem criar o cursor "m[1]"', () => {
    const { micro, env } = runDsl('m = [[1, 2], [3, 4]]');
    const m = valores(micro.arrays).find((a) => a.name === 'm');
    const p = micro.addPointer(0, 0, 'tmp');
    env.adoptReadCursor(p.id, parseExpression('m[1][0]').ast);
    expect(p).toMatchObject({ label: 'm[1][0]', readCursorKey: 'm[1][0]' });
    expect(p.target).toEqual({ kind: 'arrayCell', arrayId: m.cells[1], index: 0 });
    expect(valores(micro.pointers).filter((q) => q.readCursorKey)).toHaveLength(1);
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
