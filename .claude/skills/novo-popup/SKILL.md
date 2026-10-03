---
name: novo-popup
description: Cria um novo popup flutuante de configurações (menu de botão direito de um elemento do canvas), no padrão de LabelSettingsPopup/ChartSettingsPopup/ArraySettingsPopup. Use quando um elemento precisar de um menu de contexto ou painel de ajustes próprio.
---

# Novo popup de configurações

Fonte da verdade: receita **8.11** de `docs/ARQUITETURA.md`. Gabaritos: `src/ui/LabelSettingsPopup.js` (simples) e `src/ui/ChartSettingsPopup.js` (completo). Antes, veja se `ArraySettingsPopup` já serve com pequenas extensões.

## Passos

1. `src/ui/XSettingsPopup.js`: classe com `constructor(container)`, `open(screenX, screenY, node, { onChange | onSave, onRemove, returnFocusTo })`, `close()`, `get isOpen()`. DOM à mão (`document.createElement`), textos em pt-BR.
2. Posicione com `fitPopupInContainer` (`src/ui/fitPopup.js`) e reaproveite as classes CSS `.array-settings-*`; estilo novo só com tokens de `variables.css`.
3. Confirmações com `Dialog`, nunca `window.confirm`/`alert`.
4. `App`: instancie em `_buildLayout`; abra a partir de `_onMicroContextMenu` (no ramo do elemento); e **acrescente `this.xPopup.isOpen` ao guard do começo de `_onMicroPointerDown`** — sem isso, cliques no canvas atravessam o popup.
5. Cada mudança aplicada chama `this._renderMicroOnly()`; se o dado vai para o arquivo do projeto, skill `novo-campo-projeto`.
6. Fechar com Esc e devolver o foco (`returnFocusTo`).

## Fechamento

- Docs: lista de popups no `CLAUDE.md` e seção 7.6 do ARQUITETURA.md (skill `sincronizar-docs`).
- Verificação (skill `verificar-mudanca`): script Playwright pontual — `click({ button: 'right' })` no elemento, alterar campos, screenshot; clicar no canvas com o popup aberto (deve só fechar); Esc; popup perto da borda (deve caber); tema claro.
