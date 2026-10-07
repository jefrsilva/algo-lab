import { svgEl } from './svgUtils.js';
import { ARRAY_CELL_H } from '../core/micro/MicroModel.js';
import { labelLayout, LABEL_PAD_X, LABEL_CODE_PAD } from './labelMarkdown.js';
import { measureText, textMeasureGeneration } from './textMeasure.js';

// ---- geometria dos nós de estrutura (caixa prev | data | next) ----
export const STRUCT_W = 138;
export const STRUCT_H = 56;
export const STRUCT_PREV_W = 34;
export const STRUCT_NEXT_W = 34;
export const STRUCT_DATA_W = STRUCT_W - STRUCT_PREV_W - STRUCT_NEXT_W;
// raio do nó "simplificado" (Ctrl+A, ver App#_toggleMicroSimplifiedNodes) —
// inscrito na mesma caixa STRUCT_W x STRUCT_H do modo detalhado, então toda
// posição/hit-test/layout que já usa essas constantes continua valendo sem
// mudança nenhuma; só o DESENHO muda (caixa de 3 células vira um círculo).
export const STRUCT_CIRCLE_R = STRUCT_H / 2 - 2;

// ---- geometria dos ponteiros soltos ----
export const PTR_W = 96;
export const PTR_H = 32;

// ---- geometria das variáveis soltas (caixinha nome + valor) ----
export const VAR_W = 92;
export const VAR_H = 50;
export const VAR_HEADER_H = 18;

// ---- nomes de ponteiros/variáveis: truncados ou completos ----
// Modo padrão: nomes com mais de NAME_MAX_CHARS caracteres aparecem cortados
// ("nome_muito…", o "…" conta dentro do limite). Modo "nomes completos" (N,
// ver App#_toggleMicroFullNames): o nome inteiro, com a caixa alargando pra
// caber. Nos dois modos a largura sai do texto EXIBIDO — PTR_W/VAR_W são só
// o mínimo — e, como as demais geometrias deste arquivo, é estimada pela
// contagem de caracteres (fonte mono, ≈0.6em por caractere), sem medir o DOM.
export const NAME_MAX_CHARS = 10;
const PTR_LABEL_CHAR_W = 8.4; // .pointer-label: 14px mono
const PTR_LABEL_PAD = 32; // folga pros cantos arredondados + pino à direita
const VAR_NAME_CHAR_W = 7.2; // .variable-name: 12px mono
const VAR_VALUE_CHAR_W = 9.6; // .variable-value: 16px mono
const VAR_NAME_PAD = 16;

/** Texto exibido pra um nome, conforme o modo (`fullNames`). */
export function displayName(name, fullNames) {
  const s = String(name ?? '');
  if (fullNames || s.length <= NAME_MAX_CHARS) return s;
  return `${s.slice(0, NAME_MAX_CHARS - 1)}…`;
}

/** Largura da caixa de um ponteiro solto — cabe o nome exibido. */
export function pointerWidth(node, fullNames) {
  const chars = displayName(node.label, fullNames).length;
  return Math.max(PTR_W, Math.ceil(chars * PTR_LABEL_CHAR_W + PTR_LABEL_PAD));
}

/** Largura da caixa de uma variável solta — cabe o nome exibido e o valor
 * (ex: uma tupla "(10, 20)"). */
export function variableWidth(node, fullNames) {
  const chars = displayName(node.name, fullNames).length;
  const valueChars = cellText(node.value).length;
  return Math.max(VAR_W, Math.ceil(chars * VAR_NAME_CHAR_W + VAR_NAME_PAD), Math.ceil(valueChars * VAR_VALUE_CHAR_W + VAR_NAME_PAD));
}

// ---- geometria dos arrays ----
// o array não tem mais barra de título própria — o nome aparece num ponteiro
// dedicado que aponta pra ele (ver App#_createArrayLabelPointer), então o
// topo do array já começa nas células/índices.
export const ARRAY_CELL = ARRAY_CELL_H;
export const ARRAY_INDEX_H = 16; // horizontal: espaço acima das células para o índice
export const ARRAY_INDEX_W = 22; // vertical: espaço à esquerda das células para o índice
// set (array com `isSet`): folga entre as "pílulas" e a borda da caixa — nas
// laterais e embaixo (em cima já tem a faixa do rótulo "set"); na vertical,
// em volta toda (não tem faixa de índice).
export const SET_PAD = 7;
// colchete de janela deslizante (ver `_renderWindowBrackets`): distância da
// borda do array, altura das "pernas" e passo entre colchetes empilhados
const WINDOW_BRACKET_GAP = 7;
const WINDOW_BRACKET_DEPTH = 7;
const WINDOW_BRACKET_STEP = 11;

// ---- geometria dos dicts ----
// irmão visual do array (mesmas classes CSS, ver canvas.css) — célula um
// pouco mais larga que a de array pra caber chave de texto curta (nome,
// palavra pequena), já que o "índice" aqui é uma chave, não 1-2 dígitos.
export const DICT_CELL_W = 56;
export const DICT_CELL_H = 44;
export const DICT_KEY_BAND_H = 18; // horizontal: espaço acima das células para a chave
export const DICT_KEY_BAND_W = 32; // vertical: espaço à esquerda das células para a chave
const DICT_KEY_CHAR_W = 7.2; // .array-index-label: 12px mono

// ---- geometria das matrizes (grade linhas x colunas) ----
export const MATRIX_CELL = 44; // mesma célula quadrada do array (ARRAY_CELL)
export const MATRIX_ROW_BAND_W = 26; // faixa à esquerda com o índice de cada LINHA
export const MATRIX_COL_BAND_H = 18; // faixa em cima com o índice de cada COLUNA

export const PORT_R = 6; // raio visual/alvo de clique dos "pinos" de ligação
// afastamento do contorno de destaque (`.node-halo`, ver canvas.css) em
// relação à borda do nó — só visual, não entra em hit-test nem layout.
const HALO_GAP = 5;
// ponta de seta em unidades de mundo (markerUnits userSpaceOnUse): mesmo
// tamanho com traço normal ou selecionado (mais grosso), em vez de escalar
// junto com a espessura do traço.
const ARROW_SIZE = 15;

/** Retângulo de contorno de destaque ao redor de uma caixa `w x h` com cantos `rx`. */
function haloRect(w, h, rx, x = 0, y = 0) {
  return svgEl('rect', {
    class: 'node-halo',
    x: x - HALO_GAP,
    y: y - HALO_GAP,
    width: w + HALO_GAP * 2,
    height: h + HALO_GAP * 2,
    rx: rx + HALO_GAP,
    ry: rx + HALO_GAP,
  });
}

/** Cor padrão das labels de texto (ver App.js, LABEL_DEFAULT_COLOR) — quase
 * branca, sumiria no tema claro; renderizada com a cor de texto do tema. */
export const LABEL_THEME_COLOR = '#f0f8ff';

/** Cor CSS de fato usada pra desenhar uma label — a cor padrão (quase
 * branca) vira a cor de texto do tema; as demais ficam como estão. Usada
 * pelo render abaixo e pelo editor in place (App.js), pra combinarem. */
export function labelCssColor(color) {
  return String(color).toLowerCase() === LABEL_THEME_COLOR ? 'var(--text-0)' : color;
}

// ---- geometria das labels de texto (modo "Texto" da barra inferior) ----
// O texto é markdown básico (títulos, listas, negrito/itálico, `código`):
// estrutura e geometria em labelMarkdown.js, reexportadas daqui.
export { LABEL_PAD_X, LABEL_PAD_Y, LABEL_LINE_HEIGHT, labelLayout, labelSourceSize } from './labelMarkdown.js';

/** Tamanho de uma label já formatada (markdown) conforme o texto e o tamanho
 * de fonte — mesma ideia das demais geometrias deste arquivo (derivadas só
 * do conteúdo, nunca medidas via `getBBox`; a largura de cada trecho vem de
 * `measureText`, ver textMeasure.js), usado tanto pelo hit-test (App.js)
 * quanto pelo render abaixo. */
export function labelSize(text, fontSize) {
  const { width, height } = labelLayout(text, fontSize);
  return { width, height };
}

// ---- áreas hachuradas (modo "Área" da barra inferior) ----

/** Espaçamento do grid de pontos do fundo (ver `micro-grid-pattern` em
 * `_buildDefs`) — as áreas encaixam nele (ver App#_snapMicroArea). O ponto
 * de cada célula fica em (GRID_DOT, GRID_DOT), não na origem. */
export const GRID_SIZE = 26;
export const GRID_DOT = 1.5;

/** As 8 alças de redimensionamento de uma área selecionada (cantos + meios
 * das bordas), em coordenadas de mundo — mesma função no render e no
 * hit-test (App.js), igual às demais geometrias deste arquivo. `size` é o
 * lado da alça já convertido pra mundo (fixo na tela, independe do zoom). */
export function areaHandles(rect, size) {
  const { x, y, width: w, height: h } = rect;
  const xs = { w: x, c: x + w / 2, e: x + w };
  const ys = { n: y, c: y + h / 2, s: y + h };
  const defs = [
    ['nw', xs.w, ys.n],
    ['n', xs.c, ys.n],
    ['ne', xs.e, ys.n],
    ['e', xs.e, ys.c],
    ['se', xs.e, ys.s],
    ['s', xs.c, ys.s],
    ['sw', xs.w, ys.s],
    ['w', xs.w, ys.c],
  ];
  return defs.map(([dir, cx, cy]) => ({ dir, x: cx - size / 2, y: cy - size / 2, size }));
}

// ---- gráficos de complexidade (Big-O) ----

/** As funções clássicas da notação Big-O que um gráfico pode exibir — a
 * ordem é a de crescimento (e a das caixas no popup, ver
 * ChartSettingsPopup). `from`: primeiro n desenhado (log n < 0 antes de 1).
 * Cores do verde (melhor) ao vermelho (pior), legíveis nos dois temas. */
export const CHART_FUNCTIONS = [
  { id: '1', label: 'O(1)', color: '#22c55e', f: () => 1, from: 0 },
  { id: 'logn', label: 'O(log n)', color: '#06b6d4', f: (n) => Math.log2(n), from: 1 },
  { id: 'n', label: 'O(n)', color: '#3b82f6', f: (n) => n, from: 0 },
  { id: 'nlogn', label: 'O(n log n)', color: '#f97316', f: (n) => n * Math.log2(n), from: 1 },
  { id: 'n2', label: 'O(n²)', color: '#ef4444', f: (n) => n * n, from: 0 },
];
/** Escala padrão: n e f(n) de 0 a 12 nos dois eixos — as curvas saem bem
 * separadas (n² cruza o topo em ~29% da largura, n log n em ~41%, n na
 * diagonal, log n termina em ~30% da altura, 1 em ~8%). Cada gráfico pode
 * trocar isso pelo popup (ver ChartSettingsPopup): `nMax` (eixo n) e
 * `yMode` 'manual' (eixo vertical até `yMax`) | 'auto' (até caber a maior
 * função marcada em n = nMax, ver `chartYMax`). */
export const CHART_DEFAULT_RANGE = 12;
export const CHART_N_LIMITS = { min: 2, max: 1000 };
export const CHART_Y_LIMITS = { min: 1, max: 1e6 };
const CHART_AUTO_HEADROOM = 1.08; // folga no topo do modo automático (rótulo da maior curva à direita)
const CHART_SAMPLES = 160;
const CHART_PAD = { left: 36, right: 74, top: 24, bottom: 30 };
export const CHART_MIN_W = CHART_PAD.left + CHART_PAD.right + 80;
export const CHART_MIN_H = CHART_PAD.top + CHART_PAD.bottom + 60;
const CHART_AXIS_FONT = 12; // = .chart-axis-label (canvas.css)
const CHART_CURVE_FONT = 11; // = .chart-curve-label (canvas.css), fonte mono
const CHART_READOUT_FONT = 13; // = .chart-readout-n/.chart-readout-value (canvas.css)
const MONO_CHAR_W = 0.6; // largura de um caractere mono, em fração do tamanho da fonte

/** Largura estimada de um texto (sem medir o DOM, mesmo critério de `labelSize`). */
function chartTextWidth(text, fontSize) {
  return Math.max(24, String(text).length * fontSize * MONO_CHAR_W);
}

/** Limite do eixo n de um gráfico (padrão 12). */
export function chartNMax(chart) {
  const n = Number(chart.nMax);
  return Number.isFinite(n) && n > 0 ? n : CHART_DEFAULT_RANGE;
}

/** Limite do eixo vertical: o valor manual, ou — no modo automático — o
 * maior f(nMax) entre as funções marcadas (todas crescem com n), com uma
 * folga no topo. Sem função marcada, o automático acompanha n. */
export function chartYMax(chart) {
  if (chart.yMode === 'auto') {
    const nMax = chartNMax(chart);
    const values = CHART_FUNCTIONS.filter((fn) => (chart.functions || []).includes(fn.id)).map((fn) => fn.f(nMax));
    const top = values.length ? Math.max(...values) : nMax;
    // arredonda pra cima em 2 algarismos significativos (972 -> 980)
    const v = Math.max(1, top) * CHART_AUTO_HEADROOM;
    const step = 10 ** (Math.floor(Math.log10(v)) - 1);
    return Math.ceil(v / step - 1e-9) * step;
  }
  const y = Number(chart.yMax);
  return Number.isFinite(y) && y > 0 ? y : CHART_DEFAULT_RANGE;
}

const compactNumber = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
/** Valor de um limite de eixo como aparece no gráfico ("12", "1,2 mil", "1 mi"). */
export function formatChartNumber(v) {
  return Math.abs(v) < 10000 ? String(Math.round(v * 10) / 10).replace('.', ',') : compactNumber.format(v);
}

/** Geometria de um gráfico, em coordenadas LOCAIS (relativas a x/y do
 * gráfico): a área de plotagem, as curvas das funções em `functions` e os
 * retângulos dos títulos dos eixos (pro hit-test do duplo clique em App.js).
 * Mesma função no render e no hit-test, como as demais deste arquivo. */
export function chartLayout(chart) {
  const W = chart.width;
  const H = chart.height;
  const plot = {
    x: CHART_PAD.left,
    y: CHART_PAD.top,
    w: Math.max(10, W - CHART_PAD.left - CHART_PAD.right),
    h: Math.max(10, H - CHART_PAD.top - CHART_PAD.bottom),
  };
  const nMax = chartNMax(chart);
  const yMax = chartYMax(chart);
  const px = (n) => plot.x + (n / nMax) * plot.w;
  const py = (v) => plot.y + plot.h - (v / yMax) * plot.h;

  const curves = CHART_FUNCTIONS.filter((fn) => (chart.functions || []).includes(fn.id)).map((fn) => {
    const pts = [];
    let exit = 'right';
    let prev = null;
    for (let i = 0; i <= CHART_SAMPLES; i += 1) {
      const n = fn.from + ((nMax - fn.from) * i) / CHART_SAMPLES;
      const v = fn.f(n);
      if (v > yMax * (1 + 1e-9)) {
        // corta no topo, interpolando o ponto exato em que a curva cruza
        const t = prev ? (yMax - prev.v) / (v - prev.v) : 0;
        const nx = prev ? prev.n + (n - prev.n) * t : n;
        pts.push({ x: px(nx), y: py(yMax) });
        exit = 'top';
        break;
      }
      pts.push({ x: px(n), y: py(v) });
      prev = { n, v };
    }
    const end = pts[pts.length - 1];
    return { ...fn, pts, exit, end };
  });

  // rótulos "O(...)" na ponta de cada curva: à direita da plotagem (curvas
  // que chegam ao fim do eixo x) ou acima dela (as que saem pelo topo) —
  // empurrados pra não se sobreporem (pra baixo / pra direita).
  const labels = [];
  // à direita: empurra pra baixo; e, se o último passou do eixo n (curvas
  // achatadas juntas no fundo, ex: eixo vertical automático com n grande),
  // uma segunda passada de baixo pra cima empilha o grupo pra cima
  const rightOnes = curves.filter((c) => c.exit === 'right').sort((a, b) => a.end.y - b.end.y);
  const gap = CHART_CURVE_FONT + 3;
  const ys = [];
  rightOnes.forEach((c, i) => ys.push(i ? Math.max(c.end.y, ys[i - 1] + gap) : c.end.y));
  for (let i = ys.length - 1; i >= 0; i -= 1) {
    ys[i] = Math.min(ys[i], i === ys.length - 1 ? plot.y + plot.h - 4 : ys[i + 1] - gap);
  }
  rightOnes.forEach((c, i) => {
    labels.push({ id: c.id, text: c.label, color: c.color, x: plot.x + plot.w + 6, y: ys[i], anchor: 'start' });
  });
  const topOnes = curves.filter((c) => c.exit === 'top').sort((a, b) => a.end.x - b.end.x);
  let lastRight = -Infinity;
  topOnes.forEach((c) => {
    const w = chartTextWidth(c.label, CHART_CURVE_FONT);
    const cx = Math.max(c.end.x, lastRight + 6 + w / 2);
    lastRight = cx + w / 2;
    labels.push({ id: c.id, text: c.label, color: c.color, x: cx, y: plot.y - 9, anchor: 'middle' });
  });

  const xText = chart.xLabel || ' ';
  const yText = chart.yLabel || ' ';
  const xW = chartTextWidth(xText, CHART_AXIS_FONT) + 8;
  const yW = chartTextWidth(yText, CHART_AXIS_FONT) + 8;
  const xCenter = { x: plot.x + plot.w / 2, y: plot.y + plot.h + 17 };
  const yCenter = { x: 16, y: plot.y + plot.h / 2 };
  return {
    plot,
    nMax,
    yMax,
    // escalas n -> x e f(n) -> y (locais), as mesmas das curvas — ver chartReadout
    px,
    py,
    curves,
    labels,
    // limites dos eixos: n máximo sob a ponta do eixo n, valor máximo à
    // esquerda do topo do eixo vertical, "0" na origem
    ticks: [
      { text: '0', x: plot.x - 5, y: plot.y + plot.h + 9, anchor: 'end' },
      { text: formatChartNumber(nMax), x: plot.x + plot.w, y: plot.y + plot.h + 9, anchor: 'middle' },
      { text: formatChartNumber(yMax), x: plot.x - 5, y: plot.y, anchor: 'end' },
    ],
    xAxis: { center: xCenter, rect: { x: xCenter.x - xW / 2, y: xCenter.y - 10, width: xW, height: 20 } },
    // título do eixo y é girado 90° — o retângulo de hit-test é o girado
    yAxis: { center: yCenter, rect: { x: yCenter.x - 10, y: yCenter.y - yW / 2, width: 20, height: yW } },
  };
}

