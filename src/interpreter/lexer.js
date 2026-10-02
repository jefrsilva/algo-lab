/**
 * Lexer de expressões/atribuições estilo Python — tokeniza UMA linha (o
 * modelo de execução da ferramenta é "Ctrl+Enter aplica esta linha", não um
 * programa inteiro). Produz uma lista de tokens com posição, para o parser
 * construir mensagens de erro úteis.
 *
 * Não é o mesmo tokenizer usado para colorir a sintaxe em CodeEditor.js — lá
 * o objetivo é só classificar trechos pra CSS; aqui é produzir uma stream
 * exata que o parser consegue consumir (inclui todos os operadores/pontuação
 * como tokens próprios, não como "resto sem classificação").
 */

export const TokenType = {
  NUMBER: 'NUMBER',
  STRING: 'STRING',
  FSTRING: 'FSTRING',
  IDENT: 'IDENT',
  NONE: 'NONE',
  TRUE: 'TRUE',
  FALSE: 'FALSE',
  AND: 'AND',
  OR: 'OR',
  NOT: 'NOT',
  IS: 'IS',
  DOT: 'DOT',
  LBRACKET: 'LBRACKET',
  RBRACKET: 'RBRACKET',
  LBRACE: 'LBRACE',
  RBRACE: 'RBRACE',
  LPAREN: 'LPAREN',
  RPAREN: 'RPAREN',
  COMMA: 'COMMA',
  ASSIGN: 'ASSIGN',
  PLUS: 'PLUS',
  MINUS: 'MINUS',
  STAR: 'STAR',
  DOUBLE_STAR: 'DOUBLE_STAR',
  SLASH: 'SLASH',
  DOUBLE_SLASH: 'DOUBLE_SLASH',
  PERCENT: 'PERCENT',
  COLON: 'COLON',
  IN: 'IN',
  EQ: 'EQ',
  NEQ: 'NEQ',
  LT: 'LT',
  LTE: 'LTE',
  GT: 'GT',
  GTE: 'GTE',
  PLUS_ASSIGN: 'PLUS_ASSIGN',
  MINUS_ASSIGN: 'MINUS_ASSIGN',
  STAR_ASSIGN: 'STAR_ASSIGN',
  SLASH_ASSIGN: 'SLASH_ASSIGN',
  DOUBLE_SLASH_ASSIGN: 'DOUBLE_SLASH_ASSIGN',
  EOF: 'EOF',
};

const KEYWORDS = {
  None: TokenType.NONE,
  True: TokenType.TRUE,
  False: TokenType.FALSE,
  and: TokenType.AND,
  or: TokenType.OR,
  not: TokenType.NOT,
  is: TokenType.IS,
  in: TokenType.IN,
};

const SINGLE_CHAR = {
  '.': TokenType.DOT,
  '[': TokenType.LBRACKET,
  ']': TokenType.RBRACKET,
  '{': TokenType.LBRACE,
  '}': TokenType.RBRACE,
  '(': TokenType.LPAREN,
  ')': TokenType.RPAREN,
  ',': TokenType.COMMA,
  '+': TokenType.PLUS,
  '-': TokenType.MINUS,
  '*': TokenType.STAR,
  '/': TokenType.SLASH,
  '%': TokenType.PERCENT,
  ':': TokenType.COLON,
};

const IDENT_START_RE = /[A-Za-z_]/;
const IDENT_RE = /[A-Za-z0-9_]/;
const DIGIT_RE = /[0-9]/;

export class LexError extends Error {
  constructor(message, at) {
    super(message);
    this.name = 'LexError';
    this.at = at;
  }
}

const ESCAPES = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"', '0': '\0' };

/** Pula uma string comum (sem prefixo f) que começa em `source[i]` (a aspa
 * de abertura) — usada pra achar o fim de uma expressão DENTRO de uma
 * f-string sem confundir aspas/chaves de uma string aninhada. Devolve o
 * índice logo depois da aspa de fechamento, ou -1 se não fechar. */
function skipString(source, i) {
  const quote = source[i];
  i += 1;
  while (i < source.length && source[i] !== quote) i += source[i] === '\\' ? 2 : 1;
  return i < source.length ? i + 1 : -1;
}

