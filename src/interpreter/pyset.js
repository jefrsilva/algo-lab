/**
 * Set "de verdade", igual ao CPython 3.11 (Objects/setobject.c) — pra que a
 * ORDEM dos elementos (ao percorrer, imprimir ou desenhar o set) seja a
 * mesma do Python: a ordem das posições numa tabela hash, não a de inserção.
 *
 * Tabela: começa com 8 posições; cada elemento vai pra `hash & máscara` e,
 * se ocupada, procura as próximas (até 9 vizinhas de uma vez, quando cabem)
 * e depois salta (`i*5 + 1 + perturb`, com `perturb` consumindo os bits
 * altos do hash). Uma posição de elemento removido vira "dummy": a busca
 * passa por ela, e um "add" posterior pode reaproveitá-la. Cresce quando
 * 3/5 das posições já foram usadas (contando os dummies) — e crescer
 * reinsere tudo, então a ordem pode mudar inteira num "add". `pop()` tira a
 * partir de um "dedo" que avança.
 *
 * Hash: número usa o algoritmo exato do CPython (`_Py_HashDouble` — inteiro
 * n vira o próprio n, -1 vira -2), então sets de números saem IDÊNTICOS ao
 * Python. Texto, nó e None: no Python o hash é sorteado a cada execução
 * (texto) ou vem do endereço na memória (nó/None) — aqui, um hash
 * pseudoaleatório a partir de uma semente sorteada a cada "Rodar" (ver
 * MicroRuntimeAdapter#newHashSeed): ordem estável durante a execução, mas
 * diferente de uma execução pra outra, como no Python.
 *
 * Tudo aqui é puro (sem Environment/modelo): a tabela é
 * `{mask, fill, used, finger, slots}`, com cada posição `null` (vazia),
 * `DUMMY` (removida) ou `{hash: BigInt, value: TypedValue}`. Funções que
 * alteram a tabela mutam o objeto recebido — quem chama clona antes
 * (`cloneTable`) quando a original não pode mudar.
 */

const MINSIZE = 8;
const LINEAR_PROBES = 9;
const PERTURB_SHIFT = 5n;
const HASH_BITS = 61n;
const HASH_MODULUS = (1n << HASH_BITS) - 1n;
const u64 = (x) => BigInt.asUintN(64, x);
const DUMMY = 'dummy';

/** Tipos que podem ser elemento de set (os "hashable" do Python que a
 * ferramenta tem) — lista/dict dentro de set é erro em Python também.
 * Tupla só se todos os itens forem. */
export function isHashable(v) {
  if (v.kind === 'tuple') return v.items.every(isHashable);
  return v.kind === 'scalar' || v.kind === 'string' || v.kind === 'bool' || v.kind === 'struct' || v.kind === 'none';
}

/** Igualdade de elemento de set, igual Python: 1 == 1.0 == True (e 0 ==
 * False), então "{1, True}" é "{1}". */
export function setKeyEq(a, b) {
  const num = (v) => (v.kind === 'scalar' ? v.value : v.kind === 'bool' ? Number(v.value) : undefined);
  if (num(a) !== undefined && num(b) !== undefined) return num(a) === num(b);
  if (a.kind !== b.kind) return false;
  if (a.kind === 'string') return a.value === b.value;
  if (a.kind === 'tuple') return a.items.length === b.items.length && a.items.every((v, i) => setKeyEq(v, b.items[i]));
  if (a.kind === 'struct') return a.id === b.id;
  return a.kind === 'none';
}

// ---- hash ----

/** `hash(x)` de um número, igual `_Py_HashDouble`/`long_hash` do CPython
 * (inteiro n -> n módulo 2^61-1 com sinal; -1 -> -2). `null` pra NaN (no
 * Python o hash de NaN vem do endereço do objeto — quem chama sorteia). */
