import { tokenize, TokenType, LexError } from './lexer.js';
import { Assign, TupleAssign, ChainAssign, ExprStmt, Name, NumberLit, StrLit, FString, NoneLit, BoolLit, ArrayLit, ListComp, DictLit, SetLit, TupleLit, Attribute, Index, Slice, Call, Import, BinOp, UnaryOp, Compare, IfExp } from './ast.js';

/**
 * Parser recursive-descent com precedência estilo Python (menor pra maior):
 * expressão condicional (a if cond else b) → or → and → not → comparações
 * (== != < <= > >= is [not] in [not]) → + - → * / % → unário (-) →
 * potência (** , associativo à direita) → pós-fixo (.campo, [expr],
 * [expr:expr:expr], (args)) → primário (número, None, True, False,
 * identificador, [lista], (expr), (tupla,)).
 *
 * Reconhece uma instrução de atribuição por linha: `alvo = expressão`,
 * `alvo (+= -= *= /=) expressão` (açúcar sintático desenrolado aqui mesmo, em
 * `parseAssignRhs` — vira a mesma AST de `alvo = alvo <op> expressão`), ou
 * `alvo1, alvo2, ... = valor1, valor2, ...` (troca/atribuição múltipla, com
 * parênteses opcionais — "a, b = b, a" ou "(a, b) = (b, a)" — ver
 * `parseExprList`/ast.js#TupleAssign). `if`/`elif`/`else`/`while`/`for`/`def`
 * são reconhecidos por cima disto, em blockParser.js, que reaproveita
 * `parseStatement`/`parseExpression` pra cada linha/condição.
 */

export class ParseError extends Error {
  constructor(message, at) {
    super(message);
    this.name = 'ParseError';
    this.at = at;
  }
}

class Parser {
  constructor(tokens) {
    this.tokens = tokens;
    this.pos = 0;
  }

  peek() {
    return this.tokens[this.pos];
  }

  at(type) {
    return this.peek().type === type;
  }

  advance() {
    const t = this.tokens[this.pos];
    if (t.type !== TokenType.EOF) this.pos += 1;
    return t;
  }

  expect(type, message) {
    if (!this.at(type)) throw new ParseError(message ?? `Esperado "${type}"`, this.peek().start);
    return this.advance();
  }

  /** Identificador com um texto específico — "for"/"if" dentro de uma
   * expressão (list comprehension), que o lexer entrega como IDENT comum. */
  atWord(word) {
    const t = this.peek();
    return t.type === TokenType.IDENT && t.value === word;
  }

  /** Resto de "[elemento for a(, b) in iterável (if condição)]", já
   * consumido até o elemento (ver `parsePrimary`, caso "["). */
  parseListCompTail(element) {
    this.advance(); // "for"
    const varNames = [this.expect(TokenType.IDENT, 'Esperado nome de variável depois de "for"').value];
    if (this.at(TokenType.COMMA)) {
      this.advance();
      varNames.push(this.expect(TokenType.IDENT, 'Esperado nome de variável depois de ","').value);
    }
    this.expect(TokenType.IN, 'Esperado "in" na list comprehension');
    const iterExpr = this.parseAdd();
    let cond = null;
    if (this.atWord('if')) {
      this.advance();
      // sem expressão condicional aqui, igual a gramática do Python ("[x for
      // x in xs if a if b else c]" é erro lá também)
      cond = this.parseOr();
    }
    this.expect(TokenType.RBRACKET, 'Esperado "]" no fim da list comprehension');
    return ListComp(element, varNames, iterExpr, cond);
  }

  // ---- statement ----

