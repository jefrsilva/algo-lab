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
  // seta com ponta triangular
  arrow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4.5 19.5 15 9"/>
    <path d="M20 4 10.5 6.6l7 7z" fill="currentColor"/>
  </svg>`,
  // linha com uma travessa perpendicular em cada ponta (cota/medida)
  ruler: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <path d="M5 12h14"/>
    <path d="M5 6.5v11M19 6.5v11"/>
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

/** Tempo (ms) segurando o botão de um grupo até abrir a escolha. */
const LONG_PRESS_MS = 350;

/**
 * Barra flutuante de modos de interação do canvas, ancorada na parte
 * inferior da área de canvas. Reflete `ctx.mode` e delega a troca de modo a
 * `actions.setMode`. A lista de modos (`modes`, 3º argumento, ver
 * MICRO_MODES em App.js) vem de quem cria a barra.
 *
 * Modos com o mesmo `group` dividem UM botão: ele mostra o modo ativo do
 * grupo (ou o último escolhido) e, clicando e segurando (ou com o botão
 * direito), abre uma lista pra escolher entre eles — soltar sobre um item o
 * escolhe, ou dá pra clicar nele depois.
 */
export class ModeToolbar {
  constructor(container, actions, modes) {
    this.container = container;
    this.actions = actions;
    this.modes = modes;
    this.groupChoice = {}; // group -> id do último modo escolhido
    this.openGroup = null; // grupo com a lista de escolha aberta
    this._last = null;
    this._pressTimer = null;
    this._justChose = false;
    this._onDocPointerDown = (e) => {
      if (this.openGroup && !e.target.closest?.('.mode-group')) this._closeGroup();
    };
    this._onDocKeyDown = (e) => {
      if (e.key === 'Escape' && this.openGroup) this._closeGroup();
    };
  }

  _listen(on) {
    const fn = on ? 'addEventListener' : 'removeEventListener';
    document[fn]('pointerdown', this._onDocPointerDown, true);
    document[fn]('keydown', this._onDocKeyDown, true);
  }

  _closeGroup() {
    this.openGroup = null;
    this._listen(false);
    if (this._last) this.render(this._last);
  }

  _openGroupList(group) {
    clearTimeout(this._pressTimer);
    if (!this.openGroup) this._listen(true);
    this.openGroup = group;
    if (this._last) this.render(this._last);
  }

  _choose(m) {
    this._justChose = true;
    this.groupChoice[m.group] = m.id;
    this.openGroup = null;
    this._listen(false);
    this.actions.setMode(m.id);
  }

  _modeButton(m, mode, swatches, extraClass = '') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'mode-btn' + (mode === m.id ? ' active' : '') + extraClass;
    btn.title = `${m.label} (${m.shortcut})`;
    btn.setAttribute('aria-label', m.label);
    btn.dataset.modeId = m.id;
    btn.innerHTML = ICONS[m.id];
    if (swatches?.[m.id]) {
      const swatch = document.createElement('span');
      swatch.className = 'mode-btn-swatch';
      swatch.style.background = swatches[m.id];
      btn.appendChild(swatch);
    }
    return btn;
  }

  /** `swatches` (opcional): {idDoModo: corCss} — cor atual de uma
   * ferramenta (Alt+1..Alt+0, ver App#_applyMicroPaletteColor), mostrada
   * como uma bolinha no canto do botão daquele modo (ex: 'area', 'text'). */
  render({ mode, swatches = null }) {
    this._last = { mode, swatches };
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'mode-toolbar';
    const doneGroups = new Set();

    this.modes.forEach((m) => {
      if (!m.group) {
        const btn = this._modeButton(m, mode, swatches);
        btn.addEventListener('click', () => this.actions.setMode(m.id));
        wrap.appendChild(btn);
        return;
      }
      if (doneGroups.has(m.group)) return;
      doneGroups.add(m.group);
      const members = this.modes.filter((x) => x.group === m.group);
      // o botão lembra a última ferramenta ativa do grupo, mesmo escolhida por atalho
      if (members.some((x) => x.id === mode)) this.groupChoice[m.group] = mode;
      const current = members.find((x) => x.id === this.groupChoice[m.group]) ?? members[0];

      const host = document.createElement('div');
      host.className = 'mode-group';
      const btn = this._modeButton(current, mode, swatches, ' mode-btn-grouped');
      btn.title += ' — segure para escolher outra ferramenta do grupo';
      btn.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        clearTimeout(this._pressTimer);
        this._pressTimer = setTimeout(() => {
          this._openGroupList(m.group);
          // soltar o botão sobre um item da lista o escolhe
          const onUp = (ev) => {
            window.removeEventListener('pointerup', onUp, true);
            const item = ev.target.closest?.('.mode-flyout [data-mode-id]');
            const chosen = item && members.find((x) => x.id === item.dataset.modeId);
            if (chosen) this._choose(chosen);
          };
          window.addEventListener('pointerup', onUp, true);
        }, LONG_PRESS_MS);
      });
      const cancel = () => clearTimeout(this._pressTimer);
      btn.addEventListener('pointerup', cancel);
      btn.addEventListener('pointerleave', cancel);
      btn.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        this._openGroupList(m.group);
      });
      btn.addEventListener('click', () => {
        if (this.openGroup) return;
        this.groupChoice[m.group] = current.id;
        this.actions.setMode(current.id);
      });
      host.appendChild(btn);

      if (this.openGroup === m.group) {
        const flyout = document.createElement('div');
        flyout.className = 'mode-flyout';
        members.forEach((x) => {
          const item = this._modeButton(x, mode, swatches);
          item.addEventListener('click', () => {
            if (this._justChose) {
              this._justChose = false;
              return;
            }
            this._choose(x);
          });
          flyout.appendChild(item);
        });
        host.appendChild(flyout);
      }
      wrap.appendChild(host);
    });

    this.container.appendChild(wrap);
  }
}
