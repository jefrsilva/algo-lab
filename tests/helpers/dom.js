// Preparação comum dos testes que montam a interface no jsdom
// (`// @vitest-environment jsdom` no topo do arquivo de teste).
import { vi } from 'vitest';

/** O jsdom não implementa ResizeObserver nem algumas APIs de layout/SVG que
 * o app usa — stubs mínimos, só pra montar a interface sem lançar. */
export function instalarStubsDom() {
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (!globalThis.URL.createObjectURL) globalThis.URL.createObjectURL = () => 'blob:teste';
  if (!globalThis.URL.revokeObjectURL) globalThis.URL.revokeObjectURL = () => {};
  // sem pedido de animação real: roda na hora
  if (!globalThis.requestAnimationFrame) globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
}

/** Monta o app inteiro num <div id="app"> novo e devolve a instância. O
 * módulo App.js é importado de novo a cada chamada (com `vi.resetModules`)
 * pra que settings.js releia o localStorage do zero. */
export async function montarApp() {
  instalarStubsDom();
  localStorage.clear();
  document.body.innerHTML = '<div id="app"></div>';
  vi.resetModules();
  const { App } = await import('../../src/app/App.js');
  const root = document.getElementById('app');
  return new App(root);
}

/** Tira os atalhos de teclado globais de um app montado — senão os apps de
 * testes anteriores (com o DOM já descartado) continuariam ouvindo `window`. */
export function desmontarApp(app) {
  app.microRunner.stop();
  window.removeEventListener('keydown', app._boundKeyDown);
  window.removeEventListener('keyup', app._boundKeyUp);
}

/** Dispara um keydown (com bubbles) no elemento. */
export function tecla(el, key, opts = {}) {
  const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...opts });
  el.dispatchEvent(ev);
  return ev;
}
