import { evaluate, assign, assignChain, truthy, iterableItems, loopValues, NoneValue } from './evaluator.js';

/**
 * Interpreta um PROGRAMA (lista de statements produzida por blockParser.js)
 * contra um Environment, como uma generator function: cada `yield` é um "passo" da
 * execução (`{ line, kind, activeFrameId, callTree }`), materializável numa
 * lista pra reprodução (play/pause/step) — ver MicroProgramRunner.js, que
 * também tira um snapshot do modelo depois de cada passo.
 *
 * Granularidade: um passo por atribuição executada, um passo por linha sem
 * "=" (statement de chamada com efeito colateral, ex: "arr.append(x)"), um
 * passo por condição avaliada em if/while (mesmo quando dá falso — pra
 * deixar visível por que um loop parou ou um "if" foi pulado), um passo por
 * ligação da variável de um "for" (iterando um array já vivo no modelo OU um
 * `range(...)`, ver `resolveIterable`), e um passo por `return`. Uma guarda
 * de segurança interrompe a execução depois de MAX_STEPS passos (loop
 * infinito) e outra separada depois de MAX_CALL_DEPTH chamadas aninhadas
 * (recursão sem caso base) — ambas em vez de travar/estourar a pilha de
 * verdade da aba.
 *
 * ## Protocolo de controle de fluxo
 * `execStmt`/`execBlock` devolvem (via `return` do generator, capturado por
 * `yield*`) um "sinal" de 5 estados em vez de um boolean simples — antes só
 * existia "aborta" (limite de passos), depois `return` passou a "desviar" a
 * execução até a chamada de função mais próxima, e agora `break`/`continue`
 * fazem o mesmo até o loop mais próximo:
 *   - `{kind:'continue'}` — segue normalmente pro próximo statement.
 *   - `{kind:'break'}` — um `break` foi executado; pára o bloco atual e sobe
 *     até o `While`/`For` mais próximo (que vira `{kind:'continue'}` de novo,
 *     saindo do loop). Fora de um loop, sobe até o topo sem efeito.
 *   - `{kind:'continue-loop'}` — um `continue` foi executado; mesma
 *     propagação de `break`, mas o `While`/`For` mais próximo pula pra
 *     PRÓXIMA iteração em vez de sair. Nome diferente de `{kind:'continue'}`
 *     de propósito — não é o mesmo sinal (esse aqui SEMPRE precisa ser
 *     interceptado por um loop, o outro nunca é interceptado por nada).
 *   - `{kind:'return', value}` — um `return` foi executado; pára o bloco/loop
 *     atual e sobe até `callFunction` (que vira o valor de retorno da
 *     chamada), sem abortar o programa inteiro. Fora de uma chamada de
 *     função (`return` solto no programa de topo), sobe até o topo sem
 *     efeito — mesmo critério de "ignora silenciosamente" de sempre.
 *   - `{kind:'abort'}` — limite de passos OU de profundidade de chamada
 *     estourado; propaga por TUDO até o topo, sem exceção.
 */

const MAX_STEPS = 2000;
const LIMIT_STEP = { line: null, kind: 'limit', description: 'Possível loop infinito — execução interrompida.' };

const MAX_CALL_DEPTH = 200;
const DEPTH_LIMIT_STEP = {
  line: null,
  kind: 'limit',
  description: 'Recursão profunda demais (sem caso base?) — execução interrompida.',
};

const CONTINUE = { kind: 'continue' };
const ABORT = { kind: 'abort' };
const RETURN = (value) => ({ kind: 'return', value });
const BREAK = { kind: 'break' };
const CONTINUE_LOOP = { kind: 'continue-loop' };

/** Representação curta de um valor tipado pro RÓTULO de uma chamada na
 * árvore (ex: "fib(3)") — só pra exibição, nunca reavaliado. */
function describeArg(value, env) {
  if (value === undefined) return '?';
  if (value.kind === 'arrayref') {
    // lista: mostra o conteúdo (até 8 itens), ex: "mergeSort([3, 7, 6, 4])"
    const items = env.iterateArray?.(value.name);
    if (!items) return '[…]';
    const shown = items.slice(0, 8).map((v) => describeArg(v, env));
    return `[${shown.join(', ')}${items.length > 8 ? ', …' : ''}]`;
  }
  if (value.kind === 'nodelist') return `[${value.items.slice(0, 8).map((v) => describeArg(v, env)).join(', ')}${value.items.length > 8 ? ', …' : ''}]`;
  if (value.kind === 'scalar') return String(value.value);
  if (value.kind === 'bool') return value.value ? 'True' : 'False';
  if (value.kind === 'string') return JSON.stringify(value.value);
  if (value.kind === 'struct') return '•';
  if (value.kind === 'none') return 'None';
  return '?';
}