/**
 * Partes de uma f-string ("f'...'"), a partir de `i` (logo depois da aspa de
 * abertura) — ou, com `inSpec`, de um especificador de formato (o trecho
 * depois do ":" em "{valor:>8}"), que termina no "}" do campo (não consumido,
 * quem fecha o campo é `readFStringField`). Cada parte é um texto literal
 * (string JS, escapes já resolvidos; "{{"/"}}" viram "{"/"}") ou um campo
 * `{source, at, conv, spec, debug}` — `source` é o TEXTO da expressão (quem
 * transforma em AST é o parser, ver parser.js#parseFStringParts, pra não
 * trazer o parser pra dentro do lexer), `at` a posição dela na linha.
 */
function readFStringParts(source, i, quote, inSpec, openAt) {
  const parts = [];
  let text = '';
  const n = source.length;
  for (;;) {
    if (i >= n) {
      throw new LexError(inSpec ? 'f-string: faltou "}" fechando o campo' : 'String não terminada (faltou a aspa de fechamento)', openAt);
    }
    const c = source[i];
    if (inSpec && c === '}') break;
    if (c === quote) {
      if (inSpec) throw new LexError('f-string: faltou "}" fechando o campo', openAt);
      i += 1;
      break;
    }
    if (c === '\\' && !inSpec && i + 1 < n) {
      text += ESCAPES[source[i + 1]] ?? source[i + 1];
      i += 2;
      continue;
    }
    if (c === '{') {
      if (!inSpec && source[i + 1] === '{') {
        text += '{';
        i += 2;
        continue;
      }
      if (text) parts.push(text);
      text = '';
      const field = readFStringField(source, i + 1, quote);
      parts.push(field.part);
      i = field.end;
      continue;
    }
    if (c === '}') {
      if (source[i + 1] === '}') {
        text += '}';
        i += 2;
        continue;
      }
      throw new LexError('f-string: "}" sozinho — use "}}" para escrever um "}"', i);
    }
    text += c;
    i += 1;
  }
  if (text) parts.push(text);
  return { parts, end: i };
}

/** Um campo "{expressão(=)(!conv)(:spec)}" de f-string, a partir de `i`
 * (logo depois do "{"). A expressão termina no primeiro "}", "!" (que não
 * seja "!=") ou ":" fora de parênteses/colchetes/chaves e de strings
 * aninhadas — "{a[1:2]}" e "{d['x']}" funcionam. "{x=}" (Python 3.8+)
 * imprime o próprio texto da expressão antes do valor (`debug`). */
function readFStringField(source, i, quote) {
  const n = source.length;
  const openAt = i - 1;
  const exprStart = i;
  let depth = 0;
  for (;;) {
    if (i >= n) {
      throw new LexError('f-string: faltou "}" fechando o campo', openAt);
    }
    const c = source[i];
    if (c === '"' || c === "'") {
      const after = skipString(source, i);
      if (after === -1) throw new LexError('f-string: faltou "}" fechando o campo', openAt);
      i = after;
      continue;
    }
    if (c === '#') throw new LexError('f-string: "#" não é permitido dentro de "{...}"', i);
    if (c === '(' || c === '[' || c === '{') depth += 1;
    else if ((c === ')' || c === ']') && depth > 0) depth -= 1;
    else if (c === '}') {
      if (depth === 0) break;
      depth -= 1;
    } else if (depth === 0 && c === '!' && source[i + 1] !== '=') break;
    else if (depth === 0 && c === ':') break;
    i += 1;
  }

  const raw = source.slice(exprStart, i);
  let exprSource = raw;
  let debug = null;
  // "{x=}" / "{x = }" — "=" final que não faz parte de "==", "!=", "<=", ">="
  const trimmed = raw.trimEnd();
  if (trimmed.endsWith('=') && !/[=!<>]/.test(trimmed[trimmed.length - 2] ?? '')) {
    debug = raw;
    exprSource = trimmed.slice(0, -1);
  }
  if (!exprSource.trim()) throw new LexError('f-string: expressão vazia entre "{" e "}"', openAt);

  let conv = null;
  if (source[i] === '!') {
    conv = source[i + 1];
    if (conv !== 'r' && conv !== 's' && conv !== 'a') {
      throw new LexError('f-string: conversão inválida — use "!r", "!s" ou "!a"', i);
    }
    i += 2;
    if (source[i] !== ':' && source[i] !== '}') throw new LexError('f-string: esperado ":" ou "}" depois da conversão', i);
  }

  let spec = null;
  if (source[i] === ':') {
    const read = readFStringParts(source, i + 1, quote, true, openAt);
    spec = read.parts;
    i = read.end;
  }
  // readFStringParts(inSpec) só para no "}" — aqui é garantido que é ele
  i += 1;
  return { part: { source: exprSource, at: exprStart, conv, spec, debug }, end: i };
}

