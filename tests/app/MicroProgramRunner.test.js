// Reprodução da Simulação: snapshots por passo, navegação, autoplay e as
// posições escolhidas pelo usuário (que NÃO fazem parte do snapshot).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ARRAY_CELL_H, MicroModel } from '../../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../../src/app/MicroRuntimeAdapter.js';
import { MicroProgramRunner } from '../../src/app/MicroProgramRunner.js';
import { linhas } from '../helpers/runDsl.js';

function novo({ onChange, onSelect } = {}) {
  const micro = new MicroModel();
  const env = new MicroRuntimeAdapter(micro, {
    createPosition: () => ({ x: 100, y: 200 }),
    // rótulo com o nome 50 acima do array, como App#_createArrayLabelPointer
    onArrayCreated: (node) => micro.linkArrayLabelPointer(node.id, micro.addPointer(node.x, node.y - 50, node.name).id),
  });
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
    const linha0 = () => micro.arrays.get([...micro.arrays.values()].find((a) => a.name === 'm').cells[0]);
    linha0().cells[0] = 999;
    runner.goToStep(1);
    runner.goToStep(2);
    expect([...micro.dicts.values()][0].cells[0].value).toBe(1);
    expect(linha0().cells[0]).toBe(0);
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

describe('nós como círculos', () => {
  const FILA = linhas('a = Node(1)', 'fila = [a]', 'fila.append(a)', 'fila.pop()');

  test('é preferência do usuário, não do passo', () => {
    const { micro, env, runner } = novo();
    runner.run(FILA, env);
    runner.goToStep(2);
    const id = [...micro.arrays.values()][0].id;
    micro.setArrayNodeCircles(id, true);
    runner.updateNodeCircles(id, true);
    runner.goToStep(1);
    expect(micro.arrays.get(id).nodeCircles).toBe(true);
    runner.updateNodeCircles(id, false);
    runner.goToStep(3);
    expect(micro.arrays.get(id).nodeCircles).toBeUndefined();
  });
});

describe('array em pilha: cresce pra cima com a base parada', () => {
  const PILHA = linhas('pilha = [1]', 'pilha.append(2)', 'pilha.append(3)', 'pilha.pop()');
  const base = (arr) => arr.y + ARRAY_CELL_H * Math.max(1, arr.cells.length);

  /** Roda PILHA, vai pro passo `passo` e vira pilha ali (como o popup faz). */
  function emPilhaNoPasso(passo) {
    const { micro, env, runner } = novo();
    runner.run(PILHA, env);
    runner.goToStep(passo);
    const id = [...micro.arrays.values()][0].id;
    micro.setArrayOrientation(id, 'stack');
    runner.updateOrientation(id, 'stack');
    return { micro, runner, arr: () => micro.arrays.get(id), id };
  }

  test('a base é a mesma em todos os passos; o topo sobe e desce', () => {
    const { runner, arr } = emPilhaNoPasso(0);
    expect(arr().y).toBe(200); // virar pilha não move a caixa
    expect(base(arr())).toBe(200 + ARRAY_CELL_H);
    const tops = [0, 1, 2, 3].map((i) => {
      runner.goToStep(i);
      expect(base(arr())).toBe(200 + ARRAY_CELL_H);
      return arr().y;
    });
    expect(tops).toEqual([200, 200 - ARRAY_CELL_H, 200 - 2 * ARRAY_CELL_H, 200 - ARRAY_CELL_H]);
  });

  test('virar pilha no meio da reprodução não move a caixa do passo atual', () => {
    const { runner, arr } = emPilhaNoPasso(2);
    expect(arr().y).toBe(200);
    runner.goToStep(0);
    expect(base(arr())).toBe(200 + 3 * ARRAY_CELL_H);
    // e voltar pra vertical também não: o topo volta a ficar parado
    runner.goToStep(1);
    const topo = arr().y;
    runner.updateOrientation(arr().id, 'vertical');
    runner.goToStep(1);
    expect(arr().y).toBe(topo);
    runner.goToStep(2);
    expect(arr().y).toBe(topo);
  });

  test('arrastar uma pilha na reprodução grava a base', () => {
    const { runner, arr, id } = emPilhaNoPasso(0);
    runner.goToStep(2);
    arr().y = 50;
    runner.updatePosition(id, arr().x, 50);
    runner.goToStep(3);
    expect(base(arr())).toBe(50 + 3 * ARRAY_CELL_H);
    runner.goToStep(1); // antes do arraste: onde estava
    expect(base(arr())).toBe(200 + ARRAY_CELL_H);
  });

  test('o rótulo com o nome, acima da pilha, anda junto com o topo', () => {
    const { micro, runner, arr } = emPilhaNoPasso(2);
    const rotulo = () => micro.pointers.get(arr().labelPointerId);
    [0, 1, 2, 3].forEach((i) => {
      runner.goToStep(i);
      expect(rotulo().y).toBe(arr().y - 50);
    });
    // levado pra baixo da pilha, fica parado dali em diante
    runner.goToStep(2);
    const y = arr().y + 200;
    runner.updatePosition(rotulo().id, 0, y);
    runner.goToStep(3);
    expect(rotulo().y).toBe(y);
  });

  test('pilha que já existia antes de rodar cresce pra cima durante a execução', () => {
    const { micro, env, runner } = novo();
    runner.run('pilha = [1]', env);
    const arr0 = [...micro.arrays.values()][0];
    micro.setArrayOrientation(arr0.id, 'stack');
    runner.run(linhas('pilha.append(2)', 'pilha.append(3)'), env);
    runner.goToStep(1);
    const arr = micro.arrays.get(arr0.id);
    expect(arr.cells).toEqual([1, 2, 3]);
    expect(base(arr)).toBe(200 + ARRAY_CELL_H);
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