  parseStatement() {
    let targets = this.parseExprList();
    // "(a, b) = ..." — os parênteses viram uma tupla em `parsePrimary`; como
    // alvo, é só a lista de alvos agrupada.
    if (targets.length === 1 && targets[0].type === 'TupleLiteral' && targets[0].elements.length >= 2 && this.at(TokenType.ASSIGN)) {
      targets = targets[0].elements;
    }

    if (targets.length === 1) {
      const expr = targets[0];
      // sem "=" (nem composta) depois: só faz sentido pra uma chamada com
      // efeito colateral e sem valor útil de volta — "arr.append(x)"/
      // "arr.pop()" (ver evaluator.js#evaluate, caso 'Call' com callee
      // Attribute) — ou pra uma leitura "nums[i]"/"m[i][j]" sozinha, cujo
      // efeito é criar/mover o cursor de leitura correspondente no canvas
      // (ver MicroRuntimeAdapter#_showReadCursor). Qualquer outra expressão
      // sozinha na linha (ex: só "x", ou "1 + 2") não tem efeito nenhum,
      // então nem faz sentido como statement — erro de sintaxe mesmo.
      if (this.at(TokenType.EOF)) {
        if (expr.type === 'Call' || expr.type === 'Index') return ExprStmt(expr);
        throw new ParseError('Esperado "=" depois do alvo da atribuição', 0);
      }
      if (expr.type !== 'Name' && expr.type !== 'Attribute' && expr.type !== 'Index') {
        throw new ParseError('Alvo de atribuição inválido — só "nome", "nome.campo" ou "nome[índice]"', 0);
      }
      const plainAssign = this.at(TokenType.ASSIGN);
      let value = this.parseAssignRhs(expr);
      // "a = b = valor" (ver ast.js#ChainAssign) — cada "=" a mais
      // transforma a expressão recém-lida em mais um alvo.
      const chain = [expr];
      while (plainAssign && this.at(TokenType.ASSIGN)) {
        if (value.type !== 'Name' && value.type !== 'Attribute' && value.type !== 'Index') {
          throw new ParseError('Alvo de atribuição inválido — só "nome", "nome.campo" ou "nome[índice]"', this.peek().start);
        }
        chain.push(value);
        this.advance();
        value = this.parseExpr();
      }
      // "t = a, b" — vírgula sem parênteses do lado direito também cria uma
      // tupla, igual Python (só com "=" puro: "t += a, b" fica de fora).
      if (plainAssign && this.at(TokenType.COMMA)) {
        const elements = [value];
        while (this.at(TokenType.COMMA)) {
          this.advance();
          if (this.at(TokenType.EOF)) break; // "t = a," é a tupla de um item
          elements.push(this.parseExpr());
        }
        value = TupleLit(elements);
      }
      if (!this.at(TokenType.EOF)) throw new ParseError('Conteúdo inesperado após a expressão', this.peek().start);
      return chain.length > 1 ? ChainAssign(chain, value) : Assign(expr, value);
    }

    // "alvo1, alvo2, ... = valor1, valor2, ..." (troca/atribuição múltipla,
    // ver ast.js#TupleAssign) — sem atribuição composta aqui, Python também
    // não tem "a, b += 1, 2".
    targets.forEach((t) => {
      if (t.type !== 'Name' && t.type !== 'Attribute' && t.type !== 'Index') {
        throw new ParseError('Alvo de atribuição inválido — só "nome", "nome.campo" ou "nome[índice]"', 0);
      }
    });
    this.expect(TokenType.ASSIGN, 'Esperado "=" depois da lista de alvos');
    let values = this.parseExprList();
    // "a, b = (b, a)" — tupla literal do tamanho certo: desmonta já aqui,
    // mesmo caminho de "a, b = b, a". Um valor só de outro jeito ("i, j =
    // chave", com "chave" uma tupla) é desempacotado na execução (ver
    // interpreter.js, caso 'TupleAssign').
    if (values.length === 1 && values[0].type === 'TupleLiteral' && values[0].elements.length === targets.length) {
      values = values[0].elements;
    }
    if (values.length !== targets.length && values.length !== 1) {
      throw new ParseError(
        `Atribuição múltipla: ${targets.length} alvo(s) mas ${values.length} valor(es)`,
        this.peek().start,
      );
    }
    if (!this.at(TokenType.EOF)) throw new ParseError('Conteúdo inesperado após a expressão', this.peek().start);
    return TupleAssign(targets, values);
  }

