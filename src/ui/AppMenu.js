const MENU_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M4 6h16M4 12h16M4 18h16"/>
</svg>`;

/**
 * Menu simples (ícone de hambúrguer) ancorado no canto onde é montado — abre
 * um dropdown com uma lista de ações (`items: [{id,label}]`, ou
 * `{separator:true}` pra uma linha divisória) e chama `onSelect(id)` ao
 * clicar numa delas. Fecha ao selecionar um item ou ao clicar fora.
 */
export class AppMenu {
  constructor(container, { items = [], onSelect } = {}) {
    this.container = container;
    this.items = items;
    this.onSelect = onSelect || (() => {});
    this.open = false;
    this._build();
  }

  _build() {
    this.container.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'app-menu';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'canvas-icon-btn';
    btn.title = 'Menu';
    btn.innerHTML = MENU_ICON;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this._toggle();
    });

    const dropdown = document.createElement('div');
    dropdown.className = 'app-menu-dropdown';
    dropdown.hidden = true;
    this.itemEls = new Map();
    this.items.forEach((item) => {
      if (item.separator) {
        const sep = document.createElement('div');
        sep.className = 'app-menu-separator';
        dropdown.appendChild(sep);
        return;
      }
      const itemBtn = document.createElement('button');
      this.itemEls.set(item.id, itemBtn);
      itemBtn.type = 'button';
      itemBtn.className = 'app-menu-item';
      itemBtn.textContent = item.label;
      itemBtn.addEventListener('click', () => {
        this._close();
        this.onSelect(item.id);
      });
      dropdown.appendChild(itemBtn);
    });

    wrap.appendChild(btn);
    wrap.appendChild(dropdown);
    this.container.appendChild(wrap);
    this.dropdown = dropdown;

    this._outsideHandler = (e) => {
      if (!wrap.contains(e.target)) this._close();
    };
  }

  /** Troca o texto de um item já montado (ex.: "Tema claro" <-> "Tema escuro"). */
  setItemLabel(id, label) {
    const el = this.itemEls.get(id);
    if (el) el.textContent = label;
  }

  _toggle() {
    if (this.open) this._close();
    else this._openMenu();
  }

  _openMenu() {
    this.open = true;
    this.dropdown.hidden = false;
    document.addEventListener('pointerdown', this._outsideHandler);
  }

  _close() {
    this.open = false;
    this.dropdown.hidden = true;
    document.removeEventListener('pointerdown', this._outsideHandler);
  }
}
