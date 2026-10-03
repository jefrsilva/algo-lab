// Reprodução da Simulação: snapshots por passo, navegação, autoplay e as
// posições escolhidas pelo usuário (que NÃO fazem parte do snapshot).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { MicroModel } from '../../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../../src/app/MicroRuntimeAdapter.js';
import { MicroProgramRunner } from '../../src/app/MicroProgramRunner.js';
import { linhas } from '../helpers/runDsl.js';

function novo({ onChange, onSelect } = {}) {
  const micro = new MicroModel();
  const env = new MicroRuntimeAdapter(micro, { createPosition: () => ({ x: 100, y: 200 }) });
  const runner = new MicroProgramRunner(micro, { onChange, onSelect });
  return { micro, env, runner };
}
const varPorNome = (micro, name) => [...micro.variables.values()].find((v) => v.name === name);
const PROGRAMA = linhas('x = 1', 'x = 2', 'nums = [1, 2]', 'nums.append(3)', 'x = 3');

describe('run', () => {
  test('termina restaurado no PRIMEIRO passo', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    expect(runner.steps).toHaveLength(5);
    expect(runner.stepIndex).toBe(0);
    expect(varPorNome(micro, 'x').value).toBe(1);
    expect(micro.arrays.size).toBe(0);
  });

  test('avisa quem escuta (onChange) e seleciona os tocados do passo (onSelect)', () => {
    const onChange = vi.fn();
    const onSelect = vi.fn();
    const { env, runner } = novo({ onChange, onSelect });
    runner.run(PROGRAMA, env);
    expect(onChange).toHaveBeenCalled();
    expect(onSelect).toHaveBeenLastCalledWith(runner.steps[0].touched);
  });

  test('erro de sintaxe: nenhum passo e `error` preenchido', () => {
    const { env, runner } = novo();
    runner.run('x = (', env);
    expect(runner.hasSteps).toBe(false);
    expect(runner.stepIndex).toBe(-1);
    expect(runner.error).toMatchObject({ at: 0 });
  });

  test('rodar de novo zera a saída anterior', () => {
    const { env, runner } = novo();
    runner.run('print(1)', env);
    runner.run('print(2)', env);
    expect(runner.steps[0].output).toEqual(['2']);
  });
});

describe('goToStep', () => {
  test('restaura o estado lógico de cada passo, pra frente e pra trás', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(3);
    expect(varPorNome(micro, 'x').value).toBe(2);
    expect([...micro.arrays.values()][0].cells).toEqual([1, 2, 3]);
    runner.goToStep(2);
    expect([...micro.arrays.values()][0].cells).toEqual([1, 2]);
    runner.goToStep(4);
    expect(varPorNome(micro, 'x').value).toBe(3);
  });

  test('índice fora do intervalo é limitado', () => {
    const { env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(99);
    expect(runner.stepIndex).toBe(4);
    runner.goToStep(-5);
    expect(runner.stepIndex).toBe(0);
  });

  test('mudar o modelo ao vivo não vaza pros snapshots já tirados', () => {
    const { micro, env, runner } = novo();
    runner.run(linhas('d = {"a": 1}', 'm = [[0] * 2 for _ in range(2)]', 'x = 0'), env);
    runner.goToStep(2);
    const d = [...micro.dicts.values()][0];
    d.cells[0].value = 999;
    [...micro.matrices.values()][0].cells[0][0] = 999;
    runner.goToStep(1);
    runner.goToStep(2);
    expect([...micro.dicts.values()][0].cells[0].value).toBe(1);
    expect([...micro.matrices.values()][0].cells[0][0]).toBe(0);
  });

  test('sem passos, não faz nada', () => {
    const { runner } = novo();
    expect(() => runner.goToStep(0)).not.toThrow();
    expect(runner.stepIndex).toBe(-1);
  });
});

