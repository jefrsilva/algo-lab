// @vitest-environment jsdom
// ☰ → "Sobre o Algo-Lab": mostra o nome e a versão (package.json é a fonte única).
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { desmontarApp, montarApp } from '../helpers/dom.js';
import { APP_NAME, APP_VERSION } from '../../src/app/version.js';

let app;
afterEach(() => {
  if (app) desmontarApp(app);
  app = null;
});

describe('Sobre o Algo-Lab', () => {
  test('versão e nome vêm do package.json', () => {
    const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
    expect(APP_VERSION).toBe(pkg.version);
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(APP_NAME).toBe('Algo-Lab');
  });

  test('o item do menu abre um diálogo com o nome e a versão', async () => {
    app = await montarApp();
    const item = [...document.querySelectorAll('.app-menu-item')].find((b) => b.textContent === 'Sobre o Algo-Lab');
    expect(item).toBeDefined();
    item.click();
    const dialogo = document.querySelector('.app-dialog');
    expect(dialogo.querySelector('.app-dialog-title').textContent).toBe('Sobre o Algo-Lab');
    expect(dialogo.textContent).toContain(`Versão ${APP_VERSION}`);
    expect(dialogo.textContent).toContain('Desenvolvida e mantida por Jeferson Silva');
    expect(dialogo.textContent).toContain('apoio de IA');
    expect(dialogo.textContent).toContain('está em beta');
    expect(dialogo.textContent).toContain('não replica 100%');
    dialogo.querySelector('.btn').click();
    expect(document.querySelector('.app-dialog')).toBeNull();
  });
});
