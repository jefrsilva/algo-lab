// @vitest-environment jsdom
// Tutorial guiado de primeiros passos: popups com Próximo / Pular, o aviso
// depois de pular e a integração com o App (primeira visita, menu ☰).
import { afterEach, describe, expect, test } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { TUTORIAL_STEPS } from '../../src/ui/Tutorial.js';

let app;
const $ = (sel) => document.querySelector(sel);
const botao = (texto) => [...document.querySelectorAll('.tutorial-popup .btn')].find((b) => b.textContent === texto);
const titulo = () => $('.tutorial-title')?.textContent;

afterEach(() => {
  if (app) desmontarApp(app);
  app = null;
});

describe('Tutorial', () => {
  test('não abre sozinho quando já foi visto', async () => {
    app = await montarApp();
    expect($('.tutorial-popup')).toBeNull();
  });

  test('abre na primeira visita e Próximo percorre todos os passos até Concluir', async () => {
    app = await montarApp({ tutorial: true });
    expect(titulo()).toBe(TUTORIAL_STEPS[0].title);
    for (let i = 1; i < TUTORIAL_STEPS.length; i++) {
      botao('Próximo').click();
      expect(titulo()).toBe(TUTORIAL_STEPS[i].title);
    }
    expect(botao('Pular tutorial')).toBeUndefined(); // último passo não tem o que pular
    botao('Concluir').click();
    expect($('.tutorial-popup')).toBeNull();
    expect(JSON.parse(localStorage.getItem('algo-visualizer:settings')).tutorialSeen).toBe(true);
  });

  test('Pular mostra o aviso do menu e depois fecha; não reabre sozinho', async () => {
    app = await montarApp({ tutorial: true });
    botao('Próximo').click();
    botao('Pular tutorial').click();
    expect(titulo()).toBe('Tutorial pulado');
    expect($('.tutorial-popup').textContent).toContain('menu');
    expect(botao('Próximo')).toBeUndefined();
    botao('Entendi').click();
    expect($('.tutorial-popup')).toBeNull();
    expect(JSON.parse(localStorage.getItem('algo-visualizer:settings')).tutorialSeen).toBe(true);
  });

  test('Esc pula, e Esc de novo fecha o aviso', async () => {
    app = await montarApp({ tutorial: true });
    tecla(window, 'Escape');
    expect(titulo()).toBe('Tutorial pulado');
    tecla(window, 'Escape');
    expect($('.tutorial-popup')).toBeNull();
  });

  test('o menu ☰ tem o item Tutorial que reabre do começo', async () => {
    app = await montarApp();
    const item = [...document.querySelectorAll('.app-menu-item')].find((b) => b.textContent === 'Tutorial');
    expect(item).toBeDefined();
    item.click();
    expect(titulo()).toBe(TUTORIAL_STEPS[0].title);
    botao('Próximo').click();
    item.click(); // recomeça
    expect(titulo()).toBe(TUTORIAL_STEPS[0].title);
    expect(document.querySelectorAll('.tutorial-popup').length).toBe(1);
  });

  test('todo passo com alvo aponta pra um elemento que existe na interface', async () => {
    app = await montarApp();
    for (const step of TUTORIAL_STEPS) {
      if (step.target) expect(document.querySelector(step.target), step.target).not.toBeNull();
    }
  });
});