describe('posições (layout do usuário)', () => {
  test('a posição não faz parte do snapshot: arrastar no 1º passo vale pra todos', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.updatePosition(varPorNome(micro, 'x').id, 500, 600);
    runner.goToStep(4);
    expect(varPorNome(micro, 'x')).toMatchObject({ x: 500, y: 600 });
    runner.goToStep(0);
    expect(varPorNome(micro, 'x')).toMatchObject({ x: 500, y: 600 });
  });

  test('arrastar no meio da reprodução grava um quadro-chave daquele passo em diante', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    const id = varPorNome(micro, 'x').id;
    runner.goToStep(2);
    runner.updatePosition(id, 10, 20);
    runner.goToStep(1);
    expect(varPorNome(micro, 'x')).toMatchObject({ x: 100, y: 200 });
    runner.goToStep(4);
    expect(varPorNome(micro, 'x')).toMatchObject({ x: 10, y: 20 });
  });

  test('os quadros-chave valem pra próxima execução do mesmo programa', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(2);
    runner.updatePosition(varPorNome(micro, 'x').id, 10, 20);
    runner.run(PROGRAMA, env); // ids novos, chaves estáveis iguais
    runner.goToStep(4);
    expect(varPorNome(micro, 'x')).toMatchObject({ x: 10, y: 20 });
  });

  test('exportar e importar os quadros-chave (arquivo do projeto)', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(3);
    runner.updatePosition(varPorNome(micro, 'x').id, 7, 8);
    const exportado = JSON.parse(JSON.stringify(runner.exportStepLayout()));
    expect(exportado).toEqual([['variable:global:x#0', [{ step: 0, x: 100, y: 200 }, { step: 3, x: 7, y: 8 }]]]);

    const outro = novo();
    outro.runner.importStepLayout(exportado);
    outro.runner.run(PROGRAMA, outro.env);
    outro.runner.goToStep(4);
    expect(varPorNome(outro.micro, 'x')).toMatchObject({ x: 7, y: 8 });
  });

  test('importStepLayout ignora entradas malformadas', () => {
    const { runner } = novo();
    runner.importStepLayout([['ok', [{ step: 2, x: 1, y: 1 }, { step: 'a' }, { step: 0, x: 0, y: 0 }]], 'lixo', [1, []]]);
    expect(runner.exportStepLayout()).toEqual([
      [
        'ok',
        [
          { step: 0, x: 0, y: 0 },
          { step: 2, x: 1, y: 1 },
        ],
      ],
    ]);
    runner.importStepLayout(null);
    expect(runner.exportStepLayout()).toEqual([]);
  });

  test('orientação do array é preferência do usuário, não do passo', () => {
    const { micro, env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(3);
    const id = [...micro.arrays.values()][0].id;
    runner.updateOrientation(id, 'vertical');
    runner.goToStep(2);
    expect(micro.arrays.get(id).orientation).toBe('vertical');
  });
});

describe('autoplay', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('avança um passo por intervalo e para no fim', () => {
    const { env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.togglePlay();
    expect(runner.playing).toBe(true);
    vi.advanceTimersByTime(700);
    expect(runner.stepIndex).toBe(1);
    vi.advanceTimersByTime(700 * 10);
    expect(runner.stepIndex).toBe(4);
    expect(runner.playing).toBe(false);
  });

  test('velocidade maior encurta o intervalo', () => {
    const { env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.setSpeed(2);
    runner.togglePlay();
    vi.advanceTimersByTime(350);
    expect(runner.stepIndex).toBe(1);
  });

  test('play no último passo recomeça do início; toggle de novo pausa', () => {
    const { env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.goToStep(4);
    runner.togglePlay();
    expect(runner.stepIndex).toBe(0);
    runner.togglePlay();
    expect(runner.playing).toBe(false);
    vi.advanceTimersByTime(5000);
    expect(runner.stepIndex).toBe(0);
  });

  test('stop limpa a reprodução e cancela o timer', () => {
    const { env, runner } = novo();
    runner.run(PROGRAMA, env);
    runner.togglePlay();
    runner.stop();
    vi.advanceTimersByTime(5000);
    expect(runner.steps).toEqual([]);
    expect(runner.stepIndex).toBe(-1);
  });
});
