import { fitPopupInContainer } from './fitPopup.js';

/**
 * Popup HTML flutuante com as configurações de um array, dict OU matriz:
 * nome, tamanho (só array comum ou deque — dict cresce por inserção de
 * chave e set por `add`, nenhum dos dois tem tamanho pra editar, ver
 * `showSize`; o deque com `maxlen` limita o `maxSize`; matriz tem DOIS tamanhos,
 * linhas e colunas, ver `sizeFields`) e orientação (não se aplica à
 * matriz, ver `showOrientation`), além da ação de remover. Aberto pelo
 * botão direito no puxador da coleção (modo micro, ver
 * App#_onMicroContextMenu).
 */
export class ArraySettingsPopup {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  open(
    screenX,
    screenY,
    node,
    { maxSize = 24, showSize = true, sizeFields = null, showOrientation = true, removeLabel = 'Remover array', onSave, onRemove, returnFocusTo },
  ) {
    this.close();
    this._returnFocusTo = returnFocusTo || null;

    const el = document.createElement('div');
    el.className = 'array-settings-popup';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;

    let orientation = node.orientation;

    const nameRow = document.createElement('div');
    nameRow.className = 'array-settings-row';
    const nameLabel = document.createElement('label');
    nameLabel.textContent = 'Nome';
    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'array-settings-input';
    nameInput.value = node.name;
    nameRow.appendChild(nameLabel);
    nameRow.appendChild(nameInput);

    // `sizeFields` ([{key, label, value}], ex: linhas/colunas da matriz)
    // substitui o campo único "Tamanho" — cada um vira `payload[key]` no
    // salvar, mínimo 1 e sem máximo.
    const extraSizeInputs = (sizeFields || []).map((field) => {
      const row = document.createElement('div');
      row.className = 'array-settings-row';
      const label = document.createElement('label');
      label.textContent = field.label;
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '1';
      input.className = 'array-settings-input';
      input.value = String(field.value);
      row.appendChild(label);
      row.appendChild(input);
      return { field, row, input };
    });

    let sizeRow = null;
    let sizeInput = null;
    if (showSize && !sizeFields) {
      sizeRow = document.createElement('div');
      sizeRow.className = 'array-settings-row';
      const sizeLabel = document.createElement('label');
      sizeLabel.textContent = 'Tamanho';
      sizeInput = document.createElement('input');
      sizeInput.type = 'number';
      sizeInput.min = '1';
      sizeInput.max = String(maxSize);
      sizeInput.className = 'array-settings-input';
      sizeInput.value = String(node.cells.length);
      sizeRow.appendChild(sizeLabel);
      sizeRow.appendChild(sizeInput);
    }

    const orientRow = document.createElement('div');
    orientRow.className = 'array-settings-row';
    const orientLabel = document.createElement('label');
    orientLabel.textContent = 'Orientação';
    const orientButtons = document.createElement('div');
    orientButtons.className = 'array-settings-orientation';
    const hBtn = document.createElement('button');
    hBtn.type = 'button';
    hBtn.className = 'array-orient-btn';
    hBtn.textContent = '↔ Horizontal';
    const vBtn = document.createElement('button');
    vBtn.type = 'button';
    vBtn.className = 'array-orient-btn';
    vBtn.textContent = '↕ Vertical';
    const syncOrientButtons = () => {
      hBtn.classList.toggle('active', orientation === 'horizontal');
      vBtn.classList.toggle('active', orientation === 'vertical');
    };
    hBtn.addEventListener('click', () => {
      orientation = 'horizontal';
      syncOrientButtons();
    });
    vBtn.addEventListener('click', () => {
      orientation = 'vertical';
      syncOrientButtons();
    });
    syncOrientButtons();
    orientButtons.appendChild(hBtn);
    orientButtons.appendChild(vBtn);
    orientRow.appendChild(orientLabel);
    orientRow.appendChild(orientButtons);

    const actions = document.createElement('div');
    actions.className = 'array-settings-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn danger';
    removeBtn.textContent = removeLabel;
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'btn primary';
    saveBtn.textContent = 'Salvar';
    actions.appendChild(removeBtn);
    actions.appendChild(saveBtn);

    el.appendChild(nameRow);
    if (sizeRow) el.appendChild(sizeRow);
    extraSizeInputs.forEach(({ row }) => el.appendChild(row));
    if (showOrientation) el.appendChild(orientRow);
    el.appendChild(actions);
    this.container.appendChild(el);
    this.el = el;
    fitPopupInContainer(el, this.container, screenX, screenY);

    nameInput.focus();
    nameInput.select();

    const save = () => {
      const name = nameInput.value.trim() || node.name;
      const payload = { name, orientation };
      if (sizeInput) {
        const rawSize = Number(sizeInput.value);
        payload.size = Number.isFinite(rawSize) ? Math.max(1, Math.min(Math.round(rawSize), maxSize)) : node.cells.length;
      }
      extraSizeInputs.forEach(({ field, input }) => {
        const raw = Number(input.value);
        payload[field.key] = Number.isFinite(raw) ? Math.max(1, Math.round(raw)) : field.value;
      });
      this.close();
      onSave(payload);
    };

    saveBtn.addEventListener('click', save);
    removeBtn.addEventListener('click', () => {
      this.close();
      onRemove();
    });
    [nameInput, sizeInput, ...extraSizeInputs.map((x) => x.input)].filter(Boolean).forEach((input) => {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') save();
        else if (e.key === 'Escape') this.close();
        e.stopPropagation();
      });
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._outsideHandler = (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._outsideHandler), 0);
  }

  close() {
    if (this.el) {
      // só recupera o foco se ele ainda estava DENTRO do popup (fechou pelo
      // Salvar/Remover/Esc) — se o usuário já clicou fora (ex: direto no
      // editor de código, pra dispensar o popup e já sair digitando), o
      // foco já é de outro elemento, e não deve ser roubado de volta.
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
