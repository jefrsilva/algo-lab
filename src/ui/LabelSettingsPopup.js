import { fitPopupInContainer } from './fitPopup.js';

/**
 * Popup HTML flutuante com as configurações de uma label de texto solta no
 * canvas micro: texto, cor e tamanho da fonte, além da ação de remover.
 * Mesmo padrão visual de `ArraySettingsPopup` (reaproveita as classes
 * `.array-settings-*`) — aberto com o botão direito sobre a label, ou
 * automaticamente ao criar uma nova (ver App#_startCreateMicroLabel).
 */
export class LabelSettingsPopup {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  open(screenX, screenY, node, { minSize = 12, maxSize = 48, onSave, onRemove, returnFocusTo }) {
    this.close();
    this._returnFocusTo = returnFocusTo || null;

    const el = document.createElement('div');
    el.className = 'array-settings-popup';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;

    const textRow = document.createElement('div');
    textRow.className = 'array-settings-row';
    const textLabel = document.createElement('label');
    textLabel.textContent = 'Texto';
    // textarea: labels podem ter várias linhas (Shift+Enter quebra a linha,
    // Enter sozinho salva — mesmo atalho do editor in place)
    const textInput = document.createElement('textarea');
    textInput.className = 'array-settings-input label-settings-text';
    textInput.rows = Math.min(6, String(node.text).split('\n').length);
    textInput.wrap = 'off';
    textInput.spellcheck = false;
    textInput.value = node.text;
    textRow.appendChild(textLabel);
    textRow.appendChild(textInput);
    // o texto aceita markdown básico (ver labelMarkdown.js) — lembrete da sintaxe
    const hint = document.createElement('div');
    hint.className = 'label-settings-hint';
    hint.textContent = '**negrito**  *itálico*  `código`  # título  ## subtítulo  - item  1. item';

    const colorRow = document.createElement('div');
    colorRow.className = 'array-settings-row';
    const colorLabel = document.createElement('label');
    colorLabel.textContent = 'Cor';
    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.className = 'label-settings-color';
    colorInput.value = node.color;
    colorRow.appendChild(colorLabel);
    colorRow.appendChild(colorInput);

    const sizeRow = document.createElement('div');
    sizeRow.className = 'array-settings-row';
    const sizeLabel = document.createElement('label');
    sizeLabel.textContent = 'Tamanho';
    const sizeInput = document.createElement('input');
    sizeInput.type = 'number';
    sizeInput.min = String(minSize);
    sizeInput.max = String(maxSize);
    sizeInput.className = 'array-settings-input';
    sizeInput.value = String(node.fontSize);
    sizeRow.appendChild(sizeLabel);
    sizeRow.appendChild(sizeInput);

    const actions = document.createElement('div');
    actions.className = 'array-settings-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn danger';
    removeBtn.textContent = 'Remover texto';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn primary';
    saveBtn.textContent = 'Salvar';
    actions.appendChild(removeBtn);
    actions.appendChild(saveBtn);

    el.appendChild(textRow);
    el.appendChild(hint);
    el.appendChild(colorRow);
    el.appendChild(sizeRow);
    el.appendChild(actions);
    this.container.appendChild(el);
    this.el = el;
    fitPopupInContainer(el, this.container, screenX, screenY);

    textInput.focus();
    textInput.select();

    const save = () => {
      const text = textInput.value.trim() || node.text;
      const rawSize = Number(sizeInput.value);
      const fontSize = Number.isFinite(rawSize) ? Math.max(minSize, Math.min(Math.round(rawSize), maxSize)) : node.fontSize;
      this.close();
      onSave({ text, color: colorInput.value, fontSize });
    };

    saveBtn.addEventListener('click', save);
    removeBtn.addEventListener('click', () => {
      this.close();
      onRemove();
    });
    [textInput, sizeInput].forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.shiftKey && input === textInput) {
          // quebra de linha nativa do textarea
        } else if (e.key === 'Enter') {
          e.preventDefault();
          save();
        } else if (e.key === 'Escape') this.close();
        e.stopPropagation();
      });
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    colorInput.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._outsideHandler = (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._outsideHandler), 0);
  }

  close() {
    if (this.el) {
      // mesma lógica de ArraySettingsPopup#close: só recupera o foco se ele
      // ainda estava dentro do popup — um clique fora que já moveu o foco
      // pra outro lugar (ex: o editor de código) não é revertido.
      const shouldRefocus = this.el.contains(document.activeElement);
      this.el.remove();
      this.el = null;
      if (shouldRefocus && this._returnFocusTo) {
        const target = this._returnFocusTo;
        this._returnFocusTo = null;
        target.focus({ preventScroll: true });
      } else {
        this._returnFocusTo = null;
      }
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