  /** Uma lista de alvos (antes do "=") ou valores (depois do "="), separados
   * por vírgula — "i, j". Com parênteses em volta da lista inteira ("(i,
   * j)"), `parsePrimary` devolve uma tupla só, que `parseStatement` desmonta
   * de volta em alvos/valores. Sempre devolve pelo menos 1 item (o caso
   * comum, sem vírgula nenhuma, é só `[umaExpressão]`). */
  parseExprList() {
    const items = [this.parseExpr()];
    while (this.at(TokenType.COMMA)) {
      this.advance();
      items.push(this.parseExpr());
    }
    return items;
  }

  /** "= expr" de sempre, ou uma atribuição composta ("+= -= *= /= //=") — açúcar
   * sintático desenrolado aqui mesmo, na hora do parse: "nome += expr" vira
   * exatamente a mesma AST de "nome = nome + expr" (reaproveitando o próprio
   * `target` já parseado como o lado esquerdo do `BinOp`), então o avaliador
   * (evaluator.js) não precisa saber que atribuição composta existe — exceto
   * "+=" numa lista, que estende a lista no lugar (`inplace`, ver ast.js#BinOp). */
  parseAssignRhs(target) {
    const compoundOps = {
      [TokenType.PLUS_ASSIGN]: '+',
      [TokenType.MINUS_ASSIGN]: '-',
      [TokenType.STAR_ASSIGN]: '*',
      [TokenType.SLASH_ASSIGN]: '/',
      [TokenType.DOUBLE_SLASH_ASSIGN]: '//',
    };
    if (this.at(TokenType.ASSIGN)) {
      this.advance();
      return this.parseExpr();
    }
    const op = compoundOps[this.peek().type];
    if (op) {
      this.advance();
      // "lista += [...]" estende a mesma lista no Python (não é igual a
      // "lista = lista + [...]", que cria outra) — ver ast.js#BinOp
      return BinOp(op, target, this.parseExpr(), op === '+');
    }
    throw new ParseError('Esperado "=" (ou "+=", "-=", "*=", "/=", "//=") depois do alvo da atribuição', this.peek().start);
  }

  // ---- expressões, por precedência ----

