const ICONS = {
  // seta de ponteiro do mouse (a mão fica pro pan com a barra de espaço)
  select: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5.9 2.5v17.3l4.2-4.1 2.7 6 2.6-1.1-2.7-6h5.6z"/>
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
  // dois nós de grafo com uma aresta direcionada entre eles
  link: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="6" cy="17" r="3"/>
    <circle cx="18" cy="7" r="3"/>
    <path d="M8.4 15.1 15 9.6"/>
    <path d="M11.4 9.4 15 9.6l-.6 3.6"/>
  </svg>`,
};

/**
 * Barra flutuante de modos de interação do canvas, ancorada na parte
 * inferior da área de canvas. Não guarda estado — reflete `ctx.mode` e
 * delega a troca de modo a `actions.setMode`. A lista de modos (`modes`,
 * 3º argumento, ver MICRO_MODES em App.js) vem de quem cria a barra.
 */
export class ModeToolbar {
  constructor(container, actions, modes) {
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
