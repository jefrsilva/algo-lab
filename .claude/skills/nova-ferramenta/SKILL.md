---
name: nova-ferramenta
description: Adiciona um novo modo/ferramenta à barra inferior do canvas (como Selecionar, Texto, Área, Gráfico) com ícone, atalho de teclado, gesto de criação com rascunho e cursor próprio. Use quando pedirem uma nova ferramenta na toolbar do canvas.
---

# Nova ferramenta (modo da barra inferior)

Fonte da verdade: receita **8.7** de `docs/ARQUITETURA.md` (e 8.10 para o atalho). Gabarito: o modo `chart` ou `area` — `grep -n "'chart'" src/app/App.js`.

## Passos

1. `src/app/App.js` → `MICRO_MODES`: `{ id: 'x', label: 'Descrição', shortcut: '5 / K' }`.
2. `src/ui/ModeToolbar.js` → `ICONS`: SVG 24×24 com `stroke="currentColor"`, chave `x`.
3. Atalho no final de `App#_onKeyDown` (`else if (key === '5' || key === 'k') this._setMicroMode('x')`). **Antes**, confira que a tecla está livre: `grep -n "key === '" src/app/App.js`.
4. Gesto:
   - `_onMicroPointerDown`: ramo `if (this.microMode === 'x') { this._microPointer = { ..., hit: 'x-create', worldPtDown: worldPt }; ... }` no começo, junto aos de `text`/`area`/`chart`;
   - `_onMicroPointerMoveWindow`: atualizar o rascunho (`this._microXDraft`);
   - `_onMicroPointerUpWindow`: criar o elemento e limpar o rascunho;
   - `_setMicroMode`: zerar o rascunho ao trocar de modo;
   - `_renderMicroOnly`: desenhar o rascunho.
5. Cursor: `canvas.css` com `[data-mode='x']` (o App grava `microContainer.dataset.mode`).
6. Modo com cor (como `text`/`area`): `_applyMicroPaletteColor` e o `swatch` em `microModeToolbar.render`.

O elemento criado pela ferramenta normalmente é uma anotação (skill `novo-elemento-anotacao`). Se for um elemento do modelo, lembre que eles não podem ser criados durante a Simulação.

## Fechamento

- Docs: `CLAUDE.md` e ARQUITETURA.md citam os modos e atalhos (skill `sincronizar-docs`).
- Verificação (skill `verificar-mudanca`): script Playwright pontual que clica no botão do modo e também usa o atalho, arrasta no canvas, confere o elemento criado no screenshot, troca de modo no meio do gesto (rascunho some) e confere o cursor.