  /** "a if cond else b" — a menor precedência de todas, associativa à
   * direita ("a if x else b if y else c" é "a if x else (b if y else c)").
   * "if"/"else" chegam do lexer como IDENT comum (ver `atWord`). */
  parseExpr() {
    const body = this.parseOr();
    if (!this.atWord('if')) return body;
    this.advance();
    const test = this.parseOr();
    if (!this.atWord('else')) {
      throw new ParseError('Esperado "else" na expressão condicional ("a if condição else b")', this.peek().start);
    }
    this.advance();
    return IfExp(test, body, this.parseExpr());
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.at(TokenType.OR)) {
      this.advance();
      left = BinOp('or', left, this.parseAnd());
    }
    return left;
  }

  parseAnd() {
    let left = this.parseNot();
    while (this.at(TokenType.AND)) {
      this.advance();
      left = BinOp('and', left, this.parseNot());
    }
    return left;
  }

  parseNot() {
    if (this.at(TokenType.NOT)) {
      this.advance();
      return UnaryOp('not', this.parseNot());
    }
    return this.parseComparison();
  }

  /** Comparações em sequência ("0 <= i < n", "a == b != c") são encadeadas
   * como no Python — "a < b < c" é "a < b and b < c", com "b" avaliado UMA
   * vez só (ver ast.js#Compare). Uma comparação sozinha continua sendo um
   * `BinOp` comum. */
  parseComparison() {
    const operands = [this.parseAdd()];
    const chainOps = [];
    for (;;) {
      const op = this.parseCompareOp();
      if (!op) break;
      chainOps.push(op);
      operands.push(this.parseAdd());
    }
    if (chainOps.length === 0) return operands[0];
    if (chainOps.length === 1) return BinOp(chainOps[0], operands[0], operands[1]);
    return Compare(operands, chainOps);
  }

  /** Consome o operador de comparação seguinte ("<", "is not", "not in"...)
   * e devolve o `op` de `BinOp` correspondente, ou `null` se não há um. */
  parseCompareOp() {
    const ops = {
      [TokenType.EQ]: '==',
      [TokenType.NEQ]: '!=',
      [TokenType.LT]: '<',
      [TokenType.LTE]: '<=',
      [TokenType.GT]: '>',
      [TokenType.GTE]: '>=',
    };
    if (this.at(TokenType.IS)) {
      // "is" / "is not" — identidade, não igualdade estrutural, mas pros
      // valores tipados do avaliador (scalar/struct/none/bool) as duas
      // coisas coincidem, então mapeia direto pro "==(«not»)" que
      // `evalBinOp` já sabe fazer (ver evaluator.js#valuesEqual) — cobre o
      // idiom "enquanto atual is not None".
      this.advance();
      if (this.at(TokenType.NOT)) {
        this.advance();
        return '!=';
      }
      return '==';
    }
    if (this.at(TokenType.IN)) {
      // "expr in nome" — membership; quem resolve o lado direito (array
      // vivo, set, dict, texto, tupla) é evaluator.js#evaluate.
      this.advance();
      return 'in';
    }
    if (this.at(TokenType.NOT) && this.tokens[this.pos + 1]?.type === TokenType.IN) {
      this.advance();
      this.advance();
      return 'notin';
    }
    const op = ops[this.peek().type];
    if (!op) return null;
    this.advance();
    return op;
  }

  parseAdd() {
    let left = this.parseMul();
    while (this.at(TokenType.PLUS) || this.at(TokenType.MINUS)) {
      const op = this.advance().type === TokenType.PLUS ? '+' : '-';
      left = BinOp(op, left, this.parseMul());
    }
    return left;
  }

  parseMul() {
    let left = this.parseUnary();
    const mulOps = { [TokenType.STAR]: '*', [TokenType.SLASH]: '/', [TokenType.DOUBLE_SLASH]: '//', [TokenType.PERCENT]: '%' };
    while (mulOps[this.peek().type]) {
      const op = mulOps[this.advance().type];
      left = BinOp(op, left, this.parseUnary());
    }
    return left;
  }

  parseUnary() {
    if (this.at(TokenType.MINUS)) {
      this.advance();
      return UnaryOp('-', this.parseUnary());
    }
    return this.parsePow();
  }

  /** "base ** expoente" — associativo à direita ("2 ** 3 ** 2" == "2 ** (3 **
   * 2)") e liga mais forte que o "-" unário à esquerda mas permite "-" no
   * expoente ("2 ** -1"), igual Python: "-2 ** 2" vira UnaryOp('-', BinOp('**',
   * 2, 2)) = -4. */
  parsePow() {
    const base = this.parsePostfix();
    if (this.at(TokenType.DOUBLE_STAR)) {
      this.advance();
      return BinOp('**', base, this.parseUnary());
    }
    return base;
  }

  parsePostfix() {
    let expr = this.parsePrimary();
    for (;;) {
      if (this.at(TokenType.DOT)) {
        this.advance();
        const name = this.expect(TokenType.IDENT, 'Esperado nome de campo depois de "."');
        expr = Attribute(expr, name.value);
      } else if (this.at(TokenType.LBRACKET)) {
        this.advance();
        expr = this.parseSubscript(expr);
      } else if (this.at(TokenType.LPAREN)) {
        this.advance();
        const args = [];
        const kwargs = [];
        // "nome=valor" (argumento nomeado): IDENT seguido de "=" simples —
        // depois do primeiro, todos os seguintes também precisam ser nomeados
        const parseArg = () => {
          if (this.at(TokenType.IDENT) && this.tokens[this.pos + 1]?.type === TokenType.ASSIGN) {
            const name = this.advance().value;
            this.advance(); // "="
            if (kwargs.some((k) => k.name === name)) throw new ParseError(`Argumento "${name}" repetido`, this.peek().start);
            kwargs.push({ name, value: this.parseExpr() });
          } else {
            if (kwargs.length) throw new ParseError('Argumento posicional depois de argumento nomeado', this.peek().start);
            args.push(this.parseExpr());
          }
        };
        if (!this.at(TokenType.RPAREN)) {
          parseArg();
          while (this.at(TokenType.COMMA)) {
            this.advance();
            parseArg();
          }
        }
        this.expect(TokenType.RPAREN, 'Esperado ")"');
        expr = Call(expr, args, kwargs);
      } else {
        break;
      }
    }
    return expr;
  }

  /** Depois de já ter consumido "[": ou um índice simples ("[expr]"), ou um
   * slice ("[a:b]", "[a:b:c]", com qualquer uma das 3 partes omitida, ex:
   * "[:i]", "[i:]", "[::−1]"). Só descobre qual é olhando se aparece ":" logo
   * depois da primeira parte. */
  parseSubscript(object) {
    let start = null;
    if (!this.at(TokenType.COLON) && !this.at(TokenType.RBRACKET)) start = this.parseExpr();

    // "d[i, j]" é "d[(i, j)]" — índice tupla, igual Python
    if (start !== null && this.at(TokenType.COMMA)) {
      const elements = [start];
      while (this.at(TokenType.COMMA)) {
        this.advance();
        if (this.at(TokenType.RBRACKET)) break; // "d[i,]" é a tupla de um item
        elements.push(this.parseExpr());
      }
      this.expect(TokenType.RBRACKET, 'Esperado "]"');
      return Index(object, TupleLit(elements));
    }

    if (!this.at(TokenType.COLON)) {
      this.expect(TokenType.RBRACKET, 'Esperado "]"');
      return Index(object, start);
    }

    this.advance(); // ":"
    let stop = null;
    if (!this.at(TokenType.COLON) && !this.at(TokenType.RBRACKET)) stop = this.parseExpr();
    let step = null;
    if (this.at(TokenType.COLON)) {
      this.advance();
      if (!this.at(TokenType.RBRACKET)) step = this.parseExpr();
    }
    this.expect(TokenType.RBRACKET, 'Esperado "]"');
    return Slice(object, start, stop, step);
  }

  /** Lista de parâmetros de "def nome(...)" — cada um "nome" ou "nome=expr"
   * (valor default), separados por vírgula. Usada por `parseParams` (parse de
   * uma linha "def" inteira acontece em blockParser.js, que só extrai o texto
   * entre parênteses e delega pra cá). */
  parseParamList() {
    const params = [];
    if (!this.at(TokenType.EOF)) {
      params.push(this.parseParam());
      while (this.at(TokenType.COMMA)) {
        this.advance();
        params.push(this.parseParam());
      }
    }
    if (!this.at(TokenType.EOF)) throw new ParseError('Conteúdo inesperado na lista de parâmetros', this.peek().start);
    return params;
  }

  parseParam() {
    const name = this.expect(TokenType.IDENT, 'Esperado nome de parâmetro');
    if (this.at(TokenType.ASSIGN)) {
      this.advance();
      return { name: name.value, default: this.parseExpr() };
    }
    return { name: name.value, default: null };
  }

  /** "chave: valor" de um literal "{...}" — chave e valor são expressões
   * quaisquer (o avaliador que restringe chave a scalar/string, ver
   * evaluator.js#evaluate, caso 'DictLiteral'). */
  parseDictPair() {
    const key = this.parseExpr();
    this.expect(TokenType.COLON, 'Esperado ":" no par chave/valor do dicionário');
    const value = this.parseExpr();
    return [key, value];
  }

  parsePrimary() {
    const t = this.peek();
    if (t.type === TokenType.NUMBER) {
      this.advance();
      return NumberLit(t.value);
    }
    if (t.type === TokenType.STRING) {
      this.advance();
      return StrLit(t.value);
    }
    if (t.type === TokenType.FSTRING) {
      this.advance();
      return parseFStringParts(t.value);
    }
    if (t.type === TokenType.NONE) {
      this.advance();
      return NoneLit();
    }
    if (t.type === TokenType.TRUE) {
      this.advance();
      return BoolLit(true);
    }
    if (t.type === TokenType.FALSE) {
      this.advance();
      return BoolLit(false);
    }
    if (t.type === TokenType.IDENT) {
      this.advance();
      return Name(t.value);
    }
    if (t.type === TokenType.LBRACKET) {
      this.advance();
      const elements = [];
      if (!this.at(TokenType.RBRACKET)) {
        elements.push(this.parseExpr());
        // "[elemento for nome in iterável (if condição)]" — "for"/"if" não
        // são tokens de palavra-chave no lexer (os statements for/if são
        // reconhecidos por linha, em blockParser.js), então chegam aqui como
        // IDENT comum; `parseExpr` do elemento já para antes deles.
        if (this.atWord('for')) return this.parseListCompTail(elements[0]);
        while (this.at(TokenType.COMMA)) {
          this.advance();
          if (this.at(TokenType.RBRACKET)) break; // vírgula sobrando no fim, ex: "[1, 2, ]"
          elements.push(this.parseExpr());
        }
      }
      this.expect(TokenType.RBRACKET, 'Esperado "]"');
      return ArrayLit(elements);
    }
    if (t.type === TokenType.LBRACE) {
      this.advance();
      if (this.at(TokenType.RBRACE)) {
        this.advance();
        return DictLit([]); // "{}" é dict vazio, igual Python
      }
      // "{a: b, ...}" (dict) ou "{a, b, ...}" (set) — só dá pra saber pelo
      // que vem depois do primeiro elemento: ":" ou não.
      const first = this.parseExpr();
      if (!this.at(TokenType.COLON)) {
        const elements = [first];
        while (this.at(TokenType.COMMA)) {
          this.advance();
          if (this.at(TokenType.RBRACE)) break; // vírgula sobrando no fim
          elements.push(this.parseExpr());
        }
        this.expect(TokenType.RBRACE, 'Esperado "}"');
        return SetLit(elements);
      }
      this.advance(); // ":"
      const pairs = [[first, this.parseExpr()]];
      while (this.at(TokenType.COMMA)) {
        this.advance();
        if (this.at(TokenType.RBRACE)) break; // vírgula sobrando no fim
        pairs.push(this.parseDictPair());
      }
      this.expect(TokenType.RBRACE, 'Esperado "}"');
      return DictLit(pairs);
    }
    if (t.type === TokenType.LPAREN) {
      this.advance();
      if (this.at(TokenType.RPAREN)) {
        this.advance();
        return TupleLit([]); // "()" é a tupla vazia
      }
      const first = this.parseExpr();
      // "(expr)" sem vírgula é só agrupamento; com vírgula ("(a, b)",
      // "(a,)"), é tupla
      if (!this.at(TokenType.COMMA)) {
        this.expect(TokenType.RPAREN, 'Esperado ")"');
        return first;
      }
      const elements = [first];
      while (this.at(TokenType.COMMA)) {
        this.advance();
        if (this.at(TokenType.RPAREN)) break; // vírgula sobrando no fim
        elements.push(this.parseExpr());
      }
      this.expect(TokenType.RPAREN, 'Esperado ")"');
      return TupleLit(elements);
    }
    throw new ParseError('Expressão inválida', t.start);
  }
}

