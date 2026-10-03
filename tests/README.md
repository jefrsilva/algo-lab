# Testes automatizados

Suíte com [Vitest](https://vitest.dev/) (usa a mesma configuração de módulos do Vite).

```bash
npm test             # roda tudo uma vez (é o que o CI roda, junto com o build)
npm run test:watch   # modo observação: re-roda o que mudou a cada salvamento
npx vitest run tests/dsl          # só uma pasta
npx vitest run -t "deque"         # só os testes cujo nome contém "deque"
```

O CI (`.github/workflows/testes.yml`) roda `npm test` e `npm run build` em todo push na `main` e em todo pull request.

## Organização

| Pasta / arquivo | O que cobre | Ambiente |
|---|---|---|
| `dsl/casos.js` + `dsl/programas.test.js` | programas inteiros da DSL; a saída tem que ser **igual à do Python real** | Node |
| `dsl/python.test.js` | confere o próprio gabarito de `casos.js` rodando cada programa no `python3` (pulado se não houver Python) | Node |
| `dsl/execucao.test.js` | passos gerados, erros de sintaxe, avisos `⚠`, guardas de laço/recursão, frames, estado final do `MicroModel` | Node |
| `dsl/bugs-conhecidos.test.js` | diferenças conhecidas em relação ao Python, marcadas com `test.fails` | Node |
| `interpreter/` | lexer, parser, blockParser, f-string (`format.js`), set do CPython (`pyset.js`), tuplas (`pytuple.js`) | Node |
| `core/MicroModel.test.js` | CRUD, limpeza de referências ao apagar, `toJSON`/`loadFrom` | Node |
| `app/` | `MicroProgramRunner` (snapshots, navegação, autoplay, posições por passo), `MicroRuntimeAdapter`, `microLayoutKey`, `microAlign` (alinhar/distribuir), `settings` | Node / jsdom |
| `render/chartReadout.test.js` | leitura do gráfico Big-O com Shift + mouse (`chartReadout`/`chartReadoutLabels`): n arredondado, curva mais próxima, curvas fora do eixo | Node |
| `ui/QuickActionPalette.test.js` | casamento abreviado dos comandos e a caixa do Ctrl+Espaço | jsdom |
| `ui/App.test.js` | integração: o app inteiro montado no jsdom — Simulação, reprodução, Sandbox, atalhos, ações rápidas, leitura de gráfico com Shift, salvar/carregar | jsdom |
| `helpers/` | `runDsl` (roda um programa sem DOM, como `scripts/run-dsl.mjs`) e `montarApp`/`desmontarApp`/`tecla` (DOM) | — |

O ambiente padrão é Node puro. Um arquivo que precisa de DOM começa com `// @vitest-environment jsdom`.

O jsdom não faz layout: nada de medidas, posições na tela ou desenho de verdade. Pra conferir o desenho, use o smoke test com Playwright da skill `verificar-mudanca` (`.claude/skills/verificar-mudanca/smoke.mjs`).

## Como acrescentar testes

- **Built-in, método ou sintaxe nova da DSL:** acrescente um caso em `dsl/casos.js` com o programa e a saída que o Python imprime (rode no `python3`, com as classes de `dsl/prelude.py` se usar `Node`/`TreeNode`). `python.test.js` confere que o gabarito bate com o Python. Avisos, erros e efeitos no modelo vão em `dsl/execucao.test.js`.
- **Corrigiu um bug de `dsl/bugs-conhecidos.test.js`:** o teste dele passa a "falhar" (deixou de falhar). Troque `test.fails` por `test` (ou mova o caso pra `casos.js`).
- **Achou um bug que não vai corrigir agora:** registre em `bugs-conhecidos.test.js` com `test.fails`, descrevendo o comportamento certo.
- **Elemento ou campo novo no modelo:** CRUD e ida e volta por `toJSON`/`loadFrom` em `core/MicroModel.test.js`; se entra no snapshot da reprodução, um caso em `app/MicroProgramRunner.test.js`.
- **Campo novo no arquivo de projeto:** acrescente-o ao teste de "salvar e carregar projeto" em `ui/App.test.js`.
- **Configuração, atalho, quick action:** `app/settings.test.js` e/ou `ui/App.test.js` (dispare a tecla com `tecla(window, ...)`).
