import { parseStatement, parseExpression, parseParams } from './parser.js';
import { If, While, For, FunctionDef, Return, Break, Continue } from './ast.js';

/**
 * Parser de PROGRAMA (várias linhas, com blocos por indentação — estilo
 * Python) construído em cima do parser de uma linha só (parser.js): cada
 * statement simples ("alvo = expressão") continua reconhecido por
 * `parseStatement`; este módulo só cuida de agrupar linhas em blocos e
 * reconhecer os cabeçalhos "if/elif/else/while/for" (terminados em ":").
 *
 * `for nome in <iterável>:` — "iterável" é uma expressão qualquer (parseada
 * por `parseExpression`, mesma função usada pra condições de if/while), mas
 * só duas formas fazem sentido pro interpretador (ver interpreter.js
 * #resolveIterable): o NOME de um array já vivo no modelo (iteração por
 * valor, célula por célula) ou uma chamada `range(...)`.
 *
 * Cada statement carrega `line` (índice 0-based no código fonte), usado pra
 * destacar a linha em execução durante a reprodução (ver MicroProgramRunner).
 *
 * `def nome(a, b):` só é reconhecido no nível 0 de indentação (o nível do
 * próprio `parseProgram`) — `def` aninhado (dentro de outro bloco) é erro de
 * sintaxe, não é caso de uso de nenhum algoritmo-alvo (ver plano de
 * recursão). Cada `FunctionDef` encontrado é retirado da lista principal de
 * statements e guardado à parte em `functions` (nome -> nó), então
 * `program` só tem os statements de topo que rodam de cara — quem executa
 * chamadas (interpreter.js#callFunction) consulta `functions` na hora de uma
 * chamada. `return`/`return expr` é reconhecido dentro de qualquer bloco
 * (só faz sentido dentro do corpo de uma função — quem valida isso em tempo
 * de execução é o interpretador, não o parser).
 *
 * Retorna `{ok: true, functions: {nome -> FunctionDef}, program:
 * [...statements]}` ou `{ok: false, error}` — nunca lança.
 */

// "i in ...", "i, v in ..." ou "(i, j) in ..." (ver ast.js#For sobre
// varNames/enumerate — os parênteses só agrupam, e somem no parse do "for").
const FOR_HEADER_RE =
  /^([A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*|\(\s*[A-Za-z_][A-Za-z0-9_]*(?:\s*,\s*[A-Za-z_][A-Za-z0-9_]*)*\s*\))\s+in\s+(.+)$/;
const DEF_HEADER_RE = /^([A-Za-z_][A-Za-z0-9_]*)\((.*)\)$/;

/** Corta o comentário ("#" até o fim da linha) — mas não um "#" dentro de
 * string, ex: print("item #1") ou f"{n:#x}". */
function stripComment(line) {
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '#') {
      return line.slice(0, i);
    }
  }
  return line;
}

/** Saldo de parênteses/colchetes/chaves abertos numa linha já sem
 * comentário — ignorando os que estão dentro de string (ex. "(" ou f"{x}"). */