/** Token FSTRING (partes cruas, ver lexer.js#readFStringParts) -> nó
 * `FString`: cada campo tem o TEXTO da expressão parseado aqui, com um
 * Parser próprio; a posição de um erro dentro do campo é convertida pra
 * posição na linha inteira (`part.at`), pra marcar o lugar certo no editor. */
function parseFStringParts(parts) {
  return FString(
    parts.map((part) => {
      if (typeof part === 'string') return part;
      let expr;
      try {
        const sub = new Parser(tokenize(part.source));
        expr = sub.parseExpr();
        if (!sub.at(TokenType.EOF)) throw new ParseError('Conteúdo inesperado na expressão da f-string', sub.peek().start);
      } catch (err) {
        if (err instanceof LexError || err instanceof ParseError) err.at = (err.at ?? 0) + part.at;
        throw err;
      }
      return {
        expr,
        conv: part.conv,
        spec: part.spec ? parseFStringParts(part.spec) : null,
        debug: part.debug,
      };
    }),
  );
}

// o que a ferramenta já tem embutido, por módulo — importar outra coisa é
// erro (melhor que fingir que "import heapq" funcionou)
const IMPORTABLE = { collections: ['deque'] };
const FROM_IMPORT_RE = /^from\s+([A-Za-z_][\w.]*)\s+import\s+(.+)$/;
const IMPORT_RE = /^import\s+([A-Za-z_][\w.]*)$/;

