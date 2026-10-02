const MARGIN = 8;

/**
 * Posiciona um popup flutuante (já anexado a `container`) inteiro dentro
 * dele, a partir do ponto de tela (relativo a `container`) que o abriu:
 *
 * - `anchor: 'top'` (padrão — popups de configurações, pendurados pelo
 *   topo): abre pra baixo do ponto quando cabe, senão pra cima dele, senão
 *   encostado na borda inferior.
 * - `anchor: 'center'` (ex: NodePopup): centrado no ponto, empurrado pra
 *   dentro das bordas.
 *
 * Na horizontal, sempre centrado no ponto e empurrado pra dentro das
 * bordas. Num container baixo demais pro popup inteiro, ele ganha rolagem.
 * Depois disso `left/top` passam a ser o canto superior esquerdo de fato —
 * o deslocamento do CSS (`--popup-dx/--popup-dy`, também usado pela
 * animação `popup-in`) é zerado. `offsetWidth/Height` ignoram o `transform`
 * da animação, então a medida é a do tamanho final.
 */
export function fitPopupInContainer(el, container, screenX, screenY, { anchor = 'top' } = {}) {
  const cw = container.clientWidth;
  const ch = container.clientHeight;
  el.style.maxHeight = `${Math.max(120, ch - MARGIN * 2)}px`;
  el.style.overflowY = 'auto';
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const clampX = (x) => Math.max(MARGIN, Math.min(x, cw - w - MARGIN));
  const clampY = (y) => Math.max(MARGIN, Math.min(y, ch - h - MARGIN));

  let top;
  if (anchor === 'center') top = clampY(screenY - h / 2);
  else if (screenY + h <= ch - MARGIN) top = screenY;
  else if (screenY - h >= MARGIN) top = screenY - h;
  else top = clampY(screenY);

  el.style.setProperty('--popup-dx', '0px');
  el.style.setProperty('--popup-dy', '0px');
  el.style.left = `${clampX(screenX - w / 2)}px`;
  el.style.top = `${top}px`;
}