/** Tokeniza `source` (uma linha). Lança LexError em caractere inesperado. */
export function tokenize(source) {
  const tokens = [];
  let i = 0;
  const n = source.length;

  while (i < n) {
    const c = source[i];

    if (c === ' ' || c === '\t') {
      i += 1;
      continue;
    }

    if (c === '#') break; // comentário até o fim da linha

    // f-string: f"texto {expressão} texto" — ver readFStringParts
    if ((c === 'f' || c === 'F') && (source[i + 1] === '"' || source[i + 1] === "'")) {
      const start = i;
      const { parts, end } = readFStringParts(source, i + 2, source[i + 1], false, start);
      i = end;
      tokens.push({ type: TokenType.FSTRING, value: parts, start, end: i });
      continue;
    }

    if (c === '"' || c === "'") {
      const quote = c;
      const start = i;
      i += 1;
      let value = '';
      while (i < n && source[i] !== quote) {
        if (source[i] === '\\' && i + 1 < n) {
          const esc = source[i + 1];
          value += ESCAPES[esc] ?? esc;
          i += 2;
        } else {
          value += source[i];
          i += 1;
        }
      }
      if (i >= n) throw new LexError('String não terminada (faltou a aspa de fechamento)', start);
      i += 1; // consome a aspa de fechamento
      tokens.push({ type: TokenType.STRING, value, start, end: i });
      continue;
    }

    if (DIGIT_RE.test(c)) {
      const start = i;
      while (i < n && DIGIT_RE.test(source[i])) i += 1;
      if (source[i] === '.' && DIGIT_RE.test(source[i + 1])) {
        i += 1;
        while (i < n && DIGIT_RE.test(source[i])) i += 1;
      }
      tokens.push({ type: TokenType.NUMBER, value: Number(source.slice(start, i)), start, end: i });
      continue;
    }

    if (IDENT_START_RE.test(c)) {
      const start = i;
      while (i < n && IDENT_RE.test(source[i])) i += 1;
      const word = source.slice(start, i);
      const kw = KEYWORDS[word];
      tokens.push({ type: kw ?? TokenType.IDENT, value: word, start, end: i });
      continue;
    }

    if (c === '=' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.EQ, value: '==', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '+' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.PLUS_ASSIGN, value: '+=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '-' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.MINUS_ASSIGN, value: '-=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '*' && source[i + 1] === '*') {
      tokens.push({ type: TokenType.DOUBLE_STAR, value: '**', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '*' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.STAR_ASSIGN, value: '*=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    // "//=" antes de "//", e "//" antes de "/=" — senão "a //= 2" viraria
    // "/" + "/=" e "a // 2" viraria dois "/" soltos.
    if (c === '/' && source[i + 1] === '/' && source[i + 2] === '=') {
      tokens.push({ type: TokenType.DOUBLE_SLASH_ASSIGN, value: '//=', start: i, end: i + 3 });
      i += 3;
      continue;
    }
    if (c === '/' && source[i + 1] === '/') {
      tokens.push({ type: TokenType.DOUBLE_SLASH, value: '//', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '/' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.SLASH_ASSIGN, value: '/=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '!' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.NEQ, value: '!=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '<' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.LTE, value: '<=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '>' && source[i + 1] === '=') {
      tokens.push({ type: TokenType.GTE, value: '>=', start: i, end: i + 2 });
      i += 2;
      continue;
    }
    if (c === '<') {
      tokens.push({ type: TokenType.LT, value: '<', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === '>') {
      tokens.push({ type: TokenType.GT, value: '>', start: i, end: i + 1 });
      i += 1;
      continue;
    }
    if (c === '=') {
      tokens.push({ type: TokenType.ASSIGN, value: '=', start: i, end: i + 1 });
      i += 1;
      continue;
    }

    const single = SINGLE_CHAR[c];
    if (single) {
      tokens.push({ type: single, value: c, start: i, end: i + 1 });
      i += 1;
      continue;
    }

    throw new LexError(`Caractere inesperado "${c}"`, i);
  }

  tokens.push({ type: TokenType.EOF, value: null, start: n, end: n });
  return tokens;
}
