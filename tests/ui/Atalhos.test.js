// @vitest-environment jsdom
// Janela "Atalhos de teclado" (☰ → Atalhos de teclado, ou a tecla ?), os avisos
// de "só Python" e a dica do tutorial de onboarding sobre a lista de atalhos.
import { afterEach, describe, expect, test } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { SHORTCUT_SECTIONS } from '../../src/ui/ShortcutsDialog.js';
import { TUTORIALS } from '../../src/ui/tutorials.js';

let app;
const $ = (sel) => document.querySelector(sel);
afterEach(() => {
  if (app) desmontarApp(app);
  app = null;
});

const textoDoTutorial = (id) =>
  TUTORIALS.find((t) => t.id === id)
    .steps.flatMap((s) => s.body)
    .filter((b) => typeof b === 'string')
    .join('\n');

describe('Atalhos de teclado', () => {
  test('o item do menu abre a lista com todas as seções; Fechar fecha', async () => {
    app = await montarApp();
    const item = [...document.querySelectorAll('.app-menu-item')].find((b) => b.textContent.startsWith('Atalhos de teclado'));
    expect(item).toBeDefined();
    item.click();
    const janela = $('.shortcuts-dialog');
    expect(janela.querySelector('.app-dialog-title').textContent).toBe('Atalhos de teclado');
    const total = SHORTCUT_SECTIONS.reduce((n, s) => n + s.items.length, 0);
    expect(janela.querySelectorAll('.shortcuts-keys')).toHaveLength(total);
    expect(janela.textContent).toContain('Ctrl+Espaço');
    janela.querySelector('.btn').click();
    expect($('.shortcuts-dialog')).toBeNull();
  });

  test('a tecla ? abre a lista (e não fecha/reabre sozinha); Esc fecha', async () => {
    app = await montarApp();
    tecla(document.body, '?');
    expect($('.shortcuts-dialog')).not.toBeNull();
    tecla(document.body, '?');
    expect(document.querySelectorAll('.shortcuts-dialog')).toHaveLength(1);
    tecla(document.body, 'Escape');
    expect($('.shortcuts-dialog')).toBeNull();
  });

  test('o tutorial de onboarding explica como ver os atalhos e avisa que só há Python', () => {
    const texto = textoDoTutorial('como-comecar');
    expect(texto).toContain('Atalhos de teclado');
    expect(texto).toContain('apenas a linguagem Python');
  });

  test('o editor vazio mostra a dica de que só Python é aceito', async () => {
    app = await montarApp();
    expect($('.code-editor-textarea').placeholder).toContain('apenas código Python');
  });
});
