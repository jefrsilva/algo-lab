---
name: nova-quick-action
description: Adiciona um comando à paleta de ações rápidas (Ctrl+Espaço), como "new pointer", "new sliding window" — incluindo o helper _quickNewX que cria o elemento no centro da vista e abre a edição in place. Use quando pedirem um comando novo no Ctrl+Espaço ou no menu de ações rápidas.
---

# Nova quick action (Ctrl+Espaço)

Fonte da verdade: receita **8.8** de `docs/ARQUITETURA.md`. Veja os comandos existentes: `grep -n "model('new\|name: '" src/app/App.js` e o corpo de `App#_openQuickActions`.

## Passos

1. Em `App#_openQuickActions`, adicione ao array `commands`:
   - elemento do **modelo**: `model('new x', ['alias'], 'descrição curta em pt-BR', () => this._quickNewX())` — o helper `model` desabilita o comando durante a Simulação;
   - outros: `{ name, aliases, description, disabled: null | 'motivo', run }`.
2. Nomes em inglês no padrão `verbo objeto` (`new …`, `remove …`) para a busca abreviada funcionar (`n p` → `new pointer`). Confira que o nome/alias não colide com os existentes.
3. Implemente `_quickNewX` seguindo `_quickNewCollection`/`_quickNewNode`:
   - posição com `_microCreatePosition`;
   - criação no `MicroModel` (ou no `Map` de anotação do App);
   - seleção e `this._renderMicroOnly()`;
   - edição in place do nome (`_editMicroNameInPlace`) ou do dado (`_openMicroDataPopup`);
   - `_quickDiscard` no cancelamento (Esc desfaz a criação).
4. Busca, ranking e o "fantasma" do comando ficam por conta da `QuickActionPalette` — não mexa nela para um comando comum.

## Fechamento

- Docs: o `CLAUDE.md` descreve os comandos da paleta (skill `sincronizar-docs`).
- Verificação (skill `verificar-mudanca`): script Playwright pontual — `Control+Space`, digitar a abreviação, Enter, digitar o nome, Enter, screenshot; repetir com Esc (a criação some); abrir pelo menu ☰ (lista completa); tentar durante a Simulação (deve aparecer desabilitado, se for elemento do modelo).
