// @vitest-environment jsdom
// Tutorial guiado de primeiros passos: popups com Próximo / Pular, o aviso
// depois de pular e a integração com o App (primeira visita, menu ☰).
import { afterEach, describe, expect, test } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { TUTORIALS } from '../../src/ui/tutorials.js';

const COMO_COMECAR = TUTORIALS.find((t) => t.id === 'como-comecar').steps;
const TUTORIAL_STEPS = COMO_COMECAR;

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

  test('o menu ☰ tem o submenu Tutorial, com "Como começar" primeiro', async () => {
    app = await montarApp();
    const pai = [...document.querySelectorAll('.app-menu-item')].find((b) => b.textContent === 'Tutorial');
    const sub = pai.nextElementSibling;
    expect(sub.hidden).toBe(true);
    pai.click();
    expect(sub.hidden).toBe(false);
    const itens = [...sub.querySelectorAll('.app-menu-item')].map((b) => b.textContent);
    expect(itens[0]).toBe('Como começar');
    expect(itens).toHaveLength(TUTORIALS.length);
    sub.querySelector('.app-menu-item').click();
    expect(titulo()).toBe(TUTORIAL_STEPS[0].title);
    expect(sub.hidden).toBe(true); // escolher fecha o menu
    botao('Próximo').click();
    pai.click();
    sub.querySelector('.app-menu-item').click(); // recomeça
    expect(titulo()).toBe(TUTORIAL_STEPS[0].title);
    expect(document.querySelectorAll('.tutorial-popup').length).toBe(1);
  });

  test.each(TUTORIALS.slice(1))('cenário "$label": percorre os passos e pular só fecha', async (cenario) => {
    app = await montarApp();
    app._startTutorial(cenario.id);
    for (let i = 0; i < cenario.steps.length - 1; i++) {
      expect(titulo()).toBe(cenario.steps[i].title);
      botao('Próximo').click();
    }
    botao('Concluir').click();
    expect($('.tutorial-popup')).toBeNull();

    app._startTutorial(cenario.id);
    botao('Pular tutorial').click();
    expect($('.tutorial-popup')).toBeNull(); // sem o aviso do "Como começar"
  });

  test('cenários não marcam o tutorial inicial como visto', async () => {
    app = await montarApp({ tutorial: true });
    localStorage.clear();
    app._startTutorial('somar-lista');
    botao('Pular tutorial').click();
    expect(localStorage.getItem('algo-visualizer:settings')).toBeNull();
  });

  test('todo passo de todo roteiro com alvo aponta pra um elemento que existe na interface', async () => {
    app = await montarApp();
    for (const { steps } of TUTORIALS) {
      for (const step of steps) {
        if (step.target) expect(document.querySelector(step.target), step.target).not.toBeNull();
      }
    }
  });
});
