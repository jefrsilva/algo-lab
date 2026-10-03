// Leitura do gráfico Big-O com o mouse sobre ele (issues #11 e #17): a função pura
// `chartReadout` (projeção do cursor no eixo n, arredondamento e escolha da
// curva) e a posição dos textos (`chartReadoutLabels`). O render e o gesto
// no App ficam em tests/ui/App.test.js.
import { describe, expect, test } from 'vitest';
import { chartLayout, chartReadout, chartReadoutLabels, chartYMax } from '../../src/render/MicroCanvasView.js';

const TODAS = ['1', 'logn', 'n', 'nlogn', 'n2'];

function grafico(extra = {}) {
  return { x: 0, y: 0, width: 400, height: 300, functions: TODAS, nMax: 12, yMode: 'manual', yMax: 12, ...extra };
}

/** Ponto local sobre (n, v) do gráfico — n pode ser fracionário. */
function ponto(chart, n, v) {
  const { px, py } = chartLayout(chart);
  return { x: px(n), y: py(v) };
}

describe('chartReadout', () => {
  test('arredonda n pro inteiro mais próximo e põe o ponto em (n, f(n))', () => {
    const c = grafico({ functions: ['n'] });
    const r = chartReadout(c, ponto(c, 7.6, 3));
    const { px, py } = chartLayout(c);
    expect(r).toEqual({ n: 8, value: 8, fnId: 'n', color: '#3b82f6', x: px(8), y: py(8) });
    expect(chartReadout(c, ponto(c, 7.4, 3)).n).toBe(7);
  });

  test('n fica em [0, floor(nMax)]', () => {
    const c = grafico({ functions: ['1'], nMax: 10.6 });
    const { plot } = chartLayout(c);
    expect(chartReadout(c, { x: plot.x, y: plot.y + plot.h - 1 }).n).toBe(0);
    // na ponta direita, round(10,6) = 11 passaria do eixo
    expect(chartReadout(c, { x: plot.x + plot.w, y: plot.y + plot.h - 1 }).n).toBe(10);
  });

  test('escolhe a curva de menor distância vertical até o cursor', () => {
    const c = grafico();
    // em n = 3: 1, log 3 ≈ 1,58, 3, 3·log 3 ≈ 4,75, 9
    expect(chartReadout(c, ponto(c, 3, 8)).fnId).toBe('n2');
    expect(chartReadout(c, ponto(c, 3, 4.5)).fnId).toBe('nlogn');
    expect(chartReadout(c, ponto(c, 3, 3.2)).fnId).toBe('n');
    expect(chartReadout(c, ponto(c, 3, 0.1)).fnId).toBe('1');
    const nlogn = chartReadout(grafico({ functions: ['nlogn'], yMax: 30 }), ponto(grafico({ yMax: 30 }), 8, 20));
    expect(nlogn).toMatchObject({ n: 8, value: 24, fnId: 'nlogn' });
  });

  test('só considera as funções marcadas', () => {
    const c = grafico({ functions: ['1', 'n2'] });
    expect(chartReadout(c, ponto(c, 3, 3)).fnId).toBe('1'); // n (3) não está marcada
  });

  test('ignora curvas acima de yMax e antes de `from`', () => {
    const c = grafico();
    // n = 6: n² = 36 e n log n ≈ 15,5 já saíram pelo topo (yMax 12) — com o
    // cursor lá no alto, a mais próxima que sobra é n (6)
    expect(chartReadout(c, ponto(c, 6, 11.9)).fnId).toBe('n');
    // n = 0: log n e n log n não existem; o cursor no fundo pega 0 de n/n², não log n
    const soLog = grafico({ functions: ['logn'] });
    expect(chartReadout(soLog, ponto(soLog, 0.2, 0))).toBeNull();
    expect(chartReadout(soLog, ponto(soLog, 1, 0))).toMatchObject({ n: 1, value: 0, fnId: 'logn' });
    expect(chartReadout(c, ponto(c, 0, 0)).fnId).not.toBe('logn');
  });

  test('null fora da área de plotagem e sem função marcada', () => {
    const c = grafico();
    const { plot } = chartLayout(c);
    expect(chartReadout(c, { x: plot.x - 1, y: plot.y + 10 })).toBeNull();
    expect(chartReadout(c, { x: plot.x + 10, y: plot.y + plot.h + 1 })).toBeNull();
    expect(chartReadout(c, { x: plot.x + plot.w + 5, y: plot.y + 10 })).toBeNull();
    expect(chartReadout(c, { x: plot.x + 10, y: plot.y - 1 })).toBeNull();
    expect(chartReadout(grafico({ functions: [] }), { x: plot.x + 10, y: plot.y + 10 })).toBeNull();
  });

  test('modo automático: o eixo vertical vai até caber a maior curva', () => {
    const c = grafico({ yMode: 'auto', nMax: 100, yMax: 1 });
    expect(chartYMax(c)).toBeGreaterThanOrEqual(10000);
    // em n = 100 nenhuma curva está acima do topo: o cursor lá em cima pega n²
    const { plot } = chartLayout(c);
    const r = chartReadout(c, { x: plot.x + plot.w, y: plot.y + 1 });
    expect(r).toMatchObject({ n: 100, value: 10000, fnId: 'n2' });
  });
});

describe('chartReadoutLabels', () => {
  test('n logo acima do eixo n; f(n) ao lado do ponto, sem sair do gráfico', () => {
    const c = grafico({ functions: ['n'] });
    const { plot } = chartLayout(c);
    const meio = chartReadout(c, ponto(c, 6, 6));
    const l = chartReadoutLabels(c, meio);
    expect(l.n).toMatchObject({ text: '6', x: meio.x });
    expect(l.n.y).toBeLessThan(plot.y + plot.h);
    expect(l.n.y).toBeGreaterThan(plot.y + plot.h - 16);
    expect(l.value).toMatchObject({ text: '6', anchor: 'start' });

    // na ponta direita e no topo: o texto vira pra esquerda e pra baixo
    const ponta = chartReadout(c, ponto(c, 12, 12));
    const lp = chartReadoutLabels(c, ponta);
    expect(lp.value.y).toBeGreaterThan(0);
    expect(lp.value.y).toBeLessThan(c.height);
    if (lp.value.anchor === 'start') expect(lp.value.x).toBeLessThan(c.width);
    else expect(lp.value.x).toBeGreaterThan(0);
  });

  test('valores fracionários saem formatados (log 5 ≈ 2,3)', () => {
    const c = grafico({ functions: ['logn'] });
    const r = chartReadout(c, ponto(c, 5, 2));
    expect(chartReadoutLabels(c, r).value.text).toBe('2,3');
  });
});

test('chartReadoutLabels: perto da origem, f(n) não cobre o n', () => {
  const c = grafico({ functions: ['n'] });
  const r = chartReadout(c, ponto(c, 0, 0));
  const l = chartReadoutLabels(c, r);
  expect(l.n.y - l.value.y).toBeGreaterThanOrEqual(13);
});
