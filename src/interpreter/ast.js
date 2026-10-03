/**
 * Nós da AST produzidos pelo parser. Cada construtor é só um objeto plano
 * `{ type, ... }` — sem classes, pra ficar trivial de inspecionar/testar.
 *
 * `target` (usado em Assign) é sempre um `Name`, `Attribute` ou `Index` —
 * o parser garante isso (ver `parseTarget` em parser.js), mas o tipo aqui
 * não força porque `Attribute`/`Index` reaproveitam a mesma forma de nó
 * tanto como alvo (lado esquerdo) quanto como expressão comum (lado direito).
 */

export const Assign = (target, value) => ({ type: 'Assign', target, value });
/** "a, b = b, a" (troca) ou, mais geral, "alvo1, alvo2, ... = valor1, valor2,
 * ...", com ou sem parênteses em volta de cada lista — ver
 * parser.js#parseStatement. `targets`/`values` têm o mesmo tamanho (parser
 * garante isso na hora do parse) — exceto `values` com UM item só ("i, j =
 * chave"), que precisa ser uma tupla do tamanho certo na execução
 * (desempacotada por interpreter.js, caso 'TupleAssign'). Cada `targets[i]` é um `Name`,
 * `Attribute` ou `Index`, mesma regra do alvo de `Assign`. Nó SEPARADO de
 * `Assign` (não um `Assign` com listas) pra não mudar em nada quem já
 * consome `Assign.target`/`.value` como um valor único. Sem `+=`/`-=` etc
 * pra essa forma (Python também não tem). Sem `line` no construtor — mesmo
 * padrão de `Assign`: quem parseia uma linha só (`parseStatement`) não
 * carrega `line`, é o blockParser.js que anexa depois (`{...ast, line}`). */
export const TupleAssign = (targets, values) => ({ type: 'TupleAssign', targets, values });
/** "a = b = valor" (atribuição encadeada) — `value` é avaliado UMA vez só e
 * atribuído a cada alvo da esquerda pra direita, igual Python (ver
 * evaluator.js#assignChain: "a = b = []" deixa os dois nomes apontando pra
 * MESMA lista). Cada `targets[i]` segue a mesma regra do alvo de `Assign`.
 * Só com "=" puro — Python não aceita "a = b += 1". */
export const ChainAssign = (targets, value) => ({ type: 'ChainAssign', targets, value });
/** Statement de uma linha só que não é atribuição — só faz sentido pra uma
 * chamada com efeito colateral e sem valor útil de volta, ex: "arr.append(x)"
 * ou "arr.pop()" (ver parser.js#parseStatement). */
export const ExprStmt = (expr) => ({ type: 'ExprStmt', expr });

export const Name = (name) => ({ type: 'Name', name });
export const NumberLit = (value) => ({ type: 'Number', value });
export const StrLit = (value) => ({ type: 'Str', value });
/** f"texto {expr} texto" — `parts` alterna texto literal (string JS) e campos
 * `{expr, conv, spec, debug}`: `expr` é a AST da expressão; `conv` é
 * 'r'|'s'|'a'|null ("{x!r}"); `spec` é outro `FString` (o especificador de
 * formato pode ter campos aninhados, ex: "{x:>{largura}}") ou null; `debug` é
 * o texto "x=" de "{x=}" (impresso antes do valor) ou null. Avaliado em
 * evaluator.js (caso 'FString'), formatação em format.js. */
export const FString = (parts) => ({ type: 'FString', parts });
export const NoneLit = () => ({ type: 'NoneLiteral' });
export const BoolLit = (value) => ({ type: 'Bool', value });
export const ArrayLit = (elements) => ({ type: 'ArrayLiteral', elements });
/** "[elemento for nome in iterável]" / "[elemento for nome in iterável if
 * condição]" (list comprehension) — `varNames` tem 1 nome, ou 2 pra
 * "for i, v in enumerate(...)" (mesma regra do statement For); `cond` é
 * `null` sem "if". É o jeito idiomático de criar uma matriz zerada:
 * "[[0] * colunas for _ in range(linhas)]" (ver evaluator.js, caso 'ListComp'). */
export const ListComp = (element, varNames, iterExpr, cond) => ({ type: 'ListComp', element, varNames, iterExpr, cond });
/** "{chave: valor, ...}" — `pairs` é uma lista de `[chaveAst, valorAst]` (ver
 * parser.js#parseDictPair). Dicionário vazio "{}" tem `pairs: []`. */
export const DictLit = (pairs) => ({ type: 'DictLiteral', pairs });
/** "{a, b, c}" — set. Só com pelo menos um elemento: "{}" é dict vazio, igual
 * Python (set vazio é "set()", ver evaluator.js). */
export const SetLit = (elements) => ({ type: 'SetLiteral', elements });
/** "(a, b)", "(a,)", "()" — tupla. Também "d[a, b]" (vira "d[(a, b)]",
 * igual Python) e o lado direito sem parênteses de "t = a, b" (ver
 * parser.js). Parênteses com UMA expressão e sem vírgula ("(a + b)") são só
 * agrupamento, não tupla. */
export const TupleLit = (elements) => ({ type: 'TupleLiteral', elements });

export const Attribute = (object, attr) => ({ type: 'Attribute', object, attr });
export const Index = (object, index) => ({ type: 'Index', object, index });
/** "objeto[início:fim:passo]" — cada parte é uma AST ou `null` quando omitida
 * (ex: "a[:i]" tem `start: null`). Só suportado sobre o NOME direto de um
 * array de valores já vivo no modelo (mesma restrição de `Index`/`len` — ver
 * evaluator.js#evaluate, caso 'Slice'). */
