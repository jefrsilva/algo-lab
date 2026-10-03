// Programas inteiros rodando na DSL, com a saída comparada ao que o Python
// real imprime (gabarito em casos.js).
import { describe, expect, test } from 'vitest';
import { CASOS, normalizar } from './casos.js';
import { runDsl } from '../helpers/runDsl.js';

describe('programas da DSL imprimem o mesmo que o Python', () => {
  test.each(CASOS.map((c) => [c.nome, c]))('%s', (_nome, caso) => {
    const { output, error } = runDsl(normalizar(caso.codigo));
    expect(error).toBeNull();
    expect(output.join('\n')).toBe(normalizar(caso.saida));
  });
});