/** "from collections import deque" / "import collections" (ver
 * ast.js#Import), ou `null` se a linha não é um import. Lança ParseError pra
 * um módulo/nome que a ferramenta não tem. */
function parseImport(source) {
  const line = source.replace(/#.*$/, '').trim();
  const from = line.match(FROM_IMPORT_RE);
  const plain = line.match(IMPORT_RE);
  if (!from && !plain) return null;
  const module = (from ?? plain)[1];
  const known = IMPORTABLE[module];
  if (!known) throw new ParseError(`Módulo "${module}" não disponível — só "from collections import deque"`, 0);
  if (plain) return Import(module, []);
  const names = from[2].replace(/^\(|\)$/g, '').split(',').map((n) => n.trim());
  const unknown = names.find((n) => !known.includes(n));
  if (unknown) throw new ParseError(`"${unknown}" não disponível em ${module} — só ${known.join(', ')}`, 0);
  return Import(module, names);
}

/**
 * Faz o parse de uma linha (`alvo = expressão`). Retorna `{ok: true, ast}`
 * ou `{ok: false, error: {message, at}}` — nunca lança. Linha vazia (só
 * espaço/comentário) devolve `ok: false` com mensagem específica, pra quem
 * chamar tratar como "nada a fazer" sem confundir com erro de sintaxe.
 */
export function parseStatement(source) {
  try {
    const imported = parseImport(source);
    if (imported) return { ok: true, ast: imported };
    const tokens = tokenize(source);
    if (tokens.length === 1) return { ok: false, error: { message: 'Linha vazia', at: 0 } };
    const ast = new Parser(tokens).parseStatement();
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      return { ok: false, error: { message: err.message, at: err.at } };
    }
    throw err;
  }
}