/** Leitura de um gráfico sob o cursor (mouse sobre ele, sem botão, ver
 * App#_updateMicroChartReadout): `localPt` em coordenadas LOCAIS do gráfico
 * é projetado no eixo n e arredondado pro inteiro mais próximo (em
 * [0, floor(nMax)]); entre as funções marcadas, vale a de menor distância
 * VERTICAL (na tela) entre o cursor e f(n) — ignorando as que já saíram pelo
 * topo (f(n) > yMax) e as que ainda não começaram (n < `from`, ex. log n em
 * n = 0). Devolve null fora da área de plotagem ou sem curva válida; senão
 * { n, value, fnId, color, x, y }, com x/y (locais) do ponto na curva. */
export function chartReadout(chart, localPt) {
  const { plot, nMax, yMax, px, py } = chartLayout(chart);
  if (localPt.x < plot.x || localPt.x > plot.x + plot.w || localPt.y < plot.y || localPt.y > plot.y + plot.h) {
    return null;
  }
  const n = Math.min(Math.floor(nMax), Math.max(0, Math.round(((localPt.x - plot.x) / plot.w) * nMax)));
  let best = null;
  CHART_FUNCTIONS.forEach((fn) => {
    if (!(chart.functions || []).includes(fn.id) || n < fn.from) return;
    const value = fn.f(n);
    if (!Number.isFinite(value) || value > yMax * (1 + 1e-9)) return;
    const y = py(value);
    const dist = Math.abs(y - localPt.y);
    if (!best || dist < best.dist) best = { n, value, fnId: fn.id, color: fn.color, x: px(n), y, dist };
  });
  if (!best) return null;
  const { dist, ...readout } = best;
  return readout;
}

/** Posição dos textos da leitura (ver chartReadout) dentro do gráfico: n
 * logo acima do eixo n, sob o ponto (abaixo dele ficam os limites e o título
 * do eixo); f(n) ao lado do ponto (à direita e
 * acima; à esquerda perto da borda direita, abaixo perto do topo), sempre
 * dentro do retângulo do gráfico. */
export function chartReadoutLabels(chart, readout) {
  const { plot } = chartLayout(chart);
  const nText = formatChartNumber(readout.n);
  const vText = formatChartNumber(readout.value);
  const nW = chartTextWidth(nText, CHART_READOUT_FONT);
  const vW = chartTextWidth(vText, CHART_READOUT_FONT);
  const nx = Math.min(chart.width - 4 - nW / 2, Math.max(4 + nW / 2, readout.x));
  const right = readout.x + 8 + vW <= chart.width - 4;
  const vx = right ? readout.x + 8 : Math.max(4 + vW, readout.x - 8);
  const above = readout.y - 10 >= CHART_READOUT_FONT / 2 + 2;
  let vy = above ? readout.y - 10 : Math.min(chart.height - CHART_READOUT_FONT, readout.y + 14);
  const ny = plot.y + plot.h - 10;
  // ponto rente ao eixo n (ex. f(0) = 0): f(n) sobe pra não cobrir o n
  const vLeft = right ? vx : vx - vW;
  const overlapX = vLeft < nx + nW / 2 && vLeft + vW > nx - nW / 2;
  if (overlapX && Math.abs(vy - ny) < CHART_READOUT_FONT + 3) vy = ny - CHART_READOUT_FONT - 3;
  return {
    n: { text: nText, x: nx, y: ny },
    value: { text: vText, x: vx, y: vy, anchor: right ? 'start' : 'end' },
    guide: { x: readout.x, y1: plot.y + plot.h, y2: readout.y },
  };
}

/** Largura de célula (array/matriz) que cabe o valor mais longo — a
 * quadrada de sempre (44px) basta pra números curtos, mas "False", "True" ou
 * um texto transbordariam pra célula vizinha. Estimativa pela contagem de
 * caracteres (fonte mono de 16px ≈ 9.6px por caractere, ver
 * `.array-value-label`), mesmo critério de `labelSize` (sem medir o DOM). */
function cellWidthFor(values) {
  const longest = values.reduce((acc, v) => Math.max(acc, cellText(v).length), 0);
  return Math.max(ARRAY_CELL, Math.ceil(longest * 9.6 + 16));
}

/** Layout puro de uma matriz (não depende de x/y do nó): células em grade,
 * índice de coluna na faixa de cima e de linha na faixa da esquerda. Altura
 * da célula fixa; largura igual pra todas, a que cabe o valor mais longo
 * (ver `cellWidthFor`). `cells` é uma lista plana (linha a linha). */
export function matrixLayout(node) {
  const rows = node.cells.length;
  const cols = rows ? node.cells[0].length : 0;
  const cellW = cellWidthFor(node.cells.flat());
  const width = MATRIX_ROW_BAND_W + Math.max(1, cols) * cellW;
  const height = MATRIX_COL_BAND_H + Math.max(1, rows) * MATRIX_CELL;
  const cells = [];
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      cells.push({
        row,
        col,
        x: MATRIX_ROW_BAND_W + col * cellW,
        y: MATRIX_COL_BAND_H + row * MATRIX_CELL,
        w: cellW,
        h: MATRIX_CELL,
      });
    }
  }
  const colLabels = Array.from({ length: cols }, (_, col) => ({
    col,
    x: MATRIX_ROW_BAND_W + col * cellW + cellW / 2,
    y: MATRIX_COL_BAND_H - 5,
  }));
  const rowLabels = Array.from({ length: rows }, (_, row) => ({
    row,
    x: MATRIX_ROW_BAND_W / 2,
    y: MATRIX_COL_BAND_H + row * MATRIX_CELL + MATRIX_CELL / 2 + 4,
  }));
  return { width, height, rows, cols, cellW, cells, colLabels, rowLabels };
}

/** Retângulo (mundo) de uma célula de matriz — usado pela edição inline (App.js). */
export function matrixCellRect(node, row, col) {
  const cellW = cellWidthFor(node.cells.flat());
  return {
    x: node.x + MATRIX_ROW_BAND_W + col * cellW,
    y: node.y + MATRIX_COL_BAND_H + row * MATRIX_CELL,
    width: cellW,
    height: MATRIX_CELL,
  };
}

/** Texto de um valor de célula (array/matriz/variável): booleano no estilo
 * Python ("True"/"False"), o resto como está. */
function cellText(v) {
  return typeof v === 'boolean' ? (v ? 'True' : 'False') : String(v);
}

/** Layout puro das células de um dict, conforme orientação — mesma ideia de
 * `arrayLayout`, mas o rótulo de cada célula é a CHAVE (`node.cells[i].key`,
 * texto arbitrário), não um índice posicional 0..n-1, e a faixa de rótulo é
 * um pouco maior pra caber isso (ver DICT_KEY_BAND_W/H). Chave ou valor
 * comprido (ex: tupla "(10, 20)") alarga a célula/faixa da chave — igual
 * pra todas as células, como no array (ver `cellWidthFor`). */
export function dictLayout(node) {
  const n = node.cells.length;
  const keyChars = node.cells.reduce((acc, c) => Math.max(acc, String(c.key).length), 0);
  const valueChars = node.cells.reduce((acc, c) => (c.kind === 'value' ? Math.max(acc, cellText(c.value).length) : acc), 0);
  const keyW = Math.ceil(keyChars * DICT_KEY_CHAR_W + 10);
  const valueW = Math.ceil(valueChars * 9.6 + 16); // .array-value-label: 16px mono
  if (node.orientation === 'vertical') {
    const bandW = Math.max(DICT_KEY_BAND_W, keyW);
    const cellW = Math.max(DICT_CELL_W, valueW);
    const width = bandW + cellW;
    const height = Math.max(DICT_CELL_H, n * DICT_CELL_H);
    const cells = node.cells.map((cell, i) => {
      const y = i * DICT_CELL_H;
      return {
        key: cell.key,
        x: bandW,
        y,
        w: cellW,
        h: DICT_CELL_H,
        keyX: bandW / 2,
        keyY: y + DICT_CELL_H / 2 + 4,
        port: { x: bandW + cellW, y: y + DICT_CELL_H / 2 },
      };
    });
    return { width, height, cells };
  }
  const cellW = Math.max(DICT_CELL_W, keyW, valueW);
  const width = Math.max(cellW, n * cellW);
  const height = DICT_KEY_BAND_H + DICT_CELL_H;
  const cells = node.cells.map((cell, i) => {
    const x = i * cellW;
    return {
      key: cell.key,
      x,
      y: DICT_KEY_BAND_H,
      w: cellW,
      h: DICT_CELL_H,
      keyX: x + cellW / 2,
      keyY: DICT_KEY_BAND_H - 5,
      port: { x: x + cellW / 2, y: DICT_KEY_BAND_H + DICT_CELL_H },
    };
  });
  return { width, height, cells };
}

/**
 * Ponto mais próximo do alvo (`anchor`) dentre os pontos da borda EXTERNA do
 * struct que ficam dentro da largura da célula prev/next: o lado de fora fixo
 * (esquerda pro prev, direita pro next) mais os trechos de cima/baixo que
 * pertencem àquela célula. A divisória interna entre células nunca entra como
 * candidata, então o pino nunca fica "por dentro" da caixa.
 *
 * `pairOffset` ({x,y}, calculado em App.js a partir de ligações struct<->struct
 * de ida e volta, ex: A.next -> B e B.prev -> A) é somado direto ao ponto
 * resolvido, sem reclampar na borda. Isso é necessário porque em nós vizinhos
 * "em escada" (bordas alinhadas na diagonal) os dois pinos convergem pro MESMO
 * canto — ali as duas bordas que formam o canto colapsam num único ponto sem
 * folga, então só um leve deslocamento pra fora da borda (perpendicular à
 * direção entre os dois nós, com sinais opostos pros dois lados da ligação)
 * consegue separá-los de fato.
 */
function structFieldPort(node, field, anchor, pairOffset) {
  const isPrev = field === 'prev';
  const cellLeft = isPrev ? node.x : node.x + STRUCT_PREV_W + STRUCT_DATA_W;
  const cellRight = cellLeft + (isPrev ? STRUCT_PREV_W : STRUCT_NEXT_W);
  const outerX = isPrev ? node.x : node.x + STRUCT_W;
  const top = node.y;
  const bottom = node.y + STRUCT_H;
  const midY = (top + bottom) / 2;

  let best;
  if (!anchor) {
    best = { x: outerX, y: midY };
  } else {
    const candidates = [
      { x: outerX, y: Math.min(Math.max(anchor.y, top), bottom) }, // lado externo (esquerda/direita)
      { x: Math.min(Math.max(anchor.x, cellLeft), cellRight), y: top }, // topo, dentro da célula
      { x: Math.min(Math.max(anchor.x, cellLeft), cellRight), y: bottom }, // base, dentro da célula
    ];
    best = candidates[0];
    let bestDist = Math.hypot(anchor.x - best.x, anchor.y - best.y);
    for (let i = 1; i < candidates.length; i += 1) {
      const d = Math.hypot(anchor.x - candidates[i].x, anchor.y - candidates[i].y);
      if (d < bestDist) {
        bestDist = d;
        best = candidates[i];
      }
    }
  }

  if (pairOffset && (pairOffset.x || pairOffset.y)) {
    return { x: best.x + pairOffset.x, y: best.y + pairOffset.y };
  }
  return best;
}

/**
 * Pino de um struct "simplificado" (Ctrl+A, ver App#_toggleMicroSimplifiedNodes)
 * — mesma ideia geral de `pointerPort` (sai na direção do alvo), mas na borda
 * de um CÍRCULO em vez de um retângulo: ponto de `STRUCT_CIRCLE_R` do centro,
 * na direção de `anchor`. Sem `anchor` (nenhum alvo ainda, arraste
 * manual criando o link do zero), cai num lado fixo (`fallbackDx` negativo
 * pro prev/left, positivo pro next/right) — mesmo papel do fallback de
 * `structFieldPort`, só que não precisa de pairOffset: como cada struct tem
 * UM único círculo (não duas células fixas), duas ligações não convergem
 * pro mesmo ponto por definição — a direção pro respectivo alvo já as
 * separa sozinha.
 */
function structCirclePort(node, anchor, fallbackDx) {
  const cx = node.x + STRUCT_W / 2;
  const cy = node.y + STRUCT_H / 2;
  if (!anchor) return { x: cx + fallbackDx, y: cy };
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  const len = Math.hypot(dx, dy) || 1;
  return { x: cx + (dx / len) * STRUCT_CIRCLE_R, y: cy + (dy / len) * STRUCT_CIRCLE_R };
}

/** Pino prev/left: por padrão no meio da borda esquerda, mas migra pro topo/base
 * da célula (sempre dentro da sua largura) se `node.prevAnchor` apontar pra lá
 * — ou, em modo `simplified`, sai direto da borda do círculo na direção do
 * alvo (ver `structCirclePort`). */
export function structPrevPort(node, simplified) {
  if (simplified) return structCirclePort(node, node.prevAnchor, -STRUCT_CIRCLE_R);
  return structFieldPort(node, 'prev', node.prevAnchor, node.prevPairOffset);
}

/** Pino next/right: por padrão no meio da borda direita, com a mesma lógica do prev. */
export function structNextPort(node, simplified) {
  if (simplified) return structCirclePort(node, node.nextAnchor, STRUCT_CIRCLE_R);
  return structFieldPort(node, 'next', node.nextAnchor, node.nextPairOffset);
}

/** Pino de um struct 'graph' simplificado em direção a UM vizinho específico
 * (ver App.js#_renderMicroOnly) — mesma geometria de `structCirclePort`
 * (ponto na borda do círculo, na direção do alvo), só exportada crua: um
 * GraphNode pode ter várias setas saindo ao mesmo tempo (grau arbitrário,
 * uma por vizinho), não só duas fixas como prev/next — por isso não é um
 * "structXPort" com nome de campo fixo, é genérico em qualquer direção. */
export function structNeighborPort(node, anchor) {
  return structCirclePort(node, anchor, STRUCT_CIRCLE_R);
}

/** Contorno (atributo `d` de um <path>, em coordenadas do mundo) do campo
 * de `node` que a ferramenta "Ligar nós" vai usar (ver App#_microLinkFieldAt):
 * 'prev' (prev/left) ou 'next' (next/right) — a célula daquele lado no modo
 * detalhado, a metade do círculo no simplificado — ou `null` num nó de grafo,
 * que liga pela lista "neighbors": a célula "nbrs" (detalhado) ou o círculo
 * todo (simplificado). Os cantos externos acompanham o arredondamento da
 * caixa (rx 8), pra o destaque não vazar dela. */
