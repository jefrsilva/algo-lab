// Diferenças conhecidas entre a DSL e o Python. Cada uma está marcada com
// `test.fails`: o teste descreve o comportamento CERTO (o do Python) e hoje
// falha — o Vitest conta isso como sucesso. Quando alguém corrigir, o teste
// passa a "falhar" (porque deixou de falhar): aí é só trocar `test.fails`
// por `test` e, se fizer sentido, mover o caso pra casos.js.
import { describe, expect, test } from 'vitest';
import { linhas, saida } from '../helpers/runDsl.js';

describe('bugs conhecidos da DSL', () => {
  // Limites de representação no canvas: em vez do valor, um aviso ⚠ no
  // console (ver MicroRuntimeAdapter#_storableOrWarn/_writeDictCell e
  // evaluator.js#listValueFrom).
  test.fails('tupla com lista dentro guardada num nome', () => {
    expect(saida(linhas('t = ([1], 2)', 'print(t)'))).toBe('([1], 2)');
  });

  test.fails('dict dentro de dict', () => {
    expect(saida(linhas('d = {"m": {"a": 1}}', 'print(d)'))).toBe("{'m': {'a': 1}}");
  });

  // linhas do mesmo tamanho viram matriz (grade), que não ganha linhas — a
  // lista de listas (`kind:'arrayref'`) só nasce irregular, de "[]" ou de
  // listas que já existem
  test.fails('append de linha numa lista de listas que nasceu retangular', () => {
    expect(saida(linhas('m = [[1, 2], [3, 4]]', 'm.append([5, 6])', 'print(m)'))).toBe('[[1, 2], [3, 4], [5, 6]]');
  });
});
