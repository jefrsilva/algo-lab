---
name: verificar-mudanca
description: Verifica uma mudança neste projeto — roda a suíte de testes (npm test), confere o build, roda programas da DSL sem navegador com scripts/run-dsl.mjs e faz smoke test no navegador com Playwright (screenshot + console). Use depois de qualquer alteração em src/, antes de commitar, ou quando pedirem para testar/verificar/conferir algo no app.
---

# Verificar uma mudança

O projeto tem uma suíte de testes automatizados em `tests/` (Vitest — ver `tests/README.md`), mas não tem linter nem type checker, e os testes não enxergam o desenho. O roteiro de referência é a seção **10. Como verificar uma mudança** de `docs/ARQUITETURA.md`. Esta skill o torna executável. Rode **todos** os passos que se aplicam e relate o resultado com fidelidade (inclusive o que não deu pra verificar).

## 1. Testes e build (sempre)

```bash
npm test
npm run build
```

Os dois precisam terminar sem erros (é o que o CI roda). Um teste de `tests/dsl/bugs-conhecidos.test.js` "falhando" quer dizer que um bug conhecido foi corrigido: troque `test.fails` por `test`.

**Acrescente testes pro que você mudou** — onde cada tipo vai está em `tests/README.md` (built-in/sintaxe da DSL → caso em `tests/dsl/casos.js` com a saída do Python; modelo → `tests/core/`; reprodução → `tests/app/`; fluxo da interface → `tests/ui/App.test.js`). Os testes descartáveis dos passos abaixo (programas no scratchpad, scripts Playwright pontuais) servem pra explorar; o que vale manter vira teste em `tests/`.

## 2. Linguagem (mexeu em `src/interpreter/`, `MicroRuntimeAdapter`, `MicroModel` ou `MicroProgramRunner`)

`scripts/run-dsl.mjs` roda um programa pelo mesmo caminho da Simulação (`parseProgram` → `MicroProgramRunner#run` → `MicroRuntimeAdapter` → `MicroModel`), em Node puro:

```bash
node scripts/run-dsl.mjs programa.py            # saída do console (print + avisos ⚠) e nº de passos
node scripts/run-dsl.mjs programa.py --steps    # + lista de passos (linha 1-based e kind)
node scripts/run-dsl.mjs programa.py --model    # + estado final do MicroModel em JSON
printf 'x = [3, 1]\nprint(sorted(x))\n' | node scripts/run-dsl.mjs -
```

Escreva os programas exploratórios no scratchpad (não no repo) e, no fim, passe os casos que valem a pena pra `tests/dsl/`. Cubra, no mínimo:

- o caso feliz, comparando com o que o **Python real** imprimiria (`python3 -c ...` ajuda a conferir);
- um caso de erro (nome inexistente, índice fora da lista, tipo errado) — deve gerar aviso `⚠` legível em pt-BR ou falhar em silêncio, nunca uma exceção JS;
- o recurso usado **dentro de uma função recursiva** (frames);
- com `--model`, que o modelo final está coerente (referências, células, `frameId`).

Uma exceção JS não tratada no script indica bug — o app real também quebraria.

## 3. Interface (mexeu em `src/app/App.js`, `src/render/`, `src/ui/`, `src/styles/`)

Suba o dev server em segundo plano e use o smoke test com Playwright:

```bash
npm run dev   # em segundo plano; http://localhost:5173
node .claude/skills/verificar-mudanca/smoke.mjs programa.py saida.png [--url http://localhost:5173]
```

O script cola o programa no editor, roda na **Simulação**, vai ao último passo, imprime o contador de passos, erro de execução, o texto do console do app e erros do navegador (`pageerror`, `console.error`, HTTP ≥ 400), e salva um screenshot. **Abra o screenshot com Read** e confira o desenho.

Ele precisa do pacote `playwright` acessível (global no ambiente de nuvem). Não adicione Playwright ao `package.json`. Se não houver Playwright, diga ao usuário quais passos manuais da lista abaixo ele deve fazer.

Para gestos que o smoke não cobre (arrastar, duplo clique, botão direito, atalhos), escreva um script Playwright pontual no scratchpad a partir de `smoke.mjs`. Seletores úteis: `.code-editor-textarea`, `.code-editor-mode-btn` ("Sandbox"/"Simulação"), `.code-editor-run-btn`, `.playback-btn` (⏮ ◀ ▶ ▶| ⏭), `.step-counter`, `.micro-container` (canvas), `.micro-console .console-body`, `.micro-run-error`.

Checklist manual/automatizável por área (seção 10 do ARQUITETURA.md):

- **Elemento visual:** criar à mão (Ctrl+Espaço) e por código; selecionar, arrastar, apagar (Delete), editar (duplo clique), botão direito; ligar um ponteiro por arraste; alternar Ctrl+A (nós simplificados), N (nomes completos) e tema claro/escuro; zoom e pan.
- **Reprodução:** arrastar um elemento no meio da reprodução, voltar/avançar passos (Ctrl+, / Ctrl+.), rodar de novo e conferir que as posições foram lembradas.
- **Sandbox:** Ctrl+Enter linha a linha (flash verde/vermelho, destaque, console).
- **Persistência:** salvar o projeto, recarregar, carregar o arquivo e conferir que tudo voltou (cores, janelas deslizantes, anotações).

Ao terminar, encerre o dev server que você subiu.

## 4. Relatório

Diga o que foi verificado e como (comandos, programas, screenshot), o que falhou (com a saída) e o que ficou sem verificar.
