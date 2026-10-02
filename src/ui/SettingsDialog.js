import { CODE_FONT_MIN, CODE_FONT_MAX, SPEED_MIN, SPEED_MAX, SPEED_STEP } from '../app/settings.js';

/**
 * Janela de Configurações (item "Configurações" do menu ☰) — reúne todas as
 * preferências de tela da ferramenta (ver src/app/settings.js), que antes
 * ficavam espalhadas como itens liga/desliga no menu. Modal centralizado,
 * com o mesmo fundo escurecido/caixa do `Dialog` (classes `.app-dialog*`).
 *
 * Não guarda estado próprio nem sabe aplicar nada: lê os valores atuais em
 * `getValues()` e entrega cada mudança em `onChange(key, value)` — quem
 * aplica (e persiste) é o App (ver App#_applySetting), o mesmo caminho dos
 * atalhos de teclado. Toda mudança vale na hora (sem botão "Salvar"); o App
 * chama `refresh()` depois de aplicar, pra janela refletir o valor efetivo.
 */
const SECTIONS = [
  {
    title: 'Aparência',
    items: [
      { key: 'theme', label: 'Tema', type: 'choice', options: [['dark', 'Escuro'], ['light', 'Claro']] },
      { key: 'codeFontSize', label: 'Tamanho do texto do código e do console', type: 'stepper', min: CODE_FONT_MIN, max: CODE_FONT_MAX },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { key: 'simplifiedNodes', label: 'Nós de estrutura', shortcut: 'Ctrl+A', type: 'choice', options: [[false, 'Completos'], [true, 'Simplificados']] },
      { key: 'fullNames', label: 'Nomes de ponteiros e variáveis', shortcut: 'N', type: 'choice', options: [[false, 'Truncados'], [true, 'Completos']] },
      { key: 'areaSnap', label: 'Encaixar áreas hachuradas no grid', shortcut: 'G', type: 'toggle', hint: 'Shift durante o arraste inverte só naquele gesto' },
    ],
  },
  {
    title: 'Painéis',
    items: [
      { key: 'codePanelHidden', label: 'Painel de código', shortcut: 'Ctrl+H', type: 'choice', options: [[false, 'Visível'], [true, 'Oculto']] },
      { key: 'consoleHidden', label: 'Console', shortcut: 'C', type: 'choice', options: [[false, 'Visível'], [true, 'Oculto']] },
      { key: 'consoleFloating', label: 'Posição do console', shortcut: 'Alt+C', type: 'choice', options: [[false, 'Barra inferior'], [true, 'Janela flutuante']] },
      { key: 'callTreeMode', label: 'Pilha de chamadas', type: 'choice', options: [['full', 'Completa'], ['compact', 'Reduzida'], ['hidden', 'Oculta']] },
    ],
  },
  {
    title: 'Simulação',
    items: [
      { key: 'playbackSpeed', label: 'Velocidade da reprodução', type: 'range', min: SPEED_MIN, max: SPEED_MAX, step: SPEED_STEP, format: (v) => `${v.toLocaleString('pt-BR')}×` },
    ],
  },
];

export class SettingsDialog {
  constructor({ getValues, onChange, onReset, container = document.body } = {}) {
    this.container = container;
    this.getValues = getValues || (() => ({}));
    this.onChange = onChange || (() => {});
    this.onReset = onReset || (() => {});
    this.el = null;
    this._syncers = []; // (values) => void — um por controle, ver refresh()
    this._returnFocusTo = null;
  }

  get isOpen() {
    return !!this.el;
  }

