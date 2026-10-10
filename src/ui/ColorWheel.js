import { svgEl } from '../render/svgUtils.js';

/** Raio de dentro da roda (centro vazio = nenhuma cor) e de fora, em px. */
const INNER_R = 34;
const OUTER_R = 96;
/** Distância mínima do centro pra uma direção contar como escolha, em px. */
export const COLOR_WHEEL_DEAD_ZONE = 24;

/** Índice (0…count-1) da faixa apontada por (dx, dy) a partir do centro, ou
 * null dentro da zona morta. A faixa 0 fica centrada no topo e as outras
 * seguem no sentido horário. */
export function colorWheelIndex(dx, dy, count, deadZone = COLOR_WHEEL_DEAD_ZONE) {
  if (Math.hypot(dx, dy) < deadZone) return null;
  const turn = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1; // 0 no topo, horário
  const step = 1 / count;
  return Math.floor(((turn + step / 2) % 1) / step);
}

function polar(r, angle) {
  return [r * Math.sin(angle), -r * Math.cos(angle)];
}

/** Roda de seleção de cores ao redor do cursor (Ctrl+Shift segurados, ver
 * App#_onKeyDown). Overlay fixo na tela, sem receber o mouse: quem manda a
 * posição é o App (`move`). */
export class ColorWheel {
  constructor(parent = document.body) {
    this.el = svgEl('svg', {
      class: 'color-wheel',
      width: OUTER_R * 2 + 8,
      height: OUTER_R * 2 + 8,
      viewBox: `${-OUTER_R - 4} ${-OUTER_R - 4} ${OUTER_R * 2 + 8} ${OUTER_R * 2 + 8}`,
    });
    this.el.style.display = 'none';
    parent.appendChild(this.el);
    this.index = null;
    this.colors = [];
    this.slices = [];
    this.center = { x: 0, y: 0 };
  }

  get isOpen() {
    return this.el.style.display !== 'none';
  }

  /** `colors`: CSS das faixas (a i-ésima é a que Alt+(i+1) escolheria). */
  open(x, y, colors, labels = []) {
    this.colors = colors;
    this.center = { x, y };
    this.index = null;
    this.el.replaceChildren();
    const n = colors.length;
    const step = (2 * Math.PI) / n;
    const gap = 0.02;
    this.slices = colors.map((color, i) => {
      const a0 = i * step - step / 2 + gap;
      const a1 = i * step + step / 2 - gap;
      const [x0, y0] = polar(OUTER_R, a0);
      const [x1, y1] = polar(OUTER_R, a1);
      const [x2, y2] = polar(INNER_R, a1);
      const [x3, y3] = polar(INNER_R, a0);
      const path = svgEl('path', {
        class: 'color-wheel-slice',
        d: `M${x0} ${y0} A${OUTER_R} ${OUTER_R} 0 0 1 ${x1} ${y1} L${x2} ${y2} A${INNER_R} ${INNER_R} 0 0 0 ${x3} ${y3} Z`,
        fill: color,
      });
      this.el.appendChild(path);
      const [tx, ty] = polar((OUTER_R + INNER_R) / 2, i * step);
      const text = svgEl('text', { class: 'color-wheel-label', x: tx, y: ty });
      text.textContent = labels[i] ?? '';
      this.el.appendChild(text);
      return path;
    });
    this.el.style.left = `${x - OUTER_R - 4}px`;
    this.el.style.top = `${y - OUTER_R - 4}px`;
    this.el.style.display = '';
  }

  /** Mouse em (x, y) da tela: destaca a faixa na direção dele. */
  move(x, y) {
    if (!this.isOpen) return;
    this.index = colorWheelIndex(x - this.center.x, y - this.center.y, this.colors.length);
    this.slices.forEach((s, i) => s.classList.toggle('selected', i === this.index));
  }

  /** Fecha e devolve o índice escolhido (null = nenhum). */
  close() {
    const index = this.index;
    this.el.style.display = 'none';
    this.index = null;
    return index;
  }
}
