/**
 * Valores guardados "implicitamente" por uma chamada da pilha de recursão —
 * parâmetros e variáveis locais (ponteiros, variáveis, listas, dicts e
 * matrizes cujo NOME pertence ao frame, `frameId` no MicroModel). Usado no
 * pop-up ao passar o mouse sobre uma chamada (ver ui/CallTree.js): pra
 * chamada ainda na pilha é calculado do modelo do passo atual
 * (App#_callScope); pra chamada que já retornou, o interpretador tira uma
 * foto logo antes de desempilhar o frame (interpreter.js#callFunction, via
 * `env.frameScope`), porque depois disso o modelo já não a tem.
 *
 * Devolve `[{ name, text }]`, só texto pra exibição.
 */
const MAX_ITEMS = 8;

function fmt(v) {
  if (v === null || v === undefined) return 'None';
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'number') return String(v);
  if (Array.isArray(v?.items)) return `(${v.items.map(fmt).join(', ')})`; // tupla
  return String(v);
}

function fmtList(items, open = '[', close = ']') {
  const shown = items.slice(0, MAX_ITEMS).join(', ');
  return `${open}${shown}${items.length > MAX_ITEMS ? ', …' : ''}${close}`;
}

function arrayText(micro, array) {
  const items = array.cells.map((c) => {
    if (array.kind === 'ref') return c ? '•' : 'None';
    if (array.kind === 'arrayref') return micro.arrays.get(c) ? arrayText(micro, micro.arrays.get(c)) : 'None';
    return fmt(c);
  });
  return array.isSet ? fmtList(items, '{', '}') : fmtList(items);
}

function dictText(micro, dict) {
  const items = dict.cells.map((c) => {
    const val = c.kind === 'value' ? fmt(c.value) : c.kind === 'arrayref' && micro.arrays.get(c.value) ? arrayText(micro, micro.arrays.get(c.value)) : '•';
    return `${fmt(c.key)}: ${val}`;
  });
  return fmtList(items, '{', '}');
}

function matrixText(m) {
  return fmtList(m.cells.map((row) => fmtList(row.map(fmt))));
}

function targetText(micro, target) {
  if (!target) return 'None';
  switch (target.kind) {
    case 'struct':
      return '•';
    case 'array':
      return micro.arrays.get(target.id) ? arrayText(micro, micro.arrays.get(target.id)) : 'None';
    case 'dict':
      return micro.dicts.get(target.id) ? dictText(micro, micro.dicts.get(target.id)) : 'None';
    case 'matrix':
      return micro.matrices.get(target.id) ? matrixText(micro.matrices.get(target.id)) : 'None';
    case 'arrayCell': {
      const a = micro.arrays.get(target.arrayId);
      return a ? fmt(a.cells[target.index]) : 'None';
    }
    default:
      return '•';
  }
}

export function frameScope(micro, frameId) {
  const out = [];
  micro.variables.forEach((v) => {
    if ((v.frameId ?? 'global') === frameId) out.push({ name: v.name, text: fmt(v.value) });
  });
  micro.pointers.forEach((p) => {
    if ((p.frameId ?? 'global') !== frameId || p.isArrayLabel || p.readCursorKey) return;
    out.push({ name: p.label, text: targetText(micro, p.target) });
  });
  micro.arrays.forEach((a) => {
    if ((a.frameId ?? 'global') === frameId) out.push({ name: a.name, text: arrayText(micro, a) });
  });
  micro.dicts.forEach((d) => {
    if ((d.frameId ?? 'global') === frameId) out.push({ name: d.name, text: dictText(micro, d) });
  });
  micro.matrices.forEach((m) => {
    if ((m.frameId ?? 'global') === frameId) out.push({ name: m.name, text: matrixText(m) });
  });
  return out;
}
