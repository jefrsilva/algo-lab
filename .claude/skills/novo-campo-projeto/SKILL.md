---
name: novo-campo-projeto
description: Inclui um dado novo no arquivo de projeto salvo/carregado (_saveProject / _applyLoadedProject / _newProject e MicroModel#toJSON/loadFrom), com validação defensiva para arquivos antigos ou editados à mão. Use quando algo novo precisar sobreviver a salvar e carregar o projeto.
---

# Novo campo no arquivo de projeto

Fonte da verdade: receita **8.14** de `docs/ARQUITETURA.md` (e 6.5, fluxo de salvar/carregar).

## Decida onde o campo mora

- **Pertence ao modelo** (struct, ponteiro, array, dict, matriz, variável): `MicroModel#toJSON`/`loadFrom`.
- **Estado do App** (anotações, cores, janelas deslizantes, layout de passos…): direto no objeto do projeto em `App#_saveProject`.

## Passos

1. Salvar: `_saveProject` (ou `toJSON`). Só dados serializáveis; tuplas como `{tuple: [...]}`.
2. Carregar: `_applyLoadedProject` (ou `loadFrom`) com **validação defensiva** — o arquivo pode ser de uma versão anterior (campo ausente → padrão) ou editado à mão (tipo errado, ids inexistentes, números não finitos → descartar/clampar). Siga o estilo das validações vizinhas (ex.: filtro por `CHART_FUNCTIONS`, `Number.isFinite`). Tuplas passam por `reviveRaw`.
3. Limpar: `_newProject`.
4. Referências por id que precisam sobreviver a execuções usam chave estável (`microLayoutKey`, chave de cursor) — ids mudam a cada "Rodar".

## Verificação

Skill `verificar-mudanca`. No navegador: criar o estado, salvar, recarregar, carregar e conferir. Também carregar um projeto **sem** o campo (salvo antes da mudança, ou JSON editado removendo-o) e um com valor inválido — nenhum dos dois pode quebrar o carregamento. Para campos do modelo, `node scripts/run-dsl.mjs --model` mostra o `toJSON`.
