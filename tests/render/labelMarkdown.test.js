// Markdown básico das labels de texto (modo "Texto"): estrutura por linha
// (`parseLabelMarkdown`), trechos formatados (`parseInline`) e geometria
// (`labelLayout`, medida fixa por caractere). O desenho em si (tspans) fica
// em tests/ui/App.test.js.
import { describe, expect, test } from 'vitest';
import {
  LABEL_HEADING_SCALE,
  LABEL_LINE_HEIGHT,
  LABEL_PAD_X,
  LABEL_PAD_Y,
  labelLayout,
  labelSourceSize,
  parseInline,
  parseLabelMarkdown,
} from '../../src/render/labelMarkdown.js';

/** Trechos resumidos: texto com marcas — B negrito, I itálico, C código. */
function trechos(src) {
  return parseInline(src).map((r) => `${r.bold ? 'B' : ''}${r.italic ? 'I' : ''}${r.code ? 'C' : ''}:${r.text}`);
}

describe('parseInline', () => {
  test('texto sem marcação vira um trecho só', () => {
    expect(trechos('olá mundo')).toEqual([':olá mundo']);
  });

  test('negrito, itálico, os dois e código', () => {
    expect(trechos('a **b** c')).toEqual([':a ', 'B:b', ': c']);
    expect(trechos('a __b__ c')).toEqual([':a ', 'B:b', ': c']);
    expect(trechos('a *b* c')).toEqual([':a ', 'I:b', ': c']);
    expect(trechos('a _b_ c')).toEqual([':a ', 'I:b', ': c']);
    expect(trechos('***tudo***')).toEqual(['BI:tudo']);
    expect(trechos('use `nums[i]` aqui')).toEqual([':use ', 'C:nums[i]', ': aqui']);
  });

  test('marcação aninhada', () => {
    expect(trechos('*a **b** c*')).toEqual(['I:a ', 'BI:b', 'I: c']);
    expect(trechos('**x `y` z**')).toEqual(['B:x ', 'BC:y', 'B: z']);
  });

  test('código não interpreta markdown dentro dele', () => {
    expect(trechos('`a*b*c`')).toEqual(['C:a*b*c']);
    expect(trechos('``a ` b``')).toEqual(['C:a ` b']);
  });

  test('marcação sem fechamento, cercada de espaço ou _ dentro de palavra fica como texto', () => {
    expect(trechos('**sem fim')).toEqual([':**sem fim']);
    expect(trechos('2 * 3 * 4')).toEqual([':2 * 3 * 4']);
    expect(trechos('soma_total_final')).toEqual([':soma_total_final']);
    expect(trechos('`aberto')).toEqual([':`aberto']);
  });

  test('barra invertida escapa a marcação', () => {
    expect(trechos('\\*não\\* itálico')).toEqual([':*não* itálico']);
  });
});

describe('parseLabelMarkdown', () => {
  test('títulos, listas e parágrafos, uma entrada por linha', () => {
    const linhas = parseLabelMarkdown('# Título\n## Sub\n### Seção\n- um\n* dois\n1. três\n12) quatro\ntexto\n\n#sem espaço');
    expect(linhas.map((l) => [l.kind, l.level ?? l.marker ?? null])).toEqual([
      ['heading', 1],
      ['heading', 2],
      ['heading', 3],
      ['bullet', '•'],
      ['bullet', '•'],
      ['ordered', '1.'],
      ['ordered', '12)'],
      ['p', null],
      ['p', null],
      ['p', null],
    ]);
    expect(linhas[0].runs).toEqual([{ text: 'Título', bold: false, italic: false, code: false }]);
    expect(linhas[9].runs[0].text).toBe('#sem espaço');
  });

  test('recuo de 2 espaços desce um nível de lista e troca o marcador', () => {
    const linhas = parseLabelMarkdown('- a\n  - b\n    - c\n  1. d');
    expect(linhas.map((l) => [l.depth, l.marker])).toEqual([
      [0, '•'],
      [1, '◦'],
      [2, '▪'],
      [1, '1.'],
    ]);
  });

  test('**negrito** no começo da linha não é item de lista', () => {
    const [linha] = parseLabelMarkdown('**forte** depois');
    expect(linha.kind).toBe('p');
    expect(linha.runs[0]).toMatchObject({ text: 'forte', bold: true });
  });

  test('bloco ``` é monoespaçado e literal; as linhas da cerca não aparecem', () => {
    const linhas = parseLabelMarkdown('antes\n```python\nx = **2**\n\n# não é título\n```\ndepois');
    expect(linhas.map((l) => l.kind)).toEqual(['p', 'code', 'code', 'code', 'p']);
    expect(linhas[1].runs).toEqual([{ text: 'x = **2**', bold: false, italic: false, code: true }]);
    expect(linhas[3].runs[0].text).toBe('# não é título');
  });
});

