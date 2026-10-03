// Execução de programas da DSL além do texto impresso: passos gerados,
// erros de sintaxe, avisos no console, guardas de laço/recursão infinita e
// o estado do modelo (MicroModel) que o canvas desenha.
import { describe, expect, test } from 'vitest';
import { array, linhas, runDsl, saida, valores, variavel } from '../helpers/runDsl.js';

describe('passos', () => {
  test('um passo por atribuição/expressão, com a linha (0-based) e o tipo', () => {
    const { steps } = runDsl(linhas('x = 1', 'y = x + 1', 'print(y)'));
    expect(steps.map((s) => [s.line, s.kind])).toEqual([
      [0, 'assign'],
      [1, 'assign'],
      [2, 'expr'],
    ]);
  });

  test('condições geram passos de teste verdadeiro/falso', () => {
    const { steps } = runDsl(linhas('x = 3', 'if x > 5:', '    x = 0', 'else:', '    x = 1'));
    expect(steps.map((s) => s.kind)).toEqual(['assign', 'test-false', 'assign']);
    expect(steps[2].line).toBe(4);
  });

  test('a saída do console é guardada por passo', () => {
    const { steps } = runDsl(linhas('print(1)', 'print(2)'));
    expect(steps[0].output).toEqual(['1']);
    expect(steps[1].output).toEqual(['1', '2']);
  });

  test('cada passo lista os elementos tocados', () => {
    const { steps, micro } = runDsl(linhas('x = 1', 'nums = [1, 2]'));
    expect(steps[0].touched).toEqual([{ kind: 'variable', id: variavel(micro, 'x').id }]);
    expect(steps[1].touched).toEqual([{ kind: 'array', id: array(micro, 'nums').id }]);
  });

  test('programa vazio não gera passos nem erro', () => {
    const { steps, error } = runDsl('');
    expect(error).toBeNull();
    expect(steps).toEqual([]);
  });
});

describe('erros de sintaxe', () => {
  test.each([
    ['x = 1 +', 0, 'Expressão inválida'],
    ['x = 1\n  y = 2', 1, 'Indentação inesperada'],
    ['if x:\nprint(1)', 0, 'Bloco de "if" vazio'],
    ['import math', 0, 'Módulo "math" não disponível'],
  ])('%j → linha %i', (codigo, linha, mensagem) => {
    const { error, steps } = runDsl(codigo);
    expect(error).not.toBeNull();
    expect(error.at).toBe(linha);
    expect(error.message).toContain(mensagem);
    // erro de sintaxe cancela a execução inteira
    expect(steps).toEqual([]);
  });

  test('imports aceitos são ignorados', () => {
    expect(saida(linhas('from collections import deque', 'import collections', 'print(1)'))).toBe('1');
  });
});

describe('avisos no console (⚠) em vez de exceção', () => {
  test.each([
    ['r = range(0, 5, 0)', 'range(): o passo não pode ser zero.'],
    ['from collections import deque\nq = deque()\nq.popleft()', 'q.popleft(): o deque está vazio.'],
    ['x = sorted([3, 1], reverse=True)', 'Argumento nomeado ("reverse=...") não é suportado'],
    ['s = {1, 2}\nprint(s[0])', 'Set não tem posições'],
    ['a = [Node(1), 2]', 'Lista misturando nós e valores'],
    ['print(f"{3:q}")', 'f-string: Formato inválido: "q"'],
  ])('%j', (codigo, aviso) => {
    const { output } = runDsl(codigo);
    expect(output.some((l) => l.startsWith('⚠ ') && l.includes(aviso))).toBe(true);
  });

  test.each([
    ['nome inexistente', 'print(nada)'],
    ['índice fora da lista', 'nums = [1, 2]\nprint(nums[10])'],
    ['campo de None', 'p = None\nprint(p.data)'],
  ])('%s não derruba o interpretador', (_nome, codigo) => {
    expect(() => runDsl(codigo)).not.toThrow();
  });
});

describe('guardas de execução', () => {
  test('laço infinito é interrompido com um passo "limit"', () => {
    const { steps } = runDsl(linhas('x = 0', 'while True:', '    x += 1'));
    const ultimo = steps[steps.length - 1];
    expect(ultimo.kind).toBe('limit');
    expect(ultimo.description).toMatch(/loop infinito/);
    expect(steps.length).toBeLessThanOrEqual(2001);
  });

  test('recursão sem caso base é interrompida', () => {
    const { steps } = runDsl(linhas('def f(n):', '    return f(n + 1)', 'f(0)'));
    const ultimo = steps[steps.length - 1];
    expect(ultimo.kind).toBe('limit');
    expect(ultimo.description).toMatch(/Recursão profunda demais/);
  });
});