export const Slice = (object, start, stop, step) => ({ type: 'Slice', object, start, stop, step });
/** `kwargs` (só presente se a chamada tem algum): argumentos nomeados
 * "f(a, nome=valor)", `{name, value}[]` na ordem escrita — hoje só
 * "deque(..., maxlen=n)" usa (ver evaluator.js, caso 'Call'). */
export const Call = (callee, args, kwargs = []) => ({ type: 'Call', callee, args, ...(kwargs.length ? { kwargs } : {}) });
/** "from collections import deque" / "import collections" — sem efeito na
 * execução (deque já é built-in da ferramenta), só aceito pra o código
 * copiado de Python de verdade não dar erro de sintaxe. Ver
 * parser.js#parseImport. */
export const Import = (module, names) => ({ type: 'Import', module, names });

/** `inplace` (só '+') marca o "x += valor" desenrolado pelo parser (ver
 * parser.js#parseAssignRhs): com "x" uma lista viva, estende a MESMA lista
 * em vez de criar outra (ver evaluator.js, caso 'BinOp'). */
export const BinOp = (op, left, right, inplace = false) => ({ type: 'BinOp', op, left, right, ...(inplace ? { inplace: true } : {}) });
export const UnaryOp = (op, operand) => ({ type: 'UnaryOp', op, operand });
/** Comparação encadeada "a < b <= c" (2+ operadores — uma comparação só é
 * um `BinOp`): `ops[k]` compara `operands[k]` com `operands[k + 1]`, cada
 * operando avaliado no máximo UMA vez, parando na primeira comparação falsa
 * — igual Python ("a < b and b < c", sem avaliar "b" duas vezes). `ops` usa
 * os mesmos nomes do `BinOp` ('<', '==', 'in', 'notin'...). Ver
 * parser.js#parseComparison e evaluator.js, caso 'Compare'. */
export const Compare = (operands, ops) => ({ type: 'Compare', operands, ops });
/** Expressão condicional "body if test else orelse" — só um dos dois ramos é
 * avaliado (depois do teste), igual Python. Ver parser.js#parseExpr,
 * evaluator.js (caso 'IfExp') e interpreter.js#resolveUserCalls (o ramo não
 * escolhido nunca chama função nenhuma — "return 1 if n <= 1 else n *
 * fat(n - 1)" para no caso base). */
export const IfExp = (test, body, orelse) => ({ type: 'IfExp', test, body, orelse });

/**
 * Statements de bloco (produzidos por blockParser.js, não pelo parser de uma
 * linha só) — cada um carrega `line` (índice 0-based da linha no código
 * fonte), usado pra destacar a linha em execução durante a reprodução.
 *
 * `orelse` de `If` segue a mesma convenção da AST do Python: uma lista de
 * statements — pode ser o corpo de um "else", uma lista de um único `If`
 * (pra representar "elif") ou vazia (nenhum else/elif).
 */
export const If = (test, body, orelse, line) => ({ type: 'If', test, body, orelse, line });
export const While = (test, body, line) => ({ type: 'While', test, body, line });
/** `iterExpr` é a AST do que vem depois do "in" — um `Name` (array já vivo no
 * modelo, iterado por `env.iterateArray`) ou uma chamada `range(...)`/
 * `enumerate(...)` (avaliada normalmente por `evaluate`, ver
 * interpreter.js#resolveIterable). `varNames` é sempre um array — 1 elemento
 * pro "for nome in ...:" comum, 2 pro "for i, v in enumerate(...):" (ver
 * blockParser.js#FOR_HEADER_RE); interpreter.js#execStmt (caso 'For') faz o
 * bind de `varNames[k]` com o k-ésimo item de cada elemento do iterável
 * quando o elemento é uma tupla JS (`[idx, valor]`, produzida só por
 * `enumerate`), ou de `varNames[0]` sozinho quando o elemento é um valor
 * tipado direto. */
export const For = (varNames, iterExpr, body, line) => ({ type: 'For', varNames, iterExpr, body, line });
/** "break" / "continue" — só fazem sentido dentro do corpo de um "for"/
 * "while" (ver interpreter.js#execStmt, sinais 'break'/'continue-loop', só
 * consumidos por While/For); soltos fora de loop nenhum, o efeito se perde
 * subindo até o topo do bloco que os contém, mesmo critério de "ignora
 * silenciosamente" usado por "return" fora de função. */
export const Break = (line) => ({ type: 'Break', line });
export const Continue = (line) => ({ type: 'Continue', line });

/** "def nome(a, b=0):" — só reconhecido no nível 0 de indentação (ver
 * blockParser.js#parseProgram), que já separa os `FunctionDef` da lista
 * principal de statements pra um dicionário `functions` à parte — não
 * aparece dentro de `program`/`body` de nenhum outro statement. Cada item de
 * `params` é `{name, default: ast|null}` (ver parser.js#parseParams) —
 * `default` é reavaliado a cada CHAMADA (não uma vez só na definição, como o
 * Python "de verdade" faz), simplificação aceitável pro modelo de execução
 * linha-a-linha da ferramenta (ver interpreter.js#callFunction). */
export const FunctionDef = (name, params, body, line) => ({ type: 'FunctionDef', name, params, body, line });
/** "return" (expr null, devolve None) ou "return expr" — só faz sentido
 * dentro do corpo de um `FunctionDef` (ver interpreter.js#callFunction). */
export const Return = (expr, line) => ({ type: 'Return', expr, line });
