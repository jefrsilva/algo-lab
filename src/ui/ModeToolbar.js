const ICONS = {
  select: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 13.2V6.5a1.5 1.5 0 0 1 3 0V12"/>
    <path d="M11 12V5a1.5 1.5 0 0 1 3 0v7"/>
    <path d="M14 12.4V6.2a1.5 1.5 0 0 1 3 0V14"/>
    <path d="M8 13.2c-1.4-1-3-.4-3 .9 0 2.1 1.9 7 4.6 8.5.5.3 1 .4 1.6.4h3.1c2.3 0 4.7-2.5 4.7-5.4V11a1.5 1.5 0 0 0-3 0"/>
  </svg>`,
  connect: `<svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1" stroke-linejoin="round">
    <path d="M4 3 21 10.5l-7.6 2.4L11 21 4 3z"/>
  </svg>`,
  highlight: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 18h6M10 21h4"/>
    <path d="M12 3a6 6 0 0 0-3.5 10.9c.6.44 1 1.15 1 1.93V16h5v-1.17c0-.78.4-1.49 1-1.93A6 6 0 0 0 12 3Z"/>
    <path d="M12 1v1.4M4.2 4.2l1 1M1.4 12h1.4M20.6 4.2l-1 1M22.6 12h-1.4"/>
  </svg>`,
  text: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 6h16M12 6v13"/>
    <path d="M8 19h8"/>
  </svg>`,
  area: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <rect x="3.5" y="4.5" width="17" height="15" rx="1.5"/>
    <path d="M3.5 12 11 4.5M3.5 19.5l15-15M11 19.5l9.5-9.5" stroke-width="1.3"/>
  </svg>`,
  chart: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 3v17h17"/>
    <path d="M7 17c3-.2 5-.5 7-1.8"/>
    <path d="M7 16.5c4-2 7-6 9-12.5" stroke-width="1.5"/>
  </svg>`,
};

const MODES = [
  { id: 'select', label: 'Selecionar / Mover', shortcut: '1 / M' },
  { id: 'connect', label: 'Apontar / Conectar', shortcut: '2 / C' },
  { id: 'highlight', label: 'Destacar', shortcut: '3 / D' },
];

/**
 * Barra flutuante de modos de interação do canvas, ancorada na parte
 * inferior da área de canvas. Não guarda estado — reflete `ctx.mode` e
 * delega a troca de modo a `actions.setMode`. A lista de modos é
 * configurável (`modes`, 3º argumento) — o modo micro usa um subconjunto
 * diferente do macro (ver App.js).
 */
export class ModeToolbar {
  constructor(container, actions, modes = MODES) {
    this.container = container;
    this.actions = actions;
    this.modes = modes;
  }

  /** `swatches` (opcional): {idDoModo: corCss} — cor atual de uma
   * ferramenta (Alt+1..Alt+0, ver App#_applyMicroPaletteColor), mostrada
   * como uma bolinha no canto do botão daquele modo (ex: 'area', 'text'). */
  render({ mode, swatches = null }) {
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'mode-toolbar';

    this.modes.forEach((m) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn' + (mode === m.id ? ' active' : '');
      btn.title = `${m.label} (${m.shortcut})`;
      btn.setAttribute('aria-label', m.label);
      btn.innerHTML = ICONS[m.id];
      if (swatches?.[m.id]) {
        const swatch = document.createElement('span');
        swatch.className = 'mode-btn-swatch';
        swatch.style.background = swatches[m.id];
        btn.appendChild(swatch);
      }
      btn.addEventListener('click', () => this.actions.setMode(m.id));
      wrap.appendChild(btn);
    });

    this.container.appendChild(wrap);
  }
}
