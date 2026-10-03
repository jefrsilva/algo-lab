---
name: novo-elemento-modelo
description: Adiciona um novo elemento do modelo de memória (desenhado no canvas e manipulável pelo código, como array, dict, matriz — ex. "pilha" ou "heap" com desenho próprio) ou um novo tipo de nó de estrutura (ex. nó com 3 filhos), passando por MicroModel, MicroProgramRunner, MicroRuntimeAdapter, evaluator, MicroCanvasView, App e canvas.css. Use para qualquer elemento novo que o interpretador cria/lê ou que entra nos snapshots.
---

# Novo elemento do modelo (ou tipo de nó)

Esta é a tarefa mais extensa do projeto. Fonte da verdade: receitas **8.5** (elemento) e **8.4** (tipo de nó) de `docs/ARQUITETURA.md`, mais as seções 5 (conceitos) e 9 (armadilhas). Leia-as inteiras antes de começar.

Se o elemento **não** passa pelo interpretador nem pelos snapshots (só desenho no canvas), use a skill `novo-elemento-anotacao`.

## Método

1. **Use a matriz como gabarito** (é o elemento mais recente e passa por todas as camadas). Liste os pontos de contato:
   ```bash
   grep -rn -i "matri" src --include=*.js --include=*.css | grep -v "^\s*//" | cut -c1-160
   ```
   Para um tipo de nó, use `'tree'`/`'graph'` como gabarito (`grep -rn "'tree'" src`).
2. Crie uma lista de tarefas a partir do checklist da receita 8.5 (modelo e persistência → execução → render → App → docs) e marque cada item ao concluir. Não pule camadas: um item esquecido costuma aparecer só ao voltar um passo, salvar/carregar ou apagar.
3. Implemente camada por camada, verificando cada uma antes de seguir:
   - **Modelo + execução**: `node scripts/run-dsl.mjs prog.py --model` já mostra o elemento no JSON, antes de existir qualquer desenho. Fixe isso em testes: CRUD/`toJSON`/`loadFrom` em `tests/core/MicroModel.test.js`, snapshot por passo em `tests/app/MicroProgramRunner.test.js`, código que cria o elemento em `tests/dsl/execucao.test.js`.
   - **Render + App**: smoke no navegador (skill `verificar-mudanca`) e abra o screenshot.

## Pontos que costumam ser esquecidos

- `MicroModel#remove*` anulando referências que apontam para o elemento (`target` de ponteiros, células `ref`), além de `clear`, `toJSON`, `loadFrom`.
- Novos `target.kind` de ponteiro tratados em `setPointerTarget` e em **todas** as remoções; chegada das setas em `MicroCanvasView#_renderEdges`.
- `MicroProgramRunner`: `_snapshot` (cópia profunda só das partes mutáveis, nunca `x`/`y`), `_restore`, `_capturePositions`, `_assignKeys`; `microLayoutKey.js` se tiver nome estável.
- Nunca mutar in place objetos compartilhados com snapshots (substitua linhas/células).
- `App`: `_microNodeMaps`, `_microRemoveById`, `_isMicroModelElement`, posição, `_microFindIdsInRect`, `_microOccupiedRects`, `_microCreatePosition`, `_fitMicroViewport`/`_hasMicroContent`; hit testing na ordem certa em `_onMicroPointerDown`, `_onMicroDblClick`, `_onMicroContextMenu`, `_resolveMicroDropTarget`; filtrado por `_microPickable`.
- Geometria usada no desenho **e** no clique exportada de `MicroCanvasView.js` (num lugar só).
- `_applyColors`/`_applyDimming`/pulso de seleção e `.micro-colored` em `canvas.css`, com tokens de `variables.css` (dois temas).
- Elementos do modelo não podem ser criados pela UI durante a Simulação — a quick action usa o helper `model(...)` (skill `nova-quick-action`).
- Coleção nomeada: ponteiro-rótulo (`_create*LabelPointer`, `MicroModel#link*LabelPointer`, flag `is*Label` no ponteiro e no `toJSON`/`loadFrom`).
- Tipo de nó (8.4): a normalização de `type` aparece repetida em `addStruct`, `toJSON` e `loadFrom`; mapear nomes de campo para `next`/`prev` físicos em `MicroRuntimeAdapter#_structFieldForAttr`/`getAttr`/`assignAttr`; portas em `MicroCanvasView` (inclusive modo simplificado) e `App#_findMicroPortAt`/`_microPortWorldPos`.

## Fechamento

- Docs: ARQUITETURA.md (tabela 5.1, referência por arquivo, receita se o gabarito mudou) e `CLAUDE.md` — skill `sincronizar-docs`.
- Verificação completa da skill `verificar-mudanca`, incluindo: criar à mão e por código, arrastar, apagar, duplo clique, botão direito, ligar ponteiro, Ctrl+A, N, tema claro/escuro, voltar/avançar passos, rodar de novo, salvar/carregar projeto.
