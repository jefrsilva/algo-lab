---
name: sincronizar-docs
description: Atualiza docs/ARQUITETURA.md e CLAUDE.md para refletir uma mudança de código (novo built-in, elemento, ferramenta, configuração, atalho, arquivo, fluxo). Use ao final de qualquer mudança de arquitetura ou de comportamento visível, ou quando pedirem para revisar/atualizar a documentação.
---

# Sincronizar a documentação

O `CLAUDE.md` exige manter `docs/ARQUITETURA.md` em dia com a arquitetura; o próprio `CLAUDE.md` também descreve a DSL, os widgets e os atalhos em detalhe. Ambos estão em pt-BR (o `CLAUDE.md` em inglês com termos do app em pt-BR) — mantenha o idioma e o tom de cada um.

## Passos

1. Liste o que mudou: `git diff --stat` e `git diff` (ou o diff do branch contra o principal).
2. Para cada nome novo ou alterado (função, método, arquivo, atalho, configuração, comando), procure onde as docs falam do assunto:
   ```bash
   grep -n -i "<termo>" CLAUDE.md docs/ARQUITETURA.md
   ```
3. Atualize, conforme o tipo de mudança:

   | Mudança | `CLAUDE.md` | `docs/ARQUITETURA.md` |
   |---|---|---|
   | built-in / método / sintaxe da DSL | parágrafo "The DSL and its interpreter" | 7.4 e, se mudou o caminho, receitas 8.1–8.3 |
   | elemento do modelo / tipo de nó | "Core models", "Rendering layer" | tabela 5.1, 7.2–7.5, receita 8.4/8.5 se o gabarito mudou |
   | anotação / ferramenta / quick action | "UI widgets" | 5.6, 6.3, 7.2/7.6, receitas 8.6–8.8 |
   | configuração / atalho | `SettingsDialog` em "UI widgets" | 6.6, 7.6, receitas 8.9/8.10 |
   | arquivo novo | seção da pasta | mapa do repositório (3) e referência por arquivo (7) |
   | convenção/armadilha nova | "Things worth knowing" | seção 9 |

4. Se uma **receita** (seção 8) ficou errada ou incompleta pelo que você aprendeu fazendo a tarefa, corrija-a — e a skill correspondente em `.claude/skills/` também, se ela citar o mesmo detalhe.
5. Confira que nomes citados existem de fato: para cada identificador novo nas docs, `grep -rn "<nome>" src` deve achá-lo.

Não reescreva seções que não mudaram nem altere o estilo geral; mudanças pontuais.
