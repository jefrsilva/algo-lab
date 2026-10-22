// @vitest-environment jsdom
// Preferências do usuário (settings.js): um objeto só no localStorage, lido
// uma vez quando o módulo é importado — por isso cada teste reimporta o
// módulo depois de preparar o storage.
import { beforeEach, describe, expect, test, vi } from 'vitest';

const KEY = 'algo-visualizer:settings';

async function carregar() {
  vi.resetModules();
  return import('../../src/app/settings.js');
}

beforeEach(() => {
  localStorage.clear();
});

describe('settings', () => {
  test('sem nada salvo, tudo no padrão', async () => {
    const s = await carregar();
    for (const [key, value] of Object.entries(s.SETTINGS_DEFAULTS)) expect(s.getSetting(key)).toEqual(value);
  });

  test('setSetting normaliza, persiste e sobrevive a recarregar', async () => {
    let s = await carregar();
    expect(s.setSetting('codeFontSize', 99)).toBe(s.CODE_FONT_MAX);
    expect(s.setSetting('playbackSpeed', 0.1)).toBe(s.SPEED_MIN);
    expect(s.setSetting('theme', 'roxo')).toBe('dark');
    s.setSetting('theme', 'light');
    expect(JSON.parse(localStorage.getItem(KEY))).toMatchObject({ theme: 'light', codeFontSize: s.CODE_FONT_MAX });
    s = await carregar();
    expect(s.getSetting('theme')).toBe('light');
    expect(s.getSetting('codeFontSize')).toBe(s.CODE_FONT_MAX);
  });

  test('chave desconhecida lança', async () => {
    const s = await carregar();
    expect(() => s.setSetting('naoExiste', 1)).toThrow(/desconhecida/);
  });

  test('valores estragados no storage voltam pro padrão', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ theme: 42, callTreeMode: 'gigante', consoleRect: { x: 1 }, areaSnap: 'sim', codeFontSize: 'grande' }),
    );
    const s = await carregar();
    expect(s.getSetting('theme')).toBe('dark');
    expect(s.getSetting('callTreeMode')).toBe('full');
    expect(s.getSetting('consoleRect')).toBeNull();
    expect(s.getSetting('areaSnap')).toBe(true);
    expect(s.getSetting('codeFontSize')).toBe(s.SETTINGS_DEFAULTS.codeFontSize);
  });

  test('dimOutOfScope: padrão ligado, só `false` desliga e persiste', async () => {
    let s = await carregar();
    expect(s.getSetting('dimOutOfScope')).toBe(true);
    expect(s.setSetting('dimOutOfScope', 'talvez')).toBe(true);
    expect(s.setSetting('dimOutOfScope', false)).toBe(false);
    s = await carregar();
    expect(s.getSetting('dimOutOfScope')).toBe(false);
  });

  test('JSON inválido no storage não quebra', async () => {
    localStorage.setItem(KEY, '{nao é json');
    const s = await carregar();
    expect(s.getSetting('theme')).toBe('dark');
  });

  test('migra as chaves antigas (uma por preferência)', async () => {
    localStorage.setItem('algo-visualizer:theme', 'light');
    localStorage.setItem('algo-visualizer:area-snap', 'off');
    localStorage.setItem('algo-visualizer:call-tree-mode', 'compact');
    localStorage.setItem('algo-visualizer:console-window', JSON.stringify({ floating: true, rect: { x: 1, y: 2, w: 3, h: 4 } }));
    const s = await carregar();
    expect(s.getSetting('theme')).toBe('light');
    expect(s.getSetting('areaSnap')).toBe(false);
    expect(s.getSetting('callTreeMode')).toBe('compact');
    expect(s.getSetting('consoleFloating')).toBe(true);
    expect(s.getSetting('consoleRect')).toEqual({ x: 1, y: 2, w: 3, h: 4 });
  });
});