export function* runProgram(program, functions, env) {
  let count = 0;
  let callDepth = 0;
  const callTree = []; // {id, parentId, label, depth} — só cresce, nunca encolhe
  let currentCallNodeId = null;
  // valores já calculados que a expressão em andamento ainda vai usar, mas
  // que ainda não têm nome no modelo — ex: o resultado da 1ª chamada em
  // "merge(mergeSort(a), mergeSort(b))" enquanto a 2ª roda. A coleta de
  // listas no fim de cada chamada (ver MicroRuntimeAdapter#releaseDeadArrays)
  // não pode apagar o que estiver aqui. Pilha: cada nível de avaliação marca
  // o tamanho na entrada e volta pra ele na saída.
  const held = [];

  /** Resolve o "in <iterável>" de um "for". Um `Name` direto continua tendo
   * o atalho de sempre (array já vivo no modelo, via `env.iterateArray` —
   * preserva o comportamento hoje usado pelo cursor de leitura do modo
   * micro). Qualquer OUTRA expressão (ex: "range(n)") é avaliada
   * normalmente por `evaluate` e iterada conforme o `kind` do resultado (ver
   * evaluator.js#iterableItems). Qualquer outro `kind` (ou expressão que não resolve)
   * devolve `undefined`, e o "for" é ignorado — mesmo critério de "ignora a
   * linha silenciosamente" que a ferramenta já usava. */
  function resolveIterable(iterExpr) {
    if (iterExpr.type === 'Name') {
      // array já vivo no modelo (atalho de sempre) — só se NÃO for, cai pro
      // `evaluate` genérico abaixo (dict é valor de primeira classe, então
      // "for chave in d:" só faz sentido por ali, não por `iterateArray`).
      const arrayItems = env.iterateArray ? env.iterateArray(iterExpr.name) : undefined;
      if (arrayItems !== undefined) return arrayItems;
    }
    // qualquer outro iterável (range, enumerate, dict,
    // "d[chave]", linha de matriz "m[i]"...) — mesma função usada pela list
    // comprehension (ver evaluator.js#iterableItems).
    return iterableItems(evaluate(iterExpr, env), env);
  }

  function* tick(step) {
    count += 1;
    yield { ...step, activeFrameId: env.currentFrameId, callTree: callTree.slice() };
    if (count >= MAX_STEPS) {
      yield { ...LIMIT_STEP, activeFrameId: env.currentFrameId, callTree: callTree.slice() };
      return ABORT;
    }
    return CONTINUE;
  }

  /** "nome(args...)" pra uma função REGISTRADA em `functions` (não um
   * built-in) — empilha um frame novo (ver
   * MicroRuntimeAdapter#pushFrame), faz o bind de cada parâmetro pela mesma
   * `env.assignName` de qualquer atribuição (parâmetro vira ponteiro ou
   * variável dependendo do tipo do argumento), roda o corpo via
   * `yield* execBlock`, e devolve `{signal, value}` — `value` é o valor de
   * retorno (`None` se o corpo terminar sem `return` explícito), só válido
   * quando `signal.kind !== 'abort'`. */
  function* callFunction(fn, name, argValues) {
    if (callDepth >= MAX_CALL_DEPTH) {
      yield { ...DEPTH_LIMIT_STEP, activeFrameId: env.currentFrameId, callTree: callTree.slice() };
      return { signal: ABORT, value: undefined };
    }
    callDepth += 1;
    // lista passada como argumento é identificada pelo NOME no frame de quem
    // chama — que o frame novo não enxerga (arrays têm escopo de frame, ver
    // MicroRuntimeAdapter#_findArray). Troca por uma referência estável (id)
    // ANTES de empilhar o frame novo; mesma coisa com o retorno, abaixo.
    if (env.stableRef) argValues = argValues.map((v) => env.stableRef(v));
    // (um argumento nomeado pode deixar buraco antes dele — ver tryUserCall)
    const label = `${name}(${Array.from(argValues).filter((v) => v !== undefined).map((v) => describeArg(v, env)).join(', ')})`;
    const frameId = env.pushFrame(label);
    fn.params.forEach((param, i) => {
      if (argValues[i] !== undefined) env.assignName(param.name, argValues[i]);
      else if (param.default) {
        // valor default — reavaliado a cada chamada (ver ast.js#FunctionDef),
        // já dentro do frame novo (então "def f(n=len(arr)):" enxerga o
        // global normalmente, via a mesma resolução de nome de sempre).
        const defaultValue = evaluate(param.default, env);
        if (defaultValue !== undefined) env.assignName(param.name, defaultValue);
      }
    });
    const parentCallNodeId = currentCallNodeId;
    callTree.push({ id: frameId, parentId: parentCallNodeId, label, depth: callDepth });
    currentCallNodeId = frameId;

    const signal = yield* execBlock(fn.body);

    currentCallNodeId = parentCallNodeId;
    let value = signal.kind === 'return' ? signal.value : NoneValue;
    if (env.stableRef && value !== undefined) value = env.stableRef(value);
    env.popFrame();
    callDepth -= 1;
    if (signal.kind === 'abort') return { signal, value: undefined };
    // listas da chamada que terminou e que não foram devolvidas (nem estão
    // em uso por quem chamou) somem do canvas
    env.releaseDeadArrays?.([value, ...held]);
    return { signal: CONTINUE, value };
  }

  /** `stmt.value`/`stmt.expr` pode ser uma chamada de função de USUÁRIO
   * (registrada em `functions`) — nesse caso o valor não vem de `evaluate`
   * (que só conhece built-ins), vem de `yield* callFunction`, que também é
   * o único jeito de "pausar" a execução DENTRO da chamada pro playback
   * conseguir mostrar passo a passo. Devolve `null` se `callExpr` não é uma
   * chamada de função de usuário (chamador deve cair pro `evaluate` normal). */
  function* tryUserCall(callExpr) {
    if (!isUserCall(callExpr)) return null;
    const fn = functions[callExpr.callee.name];
    const argValues = [];
    const mark = held.length;
    for (const a of callExpr.args) {
      const arg = yield* evalExpr(a);
      if (arg.signal.kind === 'abort') return arg;
      argValues.push(arg.value);
      held.push(arg.value); // argumento já avaliado, à espera dos próximos
    }
    // "f(a, b=2)" — cada argumento nomeado vai pra posição do parâmetro
    // com esse nome; o que ficar sem valor usa o default (ver callFunction)
    for (const { name, value } of callExpr.kwargs ?? []) {
      const i = fn.params.findIndex((p) => p.name === name);
      if (i === -1 || i < callExpr.args.length) {
        env.warn?.(
          i === -1
            ? `${callExpr.callee.name}() não tem parâmetro "${name}".`
            : `${callExpr.callee.name}(): "${name}" recebeu valor duas vezes.`,
        );
        held.length = mark;
        return { signal: CONTINUE, value: undefined };
      }
      const arg = yield* evalExpr(value);
      if (arg.signal.kind === 'abort') return arg;
      argValues[i] = arg.value;
      held.push(arg.value);
    }
    const result = yield* callFunction(fn, callExpr.callee.name, argValues);
    held.length = mark;
    return result;
  }

  function isUserCall(node) {
    return node.type === 'Call' && node.callee.type === 'Name' && Object.hasOwn(functions, node.callee.name);
  }

  /** `node` tem alguma chamada de função de usuário em QUALQUER ponto da
   * árvore (ex: "no.data + soma(no.next)", "print(fib(n))")? */
  function containsUserCall(node) {
    if (node === null || typeof node !== 'object') return false;
    if (Array.isArray(node)) return node.some(containsUserCall);
    if (node.type === 'Value') return false; // já resolvido — não desce no valor tipado
    if (isUserCall(node)) return true;
    return Object.values(node).some(containsUserCall);
  }

  /** Avalia uma expressão que pode ter chamada de função de usuário
   * ANINHADA (não só a expressão inteira, como `tryUserCall` cobre) —
   * `evaluate` só conhece built-ins, então cada chamada de usuário é
   * executada antes via `yield* callFunction` (pra aparecer passo a passo e
   * na árvore de chamadas) e substituída na AST por um nó `Value` já com o
   * resultado; o que sobra vai pro `evaluate` normal. Devolve `{signal,
   * value}`, mesmo formato de `callFunction`. Sem chamada de usuário nenhuma,
   * é exatamente o `evaluate` de sempre. */
  function* evalExpr(node) {
    if (!containsUserCall(node)) return { signal: CONTINUE, value: evaluate(node, env) };
    const mark = held.length;
    const resolved = yield* resolveUserCalls(node);
    held.length = mark;
    if (resolved.signal.kind === 'abort') return { signal: resolved.signal, value: undefined };
    return { signal: CONTINUE, value: evaluate(resolved.node, env) };
  }

  /** Reescreve `node` trocando cada chamada de usuário por `{type:'Value',
   * value}` (ver evaluator.js#evaluate), executando as chamadas na ordem de
   * avaliação da esquerda pra direita. `and`/`or` preservam o curto-circuito
   * (o lado direito só é resolvido — e as chamadas dele só executam — se o
   * esquerdo não decidir sozinho), essencial pra caso base tipo
   * "return no != None and busca(no.next, x)". */
  function* resolveUserCalls(node) {
    const ok = (n) => ({ signal: CONTINUE, node: n });
    if (!containsUserCall(node)) return ok(node);

    if (isUserCall(node)) {
      const call = yield* tryUserCall(node);
      if (call.signal.kind === 'abort') return { signal: call.signal, node: null };
      held.push(call.value);
      return ok({ type: 'Value', value: call.value });
    }

    if (node.type === 'BinOp' && (node.op === 'and' || node.op === 'or')) {
      const left = yield* evalExpr(node.left);
      if (left.signal.kind === 'abort') return { signal: left.signal, node: null };
      held.push(left.value);
      if (left.value === undefined) return ok({ type: 'Value', value: undefined });
      const decided = node.op === 'and' ? !truthy(left.value, env) : truthy(left.value, env);
      if (decided) return ok({ type: 'Value', value: left.value });
      return yield* resolveUserCalls(node.right);
    }

    if (node.type === 'BinOp' && node.op !== 'in' && node.op !== 'notin' && !containsUserCall(node.left)) {
      // lado esquerdo sem chamada, direito com: avalia o esquerdo ANTES da
      // chamada (ordem do Python — "no.data + f(no)" lê `no.data` antes de
      // `f` poder mudá-lo). Seguro porque o caso genérico de BinOp em
      // `evaluate` só faz `evaluate(node.left)` mesmo.
      const leftValue = evaluate(node.left, env);
      held.push(leftValue);
      const right = yield* resolveUserCalls(node.right);
      if (right.signal.kind === 'abort') return right;
      return ok({ ...node, left: { type: 'Value', value: leftValue }, right: right.node });
    }

    // caso geral: resolve cada filho que tenha chamada, na ordem dos campos
    // do nó (que já segue a ordem de avaliação: left/right, object/index,
    // args em sequência...), mantendo o resto da AST intacto pro `evaluate`
    // (que depende de ver `Name` cru em vários casos, ex: "len(arr)").
    const out = Array.isArray(node) ? [] : { ...node };
    for (const [key, child] of Object.entries(node)) {
      if (!containsUserCall(child)) {
        out[key] = child;
        continue;
      }
      const r = yield* resolveUserCalls(child);
      if (r.signal.kind === 'abort') return r;
      out[key] = r.node;
    }
    return ok(out);
  }

  function* execBlock(stmts) {
    for (const stmt of stmts) {
      const signal = yield* execStmt(stmt);
      if (signal.kind !== 'continue') return signal;
    }
    return CONTINUE;
  }

  function* execStmt(stmt) {
    // "from collections import deque" — nada a fazer (ver ast.js#Import)
    if (stmt.type === 'Import') return CONTINUE;

    if (stmt.type === 'Assign') {
      const result = yield* evalExpr(stmt.value);
      if (result.signal.kind === 'abort') return result.signal;
      assign(stmt.target, result.value, env);
      return yield* tick({ line: stmt.line, kind: 'assign' });
    }

    if (stmt.type === 'ChainAssign') {
      // "a = b = valor" — avalia uma vez só (ver evaluator.js#assignChain)
      const result = yield* evalExpr(stmt.value);
      if (result.signal.kind === 'abort') return result.signal;
      assignChain(stmt.targets, result.value, env);
      return yield* tick({ line: stmt.line, kind: 'assign' });
    }

    if (stmt.type === 'TupleAssign') {
      // "a, b = b, a" — todo valor é avaliado ANTES de qualquer atribuição
      // acontecer (troca de verdade, sem precisar de variável temporária: se
      // atribuísse um de cada vez, o segundo alvo já leria o valor NOVO do
      // primeiro).
      const values = [];
      const mark = held.length;
      for (const v of stmt.values) {
        const result = yield* evalExpr(v);
        if (result.signal.kind === 'abort') return result.signal;
        values.push(result.value);
        held.push(result.value);
      }
      held.length = mark;
      // "i, j = chave" — um valor só (ver ast.js#TupleAssign): precisa ser
      // uma tupla com um item por alvo, desempacotada aqui
      if (values.length === 1 && stmt.targets.length > 1) {
        const v = values[0];
        if (v === undefined) return yield* tick({ line: stmt.line, kind: 'assign' });
        const items = v.kind === 'tuple' ? v.items : undefined;
        if (!items || items.length !== stmt.targets.length) {
          env.warn?.(
            items
              ? `Desempacotamento: ${stmt.targets.length} alvo(s) mas a tupla tem ${items.length} item(ns).`
              : `Desempacotamento: "${stmt.targets.length} alvos = valor" precisa de uma tupla do lado direito.`,
          );
          return yield* tick({ line: stmt.line, kind: 'assign' });
        }
        values.splice(0, 1, ...items);
      }
      stmt.targets.forEach((t, i) => assign(t, values[i], env));
      return yield* tick({ line: stmt.line, kind: 'assign' });
    }

    if (stmt.type === 'ExprStmt') {
      // linha sem "=" — só faz sentido pro efeito colateral de uma chamada
      // (built-in tipo "arr.append(x)"/"arr.pop()", ou uma função de usuário
      // chamada só pelo efeito colateral, descartando o retorno).
      const result = yield* evalExpr(stmt.expr);
      if (result.signal.kind === 'abort') return result.signal;
      return yield* tick({ line: stmt.line, kind: 'expr' });
    }

    if (stmt.type === 'Return') {
      // "return outraFuncao(...)" (chamada de cauda) ou "return no.data +
      // soma(no.next)" (chamada aninhada) — passa por `evalExpr`, senão a
      // chamada cairia no `evaluate` genérico (que não conhece função de
      // usuário nenhuma) e silenciosamente viraria `None`.
      let value;
      if (stmt.expr === null) {
        value = NoneValue;
      } else {
        const result = yield* evalExpr(stmt.expr);
        if (result.signal.kind === 'abort') return result.signal;
        value = result.value;
      }
      const tickSignal = yield* tick({ line: stmt.line, kind: 'return' });
      if (tickSignal.kind === 'abort') return tickSignal;
      return RETURN(value === undefined ? NoneValue : value);
    }

    if (stmt.type === 'Break') {
      const tickSignal = yield* tick({ line: stmt.line, kind: 'break' });
      return tickSignal.kind === 'abort' ? tickSignal : BREAK;
    }

    if (stmt.type === 'Continue') {
      const tickSignal = yield* tick({ line: stmt.line, kind: 'continue-stmt' });
      return tickSignal.kind === 'abort' ? tickSignal : CONTINUE_LOOP;
    }

    if (stmt.type === 'If') {
      const test = yield* evalExpr(stmt.test);
      if (test.signal.kind === 'abort') return test.signal;
      const ok = truthy(test.value, env);
      const tickSignal = yield* tick({ line: stmt.line, kind: ok ? 'test-true' : 'test-false' });
      if (tickSignal.kind !== 'continue') return tickSignal;
      return yield* execBlock(ok ? stmt.body : stmt.orelse);
    }

    if (stmt.type === 'While') {
      for (;;) {
        const test = yield* evalExpr(stmt.test);
        if (test.signal.kind === 'abort') return test.signal;
        const ok = truthy(test.value, env);
        const tickSignal = yield* tick({ line: stmt.line, kind: ok ? 'test-true' : 'test-false' });
        if (tickSignal.kind !== 'continue') return tickSignal;
        if (!ok) return CONTINUE;
        const bodySignal = yield* execBlock(stmt.body);
        if (bodySignal.kind === 'break') return CONTINUE;
        if (bodySignal.kind === 'continue-loop') continue;
        if (bodySignal.kind !== 'continue') return bodySignal;
      }
    }

    if (stmt.type === 'For') {
      const items = resolveIterable(stmt.iterExpr);
      if (items === undefined) return CONTINUE; // iterável desconhecido/inválido: ignora, mesmo critério de sempre
      for (const item of items) {
        // `item` é um valor tipado direto, uma tupla (desempacotada com 2+
        // nomes: "for i, j in pontos:") ou um par JS `[Scalar(i), valor]` do
        // enumerate/items (ver ast.js#For/evaluator.js#loopValues).
        // `varNames[k]` sem item correspondente (mais nomes do que a tupla
        // tem) simplesmente não recebe atribuição nenhuma naquela iteração.
        const values = loopValues(item, stmt.varNames.length);
        stmt.varNames.forEach((name, k) => {
          if (values[k] !== undefined) env.assignName(name, values[k]);
        });
        const tickSignal = yield* tick({ line: stmt.line, kind: 'for-bind' });
        if (tickSignal.kind !== 'continue') return tickSignal;
        const bodySignal = yield* execBlock(stmt.body);
        if (bodySignal.kind === 'break') return CONTINUE;
        if (bodySignal.kind === 'continue-loop') continue;
        if (bodySignal.kind !== 'continue') return bodySignal;
      }
      return CONTINUE;
    }

    return CONTINUE;
  }

  yield* execBlock(program);
}
