/**
 * Largura de um trecho de texto numa fonte do app, para a geometria das
 * labels de texto com markdown (ver `labelLayout` em labelMarkdown.js) —
 * fontes proporcionais (negrito, itálico, título…) não dá pra estimar só pelo
 * número de caracteres como nas demais geometrias do canvas.
 *
 * No navegador mede com um `OffscreenCanvas` 2D (sem tocar no DOM do canvas
 * SVG, nem `getBBox`), com cache por fonte+texto. Sem canvas (jsdom, Node)
 * cai numa estimativa por caractere, a mesma ideia de `labelSize` antes do
 * markdown. Fonte ainda não carregada não entra no cache: pede o
 * carregamento e, quando as fontes terminam de carregar (`loadingdone`), o
 * cache é zerado, a "geração" sobe (o render das labels usa ela pra se
 * refazer) e os ouvintes de `onTextMeasureChange` são avisados (App
 * redesenha o canvas).
 */

/** Largura média de um caractere, em fração do tamanho da fonte — só para a
 * estimativa sem canvas. A mono é exata (JetBrains Mono: 0,6 em). */
const FALLBACK_CHAR_W = { mono: 0.6, sans: 0.55, sansBold: 0.58 };

const FALLBACK_FAMILY = {
  sans: "'Atkinson Hyperlegible Next', 'Segoe UI', system-ui, sans-serif",
  mono: "'JetBrains Mono', 'Cascadia Code', Consolas, monospace",
};

let ctx; // undefined = ainda não tentou; null = sem canvas
let families = null;
let generation = 0;
const cache = new Map();
const listeners = new Set();

function context() {
  if (ctx !== undefined) return ctx;
  ctx = null;
  try {
    if (typeof OffscreenCanvas === 'function') ctx = new OffscreenCanvas(1, 1).getContext('2d') || null;
  } catch {
    ctx = null;
  }
  if (ctx && typeof document !== 'undefined' && document.fonts?.addEventListener) {
    document.fonts.addEventListener('loadingdone', () => {
      cache.clear();
      generation++;
      listeners.forEach((fn) => fn());
    });
  }
  return ctx;
}

/** Famílias das variáveis CSS `--font-sans`/`--font-mono` (variables.css) —
 * o canvas não entende `var()`. */
function fontFamilies() {
  if (families) return families;
  families = { ...FALLBACK_FAMILY };
  try {
    const style = getComputedStyle(document.documentElement);
    const sans = style.getPropertyValue('--font-sans').trim();
    const mono = style.getPropertyValue('--font-mono').trim();
    if (sans) families.sans = sans;
    if (mono) families.mono = mono;
  } catch {
    /* sem DOM: fica o padrão */
  }
  return families;
}

/** Largura (px) de `text` com a fonte descrita: `{ size, bold, italic, mono }`. */
export function measureText(text, { size, bold = false, italic = false, mono = false }) {
  const str = String(text);
  if (!str) return 0;
  const c = context();
  if (!c) {
    const charW = mono ? FALLBACK_CHAR_W.mono : bold ? FALLBACK_CHAR_W.sansBold : FALLBACK_CHAR_W.sans;
    return str.length * size * charW;
  }
  const fam = fontFamilies();
  const font = `${italic ? 'italic ' : ''}${bold ? 700 : 400} ${size}px ${mono ? fam.mono : fam.sans}`;
  const key = `${font}|${str}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  c.font = font;
  const width = c.measureText(str).width;
  let loaded = true;
  try {
    loaded = document.fonts.check(font, str);
    if (!loaded) document.fonts.load(font, str).catch(() => {});
  } catch {
    /* sem FontFaceSet: mede com o que houver */
  }
  if (loaded) cache.set(key, width);
  return width;
}

/** Sobe toda vez que as medidas mudam (fontes carregaram) — entra na
 * assinatura do render das labels, que só se refaz quando ela muda. */
export function textMeasureGeneration() {
  return generation;
}

/** `fn` é chamada quando as medidas mudam; devolve a função que desinscreve. */
export function onTextMeasureChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
