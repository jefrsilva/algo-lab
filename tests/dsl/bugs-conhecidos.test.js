// Diferenças conhecidas entre a DSL e o Python, achadas ao escrever os
// testes. Cada uma está marcada com `test.fails`: o teste descreve o
// comportamento CERTO (o do Python) e hoje falha — o Vitest conta isso como
// sucesso. Quando alguém corrigir o bug, o teste passa a "falhar" (porque
// deixou de falhar): aí é só trocar `test.fails` por `test` e, se fizer
// sentido, mover o caso pra casos.js.
import { describe, expect, test } from 'vitest';
import { linhas, saida } from '../helpers/runDsl.js';

describe('bugs conhecidos da DSL', () => {
  test.fails('"x = x + [2]" reatribui a lista com o resultado da soma', () => {
    expect(saida(linhas('x = [0]', 'x = x + [2]', 'print(x)'))).toBe('[0, 2]');
  });

  test.fails('dict literal com listas como valores', () => {
    expect(saida(linhas('g = {"a": [1, 2]}', 'print(g)'))).toBe("{'a': [1, 2]}");
  });

  test.fails('print de dict com lista mostra o conteúdo da lista', () => {
    expect(saida(linhas('k = {}', 'k[0] = [7, 8]', 'print(k)'))).toBe('{0: [7, 8]}');
  });

  test.fails('ponteiro devolvido por função pra variável global de mesmo nome do parâmetro', () => {
    const codigo = linhas(
      'def inserir(raiz, v):',
      '    if raiz is None:',
      '        return TreeNode(v)',
      '    raiz.left = inserir(raiz.left, v)',
      '    return raiz',
      'raiz = None',
      'raiz = inserir(raiz, 5)',
      'raiz = inserir(raiz, 3)',
      'print(raiz.data, raiz.left.data)',
    );
    expect(saida(codigo)).toBe('5 3');
  });

  test.fails('fatia direto do resultado de uma chamada', () => {
    expect(saida(linhas('nums = [1, 5]', 'print(sorted(nums)[::-1])'))).toBe('[5, 1]');
  });

  test.fails('abs() e int() embutidos', () => {
    expect(saida(linhas('print(abs(-3), int("7") + 1)'))).toBe('3 8');
  });

  test.fails('expressão condicional (a if cond else b)', () => {
    expect(saida(linhas('x = 1 if True else 2', 'print(x)'))).toBe('1');
  });
});