describe('labelLayout', () => {
  // medida fixa: 10 px por caractere a 20 px (0,5 em), sem depender de fonte
  const medida = (text, { size }) => String(text).length * size * 0.5;

  test('texto simples: uma linha, largura pelo texto, altura pela linha', () => {
    const l = labelLayout('abcd', 20, medida);
    expect(l.width).toBe(Math.round(LABEL_PAD_X + 40 + LABEL_PAD_X));
    expect(l.height).toBe(Math.round(LABEL_PAD_Y * 2 + 20 * LABEL_LINE_HEIGHT));
    expect(l.lines[0].segments).toEqual([{ text: 'abcd', x: LABEL_PAD_X, width: 40, size: 20, bold: false, italic: false, code: false }]);
  });

  test('título é maior e em negrito; aumenta a altura da linha', () => {
    const l = labelLayout('# T\nx', 20, medida);
    const size = 20 * LABEL_HEADING_SCALE[1];
    expect(l.lines[0].segments[0]).toMatchObject({ size, bold: true });
    expect(l.height).toBe(Math.round(LABEL_PAD_Y * 2 + (size + 20) * LABEL_LINE_HEIGHT));
    expect(l.lines[1].y).toBeCloseTo(LABEL_PAD_Y + size * LABEL_LINE_HEIGHT + 10 * LABEL_LINE_HEIGHT);
  });

  test('a marcação não conta na largura', () => {
    expect(labelLayout('**abcd**', 20, medida).width).toBe(labelLayout('abcd', 20, medida).width);
  });

  test('item de lista: marcador no recuo, texto depois dele', () => {
    const l = labelLayout('- a\n  - b', 20, medida);
    expect(l.lines[0].marker).toEqual({ text: '•', x: LABEL_PAD_X });
    expect(l.lines[0].segments[0].x).toBeGreaterThan(LABEL_PAD_X);
    expect(l.lines[1].marker.x).toBeGreaterThan(l.lines[0].marker.x);
    expect(l.lines[1].segments[0].x).toBeGreaterThan(l.lines[0].segments[0].x);
  });

  test('`código` ganha folga dos dois lados (fundo próprio)', () => {
    const l = labelLayout('a`b`c', 20, medida);
    const [a, b, c] = l.lines[0].segments;
    expect(b.code).toBe(true);
    expect(b.x).toBeGreaterThan(a.x + a.width);
    expect(c.x).toBeGreaterThan(b.x + b.width);
  });

  test('linhas seguidas de um bloco ``` formam um fundo só', () => {
    const l = labelLayout('x\n```\na\nb\n```\n```\nc\n```', 20, medida);
    const lineH = 20 * LABEL_LINE_HEIGHT;
    expect(l.lines.map((x) => x.kind)).toEqual(['p', 'code', 'code', 'code']);
    // os dois blocos são vizinhos (as cercas não ocupam linha) — viram um fundo só
    expect(l.codeBlocks).toEqual([{ y: LABEL_PAD_Y + lineH, height: lineH * 3 }]);
  });

  test('texto vazio ainda tem uma linha e a largura mínima', () => {
    const l = labelLayout('', 20, medida);
    expect(l.width).toBe(40);
    expect(l.height).toBe(Math.round(LABEL_PAD_Y * 2 + 20 * LABEL_LINE_HEIGHT));
  });
});

test('labelSourceSize mede o texto cru (editor in place, mono 0,6 em)', () => {
  expect(labelSourceSize('**ab**\nc', 20)).toEqual({
    width: Math.round(6 * 20 * 0.6) + LABEL_PAD_X * 2,
    height: Math.round(20 * LABEL_LINE_HEIGHT * 2) + LABEL_PAD_Y * 2,
  });
});

test('lista numerada: números alinhados à direita e textos na mesma coluna', () => {
  const medida = (text, { size }) => String(text).length * size * 0.5;
  const l = labelLayout('9. a\n  - sub\n10. b\n- outra lista\n1. c', 20, medida);
  const [nove, , dez, , um] = l.lines;
  expect(nove.segments[0].x).toBe(dez.segments[0].x);
  expect(nove.marker.x + medida('9.', { size: 20 })).toBe(dez.marker.x + medida('10.', { size: 20 }));
  // depois de outra lista, a numeração recomeça com a própria largura
  expect(um.marker.x).toBe(LABEL_PAD_X);
});
