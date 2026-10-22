/**
 * Roteiros dos tutoriais guiados (ver Tutorial.js pra como um passo é
 * desenhado): `target` é o seletor CSS da parte da tela destacada (null =
 * popup centralizado; alvo escondido também cai no centro) e `placement`
 * onde o popup fica em relação a ele ('left' | 'right' | 'center').
 * Cada texto do `body` é um parágrafo; `{ code }` é um trecho de código.
 *
 * `como-comecar` é o tutorial de primeira visita (abre sozinho, ver
 * App#_startTutorial); os demais são cenários — algoritmos pequenos feitos
 * do começo ao fim — que só abrem pelo menu ☰ → Tutorial. Se uma tela mudar
 * (seletor, atalho, nome de botão), mude o texto daqui também.
 */
const COMO_COMECAR = [
  {
    title: 'Bem-vindo(a) ao Algo-Lab!',
    target: null,
    body: [
      'Esta ferramenta mostra, passo a passo, o que acontece na memória quando um programa roda: nós, ponteiros, listas, dicionários e variáveis.',
      'Em três passos rápidos você vê como criar elementos no canvas, escrever código no Sandbox e simular a execução. Depois, os cenários do menu ☰ → Tutorial mostram algoritmos completos.',
    ],
  },
  {
    title: '1. Criar elementos no canvas',
    target: '.micro-container',
    placement: 'center',
    body: [
      'Tudo aparece aqui no canvas. Para criar um elemento, aperte Ctrl+Espaço e digite um comando, como new node, new pointer ou new array — Enter cria no centro da vista.',
      'Os mesmos comandos estão em ☰ → Ações rápidas. A barra de baixo traz as ferramentas: selecionar/mover (1), texto (2), área (3), gráfico Big-O (4) e ligar nós (5).',
      'Dê um duplo clique num elemento para editar o valor ou o nome dele; Delete remove.',
    ],
  },
  {
    title: '2. Escrever e executar código no Sandbox',
    target: '.code-editor-panel',
    placement: 'left',
    body: [
      'Aqui fica o código. No modo Sandbox, Ctrl+Enter executa só a linha do cursor — e o canvas muda na hora. Experimente digitar:',
      { code: 'p = Node(10)\nq = Node(20)\np.next = q' },
      'Código e canvas estão ligados: o que o código cria aparece no canvas com o mesmo nome, e clicar num nome no código seleciona o elemento correspondente no canvas.',
    ],
  },
  {
    title: '3. Simular a execução',
    target: '.code-editor-toolbar',
    placement: 'left',
    body: [
      'Troque para Simulação para rodar o programa inteiro. Escreva o código e clique no botão verde de rodar, o triângulo ▶ da barra do código (ou use Ctrl+Shift+Enter).',
      'Aparece uma barra de reprodução: avance e volte passo a passo, ou dê play. A cada passo o canvas mostra o estado da memória naquele ponto — e o painel de chamadas acompanha a recursão.',
    ],
  },
  {
    title: 'Pronto!',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'É só isso para começar. Para rever este tutorial quando quiser, abra o menu ☰ → Tutorial → Como começar. Lá também há cenários guiados com algoritmos simples.',
    ],
  },
];

const SOMAR_LISTA = [
  {
    title: 'Somar os números de uma lista',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'Neste cenário você escreve um programa que soma os 5 números de uma lista e o acompanha na Simulação, passo a passo.',
      'Para começar de um canvas limpo, use ☰ → Novo projeto. Depois clique em Próximo.',
    ],
  },
  {
    title: '1. Escreva o código',
    target: '.code-editor-panel',
    placement: 'left',
    body: [
      'Clique no editor de código e escreva (ou cole) o programa abaixo. A lista tem 5 elementos; o for percorre cada posição e acumula o valor em total.',
      { code: 'nums = [3, 1, 4, 1, 5]\ntotal = 0\nfor i in range(len(nums)):\n    total += nums[i]\nprint(total)' },
    ],
  },
  {
    title: '2. Mude para a Simulação',
    target: '.code-editor-toolbar',
    placement: 'left',
    body: [
      'No Sandbox, Ctrl+Enter executa uma linha por vez. Para rodar o programa inteiro e poder acompanhá-lo, clique em Simulação, no alto do painel de código.',
      'Aparece um botão verde ▶ ao lado dele: clique para rodar o programa (ou use Ctrl+Enter, que na Simulação roda tudo).',
    ],
  },
  {
    title: '3. Acompanhe passo a passo',
    target: '.micro-run-bar',
    placement: 'left',
    body: [
      'Agora há uma barra de reprodução. O botão azul ▶ dá play (reproduz sozinho; vira ⏸ para pausar). Os botões com uma barra andam UM passo: |◀ volta e ▶| avança (atalhos Ctrl+, e Ctrl+.). Os de duas setas pulam para o começo (|◀◀) ou o fim (▶▶|). A velocidade também é ajustável.',
      'A cada passo a linha atual fica destacada no código, a lista aparece no canvas, a variável total vai crescendo e o resultado (14) sai no console.',
    ],
  },
  {
    title: '4. Mude as cores',
    target: '.micro-container',
    placement: 'center',
    body: [
      'Para destacar elementos, clique em um deles (por exemplo, a lista nums ou a variável total) para selecioná-lo e aperte Alt+1 … Alt+9 para escolher uma cor; Alt+0 tira a cor.',
      'Prefere ver as opções? Segure Ctrl+Shift: uma roda de cores aparece em volta do mouse. Aponte para a cor desejada e solte as teclas (soltar no centro cancela).',
    ],
  },
  {
    title: 'Cenário concluído',
    target: null,
    body: [
      'Você escreveu um programa, rodou a simulação e acompanhou cada passo. Experimente trocar os números da lista, ou somar só os pares com um if.',
      'Outros cenários estão em ☰ → Tutorial.',
    ],
  },
];

