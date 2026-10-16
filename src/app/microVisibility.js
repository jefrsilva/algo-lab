// Visibilidade de identificadores (janela "Visibilidade" da barra do código e
// clique direito no código). Um identificador é um ponteiro (inclui o rótulo
// de array/dict e o cursor de leitura "nums[i]") ou uma variável; a escolha
// do usuário vale por NOME, em todos os passos (ver MicroProgramRunner#setHidden).

/** Chave estável do identificador: expressão do cursor de leitura, rótulo do
 * ponteiro ou nome da variável. */
export function identifierKey(node) {
  if (node.readCursorKey) return node.readCursorKey;
  return node.label ?? node.name;
}

function kindOf(node, isVariable) {
  if (isVariable) return 'variável';
  if (node.readCursorKey) return 'cursor';
  if (node.isArrayLabel || node.isDictLabel || node.isMatrixLabel) return 'coleção';
  return 'ponteiro';
}

/**
 * Lista os identificadores de uma série de modelos (o atual e o de cada passo
 * da Simulação), sem repetir chaves, em ordem alfabética.
 * `overrides` é o mapa chave -> oculto? do runner; sem override, vale o
 * `hidden` do primeiro elemento visto com aquela chave.
 */
export function collectIdentifiers(models, overrides = new Map()) {
  const found = new Map();
  const note = (node, isVariable) => {
    const key = identifierKey(node);
    if (key == null || key === '' || found.has(key)) return;
    const live = !!(node.hidden || node.readCursorHidden);
    found.set(key, { key, kind: kindOf(node, isVariable), hidden: overrides.has(key) ? overrides.get(key) : live });
  };
  models.forEach((m) => {
    m.pointers.forEach((n) => note(n, false));
    m.variables.forEach((n) => note(n, true));
  });
  return [...found.values()].sort((a, b) => a.key.localeCompare(b.key, 'pt-BR'));
}

/** Filtro da caixa de busca: trecho do nome, sem diferenciar maiúsculas. */
export function filterIdentifiers(items, query) {
  const q = query.trim().toLowerCase();
  return q ? items.filter((i) => i.key.toLowerCase().includes(q)) : items;
}
