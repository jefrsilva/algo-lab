---
name: nova-configuracao
description: Adiciona uma preferência do usuário (settings.js + janela de Configurações + App#_applySetting, persistida no localStorage) e/ou um atalho de teclado novo em App#_onKeyDown. Use quando pedirem uma opção/preferência/toggle configurável, ou um atalho de teclado.
---

# Nova configuração ou atalho de teclado

Fonte da verdade: receitas **8.9** (configuração) e **8.10** (atalho) de `docs/ARQUITETURA.md`.

Regras do projeto: **toda** preferência mora no objeto único de `src/app/settings.js` — nada de chaves soltas no localStorage e nada de toggles novos no menu ☰.

## Configuração

1. `src/app/settings.js`: chave em `SETTINGS_DEFAULTS` + validador em `VALIDATORS` (defensivo: o localStorage pode ter lixo de versões antigas).
2. `src/ui/SettingsDialog.js` → `SECTIONS`: `{ key, label, type: 'choice' | 'toggle' | 'stepper', ... }` na seção certa, com `shortcut`/`hint` se houver. Tipo de campo inexistente → implemente no `open()` do diálogo.
3. `App#_applySetting`: um `case` que aplica o efeito na tela **e** grava com `setSetting`. "Restaurar padrões" (`_resetSettings`) já itera `SETTINGS_DEFAULTS` — confira que o `case` funciona partindo do padrão.
4. Valor inicial lido no `constructor`/`_buildLayout` com `getSetting`.

## Atalho de teclado

Tudo em `App#_onKeyDown`. Antes, confira se a tecla está livre (`grep -n "key === '\|e.code === '" src/app/App.js`). Lugar certo:

- vale **mesmo digitando** no editor (como Ctrl+H, Ctrl+,/., Ctrl+Espaço) → **antes** do teste `isTyping`;
- atalhos de canvas → depois;
- teclas sem modificador → no `if/else` do final.

Use `e.code` (tecla física) quando houver Alt (no macOS Alt+C vira "ç"). Atalho que muda uma preferência chama `this._applySetting(key, valor)` — nunca `setSetting` direto, senão a janela de Configurações fica desatualizada. Mencione o atalho no `label` do modo, no `shortcut` do item de configuração ou no `title` do botão.

## Fechamento

- Docs: `CLAUDE.md` lista as configurações e atalhos do `SettingsDialog` (skill `sincronizar-docs`).
- Verificação (skill `verificar-mudanca`): script Playwright pontual — abrir Configurações pelo ☰, mudar a opção, conferir o efeito; usar o atalho e ver a janela refletir; recarregar a página e ver o valor mantido; "Restaurar padrões"; atalho com foco no editor de código (não deve disparar, se for de canvas).
