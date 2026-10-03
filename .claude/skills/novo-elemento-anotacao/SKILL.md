---
name: novo-elemento-anotacao
description: Adiciona um elemento de anotação do canvas (só visual, fora do MicroModel e dos snapshots — como label de texto, área hachurada ou gráfico Big-O), ou uma nova curva ao gráfico Big-O. Use para desenhos/anotações que o usuário cria e move no canvas mas que o código da DSL não manipula.
---

# Novo elemento de anotação

Fonte da verdade: receitas **8.6** (anotação) e **8.12** (curva Big-O) de `docs/ARQUITETURA.md`; seção 5.6 explica a diferença entre elementos do modelo e de anotação. Se o elemento precisa ser lido/escrito pelo código ou voltar com os passos da reprodução, use a skill `novo-elemento-modelo`.

## Só uma curva nova no gráfico Big-O

Adicione `{ id, label, color, f: (n) => ..., from }` a `CHART_FUNCTIONS` em `src/render/MicroCanvasView.js`, na ordem de crescimento. Popup, eixo Y automático e validação do load já usam a lista. Verifique no navegador (botão direito no gráfico) e salvar/carregar.

## Elemento novo — gabarito: o gráfico (`microCharts`)

```bash
grep -n -i "microCharts\|chart" src/app/App.js | cut -c1-160
grep -n -i "chart" src/render/MicroCanvasView.js | cut -c1-160
```

Checklist (marque cada item):

1. `App` constructor: `this.microXs = new Map()` com comentário da forma do objeto.
2. `_microNodeMaps`, `_microRemoveById`, `_microFindIdsInRect`, `_microSetNodePos`, `_fitMicroViewport`.
3. Criação: modo de ferramenta (skill `nova-ferramenta`) e/ou quick action (skill `nova-quick-action`; anotações **podem** ser criadas durante a Simulação, então não use o helper `model`).
4. Hit testing `_findMicroXAt`, normalmente **atrás** dos elementos do modelo na ordem de prioridade.
5. Render: geometria exportada e `_renderX` em `MicroCanvasView`, camada própria, campo novo em `render({...})`, montagem da lista em `_renderMicroOnly`. Estilos com tokens de `variables.css`.
6. Persistência: `_saveProject` (`project.xs`), `_applyLoadedProject` com validação defensiva, `_newProject` limpando (skill `novo-campo-projeto`).
7. Redimensionável? Reaproveite as alças das áreas (`_microResizableById`, `areaHandles`).
8. Menu de botão direito? Skill `novo-popup`.

Toda mutação de estado no `App` é seguida de `this._renderMicroOnly()`.

## Fechamento

Docs (skill `sincronizar-docs`: `CLAUDE.md` cita os elementos de anotação e o ARQUITETURA.md tem a seção 5.6) e verificação (skill `verificar-mudanca`): criar, mover, redimensionar, apagar, Ctrl+clique/seleção em retângulo, zoom/pan, tema claro/escuro, salvar/recarregar/carregar, e criar durante uma Simulação.
