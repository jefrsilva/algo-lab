// Roda um programa da DSL pelo mesmo caminho da Simulação (e de
// scripts/run-dsl.mjs): parseProgram → MicroProgramRunner#run →
// MicroRuntimeAdapter → MicroModel. Sem DOM.
import { MicroModel } from '../../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../../src/app/MicroRuntimeAdapter.js';
import { MicroProgramRunner } from '../../src/app/MicroProgramRunner.js';

/** Junta linhas num programa — evita template string com indentação extra. */
export const linhas = (...ls) => `${ls.join('\n')}\n`;

/**
 * Executa `source` e devolve:
 *   - `output`: linhas do console (print + avisos "⚠ ...") no último passo;
 *   - `steps`: os passos gerados (cada um com line/kind/touched/snapshot...);
 *   - `error`: erro de sintaxe ({message, at}) ou null;
 *   - `micro`, `env`, `runner`: pra inspecionar o modelo. O modelo termina
 *     restaurado no ÚLTIMO passo (estado final do programa), não no primeiro
 *     como no app.
 *
 * `adapterOpts` vai pro construtor do MicroRuntimeAdapter (ganchos
 * onArrayCreated/onChange..., createPosition).
 */
export function runDsl(source, adapterOpts = {}) {
  const micro = new MicroModel();
  let slot = 0;
  const env = new MicroRuntimeAdapter(micro, {
    // posição não importa aqui — só espalha pra não empilhar tudo em (0,0)
    createPosition: () => ({ x: 40 + (slot % 6) * 160, y: 40 + Math.floor(slot++ / 6) * 120 }),
    ...adapterOpts,
  });
  const runner = new MicroProgramRunner(micro);
  runner.run(source, env);
  const { steps } = runner;
  if (steps.length) runner.goToStep(steps.length - 1);
  return {
    output: steps.length ? steps[steps.length - 1].output : [],
    steps,
    error: runner.error,
    micro,
    env,
    runner,
  };
}

/** Só a saída do console (print + avisos), como texto com "\n". */
export function saida(source) {
  const { output, error } = runDsl(source);
  if (error) throw new Error(`erro de sintaxe (linha ${error.at + 1}): ${error.message}`);
  return output.join('\n');
}

/** Valores de um Map do modelo como array (ex: `valores(micro.variables)`). */
export const valores = (map) => Array.from(map.values());

/** Variável global pelo nome. */
export const variavel = (micro, name) => valores(micro.variables).find((v) => v.name === name && v.frameId === 'global');

/** Array (lista/set/deque) pelo nome. */
export const array = (micro, name) => valores(micro.arrays).find((a) => a.name === name);
