const ICON_OPEN = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';

const ICONS = {
  left: `${ICON_OPEN}<path d="M4 3v18"/><rect x="7" y="6" width="12" height="4" rx="1"/><rect x="7" y="14" width="7" height="4" rx="1"/></svg>`,
  center: `${ICON_OPEN}<path d="M12 3v3M12 10v4M12 18v3"/><rect x="5" y="6" width="14" height="4" rx="1"/><rect x="8" y="14" width="8" height="4" rx="1"/></svg>`,
  right: `${ICON_OPEN}<path d="M20 3v18"/><rect x="5" y="6" width="12" height="4" rx="1"/><rect x="10" y="14" width="7" height="4" rx="1"/></svg>`,
  top: `${ICON_OPEN}<path d="M3 4h18"/><rect x="6" y="7" width="4" height="12" rx="1"/><rect x="14" y="7" width="4" height="7" rx="1"/></svg>`,
  middle: `${ICON_OPEN}<path d="M3 12h3M10 12h4M18 12h3"/><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="8" width="4" height="8" rx="1"/></svg>`,
  bottom: `${ICON_OPEN}<path d="M3 20h18"/><rect x="6" y="5" width="4" height="12" rx="1"/><rect x="14" y="10" width="4" height="7" rx="1"/></svg>`,
  'distribute-x': `${ICON_OPEN}<path d="M3 3v18M21 3v18"/><rect x="6" y="7" width="3" height="10" rx="1"/><rect x="15" y="7" width="3" height="10" rx="1"/></svg>`,
  'distribute-y': `${ICON_OPEN}<path d="M3 3h18M3 21h18"/><rect x="7" y="6" width="10" height="3" rx="1"/><rect x="7" y="15" width="10" height="3" rx="1"/></svg>`,
};

/** Botões de alinhar (precisam de 2+ elementos selecionados) e de distribuir
 * (3+ — com 2 não há o que distribuir). */
export const ALIGN_BUTTONS = [
  { id: 'left', label: 'Alinhar à esquerda', min: 2 },
  { id: 'center', label: 'Centralizar na horizontal', min: 2 },
  { id: 'right', label: 'Alinhar à direita', min: 2 },
  { id: 'top', label: 'Alinhar no topo', min: 2 },
  { id: 'middle', label: 'Centralizar na vertical', min: 2 },
  { id: 'bottom', label: 'Alinhar no fundo', min: 2 },
  { id: 'distribute-x', label: 'Distribuir na horizontal', min: 3 },
  { id: 'distribute-y', label: 'Distribuir na vertical', min: 3 },
];

/**
 * Barra flutuante de alinhar/distribuir, colada à direita da barra de modos
 * (ver ModeToolbar.js). Só aparece com seleção múltipla, e cada botão só
 * quando a seleção basta pra ele (`ALIGN_BUTTONS[].min`). Não guarda estado
 * — reflete `count` (quantos elementos selecionados podem ser movidos) e
 * delega o clique a `actions.run(id)` (ver App#_runMicroAlignAction).
 */
export class AlignToolbar {
  constructor(container, actions) {
    this.container = container;
    this.actions = actions;
  }

  render({ count }) {
    this.container.innerHTML = '';
    const buttons = ALIGN_BUTTONS.filter((b) => count >= b.min);
    if (!buttons.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'mode-toolbar align-toolbar';
    buttons.forEach((b, i) => {
      // separador entre o grupo de alinhar e o de distribuir
      if (i > 0 && b.min !== buttons[i - 1].min) {
        const sep = document.createElement('span');
        sep.className = 'align-toolbar-sep';
        wrap.appendChild(sep);
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mode-btn align-btn';
      btn.dataset.align = b.id;
      btn.title = b.label;
      btn.setAttribute('aria-label', b.label);
      btn.innerHTML = ICONS[b.id];
      btn.addEventListener('click', () => this.actions.run(b.id));
      wrap.appendChild(btn);
    });
    this.container.appendChild(wrap);
  }
}
