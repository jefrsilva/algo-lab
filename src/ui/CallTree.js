import { getSetting, setSetting } from '../app/settings.js';

/**
 * Painel de árvore de chamadas do modo "Executar" — cada nó é uma chamada de
 * função de usuário (`{id, parentId, label, depth}`, ver interpreter.js#
 * callFunction), rotulado tipo "fib(3)"; nó pai → filho é quem chamou quem.
 * A árvore só CRESCE ao longo da reprodução (nunca encolhe), então navegar
 * pra um passo anterior não faz nós desaparecerem — dá pra inspecionar
 * qualquer chamada já feita até aquele ponto.
 *
 * Clicar num nó troca a aba do canvas estrutural (ver App#_onSelectCallFrame)
 * sem alterar o passo atual da reprodução. Os dados vêm todos de
 * `render({ nodes, activeFrameId })`; o único estado próprio é o modo de
 * exibição, guardado nas configurações (src/app/settings.js — preferência de
 * tela, não do projeto):
 *   - 'full': lista com o rótulo de cada chamada, recuada pela profundidade;
 *   - 'compact': coluna estreita com uma bolinha por chamada, recuada pela
 *     profundidade — só pra dar noção do formato/profundidade da recursão;
 *     o rótulo aparece ao passar o mouse, e clicar continua funcionando;
 *   - 'hidden': painel some (volta pelo botão da barra do código ou pela
 *     janela de Configurações).
 * Nos dois modos visíveis, a chamada ativa e seus ancestrais (a pilha de
 * verdade naquele passo) ficam destacados.
 */
const MODES = ['full', 'compact', 'hidden'];
// recuo por nível no modo reduzido — encolhe quando a recursão é funda, pra
// coluna não crescer além de COMPACT_MAX_INDENT
const COMPACT_STEP = 6;
const COMPACT_MAX_INDENT = 36;

export class CallTree {
  constructor(container, { onSelectFrame, onModeChange, onDimChange } = {}) {
    this.container = container;
    this.onDimChange = onDimChange || (() => {});
    this.onSelectFrame = onSelectFrame || (() => {});
    this.onModeChange = onModeChange || (() => {});
    this.mode = getSetting('callTreeMode');
    this._last = { nodes: null, activeFrameId: 'global' };
  }

  setMode(mode) {
    if (!MODES.includes(mode) || mode === this.mode) return;
    this.mode = mode;
    setSetting('callTreeMode', mode);
    this.onModeChange(mode);
    this.render(this._last);
  }

  /** Botão da barra do código: oculto ↔ visível (volta no modo completo). */
  toggleHidden() {
    this.setMode(this.mode === 'hidden' ? 'full' : 'hidden');
  }

  render({ nodes, activeFrameId }) {
    this._last = { nodes, activeFrameId };
    const hasCalls = !!nodes && nodes.length > 0;
    this.container.hidden = !hasCalls || this.mode === 'hidden';
    if (this.container.hidden) {
      this.container.innerHTML = '';
      return;
    }
    const compact = this.mode === 'compact';
    this.container.classList.toggle('compact', compact);

    // reconstruir esvazia o painel — sem isso a rolagem voltaria pro topo a
    // cada passo da reprodução
    const scrollTop = this.container.scrollTop;
    this.container.innerHTML = '';
    this.container.appendChild(this._makeHeader(compact));

    const list = document.createElement('div');
    list.className = 'call-tree-list';
    this.container.appendChild(list);

    // pilha de verdade no passo atual: a chamada ativa e quem a chamou
    const parentOf = new Map(nodes.map((n) => [n.id, n.parentId ?? 'global']));
    const onPath = new Set(['global']);
    for (let id = activeFrameId; id && id !== 'global'; id = parentOf.get(id)) onPath.add(id);

    const maxDepth = Math.max(1, ...nodes.map((n) => n.depth));
    const step = Math.min(COMPACT_STEP, COMPACT_MAX_INDENT / maxDepth);
    const makeNode = (frameId, label, depth) =>
      compact
        ? this._makeDot(frameId, label, depth * step, activeFrameId, onPath)
        : this._makeNode(frameId, label, depth, activeFrameId, onPath);

    list.appendChild(makeNode('global', 'global (topo)', 0));
    const byParent = new Map();
    nodes.forEach((n) => {
      const key = n.parentId ?? 'global';
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key).push(n);
    });
    const appendChildren = (parentId) => {
      (byParent.get(parentId) || []).forEach((n) => {
        list.appendChild(makeNode(n.id, n.label, n.depth));
        appendChildren(n.id);
      });
    };
    appendChildren('global');

    this.container.scrollTop = scrollTop;
    this._keepActiveVisible(list.querySelector('.active'));
  }

  _makeHeader(compact) {
    const header = document.createElement('div');
    header.className = 'call-tree-header';
    if (!compact) {
      const title = document.createElement('div');
      title.className = 'call-tree-title';
      title.textContent = 'Chamadas';
      header.appendChild(title);
    }
    header.appendChild(
      compact
        ? this._makeHeaderButton('⇥', 'Expandir a pilha de chamadas', () => this.setMode('full'))
        : this._makeHeaderButton('⇤', 'Visualização reduzida', () => this.setMode('compact')),
    );
    const dim = getSetting('dimOutOfScope');
    const dimBtn = this._makeHeaderButton(
      '◐',
      dim
        ? 'Elementos fora do escopo da chamada com opacidade reduzida (clique para mostrá-los normais)'
        : 'Elementos fora do escopo da chamada normais (clique para reduzir a opacidade)',
      () => this.onDimChange(!getSetting('dimOutOfScope')),
    );
    dimBtn.classList.toggle('toggled', dim);
    dimBtn.setAttribute('aria-pressed', String(dim));
    header.appendChild(dimBtn);
    header.appendChild(
      this._makeHeaderButton('✕', 'Ocultar a pilha de chamadas (reabrir pelo menu ☰)', () => this.setMode('hidden')),
    );
    return header;
  }

  _makeHeaderButton(text, title, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'call-tree-header-btn';
    btn.textContent = text;
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.addEventListener('click', onClick);
    return btn;
  }

  _makeNode(frameId, label, depth, activeFrameId, onPath) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'call-tree-node';
    btn.style.paddingLeft = `${8 + depth * 14}px`;
    btn.textContent = label;
    btn.classList.toggle('active', frameId === activeFrameId);
    btn.classList.toggle('on-path', onPath.has(frameId));
    btn.addEventListener('click', () => this.onSelectFrame(frameId));
    return btn;
  }

  _makeDot(frameId, label, indent, activeFrameId, onPath) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'call-tree-dot';
    btn.style.paddingLeft = `${indent}px`;
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.classList.toggle('active', frameId === activeFrameId);
    btn.classList.toggle('on-path', onPath.has(frameId));
    const dot = document.createElement('span');
    dot.className = 'call-tree-dot-mark';
    btn.appendChild(dot);
    btn.addEventListener('click', () => this.onSelectFrame(frameId));
    return btn;
  }

  /** Rola o painel (só ele, nunca a página) até a chamada ativa, se ela
   * estiver fora da área visível — na reprodução automática a chamada em
   * execução nunca some de vista. */
  _keepActiveVisible(el) {
    if (!el) return;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    const view = this.container;
    if (top < view.scrollTop) view.scrollTop = top - 8;
    else if (bottom > view.scrollTop + view.clientHeight) view.scrollTop = bottom - view.clientHeight + 8;
  }
}
