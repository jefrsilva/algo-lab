import { fitPopupInContainer } from './fitPopup.js';

/**
 * Popup HTML flutuante (não-SVG) para perguntar o valor de um novo nó ao
 * clicar em espaço vazio do canvas. Posicionado em coordenadas de tela,
 * sobre o container do canvas.
 */
export class NodePopup {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  open(screenX, screenY, onSubmit, options = {}) {
    this.close();
    const { type = 'number', placeholder = 'valor', hintText = 'Enter para criar · Esc para cancelar', initialValue = '' } = options;

    const el = document.createElement('div');
    el.className = 'node-popup';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;

    const input = document.createElement('input');
    input.type = type === 'text' ? 'text' : 'number';
    input.placeholder = placeholder;
    input.className = 'node-popup-input';
    if (type === 'text') input.classList.add('is-text');
    if (initialValue !== '') input.value = initialValue;

    const hint = document.createElement('div');
    hint.className = 'node-popup-hint';
    hint.textContent = hintText;

    el.appendChild(input);
    el.appendChild(hint);
    this.container.appendChild(el);
    this.el = el;
    fitPopupInContainer(el, this.container, screenX, screenY, { anchor: 'center' });

    input.focus();
    if (type === 'text') input.select();

    const submit = () => {
      const raw = input.value.trim();
      if (type === 'text') {
        this.close();
        onSubmit(raw === '' ? placeholder : raw);
        return;
      }
      const value = raw === '' ? Math.floor(Math.random() * 90) + 10 : Number(raw);
      if (Number.isNaN(value)) {
        input.classList.add('invalid');
        return;
      }
      this.close();
      onSubmit(value);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape' || e.key === 'Tab') this.close();
      // Tab fecha (como clicar fora) e passa adiante: campo único, não há
      // outro campo pra onde ir — o listener global (App#_onKeyDown) leva o
      // foco pro painel de código, igual o editor inline (ver
      // InlineValueEditor). As demais teclas não vazam pros atalhos do canvas.
      if (e.key !== 'Tab') e.stopPropagation();
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._outsideHandler = (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._outsideHandler), 0);
  }

  close() {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    if (this._outsideHandler) {
      document.removeEventListener('pointerdown', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  get isOpen() {
    return !!this.el;
  }
}
