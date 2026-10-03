// Diferenças conhecidas entre a DSL e o Python, achadas ao escrever os
// testes. Cada uma está marcada com `test.fails`: o teste descreve o
// comportamento CERTO (o do Python) e hoje falha — o Vitest conta isso como
// sucesso. Quando alguém corrigir o bug, o teste passa a "falhar" (porque
// deixou de falhar): aí é só trocar `test.fails` por `test` e, se fizer
// sentido, mover o caso pra casos.js.
import { describe, expect, test } from 'vitest';
import { linhas, saida } from '../helpers/runDsl.js';

describe('bugs conhecidos da DSL', () => {
  // Um nome só troca de tipo quando recebe uma lista (ver
  // MicroRuntimeAdapter#assignName); nos demais casos a atribuição é
  // ignorada e o nome continua com o valor antigo.
  test.fails('dict reatribuído com outro literal', () => {
    expect(saida(linhas('d = {"a": 1}', 'd = {"b": 2}', 'print(d)'))).toBe("{'b': 2}");
  });

  test.fails('variável que passa a guardar um nó', () => {
    expect(saida(linhas('x = 5', 'x = Node(1)', 'print(x.data)'))).toBe('1');
  });

  test.fails('ponteiro que passa a guardar um número', () => {
    expect(saida(linhas('p = Node(1)', 'p = 5', 'print(p)'))).toBe('5');
  });

  test.fails('lista que passa a guardar um número', () => {
    expect(saida(linhas('x = [1]', 'x = 5', 'print(x)'))).toBe('5');
  });

  // dicts não têm frame (ver MicroModel.js): "memo = {}" dentro da função
  // escreve no dict global de mesmo nome em vez de criar um local
  test.fails('dict criado dentro de função é local', () => {
    const codigo = linhas(
      'def f():',
      '    memo = {}',
      '    memo[1] = 2',
      '    return memo[1]',
      'memo = {}',
      'print(f(), memo)',
    );
    expect(saida(codigo)).toBe('2 {}');
  });
});
