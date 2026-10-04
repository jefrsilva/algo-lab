import { measureText } from './textMeasure.js';

/**
 * Markdown básico das labels de texto (modo "Texto" da barra inferior): o
 * texto digitado é guardado cru (`node.text`) e formatado só no desenho.
 *
 * Cada linha do texto é uma linha da label (como antes do markdown — não há
 * junção de linhas em parágrafo). Por linha:
 *   - `# título`, `## subtítulo`, `### seção` — maiores e em negrito;
 *   - `- item`, `* item`, `+ item` — lista com marcador (•);
 *   - `1. item`, `2) item` — lista numerada (o número é o digitado);
 *     nas duas listas, cada 2 espaços de recuo descem um nível;
 *   - entre duas linhas ``` — bloco de código (monoespaçado, sem formatação).
 * Dentro da linha: `**negrito**`/`__negrito__`, `*itálico*`/`_itálico_`,
 * `***os dois***` e `` `código` `` (monoespaçado, com fundo). `\*` escapa.
 * `_` dentro de palavra não formata (`soma_total`), nem `*` cercado de
 * espaços (`a * b`). Marcação sem fechamento fica como texto.
 *
 * Tudo puro (sem DOM): `parseLabelMarkdown` dá a estrutura e `labelLayout` a
 * geometria — usada pelo render (MicroCanvasView#_renderLabels) e pelo
 * hit-test (App.js, via `labelSize`), que assim sempre concordam.
 */

export const LABEL_PAD_X = 14;
export const LABEL_PAD_Y = 10;
/** Altura de linha, em múltiplos do tamanho da fonte da linha (labels
 * multi-linha, Shift+Enter no editor) — a mesma no render e no `<textarea>`
 * de edição. */
export const LABEL_LINE_HEIGHT = 1.3;

/** Tamanho dos títulos em relação à fonte da label (`#`, `##`, `###`+). */
export const LABEL_HEADING_SCALE = { 1: 1.6, 2: 1.3, 3: 1.12 };
/** Recuo por nível de lista e espaço reservado ao marcador, em fração da fonte. */
const LIST_INDENT = 1.4;
const LIST_MARKER_W = 1.3;
const LIST_MARKER_GAP = 0.4;
const BULLETS = ['•', '◦', '▪'];
/** Folga horizontal de cada lado do fundo de um `código` (fração da fonte). */
export const LABEL_CODE_PAD = 0.3;
/** Folga horizontal entre a borda do fundo de um bloco ``` e o texto. */
const CODE_BLOCK_PAD = 0.5;

const ESCAPABLE = /[\\`*_#+\-.!()[\]{}<>|~]/;
const ALNUM = /[\p{L}\p{N}]/u;
const SPACE = /\s/;

/** Junta trechos vizinhos com o mesmo estilo. */
function pushRun(runs, run) {
  if (!run.text) return;
  const prev = runs[runs.length - 1];
  if (prev && prev.bold === run.bold && prev.italic === run.italic && prev.code === run.code) prev.text += run.text;
  else runs.push(run);
}

/** Tamanho da sequência de `ch` a partir de `i`. */
function runLength(src, i, ch) {
  let j = i;
  while (src[j] === ch) j++;
  return j - i;
}

/** Fim (exclusivo) de um `código` aberto em `i` com `n` crases, ou -1. */
function codeSpanEnd(src, i, n) {
  let j = i + n;
  while (j < src.length) {
    if (src[j] === '`') {
      const m = runLength(src, j, '`');
      if (m === n) return j;
      j += m;
    } else j++;
  }
  return -1;
}

/** Posição do delimitador que fecha `delim` (`*`, `**`, `***`, `_`…) aberto
 * antes de `from`, ou -1 — pula `código` e escapes, e só aceita uma
 * sequência do MESMO tamanho, colada no texto (sem espaço antes) e, para
 * `_`, não seguida de letra/dígito. */
function findCloser(src, from, delim) {
  const ch = delim[0];
  let j = from;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (c === '`') {
      const n = runLength(src, j, '`');
      const end = codeSpanEnd(src, j, n);
      j = end < 0 ? j + n : end + n;
      continue;
    }
    if (c === ch) {
      const m = runLength(src, j, ch);
      const before = src[j - 1];
      const after = src[j + m];
      if (m === delim.length && j > from && !SPACE.test(before) && !(ch === '_' && after && ALNUM.test(after))) return j;
      j += m;
      continue;
    }
    j++;
  }
  return -1;
}

