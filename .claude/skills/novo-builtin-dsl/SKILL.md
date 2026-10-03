---
name: novo-builtin-dsl
description: Adiciona uma função built-in (ex. abs, enumerate, reversed) ou um método de lista/string/dict/set/deque (ex. lista.reverse(), s.split()) à linguagem Python-like do visualizador. Use quando pedirem para a DSL suportar uma função ou método novo do Python, ou para corrigir o comportamento de um existente.
---

# Novo built-in ou método da DSL

Fonte da verdade: receitas **8.1** e **8.2** de `docs/ARQUITETURA.md` — leia-as antes (`grep -n "### 8.1" -A20 docs/ARQUITETURA.md`). Leia também 5.2 (valores tipados) e 5.3 (interface `Environment`) se ainda não conhece.

## Antes de codar

1. Ache um built-in/método parecido e siga o mesmo caminho: `grep -n "fname === 'sorted'" src/interpreter/evaluator.js`, `grep -n "method === 'append'" src/interpreter/evaluator.js`.
2. Confira a semântica exata no Python real (`python3 -c ...`): tipos aceitos, erros, casos de borda. O objetivo é imitar o CPython (ver como `pyset.js` replica até a ordem de sets).

## Função global (`abs(x)`, receita 8.1)

1. `src/interpreter/evaluator.js`, `evaluate` → `case 'Call'` → bloco `node.callee.type === 'Name'`: `if (fname === 'abs' && node.args.length === 1) { ... }` junto dos outros. Avalie args com `evaluate(arg, env)`; devolva valor tipado (`Scalar(...)` etc.) ou `undefined` + `env.warn?.('mensagem em pt-BR')`.
2. Precisa ler/escrever o modelo? Crie método novo na interface `Environment` (documente no comentário do topo de `evaluator.js`) e implemente em `src/app/MicroRuntimeAdapter.js`, chamando `this._touch(kind, id)` em tudo que ler/escrever (destaque).
3. Realce: inclua o nome em `KEYWORDS` de `src/ui/CodeEditor.js`, se fizer sentido.
4. Lexer/parser não mudam: `nome(args)` já vira `Call`.
5. Argumentos nomeados só são aceitos por `deque(..., maxlen=)` e funções `def` (ver `interpreter.js#tryUserCall`); se o built-in precisar de kwargs, trate explicitamente.

## Método (receita 8.2)

- String → `callStringMethod`; deque → `callDequeMethod` (primitivas de lista do adapter + `dequeSetItems`); lista/set/dict → bloco `method === '...'` em `case 'Call'` com callee `Attribute`.
- Mutação do modelo só por métodos do `Environment` (`arrayAppend`, `arrayInsert`, `arrayPop`, `setAdd`…). Operação nova → crie no adapter usando a API do `MicroModel`.
- Reescrever o conteúdo inteiro de um array: `MicroModel#setArrayContents` (ou `setSetContents`) — **nunca** mute células/`hashTable` in place (corrompe os snapshots da reprodução).
- Respeite `MAX_ARRAY_SIZE` (24) com aviso, como `arrayAppend` faz.

## Regras

- `src/interpreter/` é puro: nada de importar `MicroModel` ou DOM.
- Comentários e mensagens em pt-BR, explicando o porquê.
- Docs: atualize a lista de built-ins no topo de `evaluator.js` e a descrição da DSL no `CLAUDE.md` (e no ARQUITETURA.md, se ele citar a lista) — ver skill `sincronizar-docs`.

## Verificação

Acrescente um caso em `tests/dsl/casos.js` (programa + saída do Python real) e, pra avisos `⚠`, um em `tests/dsl/execucao.test.js`. Use a skill `verificar-mudanca`: `npm test`, `npm run build` + `node scripts/run-dsl.mjs` com caso feliz (comparado ao Python real), caso de erro, uso dentro de função recursiva e `--model` se o método muta o modelo. Se mexeu no realce, um smoke no navegador.
