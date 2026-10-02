/**
 * Programas-exemplo pré-carregados no editor de código do modo "Executar" do
 * macro (ver App.js#_runMacroCode) — o usuário roda direto ou edita antes de
 * rodar. Escritos na mesma linguagem do interpretador usada no modo micro
 * (ver src/interpreter/), operando sobre a estrutura via `inicio` (nó
 * inicial, já resolvido antes da primeira linha) e `atual.vizinhos` (ver
 * MacroRuntimeAdapter#getAttr).
 *
 * A checagem "já visitei esse nó?" é feita com um `for item in visitados:`
 * comum (arrays não são valores de primeira classe nesta linguagem — não dá
 * pra passar `visitados` como argumento de uma função helper, só iterar pelo
 * NOME direto), acumulando num booleano — sem "break" na linguagem, o laço
 * sempre roda até o fim, mas o resultado é o mesmo.
 */

export const BFS_PROGRAM = `fila = []
fila.append(inicio)
visitados = []
visitados.append(inicio)
marcar_visitado(inicio)

while len(fila) > 0:
    atual = fila.pop(0)
    marcar_atual(atual)
    for vizinho in atual.vizinhos:
        ja_visitado = False
        for item in visitados:
            if item == vizinho:
                ja_visitado = True
        if not ja_visitado:
            visitados.append(vizinho)
            marcar_visitado(vizinho)
            fila.append(vizinho)
`;

export const DFS_PROGRAM = `pilha = []
pilha.append(inicio)
visitados = []

while len(pilha) > 0:
    atual = pilha.pop()
    ja_visitado = False
    for item in visitados:
        if item == atual:
            ja_visitado = True
    if not ja_visitado:
        visitados.append(atual)
        marcar_atual(atual)
        marcar_visitado(atual)
        for vizinho in atual.vizinhos:
            ja_visitado_vizinho = False
            for item in visitados:
                if item == vizinho:
                    ja_visitado_vizinho = True
            if not ja_visitado_vizinho:
                pilha.append(vizinho)
`;

export const MACRO_EXAMPLES = {
  bfs: { program: BFS_PROGRAM, auxName: 'fila' },
  dfs: { program: DFS_PROGRAM, auxName: 'pilha' },
};
