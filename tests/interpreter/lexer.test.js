import { describe, expect, test } from 'vitest';
import { LexError, TokenType, tokenize } from '../../src/interpreter/lexer.js';

const tipos = (src) => tokenize(src).map((t) => t.type);

describe('tokenize', () => {
  test('identificadores, números, operadores e posição de cada token', () => {
    const tokens = tokenize('x += nums[-1] * 2.5');
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      [TokenType.IDENT, 'x'],
      [TokenType.PLUS_ASSIGN, '+='],
      [TokenType.IDENT, 'nums'],
      [TokenType.LBRACKET, '['],
      [TokenType.MINUS, '-'],
      [TokenType.NUMBER, 1],
      [TokenType.RBRACKET, ']'],
      [TokenType.STAR, '*'],
      [TokenType.NUMBER, 2.5],
      [TokenType.EOF, null],
    ]);
    expect(tokens[2]).toMatchObject({ start: 5, end: 9 });
  });

  test('comentário é ignorado', () => {
    expect(tipos('x = 1  # comentário')).toEqual([TokenType.IDENT, TokenType.ASSIGN, TokenType.NUMBER, TokenType.EOF]);
    expect(tipos('# só comentário')).toEqual([TokenType.EOF]);
  });

  test('palavras-chave viram tokens próprios', () => {
    expect(tipos('not a and b or c is None in True False')).toEqual([
      TokenType.NOT,
      TokenType.IDENT,
      TokenType.AND,
      TokenType.IDENT,
      TokenType.OR,
      TokenType.IDENT,
      TokenType.IS,
      TokenType.NONE,
      TokenType.IN,
      TokenType.TRUE,
      TokenType.FALSE,
      TokenType.EOF,
    ]);
  });

  test('operadores de dois caracteres', () => {
    expect(tipos('** // == != <= >= -= *= /= //=')).toEqual([
      TokenType.DOUBLE_STAR,
      TokenType.DOUBLE_SLASH,
      TokenType.EQ,
      TokenType.NEQ,
      TokenType.LTE,
      TokenType.GTE,
      TokenType.MINUS_ASSIGN,
      TokenType.STAR_ASSIGN,
      TokenType.SLASH_ASSIGN,
      TokenType.DOUBLE_SLASH_ASSIGN,
      TokenType.EOF,
    ]);
  });

  test('strings com aspas simples e duplas', () => {
    const [a, b] = tokenize(`'oi' "tchau"`);
    expect([a.type, a.value]).toEqual([TokenType.STRING, 'oi']);
    expect([b.type, b.value]).toEqual([TokenType.STRING, 'tchau']);
  });

  test('f-string é quebrada em partes com conversão e spec', () => {
    const [tok] = tokenize('f"{a!r:>3}"');
    expect(tok.type).toBe(TokenType.FSTRING);
    expect(tok.value).toEqual([{ source: 'a', at: 3, conv: 'r', spec: ['>3'], debug: null }]);
  });

  test('caractere inesperado lança LexError com a coluna', () => {
    expect(() => tokenize('x = $')).toThrow(LexError);
    try {
      tokenize('x = $');
    } catch (err) {
      expect(err.at).toBe(4);
      expect(err.message).toContain('$');
    }
  });
});