export function structLinkFieldPath(node, field, simplified) {
  if (simplified) {
    const cx = node.x + STRUCT_W / 2;
    const cy = node.y + STRUCT_H / 2;
    const r = STRUCT_CIRCLE_R;
    if (field == null) return `M ${cx} ${cy - r} A ${r} ${r} 0 0 1 ${cx} ${cy + r} A ${r} ${r} 0 0 1 ${cx} ${cy - r} Z`;
    // metade esquerda (prev/left) desce pelo arco anti-horário, a direita pelo horário
    return `M ${cx} ${cy - r} A ${r} ${r} 0 0 ${field === 'prev' ? 0 : 1} ${cx} ${cy + r} Z`;
  }
  const R = 8;
  const top = node.y;
  const bottom = node.y + STRUCT_H;
  if (field === 'prev') {
    const left = node.x;
    const right = node.x + STRUCT_PREV_W;
    return `M ${right} ${top} L ${left + R} ${top} Q ${left} ${top} ${left} ${top + R} L ${left} ${bottom - R} Q ${left} ${bottom} ${left + R} ${bottom} L ${right} ${bottom} Z`;
  }
  // 'next' e "nbrs" do grafo ocupam a mesma célula da direita
  const left = node.x + STRUCT_PREV_W + STRUCT_DATA_W;
  const right = node.x + STRUCT_W;
  return `M ${left} ${top} L ${right - R} ${top} Q ${right} ${top} ${right} ${top + R} L ${right} ${bottom - R} Q ${right} ${bottom} ${right - R} ${bottom} L ${left} ${bottom} Z`;
}

/** Retângulo clicável/editável do valor `data` — a célula do meio no modo
 * detalhado com prev/next ('list'/'tree'), a célula da ESQUERDA (mais larga,
 * sem célula prev/left antes dela) no modo detalhado 'graph', ou a caixa
 * TODA no modo simplificado (não há mais célula nenhuma separada, só o
 * círculo inteiro). */
export function structDataRect(node, simplified) {
  if (simplified) return { x: node.x, y: node.y, width: STRUCT_W, height: STRUCT_H };
  if (node.type === 'graph') return { x: node.x, y: node.y, width: STRUCT_PREV_W + STRUCT_DATA_W, height: STRUCT_H };
  return { x: node.x + STRUCT_PREV_W, y: node.y, width: STRUCT_DATA_W, height: STRUCT_H };
}

/**
 * Pino de conexão de um ponteiro solto: por padrão fica no lado direito, mas
 * se `node.anchor` (ponto mundial pro qual o ponteiro está mirando) for dado,
 * o pino migra pro lado da caixa (esquerda/direita/cima/baixo) mais alinhado
 * com a direção até o alvo — assim a linha sai do lado mais curto/natural.
 * `fullNames`: a largura da caixa depende do modo de nomes (ver `pointerWidth`).
 */
export function pointerPort(node, fullNames) {
  const w = pointerWidth(node, fullNames);
  const cx = node.x + w / 2;
  const cy = node.y + PTR_H / 2;
  const anchor = node.anchor;
  if (!anchor) return { x: node.x + w, y: cy };
  const dx = anchor.x - cx;
  const dy = anchor.y - cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { x: node.x + w, y: cy } : { x: node.x, y: cy };
  }
  return dy >= 0 ? { x: cx, y: node.y + PTR_H } : { x: cx, y: node.y };
}

export function variableValueRect(node, fullNames) {
  return { x: node.x, y: node.y + VAR_HEADER_H, width: variableWidth(node, fullNames), height: VAR_H - VAR_HEADER_H };
}

/** Orientação vertical de uma coleção: 'vertical' (índice 0 em cima) ou
 * 'stack' — a "pilha" de um array (só lista/deque, ver ArraySettingsPopup):
 * também na vertical, mas com os índices crescendo PARA CIMA, o último
 * elemento (o topo da pilha) no alto da caixa. Fora o `arrayLayout`, que
 * inverte a ordem das células, quase tudo trata as duas igual. */
export function isVerticalOrientation(orientation) {
  return orientation === 'vertical' || orientation === 'stack';
}

/** Espessura do "puxador" de array/dict/matriz (ver `handleRectFor`). */
const HANDLE = 11;

/** Puxador de uma coleção (array, dict, matriz) — uma aba FORA da caixa,
 * como a barra de título de uma janela: em cima (`vertical`) ou à esquerda,
 * relativo ao canto da caixa `width`x`height`. Soltar o pino de um ponteiro
 * nele liga o ponteiro à coleção INTEIRA (`{kind:'array'|'dict'|'matrix'}`),
 * não a uma posição; arrastar por ele move a coleção (ver
 * App#_findMicroHandleAt). Fora dos `*Layout` de propósito: não muda
 * largura/altura, então nada que depende delas (pinos, células, setas pras
 * células) se mexe. */
function handleRectFor(width, height, vertical) {
  return vertical ? { x: 0, y: -HANDLE, w: width, h: HANDLE } : { x: -HANDLE, y: 0, w: HANDLE, h: height };
}

/** Array: à esquerda no horizontal, em cima no vertical (a direita/embaixo
 * ficam pros pinos e pro colchete de janela deslizante). */
export function arrayHandleRect(node) {
  const { width, height } = arrayLayout(node);
  return handleRectFor(width, height, isVerticalOrientation(node.orientation));
}

/** Dict: mesma regra do array. */
export function dictHandleRect(node) {
  const { width, height } = dictLayout(node);
  return handleRectFor(width, height, node.orientation === 'vertical');
}

/** Matriz: sempre à esquerda — em cima já ficam os índices das colunas e o
 * rótulo com o nome. */
export function matrixHandleRect(node) {
  const { width, height } = matrixLayout(node);
  return handleRectFor(width, height, false);
}

/** Retângulo que cobre caixa + puxador (relativo ao canto da caixa) — pro
 * halo de seleção, pra seta que aponta pra coleção inteira e (App) pra
 * enquadrar a vista / achar espaço livre. */
export function boxWithHandle(width, height, handle) {
  const x0 = Math.min(0, handle.x);
  const y0 = Math.min(0, handle.y);
  return { x: x0, y: y0, w: width - x0, h: height - y0 };
}

/** Desenha o halo de seleção em volta de caixa + puxador, e o puxador em si
 * (com três pontinhos de "pegada"). Chamado ANTES de desenhar a caixa: o
 * puxador entra `boxR` por baixo dela, então só a aba de fora aparece,
 * colada na borda. */
function appendHandleAndHalo(el, width, height, handle, boxR) {
  const b = boxWithHandle(width, height, handle);
  el.appendChild(haloRect(b.w, b.h, boxR, b.x, b.y));
  const vertical = handle.y < 0;
  el.appendChild(
    svgEl('rect', {
      class: 'array-handle',
      x: handle.x,
      y: handle.y,
      width: handle.w + (vertical ? 0 : boxR),
      height: handle.h + (vertical ? boxR : 0),
      rx: 4,
      ry: 4,
    }),
  );
  const gripX = handle.x + handle.w / 2;
  const gripY = handle.y + handle.h / 2;
  [-5, 0, 5].forEach((d) =>
    el.appendChild(svgEl('circle', { class: 'array-handle-grip', cx: vertical ? gripX + d : gripX, cy: vertical ? gripY : gripY + d, r: 1.3 })),
  );
}

/** Layout puro (não depende de x/y do nó) das células de um array, conforme orientação. */
export function arrayLayout(node) {
  const n = node.cells.length;
  // largura da célula: a que cabe o valor mais longo (ver `cellWidthFor`);
  // array de referências (a nós ou, numa lista de listas, a listas) mostra
  // só ∅/pino, fica sempre na quadrada.
  const cellW = node.kind && node.kind !== 'value' ? ARRAY_CELL : cellWidthFor(node.cells);
  if (node.isSet) return setLayout(node, cellW);
  if (isVerticalOrientation(node.orientation)) {
    // pilha: a posição 0 fica embaixo e a última (o topo) em cima
    const stack = node.orientation === 'stack';
    // sem largura mínima artificial aqui — um array vertical só precisa da
    // faixa de índice + a própria célula, nunca mais largo que isso.
    const width = ARRAY_INDEX_W + cellW;
    // um array vazio (0 células, ex: logo depois de "arr = []") ainda precisa
    // de um frame visível — sem isso a caixa colapsaria pra altura zero.
    const height = Math.max(ARRAY_CELL, n * ARRAY_CELL);
    const cells = node.cells.map((_, i) => {
      const y = (stack ? n - 1 - i : i) * ARRAY_CELL;
      return {
        index: i,
        x: ARRAY_INDEX_W,
        y,
        w: cellW,
        h: ARRAY_CELL,
        indexX: ARRAY_INDEX_W / 2,
        indexY: y + ARRAY_CELL / 2 + 4,
        port: { x: ARRAY_INDEX_W + cellW, y: y + ARRAY_CELL / 2 },
      };
    });
    return { width, height, cells };
  }
  // sem largura mínima artificial aqui — um array horizontal vazio mostra só
  // uma célula de largura, e cresce exatamente pela soma das larguras das
  // células conforme "arr.append(x)" adiciona mais (mesmo espírito do
  // vertical, ver acima).
  const width = Math.max(cellW, n * cellW);
  const height = ARRAY_INDEX_H + ARRAY_CELL;
  const cells = node.cells.map((_, i) => {
    const x = i * cellW;
    return {
      index: i,
      x,
      y: ARRAY_INDEX_H,
      w: cellW,
      h: ARRAY_CELL,
      indexX: x + cellW / 2,
      indexY: ARRAY_INDEX_H - 5,
      port: { x: x + cellW / 2, y: ARRAY_INDEX_H + ARRAY_CELL },
    };
  });
  return { width, height, cells };
}

/** Largura (mundo) da faixa sensível de cada divisória entre duas células
 * de um array — ver `arrayDividers`. */
export const ARRAY_DIVIDER_HIT = 8;

/** Divisórias ENTRE duas células vizinhas de um array (relativas ao canto da
 * caixa): `at` é o índice da primeira célula depois da divisória — o ponto
 * de corte de um duplo clique ali (ver App#_splitMicroArray). Cobrem só a
 * faixa das células (a faixa de índice continua criando cursores). Set não
 * tem posição, então não tem divisória. */
export function arrayDividers(node) {
  if (node.isSet || node.cells.length < 2) return [];
  const half = ARRAY_DIVIDER_HIT / 2;
  const vertical = isVerticalOrientation(node.orientation);
  // na pilha a célula `at` fica ACIMA da anterior: a divisória é a borda de baixo dela
  const stack = node.orientation === 'stack';
  return arrayLayout(node).cells.slice(1).map((c) =>
    vertical
      ? { at: c.index, x: c.x, y: (stack ? c.y + c.h : c.y) - half, w: c.w, h: ARRAY_DIVIDER_HIT }
      : { at: c.index, x: c.x - half, y: c.y, w: ARRAY_DIVIDER_HIT, h: c.h },
  );
}

/** Distância entre as linhas dos rótulos de ponta (ver `arrayEndCaptions`). */
const END_CAPTION_LINE = 13;

/** Rótulos discretos das pontas de uma lista, relativos ao canto da caixa
 * (`{text, x, y}`, `y` = linha de base, sempre centralizados em `x`):
 * - deque: "início" na posição 0 e "fim" na última (-1); com um elemento só,
 *   os dois juntos, um acima do outro. `maxlen`, se houver, num rótulo à
 *   parte;
 * - lista em pilha (`orientation: 'stack'`): "topo" no último elemento.
 * Ficam do lado de FORA, onde nada mais mora: na horizontal acima da faixa
 * de índices (embaixo saem os pinos e chegam os cursores, à esquerda ficam o
 * puxador e o rótulo com o nome); na vertical acima do puxador (ponta de
 * cima) ou abaixo da caixa (ponta de baixo) — à direita chegam os cursores e
 * fica o colchete de janela, à esquerda o rótulo com o nome. Fora do layout:
 * hit-test não muda, e longe o bastante pra não encostar no halo de
 * seleção. Set não tem pontas. */
export function arrayEndCaptions(node) {
  if (node.isSet || (!node.isDeque && node.orientation !== 'stack')) return [];
  const layout = arrayLayout(node);
  const n = node.cells.length;
  // textos de cada posição (índice -> linhas, de cima pra baixo)
  const ends = new Map();
  if (n > 0) {
    if (node.isDeque) {
      if (n === 1) ends.set(0, ['início', 'fim']);
      else {
        ends.set(0, ['início']);
        ends.set(n - 1, ['fim']);
      }
    } else ends.set(n - 1, ['topo']);
  }
  const maxlen = node.isDeque && node.maxlen != null ? `maxlen=${node.maxlen}` : null;
  const out = [];
  // linhas empilhadas pra cima a partir da linha de base `baseY`
  const above = (lines, x, baseY) =>
    lines.forEach((text, k) => out.push({ text, x, y: baseY - (lines.length - 1 - k) * END_CAPTION_LINE }));
  if (!isVerticalOrientation(node.orientation)) {
    ends.forEach((lines, i) => {
      const c = layout.cells[i];
      above(lines, c.x + c.w / 2, -HALO_GAP - 4);
    });
    if (maxlen) out.push({ text: maxlen, x: layout.width + 6, y: layout.height / 2 + 4, anchor: 'start' });
    return out;
  }
  const midX = ARRAY_INDEX_W + (layout.width - ARRAY_INDEX_W) / 2;
  const top = [];
  const bottom = [];
  ends.forEach((lines, i) => {
    // com um elemento só, os dois rótulos vão juntos pra ponta de cima
    const atTop = n === 1 || layout.cells[i].y === 0;
    (atTop ? top : bottom).push(...lines);
  });
  if (maxlen) bottom.push(maxlen);
  const handle = arrayHandleRect(node);
  above(top, midX, handle.y - HALO_GAP - 4);
  bottom.forEach((text, k) => out.push({ text, x: midX, y: layout.height + HALO_GAP + 13 + k * END_CAPTION_LINE }));
  return out;
}

/** Caixa + puxador + rótulos de ponta de um array (relativo ao canto da
 * caixa) — o espaço que ele ocupa no canvas, pra (App) achar espaço livre
 * sem esconder um "início"/"topo" debaixo de outro elemento. */
