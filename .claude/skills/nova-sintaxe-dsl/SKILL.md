---
name: nova-sintaxe-dsl
description: Adiciona sintaxe nova à linguagem Python-like do visualizador — operador (ex. **, %, is, not in), statement de uma linha (ex. pass, del x, assert) ou de bloco (ex. try/except, with) — passando por lexer, parser, blockParser, ast, interpreter e evaluator. Use quando pedirem para a DSL aceitar uma construção do Python que hoje dá erro de sintaxe.
---

# Nova sintaxe na DSL

Fonte da verdade: receita **8.3** de `docs/ARQUITETURA.md` e o pipeline da seção 4/7.4 (`lexer.js` → `parser.js` → `blockParser.js` → `interpreter.js` → `evaluator.js`). Leia antes.

## Antes de codar

1. Confirme que a construção realmente falha hoje: `printf '...' | node scripts/run-dsl.mjs -`.
2. Ache a construção existente mais parecida e siga o mesmo caminho por todas as camadas (ex.: `Compare` para comparações encadeadas, `Break`/`Continue` para palavra-chave sozinha, `While` para bloco).
3. Confira a semântica e a precedência no Python real.

## Operador novo

1. `src/interpreter/lexer.js`: token (`TokenType`, `SINGLE_CHAR` ou o trecho de dois caracteres). Palavra reservada → `KEYWORDS` do lexer.
2. `src/interpreter/parser.js`: no nível de precedência certo (`parseAdd`, `parseMul`, `parseCompareOp`…).
3. `src/interpreter/evaluator.js`: `evalBinOp`/`evaluate`. Se puder aparecer num índice de cursor (`nums[i + 1]`), revise `exprLabel`/`exprDependencies`.

## Statement de uma linha

- Em `parser.js#parseStatement`, ou em `blockParser.js#parseBlock` se for palavra-chave sozinha.
- Construtor do nó em `ast.js`.
- `interpreter.js#execStmt`, com `yield* tick({line, kind})` para virar passo da reprodução.
- Se fizer sentido no Sandbox (Ctrl+Enter numa linha), trate também em `App#_executeStatement`.

## Statement de bloco

- Cabeçalho em `blockParser.js#parseBlock` usando `parseIndentedBody`; nó em `ast.js`.
- `interpreter.js#execStmt` respeitando o **protocolo de sinais**: repasse `abort`, `return`, `break` e `continue-loop` para cima, a menos que o statement os consuma.

## Comum a todos

- Realce: palavra nova em `KEYWORDS` de `src/ui/CodeEditor.js`.
- Erros de sintaxe com mensagem em pt-BR e posição (`at`) correta.
- Interpretador puro: nada de `MicroModel`/DOM em `src/interpreter/`.
- Limites existentes (2000 passos, profundidade 200) continuam valendo.
- Docs: descrição da DSL no `CLAUDE.md` e seções afetadas do ARQUITETURA.md (skill `sincronizar-docs`).

## Verificação

Skill `verificar-mudanca`: `npm run build`; `node scripts/run-dsl.mjs --steps` mostrando os passos esperados (linha certa, um passo por ação); casos de erro de sintaxe; uso dentro de `def` recursiva e dentro de laços (sinais `break`/`return` atravessando o bloco novo). Teste também a linha isolada no Sandbox (smoke no navegador ou script Playwright pontual com Ctrl+Enter).
