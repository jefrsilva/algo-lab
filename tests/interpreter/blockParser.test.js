import { describe, expect, test } from 'vitest';
import { parseProgram } from '../../src/interpreter/blockParser.js';
import { linhas } from '../helpers/runDsl.js';

describe('parseProgram', () => {
  test('programa vazio', () => {
    expect(parseProgram('')).toEqual({ ok: true, functions: {}, program: [] });
    expect(parseProgram('\n\n# só comentário\n')).toMatchObject({ ok: true, program: [] });
  });

  test('cada statement guarda a linha (0-based) de origem', () => {
    const r = parseProgram(linhas('x = 1', '', 'y = 2'));
    expect(r.ok).toBe(true);
    expect(r.program.map((s) => [s.type, s.line])).toEqual([
      ['Assign', 0],
      ['Assign', 2],
    ]);
  });

  test('def de topo vai pro mapa de funções, fora do programa', () => {
    const r = parseProgram(linhas('def f(n, k=0):', '    return n + k', 'x = f(1)'));
    expect(Object.keys(r.functions)).toEqual(['f']);
    expect(r.functions.f).toMatchObject({ type: 'FunctionDef', name: 'f', line: 0 });
    expect(r.functions.f.params.map((p) => p.name)).toEqual(['n', 'k']);
    expect(r.functions.f.body).toEqual([{ type: 'Return', expr: expect.any(Object), line: 1 }]);
    expect(r.program.map((s) => s.type)).toEqual(['Assign']);
  });

  test('blocos aninhados por indentação', () => {
    const r = parseProgram(
      linhas('for i in range(3):', '    if i == 1:', '        continue', '    elif i == 2:', '        break', '    else:', '        x = i'),
    );
    expect(r.ok).toBe(true);
    const [laco] = r.program;
    expect(laco).toMatchObject({ type: 'For', varNames: ['i'], line: 0 });
    const [se] = laco.body;
    expect(se.type).toBe('If');
    expect(se.body).toEqual([{ type: 'Continue', line: 2 }]);
    // elif vira um If dentro do orelse
    expect(se.orelse[0].type).toBe('If');
    expect(se.orelse[0].orelse.map((s) => s.type)).toEqual(['Assign']);
  });

  test('while e for com desempacotamento', () => {
    const r = parseProgram(linhas('while x < 3:', '    x += 1', 'for i, v in enumerate(xs):', '    print(v)'));
    expect(r.program.map((s) => s.type)).toEqual(['While', 'For']);
    expect(r.program[1].varNames).toEqual(['i', 'v']);
  });

  test.each([
    [linhas('x = 1', '    y = 2'), 1, 'Indentação inesperada'],
    [linhas('if x:', 'y = 1'), 0, 'Bloco de "if" vazio'],
    [linhas('x = 1', 'y = (2'), 1, ''],
  ])('erro de sintaxe aponta a linha', (src, linha, mensagem) => {
    const r = parseProgram(src);
    expect(r.ok).toBe(false);
    expect(r.error.at).toBe(linha);
    expect(r.error.message).toContain(mensagem);
  });
});