const LISTA_LIGADA = [
  {
    title: 'Lista ligada: canvas + código',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'Neste cenário você monta uma lista ligada de 2 nós direto no canvas e depois usa o Sandbox para inserir um terceiro nó no início dela.',
      'Para começar de um canvas limpo, use ☰ → Novo projeto. Depois clique em Próximo.',
    ],
  },
  {
    title: '1. Crie dois nós',
    target: '.micro-container',
    placement: 'center',
    body: [
      'Aperte Ctrl+Espaço, digite new node e Enter. O nó nasce no centro e pede o valor: digite 10 e Enter. Repita para um segundo nó, com valor 20.',
      'Se algum ficar em cima do outro, arraste-o para o lado.',
    ],
  },
  {
    title: '2. Ligue os nós',
    target: '.mode-toolbar',
    placement: 'right',
    body: [
      'Escolha a ferramenta Ligar nós (tecla 5 ou L). Clique na metade direita do nó 10 (o ponteiro next) e depois no nó 20: aparece uma seta ligando os dois. Clicar de novo no mesmo par desfaz a ligação.',
      'Volte para Selecionar com a tecla 1 ou V.',
    ],
  },
  {
    title: '3. Crie o ponteiro head',
    target: '.micro-container',
    placement: 'center',
    body: [
      'Ctrl+Espaço, new pointer, e dê o nome head. Depois arraste a ponta do ponteiro até o nó 10, para que head aponte para o início da lista.',
      'Pronto: tudo isso foi feito só no canvas, sem escrever código.',
    ],
  },
  {
    title: '4. Mexa na lista pelo código',
    target: '.code-editor-panel',
    placement: 'left',
    body: [
      'Confira que o editor está no modo Sandbox. Digite as linhas abaixo, apertando Ctrl+Enter em cada uma:',
      { code: 'novo = Node(5)\nnovo.next = head\nhead = novo' },
      'A primeira cria um nó com 5; a segunda faz o novo nó apontar para o antigo início; a terceira move head para o novo nó.',
    ],
  },
  {
    title: '5. Veja o resultado',
    target: '.micro-container',
    placement: 'center',
    body: [
      'O canvas mudou a cada linha: o nó 5 apareceu, ganhou uma seta para o 10, e o ponteiro head passou a apontar para ele. A lista agora tem 3 nós: 5 → 10 → 20.',
      'Isso é a ligação entre as duas partes: o que você cria no canvas (head, os nós) é o que o código enxerga pelos mesmos nomes, e o que o código faz aparece no canvas. Clique em um nome no código para selecionar o elemento no canvas.',
    ],
  },
];

const SIMULACAO_POSICOES = [
  {
    title: 'Simulação e posição dos elementos',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'Neste cenário você vê que a Simulação lembra onde você colocou cada elemento em cada passo — e usa isso para montar uma animação, arrumando o desenho à mão.',
      'Para começar de um canvas limpo, use ☰ → Novo projeto. Depois clique em Próximo.',
    ],
  },
  {
    title: '1. Escreva e rode o programa',
    target: '.code-editor-panel',
    placement: 'left',
    body: [
      'Clique em Simulação, escreva o código abaixo (ele monta uma lista de 3 nós) e rode com o botão verde ▶ da barra do código.',
      { code: 'a = Node(1)\nb = Node(2)\na.next = b\nc = Node(3)\nb.next = c' },
    ],
  },
  {
    title: '2. Arrume os elementos passo a passo',
    target: '.micro-run-bar',
    placement: 'left',
    body: [
      'Volte ao primeiro passo (|◀◀). Com o nó a na tela, arraste-o para onde quiser. Avance um passo (▶| ou Ctrl+.): o nó b aparece — arraste-o para o lado de a. Continue, posicionando c quando ele surgir.',
      'Arrastar durante a Simulação grava a posição daquele elemento a partir do passo atual.',
    ],
  },
  {
    title: '3. Navegue e confira',
    target: '.micro-run-bar',
    placement: 'left',
    body: [
      'Ande para frente e para trás pelos passos: cada elemento aparece na posição que você deu a ele em cada momento, e voltar um passo não "puxa" nada de volta. Se você mexeu em um nó no meio da execução, antes desse passo ele continua onde estava.',
      'O que fica guardado são só as posições: a lógica de cada passo (valores, ponteiros) continua vindo do programa.',
    ],
  },
  {
    title: '4. Guarde a animação',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'As posições que você deu em cada passo são salvas junto com o projeto (☰ → Salvar projeto) e voltam ao carregá-lo: você monta a animação uma vez e a reproduz quantas vezes quiser, por exemplo ao gravar uma aula.',
      'Para esquecer as posições lembradas e começar o desenho de novo, use o botão de resetar o estado visual, na barra do painel de código.',
    ],
  },
  {
    title: 'Cenário concluído',
    target: null,
    body: ['Agora você sabe como a Simulação guarda o desenho de cada passo. Experimente com outros programas, como inserir nós numa lista ou percorrer um array.'],
  },
];

