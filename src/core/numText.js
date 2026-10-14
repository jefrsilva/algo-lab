/** Texto de um valor de célula/print, no estilo do Python: `Infinity` vira
 * "inf" (e `-Infinity` "-inf", `NaN` "nan"); o resto fica como `String()`.
 * Único lugar que sabe disso — o JS escreveria "Infinity" no canvas e no
 * console. */
export function numText(v) {
  if (typeof v === 'number' && !Number.isFinite(v)) return Number.isNaN(v) ? 'nan' : v > 0 ? 'inf' : '-inf';
  return String(v);
}

/** `replacer`/`reviver` de JSON pro salvar/carregar projeto: o JSON não tem
 * Infinity/NaN (`JSON.stringify` os troca por null e o valor se perderia). */
export function jsonNumReplacer(_key, value) {
  return typeof value === 'number' && !Number.isFinite(value) ? { $num: numText(value) } : value;
}

export function jsonNumReviver(_key, value) {
  if (value && typeof value === 'object' && typeof value.$num === 'string') {
    if (value.$num === 'inf') return Infinity;
    if (value.$num === '-inf') return -Infinity;
    if (value.$num === 'nan') return NaN;
  }
  return value;
}
