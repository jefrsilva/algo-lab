// Confere o GABARITO de casos.js contra o Python real: cada programa roda no
// python3 (com as classes de prelude.py) e a saída tem que ser exatamente a
// que está escrita no caso. Assim um gabarito digitado errado não passa
// despercebido. Pulado se não houver python3 na máquina.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { CASOS, normalizar } from './casos.js';

function temPython() {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const prelude = readFileSync(new URL('./prelude.py', import.meta.url), 'utf8');

describe.skipIf(!temPython())('gabarito confere com o Python real', () => {
  const casos = CASOS.filter((c) => c.python !== false);
  test.each(casos.map((c) => [c.nome, c]))('%s', (_nome, caso) => {
    const saida = execFileSync('python3', ['-'], {
      input: `${prelude}\n${normalizar(caso.codigo)}\n`,
      encoding: 'utf8',
      // ordem de set de textos é sorteada a cada execução no Python
      env: { ...process.env, PYTHONHASHSEED: '0', PYTHONIOENCODING: 'utf-8' },
    });
    expect(saida.replace(/\n$/, '')).toBe(normalizar(caso.saida));
  });
});