describe('recursão e frames', () => {
  const fat = linhas('def fat(n):', '    if n <= 1:', '        return 1', '    return n * fat(n - 1)', 'r = fat(3)', 'print(r)');

  test('cada chamada roda no seu frame e aparece na árvore de chamadas', () => {
    const { steps, output } = runDsl(fat);
    expect(output).toEqual(['6']);
    const frames = new Set(steps.map((s) => s.activeFrameId).filter((f) => f !== 'global'));
    expect(frames.size).toBe(3);
    const arvore = steps[steps.length - 1].callTree;
    expect(arvore.map((c) => [c.label, c.depth])).toEqual([
      ['fat(3)', 1],
      ['fat(2)', 2],
      ['fat(1)', 3],
    ]);
    expect(arvore[1].parentId).toBe(arvore[0].id);
  });

  test('parâmetros vivem no frame da chamada, não no global', () => {
    const { runner, micro, steps } = runDsl(fat);
    const dentro = steps.findIndex((s) => s.activeFrameId !== 'global');
    runner.goToStep(dentro);
    const n = valores(micro.variables).find((v) => v.name === 'n');
    expect(n.frameId).toBe(steps[dentro].activeFrameId);
    expect(n.value).toBe(3);
  });

  test('o escopo global só enxerga as próprias variáveis', () => {
    const { micro } = runDsl(fat);
    const globais = valores(micro.variables).filter((v) => v.frameId === 'global');
    expect(globais.map((v) => [v.name, v.value])).toEqual([['r', 6]]);
    // os "n" de cada chamada ficam no frame dela (o canvas mostra um frame por vez)
    expect(valores(micro.variables).filter((v) => v.name === 'n')).toHaveLength(3);
  });
});

describe('estado do modelo', () => {
  test('lista vira array de valores', () => {
    const { micro } = runDsl('nums = [4, 5, 6]');
    const nums = array(micro, 'nums');
    expect(nums).toMatchObject({ kind: 'value', cells: [4, 5, 6], frameId: 'global' });
  });

  test('lista de nós vira array de referências', () => {
    const { micro } = runDsl('nos = [Node(1), Node(2)]');
    const nos = array(micro, 'nos');
    expect(nos.kind).toBe('ref');
    expect(nos.cells.map((id) => micro.structs.get(id).data)).toEqual([1, 2]);
  });

  test('leitura nums[i] cria um cursor que acompanha i', () => {
    const { runner, micro } = runDsl(linhas('nums = [4, 5, 6]', 'i = 1', 'x = nums[i]', 'i = 2'));
    const cursor = () => valores(micro.pointers).find((p) => p.readCursorKey === 'nums[i]');
    runner.goToStep(2);
    expect(cursor().target).toMatchObject({ kind: 'arrayCell', index: 1 });
    expect(variavel(micro, 'x').value).toBe(5);
    runner.goToStep(3);
    expect(cursor().target).toMatchObject({ kind: 'arrayCell', index: 2 });
  });

  test('nós ligados: next aponta pro struct seguinte', () => {
    const { micro } = runDsl(linhas('a = Node(1)', 'b = Node(2)', 'a.next = b', 'p = a'));
    const ptr = (label) => valores(micro.pointers).find((p) => p.label === label);
    const a = micro.structs.get(ptr('a').target.id);
    const b = micro.structs.get(ptr('b').target.id);
    expect(a.data).toBe(1);
    expect(a.next).toBe(b.id);
    expect(ptr('p').target).toEqual({ kind: 'struct', id: a.id });
  });

  test('TreeNode expõe left/right sobre os mesmos campos físicos', () => {
    const { micro, output } = runDsl(linhas('r = TreeNode(5)', 'r.left = TreeNode(3)', 'print(r.left.data, r.right)'));
    expect(output).toEqual(['3 None']);
    const raiz = valores(micro.structs).find((s) => s.data === 5);
    expect(raiz.type).toBe('tree');
    expect(micro.structs.get(raiz.prev ?? raiz.next).data).toBe(3);
  });

  test('set é um array marcado isSet com a tabela hash', () => {
    const { micro } = runDsl('s = {3, 1, 2}');
    const s = array(micro, 's');
    expect(s.isSet).toBe(true);
    expect(s.cells).toEqual([1, 2, 3]);
    expect(s.hashTable).toBeTruthy();
  });

  test('deque guarda maxlen', () => {
    const { micro } = runDsl(linhas('from collections import deque', 'q = deque([1, 2, 3], maxlen=2)'));
    const q = array(micro, 'q');
    expect(q).toMatchObject({ isDeque: true, maxlen: 2, cells: [2, 3] });
  });

  test('dict guarda uma célula por chave', () => {
    const { micro } = runDsl('d = {"a": 1, "b": 2}');
    const d = valores(micro.dicts).find((x) => x.name === 'd');
    expect(d.cells).toEqual([
      { key: 'a', kind: 'value', value: 1 },
      { key: 'b', kind: 'value', value: 2 },
    ]);
  });

  test('matriz guarda as linhas', () => {
    const { micro } = runDsl(linhas('m = [[0] * 2 for _ in range(2)]', 'm[1][0] = 7'));
    const m = valores(micro.matrices).find((x) => x.name === 'm');
    expect(m.cells).toEqual([
      [0, 0],
      [7, 0],
    ]);
  });

  test('tupla guardada em variável é uma PyTuple internada', () => {
    const { micro } = runDsl(linhas('a = (1, 2)', 'b = (1, 2)'));
    expect(variavel(micro, 'a').value).toBe(variavel(micro, 'b').value);
    expect(String(variavel(micro, 'a').value)).toBe('(1, 2)');
  });
});