/** Trechos formatados de uma linha: `[{ text, bold, italic, code }]`. */
export function parseInline(src, style = { bold: false, italic: false }) {
  const runs = [];
  let buf = '';
  const flush = () => {
    pushRun(runs, { text: buf, bold: style.bold, italic: style.italic, code: false });
    buf = '';
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\' && i + 1 < src.length && ESCAPABLE.test(src[i + 1])) {
      buf += src[i + 1];
      i += 2;
      continue;
    }
    if (c === '`') {
      const n = runLength(src, i, '`');
      const end = codeSpanEnd(src, i, n);
      if (end < 0) {
        buf += '`'.repeat(n);
        i += n;
        continue;
      }
      let code = src.slice(i + n, end);
      // como no CommonMark: um espaço de cada lado permite ``` `` ` `` ```
      if (code.length > 2 && code[0] === ' ' && code[code.length - 1] === ' ' && code.trim()) code = code.slice(1, -1);
      flush();
      pushRun(runs, { text: code, bold: style.bold, italic: style.italic, code: true });
      i = end + n;
      continue;
    }
    if (c === '*' || c === '_') {
      const n = runLength(src, i, c);
      const next = src[i + n];
      const prev = src[i - 1];
      const canOpen = next !== undefined && !SPACE.test(next) && !(c === '_' && prev && ALNUM.test(prev));
      let matched = false;
      if (canOpen) {
        // tenta do delimitador mais longo possível ao mais curto (*** → ** → *)
        for (let k = Math.min(n, 3); k >= 1 && !matched; k--) {
          const delim = c.repeat(k);
          const close = findCloser(src, i + n, delim);
          if (close < 0) continue;
          flush();
          // sobra da sequência de abertura (ex. "****a**") fica como texto
          buf = c.repeat(n - k);
          flush();
          const inner = src.slice(i + n, close);
          const innerStyle = {
            bold: style.bold || k >= 2,
            italic: style.italic || k !== 2,
          };
          parseInline(inner, innerStyle).forEach((r) => pushRun(runs, r));
          i = close + k;
          matched = true;
        }
      }
      if (!matched) {
        buf += c.repeat(n);
        i += n;
      }
      continue;
    }
    buf += c;
    i++;
  }
  flush();
  return runs;
}

/**
 * Estrutura do markdown de uma label — uma entrada por linha desenhada:
 * `{ kind: 'p'|'heading'|'bullet'|'ordered'|'code', level, depth, marker, runs }`
 * (`level`: 1–3 nos títulos; `depth`: nível de recuo das listas). As linhas
 * ``` que abrem/fecham um bloco de código não são desenhadas.
 */
