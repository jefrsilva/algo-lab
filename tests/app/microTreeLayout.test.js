import { describe, expect, test } from 'vitest';
import { TREE_GAPS, treeLayout } from '../../src/app/microTreeLayout.js';

/** Árvore a partir de {id: [esquerdo, direito]}. */
const filhos = (arvore) => (id) => arvore[id] ?? [null, null];

/** BST com 50, 30, 70, 20, 40, 60, 80, 35, 65, 90 (inseridos nessa ordem). */
const BST = {
  50: ['30', '70'],
  30: ['20', '40'],
  70: ['60', '80'],
  40: ['35', null],
  60: [null, '65'],
  80: [null, '90'],
};

const OPTS = { w: 138, h: 56, siblingGap: 28, levelGap: 64 };

/** Caixas {id, x, y, w, h} a partir dos deslocamentos. */
const caixas = (pos, w, h) => [...pos].map(([id, { dx, dy }]) => ({ id, x: dx, y: dy, w, h }));

function semSobreposicao(boxes) {
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const separados = a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9 || a.y + a.h <= b.y + 1e-9 || b.y + b.h <= a.y + 1e-9;
      if (!separados) return `${a.id} e ${b.id} se sobrepõem`;
    }
  }
  return null;
}

/** Nível (profundidade) de cada nó da BST. */
const NIVEL = { 50: 0, 30: 1, 70: 1, 20: 2, 40: 2, 60: 2, 80: 2, 35: 3, 65: 3, 90: 3 };

describe('treeLayout na vertical', () => {
  const pos = treeLayout('50', filhos(BST), { orientation: 'vertical', ...OPTS });

  test('inclui todos os nós da subárvore, com a raiz parada', () => {
    expect([...pos.keys()].sort()).toEqual(Object.keys(NIVEL).sort());
    expect(pos.get('50')).toEqual({ dx: 0, dy: 0 });
  });

  test('cada nível numa mesma linha, um abaixo do outro', () => {
    Object.entries(NIVEL).forEach(([id, nivel]) => {
      expect(pos.get(id).dy).toBe(nivel * (OPTS.h + OPTS.levelGap));
    });
  });

  test('filho esquerdo à esquerda do pai e o direito à direita, pai no meio dos dois', () => {
    Object.entries(BST).forEach(([pai, [esq, dir]]) => {
      if (esq) expect(pos.get(esq).dx).toBeLessThan(pos.get(pai).dx);
      if (dir) expect(pos.get(dir).dx).toBeGreaterThan(pos.get(pai).dx);
      if (esq && dir) expect(pos.get(pai).dx).toBeCloseTo((pos.get(esq).dx + pos.get(dir).dx) / 2);
    });
  });

  test('nenhuma caixa se sobrepõe, e vizinhos do mesmo nível têm pelo menos a folga pedida', () => {
    expect(semSobreposicao(caixas(pos, OPTS.w, OPTS.h))).toBeNull();
    [1, 2, 3].forEach((nivel) => {
      const xs = Object.keys(NIVEL)
        .filter((id) => NIVEL[id] === nivel)
        .map((id) => pos.get(id).dx)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(OPTS.w + OPTS.siblingGap - 1e-9);
    });
  });

  test('compacta: dois irmãos folha ficam exatamente a uma caixa + folga de distância', () => {
    const p = treeLayout('a', filhos({ a: ['b', 'c'] }), { orientation: 'vertical', ...OPTS });
    expect(p.get('c').dx - p.get('b').dx).toBe(OPTS.w + OPTS.siblingGap);
  });

  test('filho único vai pro seu lado, no lugar em que estaria com irmão', () => {
    const soEsq = treeLayout('a', filhos({ a: ['b', null] }), { orientation: 'vertical', ...OPTS });
    const soDir = treeLayout('a', filhos({ a: [null, 'c'] }), { orientation: 'vertical', ...OPTS });
    expect(soEsq.get('b').dx).toBe(-(OPTS.w + OPTS.siblingGap) / 2);
    expect(soDir.get('c').dx).toBe((OPTS.w + OPTS.siblingGap) / 2);
  });

  test('subárvores fundas se afastam o bastante pra não colidir lá embaixo', () => {
    // a esquerda só desce pela direita e a direita só pela esquerda: elas se
    // cruzariam se só o 1º nível fosse levado em conta
    const arvore = { r: ['a', 'b'], a: [null, 'a1'], a1: [null, 'a2'], b: ['b1', null], b1: ['b2', null] };
    const p = treeLayout('r', filhos(arvore), { orientation: 'vertical', ...OPTS });
    expect(semSobreposicao(caixas(p, OPTS.w, OPTS.h))).toBeNull();
    expect(p.get('b2').dx - p.get('a2').dx).toBeGreaterThanOrEqual(OPTS.w + OPTS.siblingGap - 1e-9);
  });
});

describe('treeLayout na horizontal', () => {
  const opts = { orientation: 'horizontal', w: 138, h: 56, ...TREE_GAPS.horizontal.detailed };
  const pos = treeLayout('50', filhos(BST), opts);

  test('cada nível numa mesma coluna, da esquerda pra direita', () => {
    Object.entries(NIVEL).forEach(([id, nivel]) => {
      expect(pos.get(id).dx).toBe(nivel * (opts.w + opts.levelGap));
    });
  });

  test('filho esquerdo acima do direito', () => {
    Object.entries(BST).forEach(([pai, [esq, dir]]) => {
      if (esq) expect(pos.get(esq).dy).toBeLessThan(pos.get(pai).dy);
      if (dir) expect(pos.get(dir).dy).toBeGreaterThan(pos.get(pai).dy);
    });
  });

  test('nenhuma caixa se sobrepõe', () => {
    expect(semSobreposicao(caixas(pos, opts.w, opts.h))).toBeNull();
  });
});

describe('treeLayout com ciclos e nós compartilhados', () => {
  test('ciclo não trava: cada nó entra uma vez só', () => {
    const arvore = { a: ['b', 'c'], b: ['a', null], c: [null, 'a'] };
    const p = treeLayout('a', filhos(arvore), { orientation: 'vertical', ...OPTS });
    expect([...p.keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(p.get('a')).toEqual({ dx: 0, dy: 0 });
  });

  test('nó com dois pais fica sob o primeiro que o alcança', () => {
    const arvore = { a: ['b', 'c'], b: [null, 'x'], c: ['x', null] };
    const p = treeLayout('a', filhos(arvore), { orientation: 'vertical', ...OPTS });
    expect(p.size).toBe(4);
    expect(p.get('x').dx).toBeGreaterThan(p.get('b').dx);
  });

  test('um nó sozinho fica onde está', () => {
    const p = treeLayout('a', filhos({}), { orientation: 'horizontal', ...OPTS });
    expect([...p]).toEqual([['a', { dx: 0, dy: 0 }]]);
  });
});
