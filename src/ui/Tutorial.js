/**
 * Tutorial guiado: uma sequência de popups, cada um apontando (com um
 * destaque) pra uma parte da tela, com "Próximo" e "Pular tutorial". Os
 * roteiros (passos de "Como começar" e dos cenários) ficam em tutorials.js.
 * Pular mostra um último aviso dizendo que os tutoriais continuam no menu
 * ☰ → "Tutorial" (`skipNotice`; os cenários só fecham).
 *
 * Não é modal: o fundo não escurece nem bloqueia cliques, então dá pra
 * experimentar o que o passo pede sem fechar nada. Não conhece o App — só
 * recebe os passos (`target`: seletor CSS da parte destacada, ou null pra um
 * popup centralizado; texto: string, ou `{code}` pra um trecho de código) e
 * avisa `onClose(motivo)` ('concluido' | 'pulado') quando termina; quem
 * decide o que guardar é quem chama.
 */
const SKIP_NOTICE = {
  title: 'Tutorial pulado',
  target: '.canvas-top-left-controls',
  placement: 'right',
  body: ['Sem problema! Você pode ver o tutorial novamente quando quiser: abra o menu ☰ e escolha "Tutorial".'],
};

const GAP = 14;
const MARGIN = 12;

export class Tutorial {
  constructor({ container = document.body } = {}) {
    this.steps = [];
    this.skipNotice = true;
    this.onClose = () => {};
    this.container = container;
    this.index = -1;
    this.el = null;
    this.highlightEl = null;
    this._current = null;
    this._dragged = null; // {left, top} se a pessoa moveu o popup — vale até o fim do roteiro
    this._reposition = () => this._place();
    this._onKey = (e) => {
      if (e.key === 'Escape' && this.isOpen) {
        e.preventDefault();
        if (this._current === SKIP_NOTICE) this.close();
        else this.skip();
      }
    };
  }

  get isOpen() {
    return !!this.el;
  }

  /** Começa um roteiro do primeiro passo (recomeça se já havia um aberto). */
  start({ steps, onClose, skipNotice = true }) {
    this._teardown();
    this.steps = steps;
    this.onClose = onClose || (() => {});
    this.skipNotice = skipNotice;
    this._dragged = null;
    window.addEventListener('resize', this._reposition);
    window.addEventListener('keydown', this._onKey);
    this.index = 0;
    this._show(this.steps[0]);
  }

  next() {
    if (!this.isOpen || this._current === SKIP_NOTICE) return;
    if (this.index >= this.steps.length - 1) {
      this._finish('concluido');
      return;
    }
    this.index += 1;
    this._show(this.steps[this.index]);
  }

  skip() {
    if (!this.isOpen || this._current === SKIP_NOTICE) return;
    if (!this.skipNotice) {
      this._finish('pulado');
      return;
    }
    this._show(SKIP_NOTICE);
    this.onClose('pulado');
  }

  close() {
    this._teardown();
  }

  _finish(reason) {
    this._teardown();
    this.onClose(reason);
  }

  _teardown() {
    window.removeEventListener('resize', this._reposition);
    window.removeEventListener('keydown', this._onKey);
    this.el?.remove();
    this.highlightEl?.remove();
    this.el = null;
    this.highlightEl = null;
    this._current = null;
    this.index = -1;
  }

  _show(step) {
    this._current = step;
    this.el?.remove();
    this.highlightEl?.remove();

    const highlight = document.createElement('div');
    highlight.className = 'tutorial-highlight';
    highlight.hidden = true;

    const box = document.createElement('div');
    box.className = 'tutorial-popup';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-labelledby', 'tutorial-title');

    const title = document.createElement('h2');
    title.className = 'tutorial-title';
    title.id = 'tutorial-title';
    title.textContent = step.title;
    title.title = 'Arraste para mover';
    this._enableDrag(title);
    box.appendChild(title);

    step.body.forEach((part) => {
      if (typeof part === 'string') {
        const p = document.createElement('p');
        p.className = 'tutorial-text';
        p.textContent = part;
        box.appendChild(p);
      } else {
        const pre = document.createElement('pre');
        pre.className = 'tutorial-code';
        pre.textContent = part.code;
        box.appendChild(pre);
      }
    });

    const actions = document.createElement('div');
    actions.className = 'tutorial-actions';
    if (step === SKIP_NOTICE) {
      actions.appendChild(this._button('Entendi', 'primary', () => this.close()));
    } else {
      const progress = document.createElement('span');
      progress.className = 'tutorial-progress';
      progress.textContent = `${this.index + 1} / ${this.steps.length}`;
      actions.appendChild(progress);
      if (this.index < this.steps.length - 1) actions.appendChild(this._button('Pular tutorial', 'subtle', () => this.skip()));
      actions.appendChild(this._button(this.index >= this.steps.length - 1 ? 'Concluir' : 'Próximo', 'primary', () => this.next()));
    }
    box.appendChild(actions);

    this.container.appendChild(highlight);
    this.container.appendChild(box);
    this.el = box;
    this.highlightEl = highlight;
    this._place();
    box.querySelector('.btn.primary')?.focus();
  }

  /** O popup costuma cobrir o que o passo manda mexer: arrastar pelo título
   * o leva pra outro lugar, e ele fica lá nos passos seguintes. */
  _enableDrag(handle) {
    handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this.el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const rect = this.el.getBoundingClientRect();
      handle.setPointerCapture?.(e.pointerId);
      const move = (ev) => {
        this._dragged = { left: rect.left + ev.clientX - startX, top: rect.top + ev.clientY - startY };
        this._place();
      };
      const up = () => {
        handle.removeEventListener('pointermove', move);
        handle.removeEventListener('pointerup', up);
        handle.removeEventListener('pointercancel', up);
      };
      handle.addEventListener('pointermove', move);
      handle.addEventListener('pointerup', up);
      handle.addEventListener('pointercancel', up);
      e.preventDefault();
    });
  }

  _button(label, kind, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${kind}`;
    btn.textContent = label;
    btn.addEventListener('click', onClick);
    return btn;
  }

  /** Destaca o alvo do passo e põe o popup ao lado dele (ou no centro da
   * janela, sem alvo ou quando o alvo não tem tamanho na tela). */
  _place() {
    const step = this._current;
    if (!step || !this.el) return;
    const target = step.target ? document.querySelector(step.target) : null;
    const rect = target?.getBoundingClientRect();
    const visible = rect && rect.width > 0 && rect.height > 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const box = this.el;
    const bw = box.offsetWidth;
    const bh = box.offsetHeight;
    let left = (vw - bw) / 2;
    let top = (vh - bh) / 2;

    // alvo grande (o canvas todo): só destaca a borda, o popup fica no centro
    if (visible && step.placement !== 'center') {
      if (step.placement === 'left') left = rect.left - bw - GAP;
      else left = rect.right + GAP;
      top = rect.top;
      if (left < MARGIN) left = Math.min(rect.left + GAP, vw - bw - MARGIN);
    }
    if (this._dragged) ({ left, top } = this._dragged);
    left = Math.max(MARGIN, Math.min(left, vw - bw - MARGIN));
    top = Math.max(MARGIN, Math.min(top, vh - bh - MARGIN));
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;

    const hl = this.highlightEl;
    hl.hidden = !visible;
    if (visible) {
      hl.style.left = `${rect.left - 4}px`;
      hl.style.top = `${rect.top - 4}px`;
      hl.style.width = `${rect.width + 8}px`;
      hl.style.height = `${rect.height + 8}px`;
    }
  }
}