export function arrayOuterBox(node) {
  const layout = arrayLayout(node);
  const b = boxWithHandle(layout.width, layout.height, arrayHandleRect(node));
  let x0 = b.x;
  let y0 = b.y;
  let x1 = b.x + b.w;
  let y1 = b.y + b.h;
  arrayEndCaptions(node).forEach((c) => {
    // .array-end-caption: 11px mono, peso 500
    const w = measureText(c.text, { size: 11, mono: true });
    const left = c.anchor === 'start' ? c.x : c.x - w / 2;
    x0 = Math.min(x0, left);
    x1 = Math.max(x1, left + w);
    y0 = Math.min(y0, c.y - 10);
    y1 = Math.max(y1, c.y + 3);
  });
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** `arrayLayout` de um set — mesmo formato de retorno (quem desenha, clica
 * ou liga setas não precisa saber a diferença), com `SET_PAD` de folga em
 * volta das células e sem faixa de índice na vertical. O pino de um set de
 * nós fica na borda da própria célula (dentro da caixa). */
function setLayout(node, cellW) {
  const n = node.cells.length;
  if (isVerticalOrientation(node.orientation)) {
    const width = cellW + 2 * SET_PAD;
    const height = Math.max(ARRAY_CELL, n * ARRAY_CELL) + 2 * SET_PAD;
    const cells = node.cells.map((_, i) => {
      const y = SET_PAD + i * ARRAY_CELL;
      return { index: i, x: SET_PAD, y, w: cellW, h: ARRAY_CELL, port: { x: SET_PAD + cellW, y: y + ARRAY_CELL / 2 } };
    });
    return { width, height, cells };
  }
  const width = Math.max(cellW, n * cellW) + 2 * SET_PAD;
  const height = ARRAY_INDEX_H + ARRAY_CELL + SET_PAD;
  const cells = node.cells.map((_, i) => {
    const x = SET_PAD + i * cellW;
    return { index: i, x, y: ARRAY_INDEX_H, w: cellW, h: ARRAY_CELL, port: { x: x + cellW / 2, y: ARRAY_INDEX_H + ARRAY_CELL } };
  });
  return { width, height, cells };
}

/**
 * Ponto da borda do retângulo (inflado por uma pequena margem, pra a seta não
 * encostar na caixa) mais próximo de `from`. Diferente de projetar um raio a
 * partir do centro do retângulo — que "aponta" pro lado certo mas nem sempre
 * cai no ponto geometricamente mais próximo, sobretudo perto dos cantos —
 * isso é o clássico "ponto mais próximo num AABB": clampa `from` nos limites
 * do retângulo inflado e, se `from` já estiver dentro dele, projeta pro lado
 * mais próximo.
 */
/** Perímetro externo (mundo) de uma coleção — caixa + puxador (ver
 * `boxWithHandle`), inflado por `margin` —, que as setas pras células usam
 * como borda de chegada e como área a contornar. Sem contar o puxador, uma
 * seta pousava embaixo da aba. */
function outerBounds(node, layout, handle, margin) {
  const b = boxWithHandle(layout.width, layout.height, handle);
  return {
    left: node.x + b.x - margin,
    right: node.x + b.x + b.w + margin,
    top: node.y + b.y - margin,
    bottom: node.y + b.y + b.h + margin,
  };
}

function rectEdgePoint(rect, from) {
  const margin = 6;
  const left = rect.x - margin;
  const right = rect.x + rect.w + margin;
  const top = rect.y - margin;
  const bottom = rect.y + rect.h + margin;

  const insideX = from.x > left && from.x < right;
  const insideY = from.y > top && from.y < bottom;
  if (!insideX || !insideY) {
    return {
      x: Math.min(Math.max(from.x, left), right),
      y: Math.min(Math.max(from.y, top), bottom),
    };
  }

  // `from` cai dentro do retângulo inflado (ex: nós sobrepostos) — projeta pro lado mais próximo
  const distLeft = from.x - left;
  const distRight = right - from.x;
  const distTop = from.y - top;
  const distBottom = bottom - from.y;
  const minDist = Math.min(distLeft, distRight, distTop, distBottom);
  if (minDist === distLeft) return { x: left, y: from.y };
  if (minDist === distRight) return { x: right, y: from.y };
  if (minDist === distTop) return { x: from.x, y: top };
  return { x: from.x, y: bottom };
}

/**
 * Ponto de chegada de uma seta que aponta para uma CÉLULA de array — só pousa
 * numa borda realmente EXPOSTA (o perímetro externo do array), nunca numa
 * divisória interna entre células: isso faria a seta atravessar as células
 * vizinhas por cima pra chegar lá, o que é exatamente o "passa por baixo/por
 * dentro do array" que fica difícil de acompanhar. Por isso topo/base (num
 * array horizontal) — ou esquerda/direita, num vertical — são sempre
 * candidatos válidos (toda célula de uma única linha/coluna toca o array só
 * por ali), enquanto o lado "ao longo" da fileira (esquerda/direita no
 * horizontal, topo/base no vertical) só entra como candidato quando a célula
 * é a primeira/última — a única situação em que aquele lado É o perímetro do
 * array, não uma divisória interna.
 */
function arrayCellEdgePoint(node, cellIndex, from) {
  const layout = arrayLayout(node);
  const cell = layout.cells[cellIndex];
  const margin = 6;
  const cellRect = { x: node.x + cell.x, y: node.y + cell.y, w: cell.w, h: cell.h };
  const outer = outerBounds(node, layout, arrayHandleRect(node), margin);
  // primeira/última célula NA TELA (de cima pra baixo / da esquerda pra
  // direita) — na pilha a posição 0 é a de baixo
  const stack = node.orientation === 'stack' && !node.isSet;
  const isFirst = cellIndex === (stack ? node.cells.length - 1 : 0);
  const isLast = cellIndex === (stack ? 0 : node.cells.length - 1);

  // cada candidato pousa no MEIO do lado (nunca num ponto deslizante alinhado
  // com `from`) — landing num canto da célula é tão ambíguo quanto landing
  // numa divisória interna (fica difícil dizer se é a célula ou a vizinha).
  const candidates = [];
  if (isVerticalOrientation(node.orientation)) {
    const cy = cellRect.y + cellRect.h / 2;
    candidates.push({ x: outer.left, y: cy }, { x: outer.right, y: cy });
    if (isFirst) candidates.push({ x: cellRect.x + cellRect.w / 2, y: outer.top });
    if (isLast) candidates.push({ x: cellRect.x + cellRect.w / 2, y: outer.bottom });
  } else {
    const cx = cellRect.x + cellRect.w / 2;
    candidates.push({ x: cx, y: outer.top }, { x: cx, y: outer.bottom });
    if (isFirst) candidates.push({ x: outer.left, y: cellRect.y + cellRect.h / 2 });
    if (isLast) candidates.push({ x: outer.right, y: cellRect.y + cellRect.h / 2 });
  }

  let best = candidates[0];
  let bestDist = Math.hypot(from.x - best.x, from.y - best.y);
  for (let i = 1; i < candidates.length; i += 1) {
    const d = Math.hypot(from.x - candidates[i].x, from.y - candidates[i].y);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

/**
 * Ponto de controle extra (bezier) que faz uma seta pra célula de array
 * ARQUEAR por fora do array em vez de atravessar por cima/por dentro dele —
 * necessário quando `from` está fora do array mas nivelado com ele (ex: um
 * cursor à esquerda mirando a última célula: a linha reta até a borda de
 * chegada cruzaria por baixo/por dentro de todas as células no meio do
 * caminho). Detecta esse cruzamento checando se o PONTO MÉDIO do segmento
 * cai dentro do retângulo do array — só nesse caso desvia o controle pra
 * fora, pro lado (topo/base no horizontal, esquerda/direita no vertical)
 * mais alinhado com onde `from` já está, preferindo topo/esquerda no empate
 * (evita "passar por baixo", o caso que fica mais confuso de acompanhar).
 * Devolve `null` quando não há cruzamento — o caminho reto de sempre serve.
 */
function arrayAvoidBulge(from, end, node) {
  const o = outerBounds(node, arrayLayout(node), arrayHandleRect(node), 6);
  const rect = { x: o.left, y: o.top, w: o.right - o.left, h: o.bottom - o.top };
  const midX = (from.x + end.x) / 2;
  const midY = (from.y + end.y) / 2;
  const crosses = midX > rect.x && midX < rect.x + rect.w && midY > rect.y && midY < rect.y + rect.h;
  if (!crosses) return null;
  const CLEARANCE = 22;
  if (isVerticalOrientation(node.orientation)) {
    const x = from.x > rect.x + rect.w / 2 ? rect.x + rect.w + CLEARANCE : rect.x - CLEARANCE;
    return { x, y: midY };
  }
  const y = from.y > rect.y + rect.h / 2 ? rect.y + rect.h + CLEARANCE : rect.y - CLEARANCE;
  return { x: midX, y };
}

/**
 * Ponto de chegada de uma seta pra uma CÉLULA de matriz — mesmo princípio de
 * `arrayCellEdgePoint` (só pousa no perímetro EXTERNO, nunca atravessando
 * outras células por cima), mas numa grade a célula pode estar no miolo, sem
 * nenhum lado exposto. Por isso os candidatos são os quatro lados externos
 * da matriz ALINHADOS com a célula — em cima/embaixo da coluna dela, à
 * esquerda/direita da linha dela —, e a seta pousa no mais próximo de
 * `from`. Junto com o destaque da célula e dos seus índices de linha/coluna
 * (ver `_renderMatrices`), dá pra ler a coordenada de relance.
 */
function matrixCellEdgePoint(node, row, col, from) {
  const layout = matrixLayout(node);
  const margin = 6;
  const cx = node.x + MATRIX_ROW_BAND_W + col * layout.cellW + layout.cellW / 2;
  const cy = node.y + MATRIX_COL_BAND_H + row * MATRIX_CELL + MATRIX_CELL / 2;
  const outer = outerBounds(node, layout, matrixHandleRect(node), margin);
  const candidates = [
    { x: cx, y: outer.top, nx: 0, ny: -1 },
    { x: cx, y: outer.bottom, nx: 0, ny: 1 },
    { x: outer.left, y: cy, nx: -1, ny: 0 },
    { x: outer.right, y: cy, nx: 1, ny: 0 },
  ];
  let best = candidates[0];
  let bestDist = Math.hypot(from.x - best.x, from.y - best.y);
  for (let i = 1; i < candidates.length; i += 1) {
    const d = Math.hypot(from.x - candidates[i].x, from.y - candidates[i].y);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

/** Equivalente de `arrayAvoidBulge` pra matriz: se a reta até o ponto de
 * chegada cruzaria a grade, puxa o controle da curva pra FORA, do lado em
 * que a seta pousa (`end.nx/ny`, ver `matrixCellEdgePoint`). */
function matrixAvoidBulge(from, end, node) {
  const o = outerBounds(node, matrixLayout(node), matrixHandleRect(node), 6);
  const rect = { x: o.left, y: o.top, w: o.right - o.left, h: o.bottom - o.top };
  const midX = (from.x + end.x) / 2;
  const midY = (from.y + end.y) / 2;
  const crosses = midX > rect.x && midX < rect.x + rect.w && midY > rect.y && midY < rect.y + rect.h;
  if (!crosses) return null;
  const CLEARANCE = 60;
  return { x: end.x + end.nx * CLEARANCE, y: end.y + end.ny * CLEARANCE };
}

/** Equivalente de `arrayCellEdgePoint` pra dict — mesma lógica (só pousa em
 * borda EXPOSTA, nunca numa divisória interna), mas localiza a célula por
 * CHAVE (`key`), não por índice posicional — o alvo de um ponteiro pra
 * célula de dict é sempre `{kind:'dictCell', dictId, key}` (ver
 * MicroModel.js), estável mesmo se a ordem das células mudar. */
function dictCellEdgePoint(node, key, from) {
  const layout = dictLayout(node);
  const cellIndex = node.cells.findIndex((c) => c.key === key);
  if (cellIndex === -1) return from;
  const cell = layout.cells[cellIndex];
  const margin = 6;
  const cellRect = { x: node.x + cell.x, y: node.y + cell.y, w: cell.w, h: cell.h };
  const outer = outerBounds(node, layout, dictHandleRect(node), margin);
  const isFirst = cellIndex === 0;
  const isLast = cellIndex === node.cells.length - 1;

  const candidates = [];
  if (node.orientation === 'vertical') {
    const cy = cellRect.y + cellRect.h / 2;
    candidates.push({ x: outer.left, y: cy }, { x: outer.right, y: cy });
    if (isFirst) candidates.push({ x: cellRect.x + cellRect.w / 2, y: outer.top });
    if (isLast) candidates.push({ x: cellRect.x + cellRect.w / 2, y: outer.bottom });
  } else {
    const cx = cellRect.x + cellRect.w / 2;
    candidates.push({ x: cx, y: outer.top }, { x: cx, y: outer.bottom });
    if (isFirst) candidates.push({ x: outer.left, y: cellRect.y + cellRect.h / 2 });
    if (isLast) candidates.push({ x: outer.right, y: cellRect.y + cellRect.h / 2 });
  }

  let best = candidates[0];
  let bestDist = Math.hypot(from.x - best.x, from.y - best.y);
  for (let i = 1; i < candidates.length; i += 1) {
    const d = Math.hypot(from.x - candidates[i].x, from.y - candidates[i].y);
    if (d < bestDist) {
      bestDist = d;
      best = candidates[i];
    }
  }
  return best;
}

/** Equivalente de `arrayAvoidBulge` pra dict. */
function dictAvoidBulge(from, end, node) {
  const o = outerBounds(node, dictLayout(node), dictHandleRect(node), 6);
  const rect = { x: o.left, y: o.top, w: o.right - o.left, h: o.bottom - o.top };
  const midX = (from.x + end.x) / 2;
  const midY = (from.y + end.y) / 2;
  const crosses = midX > rect.x && midX < rect.x + rect.w && midY > rect.y && midY < rect.y + rect.h;
  if (!crosses) return null;
  const CLEARANCE = 22;
  if (node.orientation === 'vertical') {
    const x = from.x > rect.x + rect.w / 2 ? rect.x + rect.w + CLEARANCE : rect.x - CLEARANCE;
    return { x, y: midY };
  }
  const y = from.y > rect.y + rect.h / 2 ? rect.y + rect.h + CLEARANCE : rect.y - CLEARANCE;
  return { x: midX, y };
}

/**
 * Renderer puro do modo "micro": desenha nós de estrutura (com sub-campos
 * prev/data/next), ponteiros soltos e as ligações entre eles. Não conhece
 * o modelo — recebe um snapshot já resolvido em coordenadas de mundo.
 */
export class MicroCanvasView {
  constructor(container) {
    this.container = container;
    this.svg = svgEl('svg', { class: 'graph-canvas micro-canvas' });
    this._buildDefs();
    this.viewport = svgEl('g', { class: 'viewport' });
    this.gridRect = svgEl('rect', {
      x: -20000,
      y: -20000,
      width: 40000,
      height: 40000,
      fill: 'url(#micro-grid-pattern)',
    });
    // áreas ficam atrás de TUDO (logo acima do grid) — marcam uma região do
    // canvas, não devem cobrir os elementos dentro dela; as alças de
    // redimensionamento, ao contrário, ficam por cima de tudo (ver render).
    this.areasLayer = svgEl('g', { class: 'areas-layer' });
    // gráficos de complexidade: acima das áreas, abaixo do resto — dá pra
    // pôr um elemento (ponteiro, label…) por cima do gráfico
    this.chartsLayer = svgEl('g', { class: 'charts-layer' });
    this.edgesLayer = svgEl('g', { class: 'edges-layer' });
    this.arraysLayer = svgEl('g', { class: 'arrays-layer' });
    this.dictsLayer = svgEl('g', { class: 'dicts-layer' });
    this.matricesLayer = svgEl('g', { class: 'matrices-layer' });
    this.structsLayer = svgEl('g', { class: 'structs-layer' });
    // destaque do campo da ferramenta "Ligar nós" (ver `_renderLinkSource`)
    this.linkSourceLayer = svgEl('g', { class: 'link-source-layer' });
    this.pointersLayer = svgEl('g', { class: 'pointers-layer' });
    this.variablesLayer = svgEl('g', { class: 'variables-layer' });
    this.labelsLayer = svgEl('g', { class: 'labels-layer' });
    this.areaHandlesLayer = svgEl('g', { class: 'area-handles-layer' });

    this.viewport.appendChild(this.gridRect);
    this.viewport.appendChild(this.areasLayer);
    this.viewport.appendChild(this.chartsLayer);
    this.viewport.appendChild(this.edgesLayer);
    this.viewport.appendChild(this.arraysLayer);
    this.viewport.appendChild(this.dictsLayer);
    this.viewport.appendChild(this.matricesLayer);
    this.viewport.appendChild(this.structsLayer);
    this.viewport.appendChild(this.linkSourceLayer);
    this.viewport.appendChild(this.pointersLayer);
    this.viewport.appendChild(this.variablesLayer);
    this.viewport.appendChild(this.labelsLayer);
    this.viewport.appendChild(this.areaHandlesLayer);
    this.svg.appendChild(this.viewport);
    this.container.appendChild(this.svg);

    this.structEls = new Map();
    this.pointerEls = new Map();
    this.arrayEls = new Map();
    this.dictEls = new Map();
    this.matrixEls = new Map();
    this.variableEls = new Map();
    this.labelEls = new Map();
    this.areaEls = new Map();
    this.chartEls = new Map();
    this.edgeEls = new Map();
    this._lastSelectedId = null;
  }

  _buildDefs() {
    const defs = svgEl('defs');
    const marker = svgEl('marker', {
      id: 'micro-arrowhead',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: ARROW_SIZE,
      markerHeight: ARROW_SIZE,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto-start-reverse',
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrowhead-path' }));
    defs.appendChild(marker);

    const selectedMarker = svgEl('marker', {
      id: 'micro-arrowhead-selected',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: ARROW_SIZE,
      markerHeight: ARROW_SIZE,
      markerUnits: 'userSpaceOnUse',
      orient: 'auto-start-reverse',
    });
    selectedMarker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrowhead-path-selected' }));
    defs.appendChild(selectedMarker);

    const pattern = svgEl('pattern', {
      id: 'micro-grid-pattern',
      width: GRID_SIZE,
      height: GRID_SIZE,
      patternUnits: 'userSpaceOnUse',
    });
    pattern.appendChild(svgEl('circle', { cx: GRID_DOT, cy: GRID_DOT, r: GRID_DOT, class: 'grid-dot' }));
    defs.appendChild(pattern);

    this.svg.appendChild(defs);
    this.defs = defs;
  }

  getSize() {
    const rect = this.container.getBoundingClientRect();
    return { width: rect.width || 600, height: rect.height || 400, left: rect.left, top: rect.top };
  }

  setViewport({ tx, ty, scale }) {
    this.viewport.setAttribute('transform', `translate(${tx}, ${ty}) scale(${scale})`);
  }

  screenToWorld(screenX, screenY, { tx, ty, scale }) {
    return { x: (screenX - tx) / scale, y: (screenY - ty) / scale };
  }

  /**
   * @param structs [{id,x,y,data,type:'list'|'tree'|'graph',selected}] `type` troca os rótulos
   *   prev/next -> left/right ('tree') ou a caixa inteira por data|neighbors ('graph'), ver `_renderStructs`
   * @param pointers [{id,x,y,label,selected}]
   * @param arrays [{id,x,y,kind,orientation,cells,selected}]
   * @param dicts [{id,x,y,orientation,cells:{key,kind,value}[],selected}]
   * @param variables [{id,x,y,name,value,selected}]
   * @param edges [{id,x1,y1,targetKind:'struct'|'arrayCell',targetId?,targetArrayId?,targetIndex?,fromStructId?}]
   *   o ponto de chegada (endpoint na borda do alvo) é calculado aqui a partir da posição atual dos nós.
   * @param previewEdge {x1,y1,x2,y2,valid}|null linha tracejada durante um arraste de ligação
   * @param linkSource {x,y,type,field}|null struct e campo ('prev'|'next'|null pra grafo) que a
   *   ferramenta "Ligar nós" usa — sob o mouse ou da ligação em andamento, ver `_renderLinkSource`
   * @param labels [{id,x,y,text,color,fontSize,selected,dragging}] labels de texto soltas (modo "Texto")
   * @param selectionRect {x0,y0,x1,y1}|null retângulo de seleção em área em andamento (modo Selecionar)
   * @param areas [{id,x,y,width,height,color,selected,dragging}] áreas hachuradas (modo "Área")
   * @param areaHandles {x,y,width,height,size}|null retângulo da área (ou do gráfico) com
   *   alças de redimensionamento visíveis (só quando exatamente uma área/gráfico está selecionado)
   * @param charts [{id,x,y,width,height,xLabel,yLabel,functions,selected,dragging,editingAxis}]
   *   gráficos de complexidade (Big-O), ver `_renderCharts`
   * @param simplifiedNodes bool — Ctrl+A (ver App#_toggleMicroSimplifiedNodes): troca a caixa
   *   prev/left|data|next/right de TODO struct por um círculo só com `data`, ponteiros prev/next
   *   (ou left/right) saindo direto da borda dele, só quando existem (ver `_renderStructs`)
   * @param fullNames bool — N (ver App#_toggleMicroFullNames): nomes de ponteiros/variáveis
   *   completos (caixa alarga) em vez de truncados em NAME_MAX_CHARS (ver `displayName`)
   * @param colors Map<id, cor CSS> — cor manual de struct/ponteiro/array/dict/matriz/variável
   *   (Alt+1…Alt+9, ver App#_applyMicroPaletteColor), ver `_applyColors`
   */
  render({
    structs,
    pointers,
    arrays,
    dicts = [],
    matrices = [],
    variables = [],
    labels = [],
    areas = [],
    areaHandles = null,
    charts = [],
    edges,
    previewEdge = null,
    linkSource = null,
    selectionRect = null,
    simplifiedNodes = false,
    fullNames = false,
    colors = new Map(),
    dimmedIds = new Set(),
  }) {
    const structById = new Map(structs.map((n) => [n.id, n]));
    const arrayById = new Map(arrays.map((n) => [n.id, n]));
    const dictById = new Map(dicts.map((n) => [n.id, n]));
    const matrixById = new Map(matrices.map((n) => [n.id, n]));
    this._renderAreas(areas);
    this._renderCharts(charts);
    this._renderAreaHandles(areaHandles);
    this._renderArrays(arrays, edges);
    this._renderDicts(dicts);
    this._renderMatrices(matrices);
    this._renderStructs(structs, simplifiedNodes);
    this._renderPointers(pointers, fullNames);
    this._renderVariables(variables, fullNames);
    this._applyColors(colors);
    this._applyDimming(dimmedIds);
    this._renderLabels(labels);
    this._renderEdges(edges, structById, arrayById, dictById, simplifiedNodes, matrixById);
    this._renderPreviewEdge(previewEdge);
    this._renderLinkSource(linkSource, simplifiedNodes);
    this._renderSelectionRect(selectionRect);

    const selected =
      structs.find((n) => n.selected) ??
      pointers.find((n) => n.selected) ??
      arrays.find((n) => n.selected) ??
      dicts.find((n) => n.selected) ??
      matrices.find((n) => n.selected) ??
      variables.find((n) => n.selected);
    const selectedId = selected ? selected.id : null;
    if (selectedId && selectedId !== this._lastSelectedId) {
      this._pulseSelect(
        this.structEls.get(selectedId) ??
          this.pointerEls.get(selectedId) ??
          this.arrayEls.get(selectedId) ??
          this.dictEls.get(selectedId) ??
          this.matrixEls.get(selectedId) ??
          this.variableEls.get(selectedId),
      );
    }
    this._lastSelectedId = selectedId;
  }

  /** Cor manual dos elementos: `--node-color` + classe `.micro-colored` no
   * <g> de cada elemento que tem uma — o CSS (ver `.micro-colored` em
   * canvas.css) redefine a partir dela os tokens de cor que as regras de
   * cada elemento já usam, então normal/selecionado/arrastando continuam
   * valendo, só que no matiz escolhido. */
  _applyColors(colors) {
    [this.structEls, this.pointerEls, this.arrayEls, this.dictEls, this.matrixEls, this.variableEls].forEach((els) => {
      els.forEach((el, id) => {
        const color = colors.get(id);
        el.classList.toggle('micro-colored', !!color);
        if (color) el.style.setProperty('--node-color', color);
        else el.style.removeProperty('--node-color');
      });
    });
  }

  /** Elementos fora do escopo da chamada em execução (ver
   * App#_microOutOfScopeIds) ganham `.micro-dimmed` — mais transparentes. */
  _applyDimming(dimmedIds) {
    [this.structEls, this.pointerEls, this.arrayEls, this.dictEls, this.matrixEls, this.variableEls].forEach((els) => {
      els.forEach((el, id) => el.classList.toggle('micro-dimmed', dimmedIds.has(id)));
    });
  }

  /** Faz o elemento selecionado pulsar uma vez (chamada ao mudar a seleção). */
  _pulseSelect(el) {
    if (!el) return;
    el.classList.remove('select-flash');
    void el.getBoundingClientRect(); // força reflow para poder reiniciar a animação
    el.classList.add('select-flash');
    const onEnd = () => {
      el.classList.remove('select-flash');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
  }

  _renderPreviewEdge(previewEdge) {
    if (!this._previewEl) {
      this._previewEl = svgEl('line', { class: 'preview-edge-line' });
      this.edgesLayer.appendChild(this._previewEl);
    }
    if (!previewEdge) {
      this._previewEl.setAttribute('display', 'none');
      return;
    }
    this._previewEl.removeAttribute('display');
    this._previewEl.setAttribute('x1', previewEdge.x1);
    this._previewEl.setAttribute('y1', previewEdge.y1);
    this._previewEl.setAttribute('x2', previewEdge.x2);
    this._previewEl.setAttribute('y2', previewEdge.y2);
    this._previewEl.classList.toggle('invalid', previewEdge.valid === false);
  }

  /** Destaque do campo de origem da ferramenta "Ligar nós" — a metade do
   * nó sob o mouse (qual ponteiro um clique ali usaria) ou o campo da ligação
   * em andamento (que Tab alterna). Mesmo padrão de `_renderPreviewEdge`: um
   * único elemento reaproveitado, escondido quando não há o que mostrar. */
  _renderLinkSource(linkSource, simplified) {
    if (!this._linkSourceEl) {
      this._linkSourceEl = svgEl('path', { class: 'link-source-shape' });
      this.linkSourceLayer.appendChild(this._linkSourceEl);
    }
    if (!linkSource) {
      this._linkSourceEl.setAttribute('display', 'none');
      return;
    }
    this._linkSourceEl.removeAttribute('display');
    this._linkSourceEl.setAttribute('d', structLinkFieldPath(linkSource, linkSource.field, simplified));
    this._linkSourceEl.dataset.field = linkSource.field ?? 'neighbors';
  }

  /** Retângulo tracejado do arraste de seleção em área (modo Selecionar,
   * arrastando a partir de espaço vazio) — mesmo padrão de `_renderPreviewEdge`
   * (um único elemento reaproveitado, escondido quando não há arraste). */
  _renderSelectionRect(rect) {
    if (!this._selectionRectEl) {
      this._selectionRectEl = svgEl('rect', { class: 'selection-rect' });
      this.viewport.appendChild(this._selectionRectEl);
    }
    if (!rect) {
      this._selectionRectEl.setAttribute('display', 'none');
      return;
    }
    this._selectionRectEl.removeAttribute('display');
    const x = Math.min(rect.x0, rect.x1);
    const y = Math.min(rect.y0, rect.y1);
    this._selectionRectEl.setAttribute('x', x);
    this._selectionRectEl.setAttribute('y', y);
    this._selectionRectEl.setAttribute('width', Math.abs(rect.x1 - rect.x0));
    this._selectionRectEl.setAttribute('height', Math.abs(rect.y1 - rect.y0));
  }

  /** Áreas (modo "Área") — um fundo translúcido da cor (20%, ver
   * `.area-fill`) e uma borda da mesma cor; quando selecionada,
   * ganha um contorno tracejado na cor de seleção (as alças de
   * redimensionamento ficam à parte, ver `_renderAreaHandles`). */
  _renderAreas(areas) {
    const ids = new Set(areas.map((n) => n.id));
    for (const [id, el] of this.areaEls) {
      if (!ids.has(id)) {
        el.remove();
        this.areaEls.delete(id);
      }
    }
    areas.forEach((node) => {
      let el = this.areaEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'area-node', 'data-id': node.id });
        el.appendChild(svgEl('rect', { class: 'area-fill' }));
        el.appendChild(svgEl('rect', { class: 'area-border' }));
        el.appendChild(svgEl('rect', { class: 'area-outline' }));
        // anexada só na criação (a lista vem na ordem de criação, então a
        // mais recente fica por cima — mesma ordem do hit-test em App.js).
        // Reanexar a cada render quebraria o `dblclick` do navegador (o nó
        // "muda de lugar" no DOM entre um clique e outro).
        this.areasLayer.appendChild(el);
        this.areaEls.set(node.id, el);
      }
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.querySelectorAll('rect').forEach((r) => {
        r.setAttribute('x', node.x);
        r.setAttribute('y', node.y);
        r.setAttribute('width', Math.max(0, node.width));
        r.setAttribute('height', Math.max(0, node.height));
      });
      el.querySelector('.area-fill').style.fill = node.color;
      el.querySelector('.area-border').style.stroke = node.color;
    });
  }

  /** Alças de redimensionamento da área selecionada — por cima de todas as
   * outras camadas, pra continuarem alcançáveis mesmo com elementos em cima
   * da borda da área (o hit-test em App.js também as testa primeiro). */
  _renderAreaHandles(rect) {
    this.areaHandlesLayer.innerHTML = '';
    if (!rect) return;
    areaHandles(rect, rect.size).forEach((h) => {
      this.areaHandlesLayer.appendChild(
        svgEl('rect', {
          class: `area-handle area-handle-${h.dir}`,
          x: h.x,
          y: h.y,
          width: h.size,
          height: h.size,
          rx: h.size * 0.2,
          'stroke-width': h.size * 0.18,
        }),
      );
    });
  }

  /** Gráficos de complexidade (Big-O): cartão de fundo, eixos com seta,
   * títulos dos eixos (renomeáveis), uma curva colorida por função
   * selecionada e o rótulo "O(...)" na ponta de cada uma (geometria em
   * `chartLayout`). Os filhos são criados uma vez só e depois só têm os
   * atributos atualizados — recriá-los a cada render quebraria o `dblclick`
   * (ver `_renderAreas`). */
  _renderCharts(charts) {
    const ids = new Set(charts.map((n) => n.id));
    for (const [id, el] of this.chartEls) {
      if (!ids.has(id)) {
        el.remove();
        this.chartEls.delete(id);
      }
    }
    charts.forEach((node) => {
      let el = this.chartEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'chart-node', 'data-id': node.id });
        el.appendChild(svgEl('rect', { class: 'chart-bg', rx: 10, ry: 10 }));
        el.appendChild(svgEl('path', { class: 'chart-axes' }));
        el.appendChild(svgEl('text', { class: 'chart-axis-label chart-x-label' }));
        el.appendChild(svgEl('text', { class: 'chart-axis-label chart-y-label' }));
        el.appendChild(svgEl('text', { class: 'chart-empty-hint' }));
        for (let i = 0; i < 3; i += 1) el.appendChild(svgEl('text', { class: 'chart-tick' }));
        CHART_FUNCTIONS.forEach((fn) => {
          el.appendChild(svgEl('polyline', { class: 'chart-curve', 'data-fn': fn.id, stroke: fn.color }));
          const label = svgEl('text', { class: 'chart-curve-label', 'data-fn': fn.id, fill: fn.color });
          label.textContent = fn.label;
          el.appendChild(label);
        });
        // leitura do mouse sobre o gráfico (ver chartReadout): criada uma vez, escondida sem leitura
        const readout = svgEl('g', { class: 'chart-readout', display: 'none' });
        readout.appendChild(svgEl('line', { class: 'chart-readout-guide' }));
        readout.appendChild(svgEl('circle', { class: 'chart-readout-dot', r: 4.5 }));
        readout.appendChild(svgEl('text', { class: 'chart-readout-n' }));
        readout.appendChild(svgEl('text', { class: 'chart-readout-value' }));
        el.appendChild(readout);
        el.appendChild(svgEl('rect', { class: 'chart-outline', rx: 10, ry: 10 }));
        this.chartsLayer.appendChild(el);
        this.chartEls.set(node.id, el);
      }
      const { plot, curves, labels, ticks, xAxis, yAxis } = chartLayout(node);
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.querySelectorAll('.chart-bg, .chart-outline').forEach((r) => {
        r.setAttribute('width', node.width);
        r.setAttribute('height', node.height);
      });

      // eixos: origem no canto inferior esquerdo da plotagem, setas nas pontas
      const ox = plot.x;
      const oy = plot.y + plot.h;
      const xEnd = plot.x + plot.w + 10;
      const yEnd = plot.y - 10;
      el.querySelector('.chart-axes').setAttribute(
        'd',
        `M ${ox} ${yEnd} L ${ox} ${oy} L ${xEnd} ${oy}` +
          ` M ${ox - 4} ${yEnd + 7} L ${ox} ${yEnd} L ${ox + 4} ${yEnd + 7}` +
          ` M ${xEnd - 7} ${oy - 4} L ${xEnd} ${oy} L ${xEnd - 7} ${oy + 4}`,
      );

      const xLabel = el.querySelector('.chart-x-label');
      xLabel.setAttribute('x', xAxis.center.x);
      xLabel.setAttribute('y', xAxis.center.y);
      xLabel.textContent = node.xLabel;
      xLabel.classList.toggle('editing', node.editingAxis === 'x');
      const yLabel = el.querySelector('.chart-y-label');
      yLabel.setAttribute('x', yAxis.center.x);
      yLabel.setAttribute('y', yAxis.center.y);
      yLabel.setAttribute('transform', `rotate(-90 ${yAxis.center.x} ${yAxis.center.y})`);
      yLabel.textContent = node.yLabel;
      yLabel.classList.toggle('editing', node.editingAxis === 'y');

      el.querySelectorAll('.chart-tick').forEach((text, i) => {
        const t = ticks[i];
        text.setAttribute('x', t.x);
        text.setAttribute('y', t.y);
        text.setAttribute('text-anchor', t.anchor);
        text.textContent = t.text;
      });

      const hint = el.querySelector('.chart-empty-hint');
      hint.setAttribute('x', plot.x + plot.w / 2);
      hint.setAttribute('y', plot.y + plot.h / 2);
      hint.textContent = curves.length ? '' : 'botão direito → funções';

      const curveById = new Map(curves.map((c) => [c.id, c]));
      const labelById = new Map(labels.map((l) => [l.id, l]));
      el.querySelectorAll('.chart-curve').forEach((line) => {
        const c = curveById.get(line.dataset.fn);
        line.setAttribute('display', c ? 'inline' : 'none');
        if (c) line.setAttribute('points', c.pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
      });
      el.querySelectorAll('.chart-curve-label').forEach((text) => {
        const l = labelById.get(text.dataset.fn);
        text.setAttribute('display', l ? 'inline' : 'none');
        if (!l) return;
        text.setAttribute('x', l.x);
        text.setAttribute('y', l.y);
        text.setAttribute('text-anchor', l.anchor);
      });

      const readoutEl = el.querySelector('.chart-readout');
      readoutEl.setAttribute('display', node.readout ? 'inline' : 'none');
      if (node.readout) {
        const r = node.readout;
        const pos = chartReadoutLabels(node, r);
        const guide = readoutEl.querySelector('.chart-readout-guide');
        guide.setAttribute('x1', pos.guide.x);
        guide.setAttribute('x2', pos.guide.x);
        guide.setAttribute('y1', pos.guide.y1);
        guide.setAttribute('y2', pos.guide.y2);
        guide.setAttribute('stroke', r.color);
        const dot = readoutEl.querySelector('.chart-readout-dot');
        dot.setAttribute('cx', r.x);
        dot.setAttribute('cy', r.y);
        dot.setAttribute('fill', r.color);
        const nText = readoutEl.querySelector('.chart-readout-n');
        nText.setAttribute('x', pos.n.x);
        nText.setAttribute('y', pos.n.y);
        nText.textContent = pos.n.text;
        const vText = readoutEl.querySelector('.chart-readout-value');
        vText.setAttribute('x', pos.value.x);
        vText.setAttribute('y', pos.value.y);
        vText.setAttribute('text-anchor', pos.value.anchor);
        // f(n) na cor de texto do tema (canvas.css), não na da curva — destaca o valor
        vText.textContent = pos.value.text;
      }
    });
  }

  /** Labels de texto soltas no canvas (modo "Texto") — uma caixa (visível só
   * quando selecionada, ver `.label-box`) mais o texto em si, com cor/tamanho
   * próprios (`node.color`/`node.fontSize`, ajustáveis via
   * `LabelSettingsPopup`). O texto é markdown básico, formatado aqui a partir
   * de `labelLayout` (labelMarkdown.js): um `<tspan>` posicionado por trecho
   * (negrito/itálico/código/tamanho de título), marcadores de lista e fundos
   * dos `código`s e blocos ``` atrás do texto (`.label-code-bg`). */
  _renderLabels(labels) {
    const ids = new Set(labels.map((n) => n.id));
    for (const [id, el] of this.labelEls) {
      if (!ids.has(id)) {
        el.remove();
        this.labelEls.delete(id);
      }
    }
    labels.forEach((node) => {
      let el = this.labelEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'label-node', 'data-id': node.id });
        const box = svgEl('rect', { class: 'label-box', rx: 6, ry: 6 });
        const bgs = svgEl('g', { class: 'label-code-bgs' });
        const text = svgEl('text', { class: 'label-text' });
        el.appendChild(box);
        el.appendChild(bgs);
        el.appendChild(text);
        this.labelsLayer.appendChild(el);
        this.labelEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      // em edição in place: o texto some por baixo do editor (ver App#_editMicroLabelInPlace)
      el.classList.toggle('editing', !!node.editing);
      const textEl = el.querySelector('.label-text');
      // via style (não atributo) pra aceitar var(); cor escolhida pelo usuário
      // é mantida como está, só a padrão acompanha o tema. Os fundos de
      // código herdam a cor (currentColor, ver canvas.css).
      el.style.color = labelCssColor(node.color);
      textEl.style.fill = labelCssColor(node.color);
      // refeito só quando o texto/tamanho muda — ou quando as medidas de
      // fonte mudam (fontes terminaram de carregar, ver textMeasure.js)
      const sig = `${node.fontSize}|${textMeasureGeneration()}|${node.text}`;
      if (textEl.dataset.sig === sig) return;
      textEl.dataset.sig = sig;
      const layout = labelLayout(node.text, node.fontSize);
      const box = el.querySelector('.label-box');
      box.setAttribute('width', layout.width);
      box.setAttribute('height', layout.height);
      this._fillLabelText(textEl, el.querySelector('.label-code-bgs'), layout);
    });
  }

  /** Conteúdo formatado de uma label (ver `_renderLabels`). */
  _fillLabelText(textEl, bgs, layout) {
    textEl.textContent = '';
    bgs.textContent = '';
    layout.codeBlocks.forEach((b) => {
      bgs.appendChild(
        svgEl('rect', {
          class: 'label-code-bg block',
          x: LABEL_PAD_X,
          y: b.y,
          width: layout.width - LABEL_PAD_X * 2,
          height: b.height,
          rx: 4,
          ry: 4,
        }),
      );
    });
    layout.lines.forEach((line) => {
      if (line.marker) {
        const m = svgEl('tspan', { class: 'md-marker', x: line.marker.x, y: line.y, 'font-size': line.size });
        m.textContent = line.marker.text;
        textEl.appendChild(m);
      }
      line.segments.forEach((seg) => {
        const attrs = { x: seg.x, y: line.y, 'font-size': seg.size };
        if (seg.bold) attrs['font-weight'] = 700;
        if (seg.italic) attrs['font-style'] = 'italic';
        if (seg.code) attrs.class = 'md-code';
        const t = svgEl('tspan', attrs);
        t.textContent = seg.text;
        textEl.appendChild(t);
        if (seg.code && line.kind !== 'code') {
          const pad = seg.size * LABEL_CODE_PAD;
          const h = seg.size * 1.25;
          bgs.appendChild(
            svgEl('rect', {
              class: 'label-code-bg',
              x: seg.x - pad,
              y: line.y - h / 2,
              width: seg.width + pad * 2,
              height: h,
              rx: 3,
              ry: 3,
            }),
          );
        }
      });
    });
  }

  /**
   * Desenha as arestas como curvas de Bézier quadráticas (não retas): quando
   * duas arestas ligam o mesmo par de pontos em sentidos opostos — o caso
   * clássico de `next` de um nó com o `prev` do vizinho, numa lista ligada —
   * elas ficariam exatamente sobrepostas como retas. Em vez disso, agrupamos
   * arestas pelo par (origem, destino) não-ordenado e, quando o grupo tem mais
   * de uma aresta, afastamos o ponto de controle de cada uma perpendicularmente
   * à direção da ligação, sempre pro lado oposto — arestas sem par continuam
   * retas (o ponto de controle cai exatamente no meio do segmento).
   *
   * A sobreposição dos PINOS em si (quando os dois lados da ligação caem no
   * mesmo ponto da borda, o caso mais comum entre nós vizinhos lado a lado) é
   * resolvida antes disso, na própria posição do pino — ver `_computeStructPairOffsets`
   * em App.js e `structPrevPort`/`structNextPort`.
   */
  _renderEdges(edges, structById, arrayById, dictById = new Map(), simplifiedNodes = false, matrixById = new Map()) {
    const ids = new Set(edges.map((e) => e.id));
    for (const [id, el] of this.edgeEls) {
      if (!ids.has(id)) {
        el.remove();
        this.edgeEls.delete(id);
      }
    }

    // passo 1: resolve o ponto de chegada (borda mais próxima do alvo) de cada aresta
    let resolved = edges.map((edge) => {
      let end = { x: edge.x1, y: edge.y1 };
      let isSelfLoop = false;
      if (edge.targetKind === 'struct') {
        const target = structById.get(edge.targetId);
        if (target) {
          if (edge.targetId === edge.fromStructId) {
            // auto-referência: laço acima do próprio nó — encosta na borda de
            // cima do círculo (não da caixa) no modo simplificado, senão a
            // seta "flutuaria" longe demais do desenho reduzido.
            end = simplifiedNodes
              ? { x: target.x + STRUCT_W / 2, y: target.y + STRUCT_H / 2 - STRUCT_CIRCLE_R - 4 }
              : { x: target.x + STRUCT_W / 2, y: target.y - 4 };
            isSelfLoop = true;
          } else if (simplifiedNodes) {
            // ponto de chegada na borda do CÍRCULO (não do bounding box
            // STRUCT_W x STRUCT_H inteiro) — mesma direção usada pro pino de
            // SAÍDA do struct de origem (ver structPrevPort/structNextPort
            // com simplified=true), só que calculada a partir do alvo.
            end = structCirclePort(target, { x: edge.x1, y: edge.y1 }, 0);
          } else {
            const rect = { x: target.x, y: target.y, w: STRUCT_W, h: STRUCT_H };
            end = rectEdgePoint(rect, { x: edge.x1, y: edge.y1 });
          }
        }
      } else if (edge.targetKind === 'arrayCell') {
        const arr = arrayById.get(edge.targetArrayId);
        let avoidBulge = null;
        if (arr) {
          end = arrayCellEdgePoint(arr, edge.targetIndex, { x: edge.x1, y: edge.y1 });
          avoidBulge = arrayAvoidBulge({ x: edge.x1, y: edge.y1 }, end, arr);
        }
        return { edge, end, isSelfLoop, curveOffset: 0, perp: null, avoidBulge };
      } else if (edge.targetKind === 'array') {
        // aponta pro array INTEIRO (ex: ponteiro-rótulo, ver
        // App#_createArrayLabelPointer), não por uma célula — pousa na borda
        // EXTERNA do frame do array (nunca num ponto interno, como quando a
        // reta cruza por cima da faixa de índices), mesmo cálculo de "ponto
        // mais próximo do AABB" usado pros structs.
        const arr = arrayById.get(edge.targetArrayId);
        if (arr) {
          // caixa + puxador, pra seta não atravessar a aba
          const { width, height } = arrayLayout(arr);
          const b = boxWithHandle(width, height, arrayHandleRect(arr));
          end = rectEdgePoint({ x: arr.x + b.x, y: arr.y + b.y, w: b.w, h: b.h }, { x: edge.x1, y: edge.y1 });
        }
      } else if (edge.targetKind === 'dictCell') {
        // equivalente de 'arrayCell' pra dict — ver dictCellEdgePoint/dictAvoidBulge.
        const dict = dictById.get(edge.targetDictId);
        let avoidBulge = null;
        if (dict) {
          end = dictCellEdgePoint(dict, edge.targetCellKey, { x: edge.x1, y: edge.y1 });
          avoidBulge = dictAvoidBulge({ x: edge.x1, y: edge.y1 }, end, dict);
        }
        return { edge, end, isSelfLoop, curveOffset: 0, perp: null, avoidBulge };
      } else if (edge.targetKind === 'matrixCell') {
        // ver matrixCellEdgePoint/matrixAvoidBulge.
        const matrix = matrixById.get(edge.targetMatrixId);
        let avoidBulge = null;
        if (matrix) {
          end = matrixCellEdgePoint(matrix, edge.targetRow, edge.targetCol, { x: edge.x1, y: edge.y1 });
          avoidBulge = matrixAvoidBulge({ x: edge.x1, y: edge.y1 }, end, matrix);
        }
        return { edge, end, isSelfLoop, curveOffset: 0, perp: null, avoidBulge };
      } else if (edge.targetKind === 'matrix') {
        // aponta pra matriz INTEIRA (ponteiro-rótulo / alias "b = m").
        const matrix = matrixById.get(edge.targetMatrixId);
        if (matrix) {
          const { width, height } = matrixLayout(matrix);
          const b = boxWithHandle(width, height, matrixHandleRect(matrix));
          end = rectEdgePoint({ x: matrix.x + b.x, y: matrix.y + b.y, w: b.w, h: b.h }, { x: edge.x1, y: edge.y1 });
        }
      } else if (edge.targetKind === 'dict') {
        // equivalente de 'array' (aponta pro dict INTEIRO, ex: ponteiro-rótulo).
        const dict = dictById.get(edge.targetDictId);
        if (dict) {
          const { width, height } = dictLayout(dict);
          const b = boxWithHandle(width, height, dictHandleRect(dict));
          end = rectEdgePoint({ x: dict.x + b.x, y: dict.y + b.y, w: b.w, h: b.h }, { x: edge.x1, y: edge.y1 });
        }
      }
      return { edge, end, isSelfLoop, curveOffset: 0, perp: null, avoidBulge: null };
    });

    // passo 1.5: no modo simplificado, um par de arestas struct<->struct em
    // direções OPOSTAS (ex: A.next -> B e B.prev -> A, uma lista duplamente
    // ligada entre vizinhos) vira UMA seta só, com ponta nas duas pontas, em
    // vez de duas linhas quase sobrepostas — só faz sentido aqui: no modo
    // detalhado cada campo já tem seu próprio pino/posição fixa na caixa
    // (ver `_computeStructPairOffsets` em App.js), então as duas setas já
    // saem visualmente separadas por natureza, sem precisar fundir nada.
    if (simplifiedNodes) {
      const bySourceTarget = new Map();
      resolved.forEach((r) => {
        if (r.isSelfLoop || r.edge.targetKind !== 'struct' || !r.edge.sourceKey || !r.edge.targetKey) return;
        bySourceTarget.set(`${r.edge.sourceKey}>${r.edge.targetKey}`, r);
      });
      const merged = new Set();
      resolved.forEach((r) => {
        if (merged.has(r) || r.isSelfLoop || r.edge.targetKind !== 'struct' || !r.edge.sourceKey || !r.edge.targetKey) return;
        const reverse = bySourceTarget.get(`${r.edge.targetKey}>${r.edge.sourceKey}`);
        if (reverse && reverse !== r && !merged.has(reverse)) {
          r.bidirectional = true;
          merged.add(reverse);
        }
      });
      if (merged.size) {
        merged.forEach((r) => {
          const el = this.edgeEls.get(r.edge.id);
          if (el) {
            el.remove();
            this.edgeEls.delete(r.edge.id);
          }
        });
        resolved = resolved.filter((r) => !merged.has(r));
      }
    }

    // passo 2: curvatura no par — agrupa por (origem, destino) não-ordenado e
    // distribui o afastamento do ponto de controle
    const pairGroups = new Map();
    resolved.forEach((r) => {
      if (r.isSelfLoop || !r.edge.sourceKey || !r.edge.targetKey) return;
      const key = [r.edge.sourceKey, r.edge.targetKey].sort().join('|');
      if (!pairGroups.has(key)) pairGroups.set(key, []);
      pairGroups.get(key).push(r);
    });
    const CURVE_STEP = 24; // px de afastamento entre curvas de um mesmo par
    pairGroups.forEach((group) => {
      if (group.length < 2) return; // par único: sem curvatura, fica reto
      group.sort((a, b) => (a.edge.id < b.edge.id ? -1 : a.edge.id > b.edge.id ? 1 : 0));
      // direção canônica compartilhada por todo o grupo: se cada aresta usasse a
      // própria direção, a perpendicular se inverteria entre elas (setas em
      // sentidos opostos) e as curvas acabariam do MESMO lado, sem se separar.
      const ref = group[0];
      const dx = ref.end.x - ref.edge.x1;
      const dy = ref.end.y - ref.edge.y1;
      const len = Math.hypot(dx, dy) || 1;
      const perp = { x: -dy / len, y: dx / len };
      const n = group.length;
      group.forEach((r, i) => {
        r.curveOffset = (i - (n - 1) / 2) * CURVE_STEP;
        r.perp = perp;
      });
    });

    // passo 3: desenha cada aresta como path (reto quando curveOffset é 0)
    resolved.forEach(({ edge, end, curveOffset, perp, avoidBulge, bidirectional }) => {
      let el = this.edgeEls.get(edge.id);
      if (!el) {
        el = svgEl('path', { class: 'micro-edge-line', 'marker-end': 'url(#micro-arrowhead)' });
        this.edgesLayer.appendChild(el);
        this.edgeEls.set(edge.id, el);
      }
      let cx, cy;
      if (avoidBulge) {
        // desvia o controle pra fora do array (ver arrayAvoidBulge) — tem
        // prioridade sobre a curvatura de par, caso rara de coincidir os dois.
        cx = avoidBulge.x;
        cy = avoidBulge.y;
      } else {
        const mx = (edge.x1 + end.x) / 2;
        const my = (edge.y1 + end.y) / 2;
        cx = curveOffset ? mx + perp.x * curveOffset : mx;
        cy = curveOffset ? my + perp.y * curveOffset : my;
      }
      el.setAttribute('d', `M ${edge.x1} ${edge.y1} Q ${cx} ${cy} ${end.x} ${end.y}`);
      el.classList.toggle('selected', !!edge.selected);
      el.classList.toggle('micro-dimmed', !!edge.dimmed);
      const markerUrl = edge.selected ? 'url(#micro-arrowhead-selected)' : 'url(#micro-arrowhead)';
      el.setAttribute('marker-end', markerUrl);
      // ligação bidirecional fundida em uma só seta (ver passo 1.5, modo
      // simplificado) — ponta nas duas pontas do traço, não só na de chegada.
      if (bidirectional) el.setAttribute('marker-start', markerUrl);
      else el.removeAttribute('marker-start');
    });
  }

  /** `simplified` (Ctrl+A global, ver App#_toggleMicroSimplifiedNodes) troca a
   * caixa de 3 células (prev/left | data | next/right) por um círculo só com
   * `data` — mesmo bounding box STRUCT_W x STRUCT_H (posição/hit-test/drag
   * continuam idênticos, ver STRUCT_CIRCLE_R). Sem pino (`.struct-port`)
   * NENHUM nesse modo — nem pra campo vazio (sem marca de ∅, como no modo
   * detalhado) nem pra campo com link: a seta em si (ver App.js#_renderEdges)
   * já sai direto da borda do círculo (ver `structPrevPort`/`structNextPort`
   * com simplified=true), sem "pino" nenhum de onde ela parte — só aparece
   * alguma coisa quando o campo tem link (a seta), e é a seta inteira, não
   * um pino separado. */
  _renderStructs(structs, simplified) {
    const ids = new Set(structs.map((n) => n.id));
    for (const [id, el] of this.structEls) {
      if (!ids.has(id)) {
        el.remove();
        this.structEls.delete(id);
      }
    }
    structs.forEach((node) => {
      let el = this.structEls.get(node.id);
      const isTree = node.type === 'tree';
      const isGraph = node.type === 'graph';
      // variante decide a ESTRUTURA interna do SVG (círculo x caixa de 3
      // células prev/left|data|next/right x caixa de 2 células
      // data|neighbors) — troca rara (só no Ctrl+A global, que afeta TODOS os
      // structs de uma vez, ou na criação — o tipo nunca muda depois), então
      // é mais simples reconstruir do zero do que tentar migrar os filhos de
      // uma variante pra outra in place.
      const variant = simplified ? 'simple' : isTree ? 'tree' : isGraph ? 'graph' : 'list';
      if (el && el.dataset.variant !== variant) {
        el.remove();
        this.structEls.delete(node.id);
        el = undefined;
      }
      if (!el) {
        const structClass = isTree ? 'struct-node struct-node-tree' : isGraph ? 'struct-node struct-node-graph' : 'struct-node';
        el = svgEl('g', { class: structClass, 'data-id': node.id });
        el.dataset.variant = variant;
        if (simplified) {
          const halo = svgEl('circle', { class: 'node-halo', cx: STRUCT_W / 2, cy: STRUCT_H / 2, r: STRUCT_CIRCLE_R + HALO_GAP });
          const circle = svgEl('circle', { class: 'struct-circle', cx: STRUCT_W / 2, cy: STRUCT_H / 2, r: STRUCT_CIRCLE_R });
          const dataLabel = svgEl('text', {
            class: 'struct-data-label',
            x: STRUCT_W / 2,
            y: STRUCT_H / 2 + 6,
            'text-anchor': 'middle',
          });
          // sem pino visível aqui — o ponteiro simplificado é só a linha
          // saindo direto da borda do círculo (ver structPrevPort/
          // structNextPort com simplified=true); a posição de conexão
          // continua existindo pro arraste manual (_findMicroPortAt em
          // App.js), só não é desenhada.
          el.appendChild(halo);
          el.appendChild(circle);
          el.appendChild(dataLabel);
        } else if (isGraph) {
          // caixa de 2 células (data | neighbors) — diferente da de 3
          // (prev/left | data | next/right) porque `neighbors` é uma LISTA
          // (grau arbitrário, ver MicroModel#setStructNeighborsArray), não
          // cabe num único pino próprio como prev/next: o pino aqui só
          // aponta pro ARRAY que guarda a lista (edge targetKind:'array',
          // ver App.js#_renderMicroOnly) — as setas pra cada vizinho
          // individual saem do próprio ARRAY (renderização genérica de
          // qualquer array kind:'ref', já existente), não daqui.
          const GRAPH_DATA_W = STRUCT_PREV_W + STRUCT_DATA_W;
          const box = svgEl('rect', { class: 'struct-box', width: STRUCT_W, height: STRUCT_H, rx: 8, ry: 8 });
          const divider = svgEl('line', { class: 'struct-divider', x1: GRAPH_DATA_W, y1: 0, x2: GRAPH_DATA_W, y2: STRUCT_H });
          const dataCap = svgEl('text', { class: 'struct-field-cap', x: GRAPH_DATA_W / 2, y: 13, 'text-anchor': 'middle' });
          dataCap.textContent = 'data';
          const neighborsCap = svgEl('text', {
            class: 'struct-field-cap',
            x: GRAPH_DATA_W + STRUCT_NEXT_W / 2,
            y: 13,
            'text-anchor': 'middle',
          });
          // "neighbors" não cabe na largura estreita da célula (mesma de
          // prev/next) — abreviado, mesmo espírito de prev/next/left/right
          // já serem palavras curtas de propósito.
          neighborsCap.textContent = 'nbrs';
          const dataLabel = svgEl('text', {
            class: 'struct-data-label',
            x: GRAPH_DATA_W / 2,
            y: STRUCT_H / 2 + 14,
            'text-anchor': 'middle',
          });
          // cx/cy iniciais são só placeholder — reposicionado a cada render logo abaixo
          const neighborsPort = svgEl('circle', { class: 'struct-port struct-port-next', cx: STRUCT_W, cy: STRUCT_H / 2, r: PORT_R });
          const neighborsNull = svgEl('text', {
            class: 'struct-null-mark',
            x: GRAPH_DATA_W + STRUCT_NEXT_W / 2,
            y: STRUCT_H / 2 + 6,
            'text-anchor': 'middle',
          });
          neighborsNull.textContent = '∅';

          el.appendChild(haloRect(STRUCT_W, STRUCT_H, 8));
          el.appendChild(box);
          el.appendChild(divider);
          el.appendChild(dataCap);
          el.appendChild(neighborsCap);
          el.appendChild(neighborsNull);
          el.appendChild(dataLabel);
          el.appendChild(neighborsPort);
        } else {
          const box = svgEl('rect', {
            class: 'struct-box',
            width: STRUCT_W,
            height: STRUCT_H,
            rx: 8,
            ry: 8,
          });
          const prevDivider = svgEl('line', {
            class: 'struct-divider',
            x1: STRUCT_PREV_W,
            y1: 0,
            x2: STRUCT_PREV_W,
            y2: STRUCT_H,
          });
          const nextDivider = svgEl('line', {
            class: 'struct-divider',
            x1: STRUCT_PREV_W + STRUCT_DATA_W,
            y1: 0,
            x2: STRUCT_PREV_W + STRUCT_DATA_W,
            y2: STRUCT_H,
          });
          const prevCap = svgEl('text', {
            class: 'struct-field-cap',
            x: STRUCT_PREV_W / 2,
            y: 13,
            'text-anchor': 'middle',
          });
          prevCap.textContent = isTree ? 'left' : 'prev';
          const nextCap = svgEl('text', {
            class: 'struct-field-cap',
            x: STRUCT_PREV_W + STRUCT_DATA_W + STRUCT_NEXT_W / 2,
            y: 13,
            'text-anchor': 'middle',
          });
          nextCap.textContent = isTree ? 'right' : 'next';
          const dataCap = svgEl('text', {
            class: 'struct-field-cap',
            x: STRUCT_PREV_W + STRUCT_DATA_W / 2,
            y: 13,
            'text-anchor': 'middle',
          });
          dataCap.textContent = 'data';
          const dataLabel = svgEl('text', {
            class: 'struct-data-label',
            x: STRUCT_PREV_W + STRUCT_DATA_W / 2,
            y: STRUCT_H / 2 + 14,
            'text-anchor': 'middle',
          });
          // cx/cy iniciais são só um placeholder — reposicionados a cada render logo abaixo
          const prevPort = svgEl('circle', { class: 'struct-port struct-port-prev', cx: 0, cy: STRUCT_H / 2, r: PORT_R });
          const nextPort = svgEl('circle', { class: 'struct-port struct-port-next', cx: STRUCT_W, cy: STRUCT_H / 2, r: PORT_R });
          const prevNull = svgEl('text', {
            class: 'struct-null-mark',
            x: STRUCT_PREV_W / 2,
            y: STRUCT_H / 2 + 6,
            'text-anchor': 'middle',
          });
          prevNull.textContent = '∅';
          const nextNull = svgEl('text', {
            class: 'struct-null-mark',
            x: STRUCT_PREV_W + STRUCT_DATA_W + STRUCT_NEXT_W / 2,
            y: STRUCT_H / 2 + 6,
            'text-anchor': 'middle',
          });
          nextNull.textContent = '∅';

          el.appendChild(haloRect(STRUCT_W, STRUCT_H, 8));
          el.appendChild(box);
          el.appendChild(prevDivider);
          el.appendChild(nextDivider);
          el.appendChild(prevCap);
          el.appendChild(dataCap);
          el.appendChild(nextCap);
          el.appendChild(prevNull);
          el.appendChild(nextNull);
          el.appendChild(dataLabel);
          el.appendChild(prevPort);
          el.appendChild(nextPort);
        }
        this.structsLayer.appendChild(el);
        this.structEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('linked', !!node.linked);
      el.classList.toggle('dragging', !!node.dragging);
      const dataLabel = el.querySelector('.struct-data-label');
      const text = String(node.data);
      if (dataLabel.textContent !== text) dataLabel.textContent = text;
      // modo simplificado não tem pino desenhado (ver criação acima) — a
      // linha/seta em si (ver App.js, _renderEdges) já sai direto da borda
      // do círculo, não há mais nada pra posicionar aqui.
      if (!simplified && node.type === 'graph') {
        // caixa de 2 células — só o pino "neighbors" (mesma célula/posição
        // física de "next", ver criação acima), sem prev/left NENHUM.
        const neighborsPortEl = el.querySelector('.struct-port-next');
        const neighborsNullEl = el.querySelector('.struct-null-mark');
        neighborsNullEl.style.display = node.hasNextLink ? 'none' : '';
        const portWorld = structNextPort(node, false);
        neighborsPortEl.setAttribute('cx', portWorld.x - node.x);
        neighborsPortEl.setAttribute('cy', portWorld.y - node.y);
      } else if (!simplified) {
        const prevPortEl = el.querySelector('.struct-port-prev');
        const nextPortEl = el.querySelector('.struct-port-next');
        const prevNullEl = el.querySelectorAll('.struct-null-mark')[0];
        const nextNullEl = el.querySelectorAll('.struct-null-mark')[1];
        prevNullEl.style.display = node.hasPrevLink ? 'none' : '';
        nextNullEl.style.display = node.hasNextLink ? 'none' : '';
        // pinos prev/next acompanham a direção do respectivo alvo (node.prevAnchor/nextAnchor)
        const prevPortWorld = structPrevPort(node, false);
        prevPortEl.setAttribute('cx', prevPortWorld.x - node.x);
        prevPortEl.setAttribute('cy', prevPortWorld.y - node.y);
        const nextPortWorld = structNextPort(node, false);
        nextPortEl.setAttribute('cx', nextPortWorld.x - node.x);
        nextPortEl.setAttribute('cy', nextPortWorld.y - node.y);
      }
    });
  }

  _renderPointers(pointers, fullNames) {
    const ids = new Set(pointers.map((n) => n.id));
    for (const [id, el] of this.pointerEls) {
      if (!ids.has(id)) {
        el.remove();
        this.pointerEls.delete(id);
      }
    }
    pointers.forEach((node) => {
      let el = this.pointerEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'pointer-node', 'data-id': node.id });
        const box = svgEl('rect', { class: 'pointer-box', width: PTR_W, height: PTR_H, rx: 16, ry: 16 });
        const label = svgEl('text', {
          class: 'pointer-label',
          x: PTR_W / 2,
          y: PTR_H / 2 + 5,
          'text-anchor': 'middle',
        });
        const port = svgEl('circle', { class: 'struct-port pointer-port', cx: PTR_W, cy: PTR_H / 2, r: PORT_R });
        const title = svgEl('title');
        el.appendChild(title);
        el.appendChild(haloRect(PTR_W, PTR_H, 16));
        el.appendChild(box);
        el.appendChild(label);
        el.appendChild(port);
        this.pointersLayer.appendChild(el);
        this.pointerEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.classList.toggle('unset', node.target == null);
      el.classList.toggle('cursor', !!node.cursor);
      el.classList.toggle('array-label', !!node.arrayLabel);
      const shownName = displayName(node.label, fullNames);
      const truncated = shownName !== String(node.label ?? '');
      const titleEl = el.querySelector('title');
      // nome truncado: o tooltip mostra o nome inteiro
      const titleText = [truncated ? node.label : '', node.arrayLabel ? 'Nome — botão direito abre as configurações' : '']
        .filter(Boolean)
        .join('\n');
      if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
      const label = el.querySelector('.pointer-label');
      if (label.textContent !== shownName) label.textContent = shownName;
      // caixa (e contorno de destaque) acompanham a largura do nome exibido
      const w = pointerWidth(node, fullNames);
      el.querySelector('.pointer-box').setAttribute('width', w);
      el.querySelector('.node-halo').setAttribute('width', w + HALO_GAP * 2);
      label.setAttribute('x', w / 2);
      // pino acompanha a direção do alvo (node.anchor) — recalcula toda vez porque
      // o alvo (ou o próprio ponteiro) pode ter se movido desde o último render.
      const portWorld = pointerPort(node, fullNames);
      const port = el.querySelector('.pointer-port');
      port.setAttribute('cx', portWorld.x - node.x);
      port.setAttribute('cy', portWorld.y - node.y);
    });
  }

  _renderVariables(variables, fullNames) {
    const ids = new Set(variables.map((n) => n.id));
    for (const [id, el] of this.variableEls) {
      if (!ids.has(id)) {
        el.remove();
        this.variableEls.delete(id);
      }
    }
    variables.forEach((node) => {
      let el = this.variableEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'variable-node', 'data-id': node.id });
        const box = svgEl('rect', { class: 'variable-box', width: VAR_W, height: VAR_H, rx: 8, ry: 8 });
        const header = svgEl('rect', { class: 'variable-header', width: VAR_W, height: VAR_HEADER_H, rx: 8, ry: 8 });
        const headerFix = svgEl('rect', { class: 'variable-header',x: 0, y: VAR_HEADER_H - 8, width: VAR_W, height: 8 });
        const nameLabel = svgEl('text', {
          class: 'variable-name',
          x: VAR_W / 2,
          y: 13,
          'text-anchor': 'middle',
        });
        const valueLabel = svgEl('text', {
          class: 'variable-value',
          x: VAR_W / 2,
          y: VAR_HEADER_H + (VAR_H - VAR_HEADER_H) / 2 + 6,
          'text-anchor': 'middle',
        });
        el.appendChild(svgEl('title'));
        el.appendChild(haloRect(VAR_W, VAR_H, 8));
        el.appendChild(box);
        el.appendChild(header);
        el.appendChild(headerFix);
        el.appendChild(nameLabel);
        el.appendChild(valueLabel);
        this.variablesLayer.appendChild(el);
        this.variableEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      const shownName = displayName(node.name, fullNames);
      const titleEl = el.querySelector('title');
      // nome truncado: o tooltip mostra o nome inteiro
      const titleText = shownName !== String(node.name ?? '') ? node.name : '';
      if (titleEl.textContent !== titleText) titleEl.textContent = titleText;
      const nameLabel = el.querySelector('.variable-name');
      if (nameLabel.textContent !== shownName) nameLabel.textContent = shownName;
      // caixa inteira (cabeçalho, contorno de destaque, textos centralizados)
      // acompanha a largura do nome exibido
      const w = variableWidth(node, fullNames);
      el.querySelectorAll('.variable-box, .variable-header').forEach((r) => r.setAttribute('width', w));
      el.querySelector('.node-halo').setAttribute('width', w + HALO_GAP * 2);
      nameLabel.setAttribute('x', w / 2);
      const valueLabel = el.querySelector('.variable-value');
      valueLabel.setAttribute('x', w / 2);
      // "True"/"False" (estilo Python), não o "true"/"false" cru do JS —
      // mesma grafia que o resto da ferramenta usa pra booleano (ver
      // evaluator.js#exprLabel).
      const text = typeof node.value === 'boolean' ? (node.value ? 'True' : 'False') : String(node.value);
      if (valueLabel.textContent !== text) valueLabel.textContent = text;
    });
  }

  _renderArrays(arrays, edges = []) {
    // seta de cada ponteiro por id — `_renderWindowBrackets` olha por onde as
    // setas dos cursores de uma janela chegam no array
    const pointerEdges = new Map();
    edges.forEach((e) => {
      if (e.targetKind === 'arrayCell' && e.sourceKey?.startsWith('pointer:')) pointerEdges.set(e.sourceKey.slice('pointer:'.length), e);
    });
    const ids = new Set(arrays.map((n) => n.id));
    for (const [id, el] of this.arrayEls) {
      if (!ids.has(id)) {
        el.remove();
        this.arrayEls.delete(id);
      }
    }
    arrays.forEach((node) => {
      let el = this.arrayEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'array-node', 'data-id': node.id });
        this.arraysLayer.appendChild(el);
        this.arrayEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.classList.toggle('linked', !!node.linked);
      this._buildArrayContent(el, node);
      // aplicado fora do cache de conteúdo (_buildArrayContent pode pular a
      // reconstrução das células quando nada estrutural mudou) — mais de um
      // índice pode estar destacado ao mesmo tempo (ex: dois ponteiros no
      // mesmo array, ou o cursor de leitura junto de um ponteiro do usuário)
      el.querySelectorAll('.array-cell').forEach((cellEl, i) => {
        cellEl.classList.toggle('array-cell-target', !!node.targetCellIndexes?.has(i));
      });
      this._renderWindowBrackets(el, node, pointerEdges);
    });
  }

  /** Colchete sob as posições de cada janela deslizante do array
   * (`node.windows`, `{lo, hi, selected, pointerIds, color}` — ver App#microWindows):
   * embaixo das células na horizontal, à direita delas na vertical — ou do
   * lado oposto (em cima / à esquerda, além da faixa de índices) quando a
   * seta de um dos cursores DA PRÓPRIA janela chega por baixo/pela direita e
   * passaria por cima do colchete (ver `_windowBracketSide`). Também fora do
   * cache de `_buildArrayContent` — a janela anda a cada passo, as células
   * nem sempre mudam. Mais de uma janela no mesmo array: colchetes
   * empilhados, um por nível em cada lado. */
  _renderWindowBrackets(el, node, pointerEdges = new Map()) {
    el.querySelector('.window-brackets')?.remove();
    if (!node.windows?.length || node.isSet) return;
    const layout = arrayLayout(node);
    const vertical = isVerticalOrientation(node.orientation);
    const g = svgEl('g', { class: 'window-brackets' });
    const levels = { default: 0, flipped: 0 };
    // na horizontal, o colchete virado (em cima) passa por cima dos rótulos de
    // ponta de um deque (ver arrayEndCaptions), não por baixo deles
    const captionYs = vertical ? [] : arrayEndCaptions(node).filter((c) => c.y < 0).map((c) => c.y);
    const flippedBase = captionYs.length ? Math.max(WINDOW_BRACKET_GAP, -Math.min(...captionYs) + 13) : WINDOW_BRACKET_GAP;
    node.windows.forEach((w) => {
      // `a`/`b`: as pontas de cima/esquerda e de baixo/direita NA TELA — na
      // pilha a posição `lo` fica embaixo
      let a = layout.cells[w.lo];
      let b = layout.cells[w.hi];
      if (!a || !b) return;
      if (a.y > b.y) [a, b] = [b, a];
      const side = this._windowBracketSide(node, layout, w, pointerEdges);
      const off = (side === 'flipped' ? flippedBase : WINDOW_BRACKET_GAP) + levels[side] * WINDOW_BRACKET_STEP;
      levels[side] += 1;
      const inset = 4; // colchetes de janelas vizinhas não se encostam
      const D = WINDOW_BRACKET_DEPTH;
      let d;
      if (vertical) {
        d =
          side === 'default'
            ? `M ${layout.width + off} ${a.y + inset} h ${D} V ${b.y + b.h - inset} h ${-D}`
            : `M ${-off} ${a.y + inset} h ${-D} V ${b.y + b.h - inset} h ${D}`;
      } else {
        d =
          side === 'default'
            ? `M ${a.x + inset} ${layout.height + off} v ${D} H ${b.x + b.w - inset} v ${-D}`
            : `M ${a.x + inset} ${-off} v ${-D} H ${b.x + b.w - inset} v ${D}`;
      }
      const path = svgEl('path', { class: `window-bracket${w.selected ? ' selected' : ''}`, d });
      // cor da janela = cor dos dois cursores (ver App#_microEffectiveColors);
      // sem ela, o --cursor padrão do CSS
      if (w.color) path.style.stroke = w.color;
      g.appendChild(path);
    });
    el.appendChild(g);
  }

  /** Lado do colchete de uma janela: 'default' (embaixo / à direita) ou
   * 'flipped' (em cima / à esquerda). Só vira quando a seta de um dos dois
   * cursores da janela pousa no lado padrão (ver `arrayCellEdgePoint`) e
   * nenhum pousa no lado oposto — se as duas chegam por lados opostos, o
   * colchete sobreporia uma delas de qualquer jeito e fica onde está. Setas
   * de outros ponteiros não contam. */
  _windowBracketSide(node, layout, w, pointerEdges) {
    const vertical = isVerticalOrientation(node.orientation);
    let hitsDefault = false;
    let hitsFlipped = false;
    (w.pointerIds ?? []).forEach((id) => {
      const e = pointerEdges.get(id);
      if (!e || e.targetArrayId !== node.id || !layout.cells[e.targetIndex]) return;
      const end = arrayCellEdgePoint(node, e.targetIndex, { x: e.x1, y: e.y1 });
      if (vertical) {
        if (end.x > node.x + layout.width) hitsDefault = true;
        else if (end.x < node.x) hitsFlipped = true;
      } else if (end.y > node.y + layout.height) hitsDefault = true;
      else if (end.y < node.y) hitsFlipped = true;
    });
    return hitsDefault && !hitsFlipped ? 'flipped' : 'default';
  }

  /** Reconstrói o conteúdo interno (célula por célula) apenas quando algo estrutural mudou. */
  _buildArrayContent(el, node) {
    const kindTag = node.isSet ? 'set' : node.isDeque ? `deque:${node.maxlen ?? ''}` : '';
    const sig = `${node.kind}|${node.orientation}|${kindTag}|${node.cells.join(',')}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = '';
    el.classList.toggle('set-node', !!node.isSet);
    el.classList.toggle('deque-node', !!node.isDeque);

    const layout = arrayLayout(node);
    // set (ver MicroModel#addArray, `isSet`): mesma geometria de array (hit-
    // tests/pinos não mudam), mas sem índices — elemento de set não tem
    // posição — com caixa mais arredondada, células em "pílula" e o rótulo
    // "set" na faixa onde ficariam os índices (só na horizontal, a vertical
    // não tem largura pra isso).
    const boxR = node.isSet ? 14 : 8;
    appendHandleAndHalo(el, layout.width, layout.height, arrayHandleRect(node), boxR);
    const box = svgEl('rect', { class: 'array-box', width: layout.width, height: layout.height, rx: boxR, ry: boxR });
    el.appendChild(box);
    if (node.isSet && !isVerticalOrientation(node.orientation)) {
      const caption = svgEl('text', { class: 'array-index-label set-caption', x: SET_PAD + 2, y: ARRAY_INDEX_H - 4 });
      caption.textContent = node.cells.length === 0 ? 'set()' : 'set';
      el.appendChild(caption);
    }
    // deque: "início"/"fim" nas pontas; lista em pilha: "topo" (ver arrayEndCaptions)
    arrayEndCaptions(node).forEach((c) => {
      const caption = svgEl('text', {
        class: 'array-index-label array-end-caption',
        x: c.x,
        y: c.y,
        'text-anchor': c.anchor ?? 'middle',
      });
      caption.textContent = c.text;
      el.appendChild(caption);
    });

    layout.cells.forEach((c, i) => {
      const inset = node.isSet ? 3 : 0;
      el.appendChild(
        svgEl('rect', {
          class: `array-cell ${node.kind === 'value' ? 'array-cell-value' : 'array-cell-ref'}`,
          x: c.x + inset,
          y: c.y + inset,
          width: c.w - 2 * inset,
          height: c.h - 2 * inset,
          rx: node.isSet ? (c.h - 2 * inset) / 2 : 4,
          ry: node.isSet ? (c.h - 2 * inset) / 2 : 4,
        }),
      );
      if (!node.isSet) {
        // faixa do índice: arrastar dali cria um cursor pra posição (ver
        // App#_findMicroArrayIndexAt) — só dá o cursor do mouse, o hit-test
        // é por coordenada
        const vertical = isVerticalOrientation(node.orientation);
        el.appendChild(
          svgEl('rect', {
            class: 'array-index-hit',
            x: vertical ? 0 : c.x,
            y: vertical ? c.y : 0,
            width: vertical ? c.x : c.w,
            height: vertical ? c.h : c.y,
          }),
        );
        const idx = svgEl('text', { class: 'array-index-label', x: c.indexX, y: c.indexY, 'text-anchor': 'middle' });
        idx.textContent = String(i);
        el.appendChild(idx);
      }

      if (node.kind === 'value') {
        const val = svgEl('text', {
          class: 'array-value-label',
          x: c.x + c.w / 2,
          y: c.y + c.h / 2 + 6,
          'text-anchor': 'middle',
        });
        val.textContent = cellText(node.cells[i]);
        el.appendChild(val);
      } else {
        if (!node.cells[i]) {
          const nullMark = svgEl('text', {
            class: 'struct-null-mark',
            x: c.x + c.w / 2,
            y: c.y + c.h / 2 + 5,
            'text-anchor': 'middle',
          });
          nullMark.textContent = '∅';
          el.appendChild(nullMark);
        }
        el.appendChild(svgEl('circle', { class: 'struct-port array-cell-port', cx: c.port.x, cy: c.port.y, r: PORT_R }));
      }
    });
    // divisórias entre células, por cima delas: só dão o cursor de "dividir"
    // (duplo clique ali divide o array, ver App#_splitMicroArray) — o
    // hit-test é por coordenada (`arrayDividers`)
    arrayDividers(node).forEach((d) => {
      el.appendChild(svgEl('rect', { class: `array-divider-hit${isVerticalOrientation(node.orientation) ? ' vertical' : ''}`, x: d.x, y: d.y, width: d.w, height: d.h }));
    });
  }

  /** Irmã de `_renderArrays` — reaproveita as MESMAS classes CSS (`array-*`,
   * ver canvas.css) pra ficar visualmente igual a array, com um marcador
   * `dict-node` extra só pra estilos que devam distingui-lo (ver
   * `.dict-node .array-box`). */
  _renderDicts(dicts) {
    const ids = new Set(dicts.map((n) => n.id));
    for (const [id, el] of this.dictEls) {
      if (!ids.has(id)) {
        el.remove();
        this.dictEls.delete(id);
      }
    }
    dicts.forEach((node) => {
      let el = this.dictEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'array-node dict-node', 'data-id': node.id });
        this.dictsLayer.appendChild(el);
        this.dictEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.classList.toggle('linked', !!node.linked);
      this._buildDictContent(el, node);
      // aplicado fora do cache de conteúdo, mesmo motivo de `_renderArrays`
      // — mais de um ponteiro pode destacar chaves diferentes ao mesmo tempo.
      el.querySelectorAll('.array-cell').forEach((cellEl, i) => {
        cellEl.classList.toggle('array-cell-target', !!node.targetCellKeys?.has(node.cells[i]?.key));
      });
    });
  }

  /** Irmã de `_buildArrayContent` — a diferença central é que `kind` (valor
   * vs referência) é decidido POR CÉLULA (`node.cells[i].kind`), não uma vez
   * só pro nó inteiro (ver MicroModel.js sobre por que dict é heterogêneo). */
  _buildDictContent(el, node) {
    const sig = `${node.orientation}|${node.cells.map((c) => `${c.key}:${c.kind}:${c.value}`).join(',')}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = '';

    const layout = dictLayout(node);

    const box = svgEl('rect', { class: 'array-box', width: layout.width, height: layout.height, rx: 8, ry: 8 });
    appendHandleAndHalo(el, layout.width, layout.height, dictHandleRect(node), 8);
    el.appendChild(box);

    layout.cells.forEach((c, i) => {
      const cellModel = node.cells[i];
      el.appendChild(
        svgEl('rect', {
          class: `array-cell ${cellModel.kind === 'value' ? 'array-cell-value' : 'array-cell-ref'}`,
          x: c.x,
          y: c.y,
          width: c.w,
          height: c.h,
          rx: 4,
          ry: 4,
        }),
      );
      const keyLabel = svgEl('text', { class: 'array-index-label', x: c.keyX, y: c.keyY, 'text-anchor': 'middle' });
      keyLabel.textContent = String(c.key);
      el.appendChild(keyLabel);

      if (cellModel.kind === 'value') {
        const val = svgEl('text', {
          class: 'array-value-label',
          x: c.x + c.w / 2,
          y: c.y + c.h / 2 + 6,
          'text-anchor': 'middle',
        });
        // "True"/"False" estilo Python, mesma grafia usada no resto da
        // ferramenta pra booleano (ver `_renderVariables`).
        val.textContent = typeof cellModel.value === 'boolean' ? (cellModel.value ? 'True' : 'False') : String(cellModel.value);
        el.appendChild(val);
      } else {
        if (!cellModel.value) {
          const nullMark = svgEl('text', {
            class: 'struct-null-mark',
            x: c.x + c.w / 2,
            y: c.y + c.h / 2 + 5,
            'text-anchor': 'middle',
          });
          nullMark.textContent = '∅';
          el.appendChild(nullMark);
        }
        el.appendChild(svgEl('circle', { class: 'struct-port array-cell-port', cx: c.port.x, cy: c.port.y, r: PORT_R }));
      }
    });
  }

  /** Irmã de `_renderArrays` — reaproveita as classes `.array-*` (mesma
   * célula, mesmo halo de seleção, mesmo destaque de célula-alvo), com
   * `matrix-node` a mais pra estilos próprios (ver canvas.css). Além da
   * célula-alvo (`node.targetCells`, "linha,coluna"), acende os ÍNDICES da
   * linha e da coluna dela — é o que deixa a coordenada de "m[i][j]"
   * legível de relance. */
  _renderMatrices(matrices) {
    const ids = new Set(matrices.map((n) => n.id));
    for (const [id, el] of this.matrixEls) {
      if (!ids.has(id)) {
        el.remove();
        this.matrixEls.delete(id);
      }
    }
    matrices.forEach((node) => {
      let el = this.matrixEls.get(node.id);
      if (!el) {
        el = svgEl('g', { class: 'array-node matrix-node', 'data-id': node.id });
        this.matricesLayer.appendChild(el);
        this.matrixEls.set(node.id, el);
      }
      el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      el.classList.toggle('selected', !!node.selected);
      el.classList.toggle('dragging', !!node.dragging);
      el.classList.toggle('linked', !!node.linked);
      this._buildMatrixContent(el, node);
      const targets = node.targetCells ?? null;
      const activeRows = new Set();
      const activeCols = new Set();
      el.querySelectorAll('.array-cell').forEach((cellEl) => {
        const key = `${cellEl.dataset.row},${cellEl.dataset.col}`;
        const hit = !!targets?.has(key);
        cellEl.classList.toggle('array-cell-target', hit);
        if (hit) {
          activeRows.add(cellEl.dataset.row);
          activeCols.add(cellEl.dataset.col);
        }
      });
      el.querySelectorAll('.matrix-row-label').forEach((l) => l.classList.toggle('matrix-index-active', activeRows.has(l.dataset.row)));
      el.querySelectorAll('.matrix-col-label').forEach((l) => l.classList.toggle('matrix-index-active', activeCols.has(l.dataset.col)));
    });
  }

  _buildMatrixContent(el, node) {
    const sig = `${node.cells.length}x${node.cells[0]?.length ?? 0}|${node.cells.map((row) => row.map(cellText).join(',')).join(';')}`;
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = '';

    const layout = matrixLayout(node);
    appendHandleAndHalo(el, layout.width, layout.height, matrixHandleRect(node), 8);
    el.appendChild(svgEl('rect', { class: 'array-box', width: layout.width, height: layout.height, rx: 8, ry: 8 }));

    layout.colLabels.forEach((l) => {
      const t = svgEl('text', { class: 'array-index-label matrix-col-label', x: l.x, y: l.y, 'text-anchor': 'middle', 'data-col': l.col });
      t.textContent = String(l.col);
      el.appendChild(t);
    });
    layout.rowLabels.forEach((l) => {
      const t = svgEl('text', { class: 'array-index-label matrix-row-label', x: l.x, y: l.y, 'text-anchor': 'middle', 'data-row': l.row });
      t.textContent = String(l.row);
      el.appendChild(t);
    });
    layout.cells.forEach((c) => {
      el.appendChild(
        svgEl('rect', {
          class: 'array-cell array-cell-value',
          x: c.x,
          y: c.y,
          width: c.w,
          height: c.h,
          rx: 4,
          ry: 4,
          'data-row': c.row,
          'data-col': c.col,
        }),
      );
      const val = svgEl('text', { class: 'array-value-label', x: c.x + c.w / 2, y: c.y + c.h / 2 + 6, 'text-anchor': 'middle' });
      val.textContent = cellText(node.cells[c.row][c.col]);
      el.appendChild(val);
    });
  }

  destroy() {
    this.svg.remove();
  }
}