function bracketBalance(line) {
  let depth = 0;
  let quote = null;
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(' || c === '[' || c === '{') {
      depth += 1;
    } else if (c === ')' || c === ']' || c === '}') {
      depth -= 1;
    }
  }
  return depth;
}

/** Linha lógica que começa na linha física `start` de `rawLines` (já sem
 * comentário em nenhuma delas): como no Python, ela continua nas linhas
 * seguintes enquanto houver "(", "[" ou "{" aberto (junção implícita — ex.
 * um dict literal com um par por linha) ou enquanto a linha terminar em "\"
 * (junção explícita). As partes são juntadas com um espaço; linhas em
 * branco dentro dos colchetes são puladas e a indentação das linhas de
 * continuação não importa. Devolve `{content, end}` — `content` sem espaços
 * nas pontas e `end` o índice da última linha física consumida. */
function joinLogicalLine(rawLines, start) {
  let content = rawLines[start].trim();
  let depth = bracketBalance(content);
  let end = start;
  while (end + 1 < rawLines.length && (depth > 0 || content.endsWith('\\'))) {
    if (depth <= 0) content = content.slice(0, -1).trimEnd();
    end += 1;
    const next = rawLines[end].trim();
    if (!next) continue;
    depth += bracketBalance(next);
    content = `${content} ${next}`;
  }
  return { content, end };
}

/** Divide o código fonte em linhas lógicas não-vazias (sem comentário), cada
 * uma com sua indentação (contagem de espaços/tabs à esquerda) e o número da
 * linha física onde ela começa — que é a destacada na reprodução e a
 * apontada nos erros (ver `joinLogicalLine`). */
function tokenizeLines(source) {
  const lines = [];
  const raws = source.split('\n').map(stripComment);
  for (let lineNo = 0; lineNo < raws.length; lineNo += 1) {
    if (!raws[lineNo].trim()) continue;
    const indent = raws[lineNo].match(/^[ \t]*/)[0].length;
    const { content, end } = joinLogicalLine(raws, lineNo);
    lines.push({ indent, content, lineNo });
    lineNo = end;
  }
  return lines;
}

/** Linha lógica (ver `joinLogicalLine`) que contém a linha física `idx` do
 * código fonte — usada pelo Ctrl+Enter do Sandbox, que roda uma linha por
 * vez mas precisa do statement inteiro quando ele ocupa várias linhas (ex.
 * um dict literal com um par por linha), com o cursor em qualquer uma delas.
 * Devolve `{content, start, end}` (`content` sem comentário e sem espaços
 * nas pontas, vazio se a linha for em branco/só comentário). */
export function logicalLineAt(source, idx) {
  const raws = source.split('\n').map(stripComment);
  for (let start = 0; start < raws.length; start += 1) {
    if (!raws[start].trim()) {
      if (start === idx) return { content: '', start, end: start };
      continue;
    }
    const { content, end } = joinLogicalLine(raws, start);
    if (idx <= end) return { content, start, end };
    start = end;
  }
  return { content: '', start: idx, end: idx };
}

/** Statements simples e cabeçalhos de bloco que compartilham o mesmo nível
 * de indentação `blockIndent`, até encontrar uma linha com indentação
 * diferente (fim do bloco) ou o fim do arquivo. `isTopLevel` só é `true` na
 * chamada de `parseProgram` — todo corpo de bloco (`parseIndentedBody`) é
 * aninhado, então nunca permite `def` dentro dele. */
function parseBlock(lines, i, blockIndent, isTopLevel = false) {
  const stmts = [];
  while (i < lines.length && lines[i].indent === blockIndent) {
    const line = lines[i];
    const { content, lineNo } = line;

    if (content === 'elif' || content.startsWith('elif ') || content === 'else' || content === 'else:') {
      return { error: { message: '"elif"/"else" sem "if" correspondente', at: lineNo }, i };
    }

    if (content.startsWith('def ') && content.endsWith(':')) {
      if (!isTopLevel) {
        return { error: { message: '"def" só é permitido no nível mais externo do programa', at: lineNo }, i };
      }
      const header = content.slice(4, -1).trim();
      const m = header.match(DEF_HEADER_RE);
      if (!m) return { error: { message: 'Esperado "def nome(parâmetros):"', at: lineNo }, i };
      const [, fname, paramsSource] = m;
      const parsedParams = parseParams(paramsSource);
      if (!parsedParams.ok) return { error: { ...parsedParams.error, at: lineNo }, i };
      const params = parsedParams.params;
      const body = parseIndentedBody(lines, i, blockIndent, 'def');
      if (body.error) return body;
      stmts.push(FunctionDef(fname, params, body.stmts, lineNo));
      i = body.i;
      continue;
    }

    if (content === 'break') {
      stmts.push(Break(lineNo));
      i += 1;
      continue;
    }

    if (content === 'continue') {
      stmts.push(Continue(lineNo));
      i += 1;
      continue;
    }

    if (content === 'return' || content.startsWith('return ')) {
      const exprSource = content === 'return' ? '' : content.slice('return '.length).trim();
      let exprAst = null;
      if (exprSource !== '') {
        const parsed = parseExpression(exprSource);
        if (!parsed.ok) return { error: { ...parsed.error, at: lineNo }, i };
        exprAst = parsed.ast;
      }
      stmts.push(Return(exprAst, lineNo));
      i += 1;
      continue;
    }

    if (content.startsWith('if ') && content.endsWith(':')) {
      const test = parseExpression(content.slice(3, -1));
      if (!test.ok) return { error: { ...test.error, at: lineNo }, i };
      const body = parseIndentedBody(lines, i, blockIndent, 'if');
      if (body.error) return body;
      const chain = parseIfChain(lines, body.i, blockIndent);
      if (chain.error) return chain;
      stmts.push(If(test.ast, body.stmts, chain.orelse, lineNo));
      i = chain.i;
      continue;
    }

    if (content.startsWith('while ') && content.endsWith(':')) {
      const test = parseExpression(content.slice(6, -1));
      if (!test.ok) return { error: { ...test.error, at: lineNo }, i };
      const body = parseIndentedBody(lines, i, blockIndent, 'while');
      if (body.error) return body;
      stmts.push(While(test.ast, body.stmts, lineNo));
      i = body.i;
      continue;
    }

    if (content.startsWith('for ') && content.endsWith(':')) {
      const m = content.slice(4, -1).match(FOR_HEADER_RE);
      if (!m) {
        return {
          error: {
            message: 'Esperado "for nome in array:", "for nome in range(...):" ou "for i, v in enumerate(...):"',
            at: lineNo,
          },
          i,
        };
      }
      const [, varsSource, iterSource] = m;
      const varNames = varsSource.replace(/^\(|\)$/g, '').split(',').map((v) => v.trim());
      const iter = parseExpression(iterSource);
      if (!iter.ok) return { error: { ...iter.error, at: lineNo }, i };
      const body = parseIndentedBody(lines, i, blockIndent, 'for');
      if (body.error) return body;
      stmts.push(For(varNames, iter.ast, body.stmts, lineNo));
      i = body.i;
      continue;
    }

    const result = parseStatement(content);
    if (!result.ok) return { error: { ...result.error, at: lineNo }, i };
    stmts.push({ ...result.ast, line: lineNo });
    i += 1;
  }
  return { stmts, i };
}

/** Consome o corpo indentado logo após um cabeçalho "...:" na linha `i`. */
function parseIndentedBody(lines, i, parentIndent, headerLabel) {
  const bodyStart = i + 1;
  if (bodyStart >= lines.length || lines[bodyStart].indent <= parentIndent) {
    return { error: { message: `Bloco de "${headerLabel}" vazio`, at: lines[i].lineNo }, i: bodyStart };
  }
  const childIndent = lines[bodyStart].indent;
  return parseBlock(lines, bodyStart, childIndent);
}

/** Depois do corpo de um "if" (ou de um "elif" anterior), olha se a próxima
 * linha no mesmo nível de indentação é "elif ...:" ou "else:" e monta a
 * cadeia — "elif" vira um `If` aninhado dentro de `orelse` (mesma convenção
 * da AST do Python), "else" vira o `orelse` final da cadeia. */
function parseIfChain(lines, i, blockIndent) {
  if (i >= lines.length || lines[i].indent !== blockIndent) return { orelse: [], i };
  const line = lines[i];

  if (line.content === 'else:') {
    const body = parseIndentedBody(lines, i, blockIndent, 'else');
    if (body.error) return body;
    return { orelse: body.stmts, i: body.i };
  }

  if (line.content.startsWith('elif ') && line.content.endsWith(':')) {
    const test = parseExpression(line.content.slice(5, -1));
    if (!test.ok) return { error: { ...test.error, at: line.lineNo }, i };
    const body = parseIndentedBody(lines, i, blockIndent, 'elif');
    if (body.error) return body;
    const rest = parseIfChain(lines, body.i, blockIndent);
    if (rest.error) return rest;
    return { orelse: [If(test.ast, body.stmts, rest.orelse, line.lineNo)], i: rest.i };
  }

  return { orelse: [], i };
}

export function parseProgram(source) {
  const lines = tokenizeLines(source);
  if (!lines.length) return { ok: true, functions: {}, program: [] };
  const result = parseBlock(lines, 0, lines[0].indent, true);
  if (result.error) return { ok: false, error: result.error };
  if (result.i < lines.length) {
    return { ok: false, error: { message: 'Indentação inesperada', at: lines[result.i].lineNo } };
  }
  const functions = {};
  const program = [];
  for (const stmt of result.stmts) {
    if (stmt.type === 'FunctionDef') functions[stmt.name] = stmt;
    else program.push(stmt);
  }
  return { ok: true, functions, program };
}