function hashNumber(v) {
  if (Number.isNaN(v)) return null;
  if (!Number.isFinite(v)) return v > 0 ? 314159n : -314159n;
  let x;
  const sign = v < 0 ? -1n : 1n;
  if (Number.isSafeInteger(v)) {
    x = BigInt(Math.abs(v)) % HASH_MODULUS;
  } else {
    // frexp: |v| = m * 2^e, com m em [0.5, 1) — escala de 2 em 2 (exata;
    // dividir por 2 ** e direto estoura pra Infinity perto do maior double)
    let m = Math.abs(v);
    let e = 0;
    while (m >= 1) {
      m /= 2;
      e += 1;
    }
    while (m < 0.5) {
      m *= 2;
      e -= 1;
    }
    x = 0n;
    while (m) {
      x = ((x << 28n) & HASH_MODULUS) | (x >> (HASH_BITS - 28n));
      m *= 268435456; // 2^28
      e -= 28;
      const y = Math.floor(m);
      m -= y;
      x += BigInt(y);
      if (x >= HASH_MODULUS) x -= HASH_MODULUS;
    }
    const bits = Number(HASH_BITS);
    const shift = BigInt(e >= 0 ? e % bits : bits - 1 - ((-1 - e) % bits));
    x = ((x << shift) & HASH_MODULUS) | (x >> (HASH_BITS - shift));
  }
  const h = sign * x;
  return h === -1n ? -2n : h;
}

/** Hash pseudoaleatório de 64 bits pra texto/nó/None — FNV-1a misturado
 * com a semente e finalizado com o misturador do splitmix64. */
