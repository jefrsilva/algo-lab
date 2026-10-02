import { getSetting, setSetting } from './settings.js';

/**
 * Tema visual (escuro/claro) — preferência de quem está vendo, NÃO parte do
 * projeto salvo (fica nas configurações, ver settings.js). Aplicado como
 * `data-theme` no <html>; os tokens de cor de cada tema ficam em
 * src/styles/variables.css. Escuro é o padrão (o app sempre abriu assim); o
 * claro é útil pra projetar/gravar com fundo branco.
 */
export function getSavedTheme() {
  return getSetting('theme');
}

export function getTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function applyTheme(theme) {
  // troca instantânea: sem isso, todo elemento com `transition` de cor
  // (nós, células, bordas) atravessava tons intermediários por 0.2s —
  // ex.: células de array passando por quase-preto ao ir do escuro pro claro.
  const root = document.documentElement;
  root.classList.add('theme-switching');
  root.dataset.theme = setSetting('theme', theme);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('theme-switching')));
}
