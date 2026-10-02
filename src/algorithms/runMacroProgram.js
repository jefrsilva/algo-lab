import { parseProgram } from '../interpreter/blockParser.js';
import { runProgram } from '../interpreter/interpreter.js';

/**
 * Roda um programa escrito pelo usuário (BFS/DFS/etc., ver
 * src/app/macroExamplePrograms.js) contra uma estrutura macro através de
 * `env` (`MacroRuntimeAdapter`) e materializa os passos no MESMO formato que
 * `src/algorithms/traversal.js` (`collectSteps(bfs(...))`) já produz —
 * `{seq, pseudoLine, description, auxIds, visited, currentId, edge}` — assim
 * `App.js`/`CanvasView` não precisam saber se um passo veio de um generator
 * escrito à mão ou de código interpretado. `output` é um extra (os passos de
 * `traversal.js` não têm esse campo) — texto acumulado por "print(...)" até
 * aquele passo (ver MacroRuntimeAdapter#print), consumido por
 * App#_renderMacroConsole.
 *
 * `pseudoLine`/`description` apontam pra LINHA DE VERDADE do código-fonte do
 * usuário — quem destaca a linha em execução é o próprio editor de código
 * (`CodeEditor#setExecutionLine`, ver App.js#_renderMacroCodePanel), não um
 * pseudocódigo fixo traduzido. `sourceLines` é o `source` já quebrado em
 * linhas, pra virar a descrição de cada passo.
 *
 * `auxIds` vem do conteúdo do array de rascunho chamado `auxName` (por
 * convenção do programa-exemplo: `fila` pro BFS, `pilha` pro DFS) — desenhado
 * como uma estrutura de verdade no canvas (ver App.js#_buildMacroAuxFrames),
 * não afeta a execução em si. `currentId`/
 * `visited` vêm das chamadas explícitas a `marcar_atual`/`marcar_visitado`
 * (ver evaluator.js) — não são inferidos por convenção de nome, então
 * continuam corretos mesmo se o usuário renomear as variáveis do programa.
 */
export function runMacroProgram(source, env, { auxName = 'fila', sourceLines = [] } = {}) {
  const parsed = parseProgram(source);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const steps = [];
  let currentId = null;
  const visited = new Set();
  let seq = 0;

  for (const tick of runProgram(parsed.program, parsed.functions, env)) {
    env.touched.forEach(({ kind, id }) => {
      if (kind !== 'state') return;
      const state = env.nodeStates.get(id);
      if (state === 'current') currentId = id;
      if (state === 'visited') visited.add(id);
    });
    env.touched = [];

    const aux = env.arrays.get(auxName) ?? [];
    seq += 1;
    steps.push({
      seq,
      type: tick.kind,
      pseudoLine: tick.line,
      description: tick.line != null ? (sourceLines[tick.line] ?? '').trim() : (tick.description ?? ''),
      auxIds: aux.filter((v) => v.kind === 'struct').map((v) => v.id),
      visited: [...visited],
      currentId,
      edge: null,
      output: env.output.slice(),
    });
  }

  return { ok: true, steps };
}
