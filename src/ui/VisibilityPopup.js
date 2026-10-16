import { filterIdentifiers } from '../app/microVisibility.js';

/**
 * Janela flutuante "Visibilidade" (botão da barra do painel de código):
 * lista todos os identificadores (ponteiros, cursores, variáveis) com um
 * toggle de visibilidade cada. Caixa de busca no topo (filtra enquanto digita),
 * "selecionar filtrados", toggle geral (aplica aos filtrados) e Resetar
 * (tudo visível). Reaproveita o visual de `ArraySettingsPopup`.
 *
 * Quem abre fornece:
 *  - getItems(): [{key, kind, hidden}] atual (relido a cada mudança);
 *  - onChange(keys, hidden): aplica a visibilidade a essas chaves;
 *  - onReset(): torna tudo visível.
 */
export class VisibilityPopup {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  open(screenX, screenY, { getItems, onChange, onReset }) {
    this.close();
    this._getItems = getItems;
    this._onChange = onChange;
    this._onReset = onReset;
    this._selected = new Set();
    this._query = '';

    const el = document.createElement('div');
    el.className = 'array-settings-popup visibility-popup';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;

    const search = document.createElement('input');
    search.type = 'text';
    search.className = 'array-settings-input visibility-search';
    search.placeholder = 'Buscar identificador…';
    search.spellcheck = false;
    search.setAttribute('aria-label', 'Buscar identificador');
    this.search = search;

    // linha de ações em lote: seleciona os filtrados | toggle geral | resetar
    const bulk = document.createElement('div');
    bulk.className = 'array-settings-row visibility-bulk';
    const selectLabel = document.createElement('label');
    selectLabel.className = 'visibility-check';
    const selectAll = document.createElement('input');
    selectAll.type = 'checkbox';
    selectAll.setAttribute('aria-label', 'Selecionar todos os filtrados');
    selectLabel.append(selectAll, document.createTextNode('Selecionar filtrados'));
    const master = document.createElement('input');
    master.type = 'checkbox';
    master.className = 'visibility-toggle';
    master.title = 'Mostrar/ocultar todos (os selecionados, ou os filtrados se nenhum estiver selecionado)';
    master.setAttribute('aria-label', 'Alternar visibilidade de todos');
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'btn';
    resetBtn.textContent = 'Resetar';
    resetBtn.title = 'Torna todos os identificadores visíveis';
    bulk.append(selectLabel, master, resetBtn);
    this.selectAll = selectAll;
    this.master = master;

    const list = document.createElement('div');
    list.className = 'visibility-list';
    this.list = list;

    el.append(search, bulk, list);
    this.container.appendChild(el);
    this.el = el;
    this._render();
    search.focus();

    search.addEventListener('input', () => {
      this._query = search.value;
      this._render();
    });
    selectAll.addEventListener('change', () => {
      const shown = this._filtered();
      shown.forEach((i) => (selectAll.checked ? this._selected.add(i.key) : this._selected.delete(i.key)));
      this._render();
    });
    // marcado = visível; o alvo é a seleção (ou, sem seleção, os filtrados)
    master.addEventListener('change', () => {
      const targets = this._targets();
      if (targets.length) this._onChange(targets.map((i) => i.key), !master.checked);
      this._render();
    });
    resetBtn.addEventListener('click', () => {
      this._onReset();
      this._render();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.close();
      e.stopPropagation();
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._outsideHandler = (e) => {
      if (this.el && !this.el.contains(e.target) && !e.target.closest?.('.visibility-open-btn')) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._outsideHandler), 0);
  }

  _filtered() {
    return filterIdentifiers(this._getItems(), this._query);
  }

  _targets() {
    const shown = this._filtered();
    const chosen = shown.filter((i) => this._selected.has(i.key));
    return chosen.length ? chosen : shown;
  }

  /** Redesenha lista e controles gerais a partir do estado atual. */
  _render() {
    if (!this.el) return;
    const shown = this._filtered();
    this.list.textContent = '';
    if (!shown.length) {
      const empty = document.createElement('div');
      empty.className = 'visibility-empty';
      empty.textContent = this._getItems().length ? 'Nenhum identificador encontrado' : 'Nenhum identificador ainda';
      this.list.appendChild(empty);
    }
    shown.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'visibility-row';
      const pick = document.createElement('input');
      pick.type = 'checkbox';
      pick.checked = this._selected.has(item.key);
      pick.setAttribute('aria-label', `Selecionar ${item.key}`);
      pick.addEventListener('change', () => {
        if (pick.checked) this._selected.add(item.key);
        else this._selected.delete(item.key);
        this._syncBulk();
      });
      const name = document.createElement('span');
      name.className = 'visibility-name';
      name.textContent = item.key;
      const kind = document.createElement('span');
      kind.className = 'visibility-kind';
      kind.textContent = item.kind;
      const toggle = document.createElement('input');
      toggle.type = 'checkbox';
      toggle.className = 'visibility-toggle';
      toggle.checked = !item.hidden;
      toggle.title = item.hidden ? 'Oculto — clique para mostrar' : 'Visível — clique para ocultar';
      toggle.setAttribute('aria-label', `Visibilidade de ${item.key}`);
      toggle.addEventListener('change', () => {
        this._onChange([item.key], !toggle.checked);
        this._render();
      });
      row.append(pick, name, kind, toggle);
      this.list.appendChild(row);
    });
    this._syncBulk(shown);
  }

  _syncBulk(shown = this._filtered()) {
    const picked = shown.filter((i) => this._selected.has(i.key)).length;
    this.selectAll.checked = shown.length > 0 && picked === shown.length;
    this.selectAll.indeterminate = picked > 0 && picked < shown.length;
    const targets = picked ? shown.filter((i) => this._selected.has(i.key)) : shown;
    const visible = targets.filter((i) => !i.hidden).length;
    this.master.checked = targets.length > 0 && visible === targets.length;
    this.master.indeterminate = visible > 0 && visible < targets.length;
    this.master.disabled = targets.length === 0;
  }

  /** Relê os identificadores (ex.: o programa rodou de novo com a janela aberta). */
  refresh() {
    this._render();
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
