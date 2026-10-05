/**
 * Chave estável (independente de id — que muda a cada execução/criação,
 * já que `nextId` nunca repete) usada por App#microLayout pra lembrar a
 * posição que o usuário escolheu pra um elemento do modo micro. Sobrevive a
 * apagar+recriar o elemento (rodar a linha de novo) e a uma reprodução
 * completa (modo "Executar", ver MicroProgramRunner — que só lembra posição
 * DENTRO de uma única corrida, por id) — App#microLayout é um mapa à parte,
 * nunca resetado entre corridas, só ao começar/carregar outro projeto.
 *
 * Cada "kind" usa a informação que IDENTIFICA aquele elemento de forma
 * estável entre execuções: nome (array/dict/variável/ponteiro) ou a chave
 * SIMBÓLICA de um cursor de leitura (ex: "nums[i]" — nunca o índice concreto,
 * que muda a cada passo, ver MicroRuntimeAdapter#_showReadCursor).
 *
 * `frameId` (pointer/variável) é reduzido a duas categorias (`global`/`call`)
 * — não o id exato da chamada, que é sorteado de novo a cada execução: um
 * parâmetro chamado "n" deve lembrar a MESMA posição em qualquer chamada
 * recursiva, não uma por chamada (só uma aba de cada vez fica visível, ver
 * App#_renderMicroOnly, então isso nunca causa duas coisas na mesma tela
 * disputando a mesma posição lembrada).
 *
 * Nó de struct anônimo (`Node(valor)`, sem nome próprio) FICA DE FORA de
 * propósito — a única chave estável possível seria a linha de código que o
 * criou, mas a mesma linha dentro de um loop cria VÁRIOS nós por corrida
 * (ex: "novo = Node(v)" construindo uma lista), e todos cairiam na mesma
 * posição lembrada, empilhados. Sem uma forma barata de diferenciar
 * ocorrências da mesma linha, structs continuam com o cascateamento de
 * sempre (`App#_findFreeMicroPosition`).
 */
export function microLayoutKey(kind, { name, frameId, cursorKey, dictName, key } = {}) {
  const scope = frameId === 'global' || frameId == null ? 'global' : 'call';
  switch (kind) {
    case 'pointer':
      return name ? `pointer:${scope}:${name}` : null;
    case 'variable':
      return name ? `variable:${scope}:${name}` : null;
    // array criado dentro de uma chamada (ex: "leftHalf = arr[:mid]" num
    // merge sort) existe UM POR CHAMADA, todos visíveis ao mesmo tempo (heap)
    // — uma posição lembrada por nome empilharia todos no mesmo lugar, então
    // ficam sem chave (cascateamento de sempre), igual struct anônimo.
    case 'array':
      return name && scope === 'global' ? `array:${name}` : null;
    // dict/matriz criados numa chamada: mesma regra de array
    case 'dict':
      return name && scope === 'global' ? `dict:${name}` : null;
    case 'array-label':
      return name && scope === 'global' ? `array-label:${name}` : null;
    case 'dict-label':
      return name && scope === 'global' ? `dict-label:${name}` : null;
    case 'matrix':
      return name && scope === 'global' ? `matrix:${name}` : null;
    case 'matrix-label':
      return name && scope === 'global' ? `matrix-label:${name}` : null;
    case 'cursor':
      return cursorKey ? `cursor:${cursorKey}` : null;
    case 'array-in-dict':
      return dictName && key != null ? `array-in-dict:${dictName}.${key}` : null;
    // lista dentro de uma lista de listas global ("res[0]"), pela posição
    case 'array-in-list':
      return name && key != null ? `array-in-list:${name}.${key}` : null;
    default:
      return null;
  }
}