export function parseLabelMarkdown(text) {
  const lines = [];
  let inCode = false;
  String(text)
    .split('\n')
    .forEach((raw) => {
      if (/^\s*```/.test(raw)) {
        inCode = !inCode;
        return;
      }
      if (inCode) {
        lines.push({ kind: 'code', runs: raw ? [{ text: raw, bold: false, italic: false, code: true }] : [] });
        return;
      }
      let m = /^(#{1,6})\s+(.*)$/.exec(raw);
      if (m) {
        lines.push({ kind: 'heading', level: Math.min(3, m[1].length), runs: parseInline(m[2].replace(/\s+#+\s*$/, '')) });
        return;
      }
      m = /^(\s*)[-*+]\s+(.*)$/.exec(raw);
      if (m) {
        const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
        lines.push({ kind: 'bullet', depth, marker: BULLETS[depth % BULLETS.length], runs: parseInline(m[2]) });
        return;
      }
      m = /^(\s*)(\d{1,9})([.)])\s+(.*)$/.exec(raw);
      if (m) {
        const depth = Math.floor(m[1].replace(/\t/g, '  ').length / 2);
        lines.push({ kind: 'ordered', depth, marker: `${Number(m[2])}${m[3]}`, runs: parseInline(m[4]) });
        return;
      }
      lines.push({ kind: 'p', runs: parseInline(raw) });
    });
  return lines;
}

/**
 * Geometria de uma label com markdown, em coordenadas locais (origem no
 * canto superior esquerdo da caixa):
 *   { width, height,
 *     lines: [{ y (centro), size, marker: {text, x}|null, segments }],
 *     codeBlocks: [{ y, height }] }  — fundos dos blocos ``` (largura toda)
 * `segments`: `[{ text, x, width, size, bold, italic, code }]`, cada um já
 * posicionado (o render põe um `<tspan>` com `x` explícito por trecho).
 * `measure(text, font)` mede um trecho (padrão: `measureText`; os testes
 * passam uma medida fixa).
 */
export function labelLayout(text, fontSize, measure = measureText) {
  const parsed = parseLabelMarkdown(text);
  if (!parsed.length) parsed.push({ kind: 'p', runs: [] });
  const lines = [];
  const codeBlocks = [];
  const listMarkerW = orderedMarkerWidths(parsed, fontSize, measure);
  let y = LABEL_PAD_Y;
  let right = 0;
  parsed.forEach((line, idx) => {
    const heading = line.kind === 'heading';
    const size = heading ? fontSize * LABEL_HEADING_SCALE[line.level] : fontSize;
    const lineH = size * LABEL_LINE_HEIGHT;
    let x = LABEL_PAD_X;
    let marker = null;
    if (line.kind === 'bullet' || line.kind === 'ordered') {
      x += line.depth * fontSize * LIST_INDENT;
      const ownW = measure(line.marker, { size });
      // numerada: números alinhados à direita na largura do maior da lista
      const markerW = listMarkerW.get(idx) ?? ownW;
      marker = { text: line.marker, x: x + markerW - ownW };
      x += Math.max(fontSize * LIST_MARKER_W, markerW + fontSize * LIST_MARKER_GAP);
    } else if (line.kind === 'code') {
      x += fontSize * CODE_BLOCK_PAD;
      const prev = codeBlocks[codeBlocks.length - 1];
      if (prev && parsed[idx - 1]?.kind === 'code') prev.height += lineH;
      else codeBlocks.push({ y, height: lineH });
    }
    const segments = line.runs.map((run) => {
      const font = { size, bold: heading || run.bold, italic: run.italic, mono: run.code };
      // `código` solto na linha ganha folga dos dois lados (fundo próprio);
      // dentro de um bloco ``` o fundo é o do bloco todo
      const pad = run.code && line.kind !== 'code' ? size * LABEL_CODE_PAD : 0;
      const width = measure(run.text, font);
      const seg = { text: run.text, x: x + pad, width, size, bold: font.bold, italic: run.italic, code: run.code };
      x += width + pad * 2;
      return seg;
    });
    right = Math.max(right, line.kind === 'code' ? x + fontSize * CODE_BLOCK_PAD : x);
    lines.push({ kind: line.kind, y: y + lineH / 2, size, marker, segments });
    y += lineH;
  });
  const width = Math.max(40, Math.round(right + LABEL_PAD_X));
  const height = Math.round(y + LABEL_PAD_Y);
  return { width, height, lines, codeBlocks };
}

/** Largura do maior número de cada lista numerada (índice da linha → largura):
 * itens numerados seguidos no mesmo nível (itens mais recuados no meio não
 * quebram a lista) usam todos a mesma, pro texto deles ficar alinhado
 * ("9." e "10."). */
function orderedMarkerWidths(parsed, fontSize, measure) {
  const widths = new Map();
  const isList = (l) => l.kind === 'bullet' || l.kind === 'ordered';
  parsed.forEach((line, idx) => {
    if (line.kind !== 'ordered' || widths.has(idx)) return;
    const members = [];
    for (let j = idx; j < parsed.length && isList(parsed[j]) && parsed[j].depth >= line.depth; j++) {
      const l = parsed[j];
      if (l.depth !== line.depth) continue;
      if (l.kind !== 'ordered') break;
      members.push(j);
    }
    const max = Math.max(...members.map((j) => measure(parsed[j].marker, { size: fontSize })));
    members.forEach((j) => widths.set(j, max));
  });
  return widths;
}

/** Tamanho do texto CRU (sem formatar) em fonte mono — a caixa do
 * `<textarea>` de edição in place (App#_editMicroLabelInPlace), onde o
 * markdown aparece digitado como está. */
export function labelSourceSize(text, fontSize) {
  const lines = String(text).split('\n');
  const longest = lines.reduce((acc, l) => Math.max(acc, l.length), 0);
  const width = Math.max(40, Math.round(longest * fontSize * 0.6) + LABEL_PAD_X * 2);
  const height = Math.round(fontSize * LABEL_LINE_HEIGHT * lines.length) + LABEL_PAD_Y * 2;
  return { width, height };
}
