// Programas da DSL com a saída que o PYTHON REAL imprime pra eles — o
// gabarito de programas.test.js (roda na DSL) e de python.test.js (confere,
// quando há python3 na máquina, que o próprio gabarito está certo).
//
// Pra acrescentar um caso: escreva o programa, rode no Python
// (`python3 programa.py`, com as classes de tests/dsl/prelude.py se usar
// Node/TreeNode) e cole a saída. Use só o que a DSL suporta (ver CLAUDE.md);
// limitações conhecidas ficam em bugs-conhecidos.test.js.
//
// `python: false` desliga a conferência com o Python pra um caso que não é
// Python válido (ex: depende de algo exclusivo da ferramenta).
//
// O texto começa numa linha nova (depois da crase) só por legibilidade — a
// primeira quebra de linha é descartada (ver `normalizar`).

/** Tira a quebra de linha logo depois da crase de abertura e a do fim. */
export const normalizar = (texto) => texto.replace(/^\n/, '').replace(/\n$/, '');

export const CASOS = [
  {
    nome: "aritmética, atribuição composta, comparação encadeada e lógica",
    codigo: `
a = 7
b = 2
print(a + b, a - b, a * b, a / b, a // b, a % b, a ** b)
print(-a // b, -a % b)
x = 10
x += 5
x -= 3
x *= 2
x //= 5
print(x)
print(0 <= x < 10, 1 < 2 > 3)
print(not True, True and False, None or 4)
print(min(4, 2, 9), max([1, 8, 3]), sum([1, 2, 3]))
`,
    saida: `
9 5 14 3.5 3 1 49
-4 1
4
True False
False False 4
2 8 6
`,
  },
  {
    nome: "textos, fatias e f-strings com spec/!r/=",
    codigo: `
s = "Olá mundo"
print(len(s), s.upper(), s.lower())
print(s[0], s[-1], s[1:3])
nome = "Ana"
idade = 30
print(f"{nome} tem {idade} anos")
print(f"{idade:5d}|{3.14159:.2f}|{nome!r}|{idade=}")
print("-".join(["a", "b", "c"]))
print("a,b,c".split(","))
print(str(42) + "!", len("abc") + 1)
`,
    saida: `
9 OLÁ MUNDO olá mundo
O o lá
Ana tem 30 anos
   30|3.14|'Ana'|idade=30
a-b-c
['a', 'b', 'c']
42! 4
`,
  },
  {
    nome: "listas: métodos, índices negativos, fatias, compreensão e enumerate",
    codigo: `
nums = [5, 3, 8, 1]
nums.append(9)
nums.insert(0, 7)
print(nums, len(nums))
print(nums.pop(), nums.pop(0), nums)
nums[1] = 30
print(nums, nums[-1], nums[1:3])
ordenada = sorted(nums)
print(ordenada, ordenada[::-1])
quad = [x * x for x in range(6) if x % 2 == 0]
print(quad)
print([0] * 3 + [1, 2])
print(3 in nums, 4 in nums)
for i, v in enumerate(nums):
    print(i, v)
`,
    saida: `
[7, 5, 3, 8, 1, 9] 6
9 7 [5, 3, 8, 1]
[5, 30, 8, 1] 1 [30, 8]
[1, 5, 8, 30] [30, 8, 5, 1]
[0, 4, 16]
[0, 0, 0, 1, 2]
False False
0 5
1 30
2 8
3 1
`,
  },
  {
    nome: "for/while com break/continue, range com passo e if/elif/else",
    codigo: `
total = 0
for i in range(10):
    if i == 7:
        break
    if i % 2 == 0:
        continue
    total += i
print(total)
n = 0
while n < 5:
    n += 1
else_val = n
print(else_val)
for i in range(10, 0, -3):
    print(i)
if total > 100:
    print("grande")
elif total > 5:
    print("medio")
else:
    print("pequeno")
`,
    saida: `
9
5
10
7
4
1
medio
`,
  },
  {
    nome: "funções recursivas, parâmetro padrão e argumento nomeado",
    codigo: `
def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)

def saudacao(nome, prefixo="Olá"):
    return f"{prefixo}, {nome}!"

print(fib(10))
print(saudacao("Bia"))
print(saudacao("Bia", prefixo="Oi"))

def soma_lista(xs):
    total = 0
    for x in xs:
        total += x
    return total

print(soma_lista([1, 2, 3, 4]))
`,
    saida: `
55
Olá, Bia!
Oi, Bia!
10
`,
  },
  {
    nome: "dicts: get, in, keys/values/items e contagem",
    codigo: `
d = {"a": 1, "b": 2}
d["c"] = 3
d["a"] += 10
print(d, len(d))
print("b" in d, "z" in d, d.get("z", 0))
for k in d:
    print(k, d[k])
print(list(d.keys()), list(d.values()))
for k, v in d.items():
    print(k, v)
cont = {}
for ch in "banana":
    cont[ch] = cont.get(ch, 0) + 1
print(cont)
`,
    saida: `
{'a': 11, 'b': 2, 'c': 3} 3
True False 0
a 11
b 2
c 3
['a', 'b', 'c'] [11, 2, 3]
a 11
b 2
c 3
{'b': 1, 'a': 3, 'n': 2}
`,
  },
  {
    nome: "sets de números na mesma ordem do CPython",
    codigo: `
s = {3, 1, 2}
s.add(10)
s.add(1)
print(s, len(s))
s.discard(3)
s.remove(2)
print(s, 2 in s, 10 in s)
t = set()
for x in [5, 4, 5, 33, 4, 1]:
    t.add(x)
print(t)
print(sorted(t))
`,
    saida: `
{10, 1, 2, 3} 4
{10, 1} False True
{33, 4, 5, 1}
[1, 4, 5, 33]
`,
  },
  {
    nome: "tuplas: desempacotamento, troca, chave de dict e elemento de set",
    codigo: `
t = (1, 2)
a, b = t
print(a, b, t)
a, b = b, a
print(a, b)
d = {}
d[0, 1] = "x"
d[(2, 3)] = "y"
print(d)
print(d[0, 1])
p = 3, 4
print(p, len(p), p[0])
visit = set()
visit.add((1, 2))
visit.add((1, 2))
print(len(visit), (1, 2) in visit)
`,
    saida: `
1 2 (1, 2)
2 1
{(0, 1): 'x', (2, 3): 'y'}
x
(3, 4) 2 3
1 True
`,
  },
  {
    nome: "deque: append/appendleft/pop/popleft/rotate e maxlen",
    codigo: `
from collections import deque
q = deque([1, 2, 3])
q.append(4)
q.appendleft(0)
print(q)
print(q.popleft(), q.pop(), q)
q.rotate(1)
print(q)
r = deque(maxlen=2)
r.append(1)
r.append(2)
r.append(3)
print(r, len(r))
`,
    saida: `
deque([0, 1, 2, 3, 4])
0 4 deque([1, 2, 3])
deque([3, 1, 2])
deque([2, 3], maxlen=2) 2
`,
  },
  {
    nome: "nós ligados (Node) percorridos em laço e em recursão",
    codigo: `
a = Node(1)
b = Node(2)
c = Node(3)
a.next = b
b.next = c
p = a
total = 0
while p is not None:
    total += p.data
    p = p.next
print(total)
def tamanho(no):
    if no is None:
        return 0
    return 1 + tamanho(no.next)
print(tamanho(a))
`,
    saida: `
6
3
`,
  },
  {
    nome: "matriz: criação por compreensão, escrita e leitura",
    codigo: `
m = [[0] * 3 for _ in range(2)]
m[1][2] = 5
m[0][0] = 1
print(m)
print(len(m), len(m[0]), m[1][2])
total = 0
for i in range(len(m)):
    for j in range(len(m[0])):
        total += m[i][j]
print(total)
`,
    saida: `
[[1, 0, 0], [0, 0, 5]]
2 3 5
6
`,
  },
  {
    nome: "BFS em grafo com dict de listas e deque",
    codigo: `
from collections import deque
grafo = {}
grafo[0] = [1, 2]
grafo[1] = [3]
grafo[2] = [3, 4]
grafo[3] = [5]
grafo[4] = [5]
grafo[5] = []
dist = {0: 0}
fila = deque([0])
ordem = []
while fila:
    u = fila.popleft()
    ordem.append(u)
    for v in grafo[u]:
        if v not in dist:
            dist[v] = dist[u] + 1
            fila.append(v)
print(ordem)
print(dist)
`,
    saida: `
[0, 1, 2, 3, 4, 5]
{0: 0, 1: 1, 2: 1, 3: 2, 4: 2, 5: 3}
`,
  },
  {
    nome: "busca binária dentro de função",
    codigo: `
def busca(nums, alvo):
    lo = 0
    hi = len(nums) - 1
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == alvo:
            return mid
        elif nums[mid] < alvo:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1

nums = [1, 3, 5, 7, 9, 11]
print(busca(nums, 7), busca(nums, 4), busca(nums, 1))
`,
    saida: `
3 -1 0
`,
  },
];