const RECURSAO = [
  {
    title: 'Recursão e o painel de chamadas',
    target: '.canvas-top-left-controls',
    placement: 'right',
    body: [
      'Neste cenário você roda uma função recursiva pequena — o Fibonacci de 3 — e usa o painel de chamadas para ver a árvore de recursão, o que cada chamada guarda e o que ela retornou.',
      'Para começar de um canvas limpo, use ☰ → Novo projeto. Depois clique em Próximo.',
    ],
  },
  {
    title: '1. Escreva a função',
    target: '.code-editor-panel',
    placement: 'left',
    body: [
      'Clique em Simulação (o painel de chamadas só existe nela) e escreva o código abaixo. fib(n) devolve n quando n < 2 (caso base); senão soma o resultado de duas chamadas a si mesma.',
      { code: 'def fib(n):\n    if n < 2:\n        return n\n    return fib(n - 1) + fib(n - 2)\n\nprint(fib(3))' },
      'Rode com o botão verde ▶ da barra do código.',
    ],
  },
  {
    title: '2. A árvore de recursão',
    target: '.call-tree-panel',
    placement: 'left',
    body: [
      'Surgiu o painel "Chamadas", entre o canvas e o código. Cada linha é uma chamada de função; as que estão recuadas foram feitas pela linha de cima — por isso ele desenha a árvore de recursão.',
      'Avance passo a passo (▶| ou Ctrl+.) e veja a árvore crescer: fib(3) chama fib(2), que chama fib(1) e fib(0); depois fib(3) chama fib(1). Ela só cresce: voltar um passo não apaga chamadas já feitas.',
      'A chamada ativa naquele passo e as que a chamaram (a pilha de verdade) ficam destacadas.',
    ],
  },
  {
    title: '3. O que cada chamada retornou',
    target: '.call-tree-panel',
    placement: 'left',
    body: [
      'Quando uma chamada termina, o painel mostra o valor devolvido ao lado dela: fib(1) → 1, fib(0) → 0, fib(2) → 1 e, no fim, fib(3) → 2. Vá para o último passo (▶▶|) para ver todos de uma vez.',
      'O 2 final é o que o print escreve no console.',
    ],
  },
  {
    title: '4. O escopo de cada chamada',
    target: '.call-tree-panel',
    placement: 'left',
    body: [
      'Passe o mouse sobre uma chamada: um balão mostra os parâmetros e as variáveis locais dela (por exemplo, n = 2 em fib(2)) — mesmo as que já retornaram.',
      'Clique em uma chamada para ver o escopo dela no canvas: aparecem as variáveis daquela chamada, e o que está fora do escopo fica esmaecido (o botão ◐ do painel liga e desliga esse esmaecimento).',
    ],
  },
  {
    title: 'Cenário concluído',
    target: '.call-tree-panel',
    placement: 'left',
    body: [
      'O botão ⇤ do painel o deixa reduzido (uma bolinha por chamada, útil em recursões fundas) e ✕ o oculta; para reabri-lo, use o botão de pilha na barra do código.',
      'Experimente trocar para fib(4) e veja a árvore crescer — ou um fatorial, que gera uma árvore em fila.',
    ],
  },
];

export const TUTORIALS = [
  { id: 'como-comecar', label: 'Como começar', steps: COMO_COMECAR },
  { id: 'somar-lista', label: 'Cenário 1: somar os números de uma lista', steps: SOMAR_LISTA },
  { id: 'lista-ligada', label: 'Cenário 2: lista ligada no canvas e no código', steps: LISTA_LIGADA },
  { id: 'simulacao-posicoes', label: 'Cenário 3: simulação e posição dos elementos', steps: SIMULACAO_POSICOES },
  { id: 'recursao', label: 'Cenário 4: recursão e o painel de chamadas', steps: RECURSAO },
];
