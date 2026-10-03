// Organizar uma árvore binária de TreeNodes por níveis (botões "Árvore ↕" e
// "Árvore ↔" da TreeLayoutToolbar, que aparecem com um só TreeNode
// selecionado, e os comandos "layout tree …" do Ctrl+Espaço). Função pura
// sobre ids e uma função que dá os filhos de cada nó — quem lê o modelo
// (left/right moram nos campos físicos prev/next, ver
// MicroRuntimeAdapter#_structFieldForAttr) e aplica as posições é
// App#_runMicroTreeLayout.
//
// O arranjo é compacto, no espírito de Reingold–Tilford: cada subárvore é
// montada sozinha e guarda o seu contorno (a extensão ocupada em cada nível);
// ao juntar a subárvore esquerda e a direita sob o pai, elas se aproximam até
// o menor afastamento que deixa `siblingGap` de folga em TODOS os níveis que
// as duas têm em comum. O pai fica no meio dos dois filhos. Um filho único
// vai para o seu lado (esquerdo ou direito), no mesmo lugar em que estaria se
// tivesse irmão — assim a forma binária continua legível.

/** Folga entre caixas, por orientação e modo de desenho do nó (ver
 * App#_microElementRect): `siblingGap` entre vizinhos do mesmo nível,
 * `levelGap` entre um nível e o próximo. No modo detalhado as setas
 * left/right saem dos LADOS da caixa larga, então a folga entre níveis
 * precisa caber a seta descendo até o filho. */
export const TREE_GAPS = {
  vertical: {
    detailed: { siblingGap: 36, levelGap: 64 },
    simplified: { siblingGap: 28, levelGap: 48 },
  },
  horizontal: {
    detailed: { siblingGap: 32, levelGap: 72 },
    simplified: { siblingGap: 28, levelGap: 56 },
  },
};

/**
 * Posições dos nós da subárvore que começa em `rootId`, relativas à raiz.
 *
 * @param rootId id do nó que fica parado (a âncora).
 * @param childrenOf (id) => [leftId | null, rightId | null].
 * @param opts.orientation 'vertical' (níveis um abaixo do outro, esquerdo à
 *   esquerda) ou 'horizontal' (níveis lado a lado, da esquerda pra direita,
 *   esquerdo acima do direito).
 * @param opts.w, opts.h tamanho da caixa de cada nó (todos iguais).
 * @param opts.siblingGap folga entre caixas vizinhas do mesmo nível.
 * @param opts.levelGap folga entre um nível e o seguinte.
 * @returns Map<id, {dx, dy}> — deslocamento do canto de cada nó em relação
 *   ao canto da raiz (a raiz entra com {0, 0}). Um nó já visitado (ciclo, ou
 *   dois pais apontando pro mesmo filho) entra uma vez só: na segunda vez é
 *   tratado como filho ausente.
 */
export function treeLayout(rootId, childrenOf, { orientation = 'vertical', w, h, siblingGap, levelGap }) {
  const vertical = orientation !== 'horizontal';
  const breadth = vertical ? w : h; // tamanho no eixo em que os irmãos se espalham
  const step = (vertical ? h : w) + levelGap; // distância entre níveis
  const half = breadth / 2;
  const unit = breadth + siblingGap; // afastamento entre centros de dois irmãos folha
  const visited = new Set();

  // Monta a subárvore de `id`: {id, kids: [{sub, offset}], contour}, com
  // `contour[k] = [min, max]` = extensão ocupada no nível k (0 = o próprio
  // nó), relativa ao centro do nó.
  function build(id) {
    visited.add(id);
    const [leftId, rightId] = childrenOf(id) ?? [];
    const take = (c) => (c != null && !visited.has(c) ? build(c) : null);
    const left = take(leftId);
    const right = take(rightId);
    let dl = -unit / 2;
    let dr = unit / 2;
    if (left && right) {
      // menor d tal que, em todo nível comum, (right.min + d) - (left.max - d) >= siblingGap
      let d = unit / 2;
      const common = Math.min(left.contour.length, right.contour.length);
      for (let k = 0; k < common; k++) {
        d = Math.max(d, (siblingGap + left.contour[k][1] - right.contour[k][0]) / 2);
      }
      dl = -d;
      dr = d;
    }
    const kids = [];
    if (left) kids.push({ sub: left, offset: dl });
    if (right) kids.push({ sub: right, offset: dr });
    const contour = [[-half, half]];
    kids.forEach(({ sub, offset }) => {
      sub.contour.forEach(([lo, hi], k) => {
        const level = contour[k + 1];
        if (level) {
          level[0] = Math.min(level[0], lo + offset);
          level[1] = Math.max(level[1], hi + offset);
        } else {
          contour[k + 1] = [lo + offset, hi + offset];
        }
      });
    });
    return { id, kids, contour };
  }

  const out = new Map();
  if (rootId == null) return out;
  const place = (node, center, level) => {
    const along = level * step;
    out.set(node.id, vertical ? { dx: center, dy: along } : { dx: along, dy: center });
    node.kids.forEach(({ sub, offset }) => place(sub, center + offset, level + 1));
  };
  place(build(rootId), 0, 0);
  return out;
}
