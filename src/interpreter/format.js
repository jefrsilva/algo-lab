/**
 * Especificador de formato de f-string ("{valor:spec}") — o subconjunto da
 * mini-linguagem de formatação do Python que faz sentido pros valores da
 * ferramenta (números, strings, bool):
 *
 *   [[preenchimento]alinhamento][sinal][#][0][largura][,|_][.precisão][tipo]
 *
 *   alinhamento: < (esquerda) > (direita) ^ (centro) = (sinal à esquerda,
 *                preenchimento entre o sinal e os dígitos)
 *   sinal:       + (sempre) - (só negativo, padrão) espaço (espaço nos positivos)
 *   tipo:        s (texto) · d (inteiro) · b o x X (base 2/8/16, "#" põe o
 *                prefixo 0b/0o/0x) · c (caractere) · f F (casas decimais fixas,
 *                6 por padrão) · e E (notação científica) · g G (geral) ·
 *                % (percentual)
 *
 * Sem distinção int/float no modelo (todo número é um `number` JS), um número
 * sem tipo se comporta como inteiro ("d") quando é inteiro e como float
 * ("g"-ish, ou o texto de sempre sem precisão) quando não é.
 *
 * `formatWithSpec` lança `FormatError` com uma mensagem legível quando o spec
 * é inválido ou não se aplica ao valor — quem chama (evaluator.js) repassa
 * pro console como aviso.
 */

export class FormatError extends Error {}

const SPEC_RE = /^(?:(.)?([<>=^]))?([+\- ])?(#)?(0)?(\d+)?([,_])?(?:\.(\d+))?([bcdeEfFgGosxX%])?$/;

function parseSpec(spec) {
  const m = SPEC_RE.exec(spec);
  if (!m) throw new FormatError(`Formato inválido: "${spec}"`);
  const [, fill, align, sign, alt, zero, width, grouping, precision, type] = m;
  return {
    fill: fill ?? (zero && !align ? '0' : ' '),
    align: align ?? (zero ? '=' : null),
    sign: sign ?? '-',
    alt: !!alt,
    width: width ? Number(width) : 0,
    grouping: grouping ?? null,
    precision: precision != null ? Number(precision) : null,
    type: type ?? null,
  };
}

/** Separador de milhar ("," ou "_") na parte inteira de `digits` (só
 * dígitos, sem sinal); `every` = 3 (decimal) ou 4 (b/o/x com "_"). */
function group(digits, sep, every = 3) {
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % every === 0) out += sep;
    out += digits[i];
  }
  return out;
}

/** Aplica largura/alinhamento. `prefix` (sinal e/ou 0x) fica colado à
 * esquerda no alinhamento "=". */
function pad(prefix, body, s, defaultAlign) {
  const len = prefix.length + body.length;
  if (s.width <= len) return prefix + body;
  const fill = s.fill.repeat(s.width - len);
  const align = s.align ?? defaultAlign;
  if (align === '<') return prefix + body + fill;
  if (align === '=') return prefix + fill + body;
  if (align === '^') {
    const left = Math.floor(fill.length / 2);
    return fill.slice(0, left) + prefix + body + fill.slice(left);
  }
  return fill + prefix + body;
}

/** Expoente com pelo menos 2 dígitos, igual Python ("1e+05", não "1e+5"). */
function pyExponential(n, digits) {
  return n.toExponential(digits).replace(/e([+-])(\d)$/, 'e$10$2');
}

/** Tipo "g": fixo ou científico conforme o expoente, sem zeros à direita
 * (a menos que "#"). */
function generalFormat(n, precision, alt) {
  const p = precision === 0 ? 1 : precision ?? 6;
  if (n === 0) return alt ? `0.${'0'.repeat(p - 1)}` : '0';
  const exp = Number(n.toExponential(p - 1).split('e')[1]);
  let out;
  if (exp >= -4 && exp < p) {
    out = n.toFixed(Math.max(0, p - 1 - exp));
    if (!alt && out.includes('.')) out = out.replace(/\.?0+$/, '');
  } else {
    out = pyExponential(n, p - 1);
    if (!alt) out = out.replace(/\.?0+e/, 'e');
  }
  return out;
}