/**
 * Faz o parse da lista de parâmetros de "def nome(a, b=0):" (o texto ENTRE
 * os parênteses, já extraído por blockParser.js). Mesmo contrato de retorno
 * de `parseStatement`: `{ok, params}` (cada item `{name, default: ast|null}`)
 * ou `{ok, error}`.
 */
export function parseParams(source) {
  try {
    const tokens = tokenize(source);
    const params = new Parser(tokens).parseParamList();
    return { ok: true, params };
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      return { ok: false, error: { message: err.message, at: err.at } };
    }
    throw err;
  }
}

/**
 * Faz o parse de uma EXPRESSÃO isolada (sem "alvo =") — usado pelo
 * blockParser.js pra interpretar a condição de "if"/"while"/"elif". Mesmo
 * contrato de retorno de `parseStatement`: `{ok, ast}` ou `{ok, error}`.
 */
export function parseExpression(source) {
  try {
    const tokens = tokenize(source);
    if (tokens.length === 1) return { ok: false, error: { message: 'Expressão vazia', at: 0 } };
    const p = new Parser(tokens);
    const ast = p.parseExpr();
    if (!p.at(TokenType.EOF)) throw new ParseError('Conteúdo inesperado após a expressão', p.peek().start);
    return { ok: true, ast };
  } catch (err) {
    if (err instanceof LexError || err instanceof ParseError) {
      return { ok: false, error: { message: err.message, at: err.at } };
    }
    throw err;
  }
}
