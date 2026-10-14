// Árvore de chamadas: valor de retorno das chamadas que terminaram e escopo
// (parâmetros/locais) guardado pelo frame, pro pop-up do hover.
import { describe, expect, test } from 'vitest';
import { MicroModel } from '../../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../../src/app/MicroRuntimeAdapter.js';
import { MicroProgramRunner } from '../../src/app/MicroProgramRunner.js';
import { frameScope } from '../../src/app/frameScope.js';
import { linhas } from '../helpers/runDsl.js';

const PROGRAMA = linhas(
  'def f(n):',
  '    x = n * 2',
  '    if n <= 1:',
  '        return 1',
  '    return f(n - 1) + x',
  'print(f(2))',
);

function rodar() {
  const micro = new MicroModel();
  const env = new MicroRuntimeAdapter(micro, { createPosition: () => ({ x: 0, y: 0 }) });
  const runner = new MicroProgramRunner(micro, {});
  runner.run(PROGRAMA, env);
  return { micro, runner };
}

describe('árvore de chamadas', () => {
  test('chamadas retornadas trazem o valor de retorno e o escopo; passos antigos não', () => {
    const { runner } = rodar();
    const ultimo = runner.steps[runner.steps.length - 1].callTree;
    expect(ultimo.map((n) => [n.label, n.returnText])).toEqual([['f(2)', '5'], ['f(1)', '1']]);
    expect(ultimo[1].scope).toEqual(expect.arrayContaining([{ name: 'x', text: '2' }, { name: 'n', text: '1' }]));
    const primeiro = runner.steps.find((s) => s.callTree?.length)?.callTree;
    expect(primeiro[0].returned).toBeUndefined();
  });

  test('frameScope lista as variáveis do frame e ignora as dos outros', () => {
    const micro = new MicroModel();
    micro.addVariable(0, 0, 'a', 1, 'frame_1');
    micro.addVariable(0, 0, 'b', 2, 'global');
    expect(frameScope(micro, 'frame_1')).toEqual([{ name: 'a', text: '1' }]);
  });
});
