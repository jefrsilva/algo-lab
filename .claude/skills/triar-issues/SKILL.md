---
name: triar-issues
description: Verifica as issues abertas do repositório no GitHub, prioriza bugs e, para cada issue, lê o código envolvido e abre uma tarefa paralela com um prompt independente (ou resolve na própria sessão, se pedirem). Use quando pedirem para verificar/triar as issues, ver o que está pendente no GitHub, ou abrir tarefas para resolver as issues.
---

# Triar as issues abertas

O objetivo é transformar cada issue aberta em uma tarefa que outra sessão consiga resolver **sem esta conversa**: com os arquivos de partida, as armadilhas e o que conta como "pronto". Copiar o texto da issue não basta: leia o código antes de escrever o prompt.

## 1. Listar as issues abertas

Repositório: o `origin` deste checkout (`git remote get-url origin`, hoje `jefrsilva/algo-lab`). Use o que a sessão tiver:

- **Ferramentas MCP do GitHub** (sessões na nuvem): `list_issues` com `state: OPEN` e os campos `number`, `title`, `body`, `labels`, `assignees`, `created_at`. Se não estiverem carregadas, carregue com ToolSearch (`select:mcp__github__list_issues,mcp__github__issue_read`).
- **`gh` CLI** (terminal local): `gh issue list --state open --json number,title,body,labels,assignees,createdAt --limit 100`.

Se nenhum dos dois funcionar, diga ao usuário o que falta (autenticar o `gh` ou conectar o GitHub) e pare. Não invente issues.

Para cada issue, leia também os comentários (`issue_read` com `get_comments` / `gh issue view N --comments`): muitas vezes o comentário muda o escopo.

## 2. Filtrar e priorizar

Deixe de fora, citando no relatório final:

- issues com PR aberto que as resolve (procure PRs abertos que citem `#N` ou cujo `closed_by_pull_requests` não esteja vazio);
- issues já atribuídas a alguém, a menos que o usuário peça para incluí-las;
- issues que, conferindo o código atual do `main`, já estão resolvidas: proponha fechá-las, mas não feche sem o usuário pedir.

Ordem de prioridade:

1. label `bug` (ou título/corpo descrevendo comportamento quebrado, erro, exceção);
2. as demais (`enhancement`, docs…);
3. dentro de cada grupo, a mais antiga primeiro.

## 3. Investigar cada issue no código

Antes de escrever o prompt, localize no código o que a issue envolve. Use `grep` com os termos da issue e consulte `CLAUDE.md` e `docs/ARQUITETURA.md`. Anote:

- **arquivos e métodos de partida** (caminhos relativos ao repositório, ex. `src/app/App.js#_quickNewSlidingWindow`);
- **armadilhas** que a sessão nova precisa saber: estado guardado por id × por chave estável (seção 5.5 do ARQUITETURA.md), snapshots da reprodução, dados que precisam ir para o projeto salvo, `Environment` × `MicroRuntimeAdapter`, etc.;
- **a skill do projeto que cobre o tipo de mudança**, pela tabela abaixo:

  | A issue pede… | Skill |
  |---|---|
  | função/método Python novo ou corrigido na DSL | `novo-builtin-dsl` |
  | sintaxe/statement novo na DSL | `nova-sintaxe-dsl` |
  | elemento do modelo / tipo de nó novo | `novo-elemento-modelo` |
  | anotação do canvas (label, área, gráfico) | `novo-elemento-anotacao` |
  | ferramenta da barra inferior | `nova-ferramenta` |
  | comando do Ctrl+Espaço | `nova-quick-action` |
  | preferência ou atalho de teclado | `nova-configuracao` |
  | menu de botão direito / popup | `novo-popup` |
  | dado que precisa sobreviver a salvar/carregar | `novo-campo-projeto` |

- para um **bug**: um jeito de reproduzir (programa da DSL para `node scripts/run-dsl.mjs`, ou passos na interface) e **onde fica o teste que o cobre** em `tests/` (ver a tabela de `tests/README.md`; um bug de DSL que difere do Python pode já estar em `tests/dsl/bugs-conhecidos.test.js` como `test.fails`). Tente reproduzir você mesmo quando for rápido: um bug que não se reproduz no `main` vira "provavelmente já resolvido" no relatório.

Se a issue for ambígua a ponto de duas leituras levarem a implementações diferentes, escreva as duas no prompt e peça que a sessão nova confirme com o usuário antes de implementar.

## 4. Abrir as tarefas

Para cada issue que sobrou, em ordem de prioridade, abra uma tarefa com `mcp__ccd_session__spawn_task` (o card "Suggested task" do app do Claude). Se a ferramenta não estiver disponível, lance subagentes (`Agent`) em paralelo com o mesmo prompt, um por issue, cada um em seu próprio worktree (`isolation: "worktree"`).

- **title**: verbo no imperativo, menos de 60 caracteres (ex. "Corrigir cor do colchete da sliding window").
- **tldr**: uma ou duas frases em linguagem simples, sem caminhos de arquivo.
- **prompt** (pt-BR), independente desta conversa:
  1. link e número da issue, label, e o texto dela (com os comentários relevantes);
  2. "Leia antes o CLAUDE.md e docs/ARQUITETURA.md";
  3. arquivos/métodos de partida e armadilhas (passo 3);
  4. a skill do projeto a seguir, se houver;
  5. para bug: como reproduzir, o comportamento esperado e o pedido de **primeiro escrever um teste que falha** no arquivo de `tests/` indicado (ou tirar o `test.fails` de `bugs-conhecidos.test.js`), depois corrigir;
  6. definição de pronto: `npm test` e o build passando e a verificação da skill `verificar-mudanca` (inclusive screenshot quando mexer na interface); docs atualizadas com `sincronizar-docs` se o comportamento documentado mudar; commit, push e um PR com `Resolve #N` na descrição — mensagem de commit, título e descrição do PR e comentários no GitHub em pt-BR. O CI (`.github/workflows/testes.yml`) roda `npm test` e o build em todo PR.

Uma tarefa por issue. Não junte issues num prompt só, a não ser que mexam no mesmo trecho de código e uma dependa da outra; nesse caso, diga isso no prompt.

Se o usuário pedir para **resolver aqui mesmo**, descarte a tarefa correspondente (`mcp__ccd_session__dismiss_task`) e siga o próprio prompt nesta sessão, num branch próprio.

## 5. Relatório

Responda ao usuário com:

- quantas issues abertas havia e quantas viraram tarefa, na ordem de prioridade (bugs primeiro), uma linha por issue com link;
- as que ficaram de fora e por quê (PR aberto, atribuída, já resolvida, ambígua);
- o que não deu para verificar (ex. bug que não consegui reproduzir).

Não comente nas issues nem mude labels, responsáveis ou estado sem o usuário pedir.
