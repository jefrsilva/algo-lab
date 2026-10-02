/**
 * Tupla como valor CRU guardável no modelo — chave de dict ("d[(i, j)] =
 * 5"), valor de variável ("pos = (1, 2)"), de célula de dict ou de célula de
 * lista/set ("fila.append((i, j))", "visitados.add((i, j))"). O valor
 * tipado do avaliador é `{kind:'tuple', items: TypedValue[]}` (ver
 * evaluator.js#TupleValue); este módulo é a forma "congelada" dele, que
 * MicroModel guarda no lugar de um number/string/boolean.
 *
 * Só cabe aqui uma tupla de itens imutáveis: número, texto, bool, None ou
 * outra tupla dessas (o "hashable" do Python que a ferramenta consegue
 * guardar como valor cru). Tupla com nó/lista dentro continua existindo como
 * valor tipado durante a expressão, mas não vira chave nem variável.
 *
 * Cada tupla crua é INTERNADA: duas tuplas iguais são SEMPRE o mesmo objeto
 * JS. É o que deixa ela ser chave de `Map` (dict do avaliador, ver
 * evaluator.js#DictValue) e ser comparada com `===` nas células de dict do
 * modelo (MicroModel#setDictCellValue, `c.key === key`) sem mudar nada
 * nesses lugares. Igualdade segue o Python: 1 == 1.0 == True, então (1, 2)
 * e (True, 2) são a mesma chave (fica a grafia da primeira a ser criada —
 * no Python, um dict também mantém a chave que entrou primeiro).
 *
 * Imutável e sem estado além dos itens: snapshots da reprodução (ver
 * MicroProgramRunner#_snapshot) podem compartilhar a mesma instância.
 * `toJSON` deixa o projeto salvo como `{tuple: [...]}`; `reviveRaw` faz o
 * caminho de volta (ver MicroModel#loadFrom).
 */

export class PyTuple {
  constructor(items, canon) {
    this.items = Object.freeze(items);
    this.canon = canon;
    Object.freeze(this);
  }

  get length() {
    return this.items.length;
  }

  /** `repr()` do Python — "(1, 'a')", "(1,)", "()". É o texto exibido no
   * canvas (rótulo da chave, valor da variável), no print e em toda chave
   * de string montada com `${...}` (ver App.js, `dictCell:${id}:${key}`). */
  toString() {
    const parts = this.items.map(rawRepr);
    return parts.length === 1 ? `(${parts[0]},)` : `(${parts.join(', ')})`;
  }

  toJSON() {
    return { tuple: this.items };
  }
}

const registry = new Map(); // canon -> PyTuple

/** Texto canônico de um item cru — bool vira número, igual a igualdade do Python. */
function canonOf(raw) {
  if (raw instanceof PyTuple) return `t${raw.canon}`;
  if (raw === null) return 'N';
  if (typeof raw === 'boolean') return `n${Number(raw)}`;
  if (typeof raw === 'number') return `n${raw}`;
  return `s${JSON.stringify(raw)}`;
}

/** `repr()` de um item cru — texto entre aspas simples, igual
 * evaluator.js#pyStringRepr. */
export function rawRepr(raw) {
  if (raw === null) return 'None';
  if (typeof raw === 'boolean') return raw ? 'True' : 'False';
  if (typeof raw === 'string') return `'${raw.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
  return String(raw);
}

/** Tupla crua (internada) com esses itens crus — ver cabeçalho. */
export function makeTuple(rawItems) {
  const canon = `(${rawItems.map(canonOf).join(',')})`;
  let t = registry.get(canon);
  if (!t) {
    t = new PyTuple([...rawItems], canon);
    registry.set(canon, t);
  }
  return t;
}

/** Valor salvo (JSON) -> valor cru: `{tuple: [...]}` volta a ser uma
 * `PyTuple` (recursivamente); qualquer outra coisa volta intacta. Também
 * aceita uma `PyTuple` já pronta (cópia em memória, sem passar por JSON). */
export function reviveRaw(v) {
  if (v instanceof PyTuple) return v;
  if (v && typeof v === 'object' && Array.isArray(v.tuple)) return makeTuple(v.tuple.map(reviveRaw));
  return v;
}
