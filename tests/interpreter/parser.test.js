import { describe, expect, test } from 'vitest';
import { parseExpression, parseParams, parseStatement } from '../../src/interpreter/parser.js';

const stmt = (src) => {
  const r = parseStatement(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
};
const expr = (src) => {
  const r = parseExpression(src);
  if (!r.ok) throw new Error(r.error.message);
  return r.ast;
};
const nome = (name) => ({ type: 'Name', name });
const num = (value) => ({ type: 'Number', value });

describe('parseStatement', () => {
  test('atribuição simples', () => {
    expect(stmt('x = 1')).toEqual({ type: 'Assign', target: nome('x'), value: num(1) });
  });

  test('atribuição composta vira Assign com BinOp', () => {
    expect(stmt('nums[i] -= 1')).toEqual({
      type: 'Assign',
      target: { type: 'Index', object: nome('nums'), index: nome('i') },
      value: { type: 'BinOp', op: '-', left: { type: 'Index', object: nome('nums'), index: nome('i') }, right: num(1) },
    });
  });

  test('"+=" marca o BinOp como inplace (lista é estendida no lugar)', () => {
    expect(stmt('xs += [1]')).toEqual({
      type: 'Assign',
      target: nome('xs'),
      value: { type: 'BinOp', op: '+', left: nome('xs'), right: { type: 'ArrayLiteral', elements: [num(1)] }, inplace: true },
    });
  });

  test('troca com tuplas', () => {
    expect(stmt('a, b = b, a')).toEqual({ type: 'TupleAssign', targets: [nome('a'), nome('b')], values: [nome('b'), nome('a')] });
  });

  test('atribuição encadeada', () => {
    expect(stmt('x = y = 0')).toEqual({ type: 'ChainAssign', targets: [nome('x'), nome('y')], value: num(0) });
  });

  test('chamada com argumento nomeado', () => {
    expect(stmt('f(a, k=2)')).toEqual({
      type: 'ExprStmt',
      expr: { type: 'Call', callee: nome('f'), args: [nome('a')], kwargs: [{ name: 'k', value: num(2) }] },
    });
  });

  test('import de deque', () => {
    expect(stmt('from collections import deque')).toMatchObject({ type: 'Import', module: 'collections' });
  });

  test('linha vazia/comentário não é erro de sintaxe, mas não tem AST', () => {
    expect(parseStatement('   # nada')).toEqual({ ok: false, error: { message: 'Linha vazia', at: 0 } });
  });

  test.each(['x = ', 'x = (1, 2', '= 3', 'x = [1, 2'])('erro de sintaxe em %j não lança', (src) => {
    const r = parseStatement(src);
    expect(r.ok).toBe(false);
    expect(typeof r.error.message).toBe('string');
    expect(typeof r.error.at).toBe('number');
  });
});

describe('parseExpression', () => {
  test('precedência: ** > * > +', () => {
    expect(expr('1 + 2 * 3 ** 2')).toEqual({
      type: 'BinOp',
      op: '+',
      left: num(1),
      right: { type: 'BinOp', op: '*', left: num(2), right: { type: 'BinOp', op: '**', left: num(3), right: num(2) } },
    });
  });

  test('precedência lógica: not > and > or', () => {
    expect(expr('not a or b and c')).toEqual({
      type: 'BinOp',
      op: 'or',
      left: { type: 'UnaryOp', op: 'not', operand: nome('a') },
      right: { type: 'BinOp', op: 'and', left: nome('b'), right: nome('c') },
    });
  });

  test('comparação encadeada vira um único Compare', () => {
    expect(expr('0 <= i < n')).toEqual({ type: 'Compare', operands: [num(0), nome('i'), nome('n')], ops: ['<=', '<'] });
  });

  test('atributo, índice e fatia', () => {
    expect(expr('a.next')).toEqual({ type: 'Attribute', object: nome('a'), attr: 'next' });
    expect(expr('m[i][j]')).toEqual({ type: 'Index', object: { type: 'Index', object: nome('m'), index: nome('i') }, index: nome('j') });
    expect(expr('xs[1:3]')).toMatchObject({ type: 'Slice', object: nome('xs'), start: num(1), stop: num(3) });
  });

  test('literais de lista, dict, set e tupla', () => {
    expect(expr('[1, 2]').type).toBe('ArrayLiteral');
    expect(expr('{"a": 1}').type).toBe('DictLiteral');
    expect(expr('{1, 2}').type).toBe('SetLiteral');
    expect(expr('(1, 2)').type).toBe('TupleLiteral');
    expect(expr('[x * 2 for x in xs if x > 0]').type).toBe('ListComp');
  });

  test('expressão condicional: menor precedência, associativa à direita', () => {
    expect(expr('a if x > 0 else b')).toEqual({
      type: 'IfExp',
      test: { type: 'BinOp', op: '>', left: nome('x'), right: num(0) },
      body: nome('a'),
      orelse: nome('b'),
    });
    expect(expr('a or b if c else d')).toMatchObject({ type: 'IfExp', body: { type: 'BinOp', op: 'or' } });
    expect(expr('1 if p else 2 if q else 3')).toEqual({
      type: 'IfExp',
      test: nome('p'),
      body: num(1),
      orelse: { type: 'IfExp', test: nome('q'), body: num(2), orelse: num(3) },
    });
  });

  test('expressão condicional dentro e em volta de list comprehension', () => {
    expect(expr('[v if v > 0 else 0 for v in xs]')).toMatchObject({ type: 'ListComp', element: { type: 'IfExp' }, cond: null });
    expect(expr('[v for v in xs if v > 0]')).toMatchObject({ type: 'ListComp', element: nome('v'), cond: { type: 'BinOp' } });
    // o filtro da comprehension não aceita expressão condicional (igual Python)
    expect(parseExpression('[v for v in xs if a if b else c]')).toMatchObject({ ok: false });
  });

  test('expressão condicional sem else é erro', () => {
    expect(parseExpression('a if b')).toMatchObject({ ok: false, error: { message: expect.stringContaining('Esperado "else"') } });
  });

  test('conteúdo sobrando depois da expressão é erro', () => {
    expect(parseExpression('a b')).toMatchObject({ ok: false });
    expect(parseExpression('')).toEqual({ ok: false, error: { message: 'Expressão vazia', at: 0 } });
  });
});

describe('parseParams', () => {
  test('parâmetros com e sem valor padrão', () => {
    expect(parseParams('a, b=1')).toEqual({
      ok: true,
      params: [
        { name: 'a', default: null },
        { name: 'b', default: num(1) },
      ],
    });
  });

  test('lista vazia', () => {
    expect(parseParams('')).toEqual({ ok: true, params: [] });
  });
});
