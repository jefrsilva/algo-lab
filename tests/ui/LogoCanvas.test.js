// @vitest-environment jsdom
// Logo do canvas: vem de src/assets/algo-lab.svg e é decorativa.
import { afterEach, describe, expect, test } from 'vitest';
import { desmontarApp, montarApp } from '../helpers/dom.js';

let app;
afterEach(() => {
  if (app) desmontarApp(app);
  app = null;
});

describe('Logo do canvas', () => {
  test('exibe o SVG do Algo-Lab, decorativo', async () => {
    app = await montarApp();
    const logo = document.querySelector('.canvas-logo');
    expect(logo.getAttribute('aria-hidden')).toBe('true');
    expect(logo.querySelector('svg[aria-label="Algo-Lab"]')).not.toBeNull();
    expect(logo.querySelectorAll('svg path').length).toBeGreaterThan(0);
  });
});
