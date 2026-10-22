# Algo-Lab

**[Experimente online: algo-lab.app](https://algo-lab.app/)** · [English](README.en.md)

Visualizador de estruturas de dados e algoritmos que roda inteiramente no navegador. Você escreve um programa em Python e acompanha, passo a passo, o que acontece na memória: nós, ponteiros, listas, dicionários e variáveis desenhados num canvas.

> **Status: beta (versão 1.0.0).** Veja as [limitações](#limitações) abaixo.

## Para que serve

O Algo-Lab nasceu como apoio didático para a gravação dos cursos de Coding Interview da [Alura](https://www.alura.com.br/) ([parte 1](https://www.alura.com.br/curso-online-coding-interviews-parte-1) e [parte 2](https://www.alura.com.br/curso-online-coding-interviews-parte-2)). A ideia é tornar visível o que normalmente fica só na cabeça de quem programa: para onde cada ponteiro aponta, como uma lista ligada muda a cada atribuição, como a recursão empilha e desempilha chamadas.

Foi desenvolvido e é mantido por [Jeferson Silva](https://www.linkedin.com/in/jefrsilva/), com apoio de IA, e está disponível como contribuição para a comunidade, para quem quiser usá-lo e modificá-lo, sob a licença GPL v3 ou posterior.

## O que dá para fazer

- **Montar o modelo de memória à mão** no canvas (nós, ponteiros, arrays, dicionários, variáveis) ou **escrevê-lo em código**: os dois ficam ligados, e o que o código cria aparece no canvas com o mesmo nome.
- **Sandbox:** executar uma linha de cada vez e ver o canvas mudar na hora.
- **Simulação:** rodar o programa inteiro e navegar por ele com play, passo a passo e voltar, com a linha atual destacada e o painel de chamadas acompanhando a recursão.
- **Anotar o canvas** com textos, áreas, setas, réguas e gráficos de complexidade (Big-O).
- **Tutoriais guiados** (☰ → Tutorial) e lista de atalhos de teclado (tecla `?`).

## Como rodar

Não quer instalar nada? Use em [algo-lab.app](https://algo-lab.app/). Para rodar localmente, é preciso do [Node.js](https://nodejs.org/) (a versão está em `.node-version`):

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # suíte de testes
npm run build   # gera dist/
```

Não há backend: tudo roda no navegador.

## Limitações

O Algo-Lab é uma ferramenta de apoio ao ensino, não um ambiente completo:

- **Só Python**, e apenas um subconjunto dele: não há classes, funções aninhadas nem `global`, e cada instrução ocupa uma linha lógica.
- **Não replica 100% o comportamento do Python.** Há diferenças conhecidas, registradas em `tests/dsl/bugs-conhecidos.test.js`.
- **Não visualiza todos os tipos de algoritmos e estruturas de dados**, só os que têm representação no modelo de memória da ferramenta.
- **Em beta:** podem existir bugs e a interface pode mudar.

Achou um problema ou quer sugerir algo? Abra uma [issue](../../issues).

## Documentação

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md): visão geral do código, fluxos e receitas para estender a ferramenta.
- [`tests/README.md`](tests/README.md): como escrever e rodar os testes.

## Licença

Distribuído sob a [GNU General Public License v3.0 ou posterior](LICENSE). Você pode usar, estudar, modificar e redistribuir a ferramenta, desde que as versões modificadas que você distribuir também sejam publicadas sob a GPL, com o código-fonte disponível. Assim, as melhorias voltam para a comunidade.

As fontes JetBrains Mono e Atkinson Hyperlegible Next, incluídas no site, são distribuídas sob a [SIL Open Font License 1.1](https://openfontlicense.org/).
