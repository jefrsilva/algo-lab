const ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';

const ICONS = {
  vertical: `${ICON_OPEN}<path d="M10.5 7.5 6.5 15.5M13.5 7.5l4 8"/><circle cx="12" cy="5" r="2.5"/><circle cx="5.5" cy="18" r="2.5"/><circle cx="18.5" cy="18" r="2.5"/></svg>`,
  horizontal: `${ICON_OPEN}<path d="M7.5 10.5l8-4M7.5 13.5l8 4"/><circle cx="5" cy="12" r="2.5"/><circle cx="18" cy="5.5" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/></svg>`,
};

/** Os dois arranjos: níveis um abaixo do outro, ou lado a lado. */
export const TREE_LAYOUT_BUTTONS = [
  { id: 'vertical', label: 'Árvore ↕ — organiza por níveis, um abaixo do outro' },
  { id: 'horizontal', label: 'Árvore ↔ — organiza por níveis, um ao lado do outro' },
];

/**
 * Barra flutuante "organizar como árvore", logo acima da barra de modos (ver
 * ModeToolbar.js), ao lado do lugar da AlignToolbar — as duas dividem o
 * mesmo host em linha, então nunca se sobrepõem. Só aparece com exatamente
 * um TreeNode selecionado. Não guarda estado — reflete `enabled` e delega o
 * clique a `actions.run(orientation)` (ver App#_runMicroTreeLayout).
 */
export class TreeLayoutToolbar {
  constructor(container, actions) {
    this.container = container;
    this.actions = actions;
  }

  render({ enabled }) {
    this.container.innerHTML = '';
    if (!enabled) return;
    const wrap = document.createElement('div');
    wrap.className = 'mode-toolbar tree-layout-toolbar';
    TREE_LAYOUT_BUTTONS.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn tree-layout-btn';
      btn.dataset.treeLayout = b.id;
      btn.title = b.label;
      btn.setAttribute('aria-label', b.label);
      btn.innerHTML = ICONS[b.id];
      btn.addEventListener('click', () => this.actions.run(b.id));
      wrap.appendChild(btn);
    });
    this.container.appendChild(wrap);
  }
}