  open() {
    if (this.el) return;
    this._returnFocusTo = document.activeElement;
    this._syncers = [];

    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) this.close();
    });

    const box = document.createElement('div');
    box.className = 'app-dialog settings-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'settings-dialog-title');
    box.addEventListener('pointerdown', (e) => e.stopPropagation());

    const titleEl = document.createElement('h2');
    titleEl.className = 'app-dialog-title';
    titleEl.id = 'settings-dialog-title';
    titleEl.textContent = 'Configurações';
    box.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'settings-body';
    SECTIONS.forEach((section) => {
      const sec = document.createElement('section');
      sec.className = 'settings-section';
      const h = document.createElement('h3');
      h.className = 'settings-section-title';
      h.textContent = section.title;
      sec.appendChild(h);
      section.items.forEach((item) => sec.appendChild(this._buildRow(item)));
      body.appendChild(sec);
    });
    box.appendChild(body);

    const note = document.createElement('p');
    note.className = 'settings-note';
    note.textContent = 'As configurações valem na hora e ficam salvas neste navegador.';
    box.appendChild(note);

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions settings-actions';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn subtle';
    resetBtn.textContent = 'Restaurar padrões';
    resetBtn.addEventListener('click', () => this.onReset());
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn primary';
    closeBtn.textContent = 'Fechar';
    closeBtn.addEventListener('click', () => this.close());
    actions.appendChild(resetBtn);
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    backdrop.appendChild(box);
    this.container.appendChild(backdrop);
    this.el = backdrop;
    this.box = box;
    this.refresh();

    this._boundKeyDown = (e) => {
      // modal: nenhum atalho do app vale com a janela aberta (ver App#_onKeyDown)
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        // Tab/Shift+Tab circulam só pelos controles da janela
        const focusables = [...box.querySelectorAll('button:not(:disabled), input')];
        if (focusables.length === 0) return;
        e.preventDefault();
        const i = focusables.indexOf(document.activeElement);
        const next = i === -1 ? 0 : (i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        focusables[next].focus();
      }
    };
    document.addEventListener('keydown', this._boundKeyDown);
    closeBtn.focus();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    this.box = null;
    this._syncers = [];
    document.removeEventListener('keydown', this._boundKeyDown);
    this._boundKeyDown = null;
    const back = this._returnFocusTo;
    this._returnFocusTo = null;
    if (back && back !== document.body && document.contains(back)) back.focus();
  }

  /** Reflete os valores atuais (depois de qualquer mudança — da própria
   * janela, de um atalho ou de "Restaurar padrões"). */
  refresh() {
    if (!this.el) return;
    const values = this.getValues();
    this._syncers.forEach((sync) => sync(values));
  }

  _buildRow(item) {
    const row = document.createElement('div');
    row.className = 'settings-row';

    const labelWrap = document.createElement('div');
    labelWrap.className = 'settings-label';
    const label = document.createElement('span');
    label.className = 'settings-label-text';
    label.textContent = item.label;
    labelWrap.appendChild(label);
    if (item.shortcut) {
      const kbd = document.createElement('kbd');
      kbd.className = 'settings-shortcut';
      kbd.textContent = item.shortcut;
      kbd.title = 'Atalho de teclado';
      labelWrap.appendChild(kbd);
    }
    if (item.hint) {
      const hint = document.createElement('span');
      hint.className = 'settings-hint';
      hint.textContent = item.hint;
      labelWrap.appendChild(hint);
    }
    row.appendChild(labelWrap);

    const control = document.createElement('div');
    control.className = 'settings-control';
    if (item.type === 'choice') this._buildChoice(control, item, label.textContent);
    else if (item.type === 'toggle') this._buildToggle(control, item);
    else if (item.type === 'stepper') this._buildStepper(control, item);
    else if (item.type === 'range') this._buildRange(control, item);
    row.appendChild(control);
    return row;
  }

  /** Botões segmentados (um ativo por vez). */
  _buildChoice(control, item, groupLabel) {
    const group = document.createElement('div');
    group.className = 'settings-seg';
    group.setAttribute('role', 'radiogroup');
    group.setAttribute('aria-label', groupLabel);
    const buttons = item.options.map(([value, text]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'settings-seg-btn';
      btn.textContent = text;
      btn.setAttribute('role', 'radio');
      btn.addEventListener('click', () => this.onChange(item.key, value));
      group.appendChild(btn);
      return { btn, value };
    });
    control.appendChild(group);
    this._syncers.push((values) => {
      buttons.forEach(({ btn, value }) => {
        const on = values[item.key] === value;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-checked', String(on));
      });
    });
  }

  /** Interruptor liga/desliga. */
  _buildToggle(control, item) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'settings-switch';
    btn.setAttribute('role', 'switch');
    btn.setAttribute('aria-label', item.label);
    btn.innerHTML = '<span class="settings-switch-knob"></span>';
    btn.addEventListener('click', () => this.onChange(item.key, btn.getAttribute('aria-checked') !== 'true'));
    control.appendChild(btn);
    this._syncers.push((values) => btn.setAttribute('aria-checked', String(!!values[item.key])));
  }

  /** − valor + (mesma ideia dos botões de fonte da barra do código). */
  _buildStepper(control, item) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-stepper';
    const minus = document.createElement('button');
    minus.type = 'button';
    minus.className = 'settings-stepper-btn';
    minus.textContent = '−';
    minus.setAttribute('aria-label', 'Diminuir');
    const value = document.createElement('span');
    value.className = 'settings-stepper-value';
    const plus = document.createElement('button');
    plus.type = 'button';
    plus.className = 'settings-stepper-btn';
    plus.textContent = '+';
    plus.setAttribute('aria-label', 'Aumentar');
    let current = null;
    minus.addEventListener('click', () => this.onChange(item.key, current - 1));
    plus.addEventListener('click', () => this.onChange(item.key, current + 1));
    wrap.appendChild(minus);
    wrap.appendChild(value);
    wrap.appendChild(plus);
    control.appendChild(wrap);
    this._syncers.push((values) => {
      current = values[item.key];
      value.textContent = String(current);
      minus.disabled = current <= item.min;
      plus.disabled = current >= item.max;
    });
  }

  /** Controle deslizante com o valor ao lado. */
  _buildRange(control, item) {
    const wrap = document.createElement('div');
    wrap.className = 'settings-range';
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(item.min);
    input.max = String(item.max);
    input.step = String(item.step);
    input.setAttribute('aria-label', item.label);
    const value = document.createElement('span');
    value.className = 'settings-range-value';
    input.addEventListener('input', () => this.onChange(item.key, Number(input.value)));
    wrap.appendChild(input);
    wrap.appendChild(value);
    control.appendChild(wrap);
    this._syncers.push((values) => {
      const v = values[item.key];
      if (Number(input.value) !== v) input.value = String(v);
      value.textContent = item.format ? item.format(v) : String(v);
    });
  }
}
