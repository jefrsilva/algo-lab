/**
 * Configurações de quem está usando a ferramenta (tema, nomes completos,
 * console flutuante, velocidade da reprodução...) — preferência de tela, NÃO
 * parte do projeto salvo. Ficam todas juntas num único objeto no
 * localStorage, então sobrevivem a fechar e reabrir a ferramenta; editadas
 * pela janela de Configurações (ver src/ui/SettingsDialog.js) e pelos atalhos
 * de teclado de sempre (G, N, C, Alt+C, Ctrl+A, Ctrl+H...).
 *
 * Antes cada preferência tinha a sua própria chave (tema, grid das áreas,
 * modo da pilha de chamadas, console) — `loadAll` ainda lê essas chaves
 * antigas uma vez, pra quem já tinha escolhido algo não perder a escolha.
 */
const STORAGE_KEY = 'algo-visualizer:settings';

export const CODE_FONT_MIN = 16;
export const CODE_FONT_MAX = 32;
export const SPEED_MIN = 0.5;
export const SPEED_MAX = 3;
export const SPEED_STEP = 0.25;

export const SETTINGS_DEFAULTS = Object.freeze({
  theme: 'dark', // 'dark' | 'light'
  codeFontSize: 22,
  simplifiedNodes: false, // Ctrl+A
  fullNames: false, // N
  areaSnap: true, // G
  consoleHidden: false, // C
  consoleFloating: false, // Alt+C
  consoleRect: null, // {x,y,w,h} da janela flutuante do console
  callTreeMode: 'full', // 'full' | 'compact' | 'hidden'
  dimOutOfScope: true, // elementos fora do escopo da chamada ativa ficam translúcidos
  codePanelHidden: false, // Ctrl+H
  codePanelBottomInset: 0, // px reservados embaixo do painel de código (ver App#_setupCodeBottomResizer)
  playbackSpeed: 1,
});

const clampNumber = (v, min, max, fallback) => (Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback);
const validRect = (r) => (r && typeof r === 'object' && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(r[k])) ? r : null);

/** Normaliza um valor lido do storage — qualquer coisa estranha volta pro padrão. */
const VALIDATORS = {
  theme: (v) => (v === 'light' ? 'light' : 'dark'),
  codeFontSize: (v) => Math.round(clampNumber(v, CODE_FONT_MIN, CODE_FONT_MAX, SETTINGS_DEFAULTS.codeFontSize)),
  simplifiedNodes: (v) => v === true,
  fullNames: (v) => v === true,
  areaSnap: (v) => v !== false,
  consoleHidden: (v) => v === true,
  consoleFloating: (v) => v === true,
  consoleRect: validRect,
  callTreeMode: (v) => (['full', 'compact', 'hidden'].includes(v) ? v : 'full'),
  dimOutOfScope: (v) => v !== false,
  codePanelHidden: (v) => v === true,
  codePanelBottomInset: (v) => Math.round(clampNumber(v, 0, 10000, 0)),
  playbackSpeed: (v) => clampNumber(v, SPEED_MIN, SPEED_MAX, SETTINGS_DEFAULTS.playbackSpeed),
};

function readLegacy() {
  const legacy = {};
  try {
    const theme = localStorage.getItem('algo-visualizer:theme');
    if (theme) legacy.theme = theme;
    const snap = localStorage.getItem('algo-visualizer:area-snap');
    if (snap) legacy.areaSnap = snap !== 'off';
    const callTree = localStorage.getItem('algo-visualizer:call-tree-mode');
    if (callTree) legacy.callTreeMode = callTree;
    const consoleRaw = JSON.parse(localStorage.getItem('algo-visualizer:console-window') || 'null');
    if (consoleRaw && typeof consoleRaw === 'object') {
      legacy.consoleFloating = consoleRaw.floating === true;
      legacy.consoleRect = consoleRaw.rect;
    }
  } catch {
    // storage indisponível ou JSON estragado — fica com os padrões
  }
  return legacy;
}

function loadAll() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    raw = null;
  }
  const source = raw && typeof raw === 'object' ? raw : readLegacy();
  const out = {};
  Object.keys(SETTINGS_DEFAULTS).forEach((key) => {
    out[key] = key in source ? VALIDATORS[key](source[key]) : SETTINGS_DEFAULTS[key];
  });
  return out;
}

const current = loadAll();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    // sem storage (janela privada, bloqueado) — vale só pra esta sessão
  }
}

export function getSetting(key) {
  return current[key];
}

/** Grava (já normalizado) e devolve o valor efetivamente guardado. */
export function setSetting(key, value) {
  if (!(key in VALIDATORS)) throw new Error(`configuração desconhecida: ${key}`);
  current[key] = VALIDATORS[key](value);
  persist();
  return current[key];
}