function seededHash(text, seed) {
  let h = u64(0xcbf29ce484222325n ^ seed);
  for (let i = 0; i < text.length; i += 1) {
    h = u64((h ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  }
  h = u64((h ^ (h >> 30n)) * 0xbf58476d1ce4e5b9n);
  h = u64((h ^ (h >> 27n)) * 0x94d049bb133111ebn);
  h ^= h >> 31n;
  const signed = BigInt.asIntN(64, h);
  return signed === -1n ? -2n : signed;
}

const XXPRIME_1 = 11400714785074694791n;
const XXPRIME_2 = 14029467366897019727n;
const XXPRIME_5 = 2870177450012600261n;

/** `hash(tupla)`, igual `tuplehash` do CPython 3.8+ (variante do xxHash
 * sobre o hash de cada item, aritmética de 64 bits sem sinal) — então um set
 * de tuplas de números sai na MESMA ordem do Python. */
function hashTuple(items, seed) {
  let acc = XXPRIME_5;
  for (const it of items) {
    const lane = u64(pyHash(it, seed));
    acc = u64(acc + lane * XXPRIME_2);
    acc = u64((acc << 31n) | (acc >> 33n));
    acc = u64(acc * XXPRIME_1);
  }
  acc = u64(acc + (BigInt(items.length) ^ (XXPRIME_5 ^ 3527539n)));
  if (acc === u64(-1n)) return 1546275796n;
  return BigInt.asIntN(64, acc);
}

/** `hash(valor)` como o Python calcularia (ver cabeçalho). `seed` é um BigInt. */
export function pyHash(v, seed) {
  switch (v.kind) {
    case 'scalar':
      return hashNumber(v.value) ?? seededHash(`nan:${v.value}`, seed);
    case 'bool':
      return v.value ? 1n : 0n;
    case 'string':
      return v.value === '' ? 0n : seededHash(`s:${v.value}`, seed);
    case 'struct':
      return seededHash(`n:${v.id}`, seed);
    case 'tuple':
      return hashTuple(v.items, seed);
    default:
      return seededHash('None', seed);
  }
}

// ---- tabela ----

export function emptyTable() {
  return { mask: MINSIZE - 1, fill: 0, used: 0, finger: 0, slots: new Array(MINSIZE).fill(null) };
}

export function cloneTable(t) {
  return { ...t, slots: t.slots.slice() };
}

/** Elementos na ordem em que o Python os percorre: a das posições. */
export function tableValues(t) {
  return t.slots.filter((e) => e !== null && e !== DUMMY).map((e) => e.value);
}

/** `set_insert_clean` — só pra tabela recém-criada (sem dummies, sem repetidos). */
function insertClean(t, entry) {
  const mask = BigInt(t.mask);
  let i = u64(entry.hash) & mask;
  let perturb = u64(entry.hash);
  for (;;) {
    let idx = Number(i);
    if (t.slots[idx] === null) {
      t.slots[idx] = entry;
      return;
    }
    if (idx + LINEAR_PROBES <= t.mask) {
      for (let j = 0; j < LINEAR_PROBES; j += 1) {
        idx += 1;
        if (t.slots[idx] === null) {
          t.slots[idx] = entry;
          return;
        }
      }
    }
    perturb >>= PERTURB_SHIFT;
    i = u64(i * 5n + 1n + perturb) & mask;
  }
}

/** `set_table_resize` — menor potência de 2 (>= 8) maior que `minused`;
 * reinsere os elementos vivos na ordem das posições antigas. Continuar com
 * 8 posições sem dummies pra limpar não faz nada (igual o C). */
function resize(t, minused) {
  let size = MINSIZE;
  while (size <= minused) size *= 2;
  if (size === MINSIZE && t.mask === MINSIZE - 1 && t.fill === t.used) return;
  const old = t.slots;
  t.slots = new Array(size).fill(null);
  t.mask = size - 1;
  t.fill = t.used;
  old.forEach((e) => {
    if (e !== null && e !== DUMMY) insertClean(t, e);
  });
}

/** Posição do elemento igual a `value` (`found`) ou, se não está lá, da
 * primeira vazia na sequência de busca dele (`idx`) e do ÚLTIMO dummy visto
 * antes dela (`freeslot`, ou -1 — é o último mesmo, `freeslot = entry` no
 * C, não o primeiro) — `set_lookkey`/laço de `set_add_entry`. A busca
 * sempre vai até uma vazia (o elemento pode estar depois de um dummy). */
function lookup(t, value, hash) {
  const mask = BigInt(t.mask);
  let i = u64(hash) & mask;
  let perturb = u64(hash);
  let freeslot = -1;
  for (;;) {
    let idx = Number(i);
    let probes = idx + LINEAR_PROBES <= t.mask ? LINEAR_PROBES : 0;
    for (;;) {
      const e = t.slots[idx];
      if (e === null) return { idx, found: false, freeslot };
      if (e === DUMMY) {
        freeslot = idx;
      } else if (e.hash === hash && setKeyEq(e.value, value)) {
        return { idx, found: true, freeslot };
      }
      idx += 1;
      if (probes === 0) break;
      probes -= 1;
    }
    perturb >>= PERTURB_SHIFT;
    i = u64(i * 5n + 1n + perturb) & mask;
  }
}

/** `set_add_entry` — `true` se entrou (não estava lá). Reaproveita o
 * primeiro dummy da busca, se houver (sem contar em `fill`, sem crescer). */
export function tableInsert(t, value, hash) {
  const { idx, found, freeslot } = lookup(t, value, hash);
  if (found) return false;
  if (freeslot !== -1) {
    t.slots[freeslot] = { hash, value };
    t.used += 1;
    return true;
  }
  t.slots[idx] = { hash, value };
  t.fill += 1;
  t.used += 1;
  if (t.fill * 5 >= t.mask * 3) resize(t, t.used > 50000 ? t.used * 2 : t.used * 4);
  return true;
}

/** `set_discard_entry` — `true` se estava lá (a posição vira dummy). */
export function tableDiscard(t, value, hash) {
  const { idx, found } = lookup(t, value, hash);
  if (!found) return false;
  t.slots[idx] = DUMMY;
  t.used -= 1;
  return true;
}

/** `set_pop` — tira o elemento a partir do "dedo" (`finger`), que avança;
 * `undefined` se vazio. */
export function tablePop(t) {
  if (t.used === 0) return undefined;
  let idx = t.finger & t.mask;
  while (t.slots[idx] === null || t.slots[idx] === DUMMY) {
    idx += 1;
    if (idx > t.mask) idx = 0;
  }
  const { value } = t.slots[idx];
  t.slots[idx] = DUMMY;
  t.used -= 1;
  t.finger = idx + 1;
  return value;
}

/** `set_merge` — "s.update(outro_set)", usado por set(outro_set) e pelo
 * literal de constantes (ver `buildSetLiteral`). */
function merge(t, other) {
  if (other.used === 0) return;
  if ((t.fill + other.used) * 5 >= t.mask * 3) resize(t, (t.used + other.used) * 2);
  if (t.fill === 0 && t.mask === other.mask && other.fill === other.used) {
    other.slots.forEach((e, i) => {
      if (e !== null) t.slots[i] = e;
    });
    t.fill = other.fill;
    t.used = other.used;
    return;
  }
  if (t.fill === 0) {
    t.fill = other.used;
    t.used = other.used;
    other.slots.forEach((e) => {
      if (e !== null && e !== DUMMY) insertClean(t, e);
    });
    return;
  }
  other.slots.forEach((e) => {
    if (e !== null && e !== DUMMY) tableInsert(t, e.value, e.hash);
  });
}

/** Set novo com `items` inseridos um a um (set(lista), set(texto), add em
 * sequência). */
export function buildFromItems(items, seed) {
  const t = emptyTable();
  items.forEach((v) => tableInsert(t, v, pyHash(v, seed)));
  return t;
}

/** "set(outro_set)" — cópia via `set_merge`. */
export function buildFromTable(other) {
  const t = emptyTable();
  merge(t, other);
  return t;
}

/** "set(d)" com d um dict — o CPython reserva espaço pra todas as chaves
 * antes de inserir (uma tabela já maior, então outra ordem). */
export function buildFromDictKeys(keys, seed) {
  const t = emptyTable();
  if (keys.length * 5 >= t.mask * 3) resize(t, keys.length * 2);
  keys.forEach((v) => tableInsert(t, v, pyHash(v, seed)));
  return t;
}

/** Literal "{a, b, c}". O compilador do Python trata diferente o literal com
 * 3+ elementos TODOS constantes (números, textos, True/False/None): vira um
 * frozenset pronto que é copiado (`BUILD_SET 0` + `SET_UPDATE`) — o que
 * pode dar uma tabela de outro tamanho, e outra ordem, que inserir um a um
 * (`BUILD_SET n`). `allConstant` diz se é esse caso. O frozenset ainda é
 * reconstruído uma vez ao entrar nas constantes do código
 * (`merge_consts_recursive`: frozenset(tuple(frozenset(itens)))) — são
 * DOIS frozensets em sequência antes da cópia pro set. */
export function buildSetLiteral(items, allConstant, seed) {
  if (allConstant && items.length > 2) {
    const folded = buildFromItems(items, seed);
    const merged = buildFromItems(tableValues(folded), seed);
    return buildFromTable(merged);
  }
  return buildFromItems(items, seed);
}

// ---- guardar no modelo ----

/** Forma guardável da tabela (no array do set, ver MicroModel): a posição
 * de cada elemento, sem os valores — esses ficam nas células do array, na
 * mesma ordem das posições ocupadas. Hash como texto (BigInt não vai pra
 * JSON). Objeto novo a cada mudança (snapshots da reprodução compartilham
 * a referência antiga). */
export function serializeTable(t) {
  return {
    mask: t.mask,
    fill: t.fill,
    used: t.used,
    finger: t.finger,
    slots: t.slots.map((e) => (e === null ? null : e === DUMMY ? false : e.hash.toString())),
  };
}

/** Inverso de `serializeTable`, com os valores das células (já tipados, na
 * ordem das posições). `null` se a tabela guardada não bate com as células
 * — quantidade diferente, ou hash diferente do que o valor tem AGORA
 * (projeto carregado com outra semente, célula editada à mão no canvas) —
 * aí quem chama reconstrói a tabela a partir das células. */
export function deserializeTable(stored, values, seed) {
  if (!stored || !Array.isArray(stored.slots)) return null;
  const active = stored.slots.filter((s) => typeof s === 'string').length;
  if (active !== values.length || stored.used !== values.length) return null;
  let k = 0;
  const slots = [];
  for (const s of stored.slots) {
    if (s === null) slots.push(null);
    else if (s === false) slots.push(DUMMY);
    else {
      const value = values[k];
      k += 1;
      const hash = BigInt(s);
      if (pyHash(value, seed) !== hash) return null;
      slots.push({ hash, value });
    }
  }
  return { mask: stored.mask, fill: stored.fill, used: stored.used, finger: stored.finger ?? 0, slots };
}