function formatNumber(n, s) {
  const type = s.type ?? (Number.isInteger(n) && s.precision == null ? 'd' : null);
  const abs = Math.abs(n);
  let prefix = n < 0 ? '-' : s.sign === '+' ? '+' : s.sign === ' ' ? ' ' : '';
  let body;

  if (!Number.isFinite(n)) {
    body = Number.isNaN(n) ? 'nan' : 'inf';
    if (type === 'F' || type === 'E' || type === 'G') body = body.toUpperCase();
    return pad(prefix, body, s, '>');
  }

  const needsInt = (t) => {
    if (!Number.isInteger(n)) throw new FormatError(`Formato "${t}" exige um número inteiro (recebeu ${n})`);
  };

  switch (type) {
    case 'd':
      needsInt('d');
      body = String(abs);
      if (s.grouping) body = group(body, s.grouping);
      break;
    case 'b':
    case 'o':
    case 'x':
    case 'X': {
      needsInt(type);
      const base = { b: 2, o: 8, x: 16, X: 16 }[type];
      body = abs.toString(base);
      if (type === 'X') body = body.toUpperCase();
      if (s.grouping === '_') body = group(body, '_', 4);
      else if (s.grouping) throw new FormatError(`Formato "," não se aplica ao tipo "${type}"`);
      if (s.alt) prefix += type === 'X' ? '0X' : `0${type}`;
      break;
    }
    case 'c':
      needsInt('c');
      return pad('', String.fromCodePoint(n), s, '<');
    case 'f':
    case 'F':
    case '%': {
      const value = type === '%' ? abs * 100 : abs;
      body = value.toFixed(s.precision ?? 6);
      if (s.alt && !body.includes('.')) body += '.';
      if (s.grouping) {
        const [int, frac] = body.split('.');
        body = group(int, s.grouping) + (frac != null ? `.${frac}` : '');
      }
      if (type === '%') body += '%';
      break;
    }
    case 'e':
    case 'E':
      body = pyExponential(abs, s.precision ?? 6);
      if (type === 'E') body = body.toUpperCase();
      break;
    case 'g':
    case 'G':
      body = generalFormat(abs, s.precision, s.alt);
      if (type === 'G') body = body.toUpperCase();
      break;
    case 's':
      throw new FormatError('Formato "s" é só pra texto — use "d" ou "f" pra números');
    default:
      // sem tipo, número não inteiro (ou com precisão)
      body = s.precision != null ? generalFormat(abs, s.precision, s.alt) : String(abs);
      break;
  }
  return pad(prefix, body, s, '>');
}

function formatText(text, s) {
  if (s.type && s.type !== 's') throw new FormatError(`Formato "${s.type}" não se aplica a texto`);
  if (s.sign !== '-' || s.grouping || s.alt) throw new FormatError('Sinal, "#" e separador de milhar não se aplicam a texto');
  if (s.align === '=') throw new FormatError('Alinhamento "=" não se aplica a texto');
  const body = s.precision != null ? text.slice(0, s.precision) : text;
  return pad('', body, s, '<');
}

/**
 * Formata um valor tipado (ver evaluator.js) segundo `spec` (texto já
 * resolvido, sem o ":"). `plainText` é o texto "de sempre" do valor (o mesmo
 * do print), usado com spec vazio. Lança FormatError.
 */
export function formatWithSpec(value, spec, plainText) {
  if (spec === '') return plainText;
  const s = parseSpec(spec);
  if (value.kind === 'scalar') return formatNumber(value.value, s);
  // bool em Python é int: com qualquer spec não vazio vira 1/0
  if (value.kind === 'bool') return formatNumber(value.value ? 1 : 0, s);
  if (value.kind === 'string') return formatText(value.value, s);
  throw new FormatError(`Formato "${spec}" não se aplica a esse valor (${plainText})`);
}

/** Só alinhamento/largura sobre um texto já pronto — pra "{x!r:>10}" (a
 * conversão transforma o valor em texto antes de aplicar o spec, igual
 * Python). */
export function formatTextWithSpec(text, spec) {
  if (spec === '') return text;
  return formatText(text, parseSpec(spec));
}
