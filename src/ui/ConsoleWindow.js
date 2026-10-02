import { getSetting, setSetting } from '../app/settings.js';

/** Ícones do botão de alternância — mostram a AÇÃO (o modo PARA O QUAL vai
 * trocar), igual aos rótulos do menu ☰. */
const FLOAT_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/><rect x="11" y="11" width="7" height="6" rx="1"/>
</svg>`;
const DOCK_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 15h18"/>
</svg>`;
const CLEAR_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"/>
</svg>`;

const MIN_W = 200;
const MIN_H = 90;
const DEFAULT_W = 440;
const DEFAULT_H = 200;
const MARGIN = 12; // folga mínima entre a janela e as bordas do canvas ao posicionar por padrão
const RESIZE_DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** Preenche `el` com `lines` — uma por `<p>`, mais recente por último — e
 * rola até o fim. Reconstrói o conteúdo inteiro a cada render (não vale a pena diffar). */
export function fillConsoleLines(el, lines) {
  el.innerHTML = '';
  lines.forEach((line) => {
    const p = document.createElement('p');
    // aviso do interpretador (ver MicroRuntimeAdapter#warn) e resultado de
    // condição avaliada no Sandbox (ver App#_evaluateCondition) — cor própria
    let cls = 'code-console-line';
    if (line.startsWith('⚠')) cls += ' warn';
    else if (line === '> True') cls += ' cond-true';
    else if (line === '> False') cls += ' cond-false';
    p.className = cls;
    p.textContent = line;
    el.appendChild(p);
  });
  el.scrollTop = el.scrollHeight;
}

/**
 * Console do "print(...)" do modo micro, com dois modos de apresentação:
 *
 * - **encaixado** (padrão): faixa embaixo do canvas (`dockHost`, a coluna
 *   `.micro-main`), mostrando só as últimas `maxDockedLines` linhas — não pode
 *   crescer às custas da visualização;
 * - **flutuante**: janela sobre o canvas (`floatHost`, o `.micro-container`),
 *   com fundo translúcido (30%), movida pela barra de título e redimensionada
 *   pelas bordas/cantos; mostra a saída inteira, com rolagem.
 *
 * O modo e a posição/tamanho da janela são preferência de quem usa (como o
 * tema): ficam nas configurações (src/app/settings.js), não no projeto salvo. Em qualquer modo o
 * console some quando não há nada a mostrar (ver `render`) — a não ser que
 * tenha acabado de ser reaberto à mão — e pode ser ocultado de vez
 * (`userHidden`, tecla C), aí não aparece nem com saída.
 */
export class ConsoleWindow {
  /** `onClear`: botão de limpar — o que "limpar" significa depende da
   * origem das linhas (manual x reprodução), então quem decide é o App
   * (ver App#_clearMicroConsole), que depois chama `render` de novo. */
  constructor({ dockHost, floatHost, maxDockedLines = 3, onModeChange, onClear } = {}) {
    this.dockHost = dockHost;
    this.floatHost = floatHost;
    this.maxDockedLines = maxDockedLines;
    this.onModeChange = onModeChange || (() => {});
    this.onClear = onClear || (() => {});
    this.floating = getSetting('consoleFloating');
    this.rect = getSetting('consoleRect'); // {x,y,w,h} em px, relativo ao floatHost — null = posição padrão
    this.userHidden = getSetting('consoleHidden');
    // reaberto à mão (C) sem nada impresso: aparece vazio mesmo, senão a
    // tecla pareceria não fazer nada — volta ao normal na próxima saída vazia
    // depois de ter mostrado alguma linha (ver `render`)
    this._showEmpty = false;
    this._lines = [];
    this._gesture = null;
    this._build();
    this._mount();
    // canvas redimensionado (janela do navegador, divisória do painel de
    // código, Ctrl+H) — mantém a janela flutuante dentro da área visível.
    this._resizeObserver = new ResizeObserver(() => {
      if (this.floating && !this.el.hidden) this._applyRect();
    });
    this._resizeObserver.observe(floatHost);
  }

  _build() {
    const el = document.createElement('div');
    el.className = 'code-console micro-console';
    el.hidden = true;

    const header = document.createElement('div');
    header.className = 'console-header';
    const title = document.createElement('span');
    title.className = 'console-title';
    title.textContent = 'Console';
    const makeBtn = (onClick) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'console-mode-btn';
      btn.addEventListener('click', onClick);
      // o clique no botão não pode virar início de arraste da janela
      btn.addEventListener('pointerdown', (e) => e.stopPropagation());
      return btn;
    };
    const clearBtn = makeBtn(() => this.onClear());
    clearBtn.title = 'Limpar console';
    clearBtn.innerHTML = CLEAR_ICON;
    const toggleBtn = makeBtn(() => this.toggleFloating());
    header.appendChild(title);
    header.appendChild(clearBtn);
    header.appendChild(toggleBtn);
    header.addEventListener('pointerdown', (e) => this._startGesture(e, 'move'));

    const body = document.createElement('div');
    body.className = 'console-body';

    el.appendChild(header);
    el.appendChild(body);
    RESIZE_DIRS.forEach((dir) => {
      const handle = document.createElement('div');
      handle.className = `console-resize console-resize-${dir}`;
      handle.addEventListener('pointerdown', (e) => this._startGesture(e, dir));
      el.appendChild(handle);
    });

    this.el = el;
    this.body = body;
    this.toggleBtn = toggleBtn;
  }

  /** Coloca o elemento no host do modo atual (move o MESMO nó do DOM entre
   * os dois — conteúdo e tamanho de fonte vão junto). */
  _mount() {
    this.el.classList.toggle('floating', this.floating);
    this.toggleBtn.innerHTML = this.floating ? DOCK_ICON : FLOAT_ICON;
    this.toggleBtn.title = this.floating ? 'Encaixar console na barra inferior (Alt+C)' : 'Abrir console em janela flutuante (Alt+C)';
    if (this.floating) {
      this.floatHost.appendChild(this.el);
    } else {
      this.dockHost.appendChild(this.el);
      this.el.style.left = this.el.style.top = this.el.style.width = this.el.style.height = '';
    }
    if (this.floating && !this.el.hidden) this._applyRect();
    this._renderBody(); // depois do tamanho definido, pra rolar até a última linha
  }

  toggleFloating() {
    this.setFloating(!this.floating);
  }

  /** Barra inferior (false) ou janela flutuante (true) — Alt+C ou janela
   * de Configurações. */
  setFloating(floating) {
    floating = !!floating;
    if (floating === this.floating) return;
    this.floating = floating;
    this._mount();
    this._save();
    this.onModeChange(this.floating);
  }

  /** Mesmo `--code-font-size` do painel de código (ver CodeEditor#onFontSizeChange). */
  setFontSize(px) {
    this.el.style.setProperty('--code-font-size', `${px}px`);
  }

  /** Visível (false) ou oculto (true) — tecla C ou janela de Configurações. */
  setHidden(hidden) {
    hidden = !!hidden;
    if (hidden === this.userHidden) return;
    this.userHidden = hidden;
    this._showEmpty = !hidden;
    setSetting('consoleHidden', hidden);
    this.render(this._lines);
  }

  /** Atualiza a saída mostrada — escondido quando `lines` está vazio (ou
   * sempre, se ocultado com C). */
  render(lines) {
    if (lines.length > 0) this._showEmpty = false;
    this._lines = lines;
    const wasHidden = this.el.hidden;
    this.el.hidden = this.userHidden || (lines.length === 0 && !this._showEmpty);
    if (this.el.hidden) return;
    // só dá pra medir o host (e posicionar a janela) com o console visível
    if (wasHidden && this.floating) this._applyRect();
    this._renderBody();
  }

  _renderBody() {
    const lines = this.floating ? this._lines : this._lines.slice(-this.maxDockedLines);
    fillConsoleLines(this.body, lines);
  }

  // ---- geometria da janela flutuante ----

  _defaultRect() {
    const hostW = this.floatHost.clientWidth;
    const hostH = this.floatHost.clientHeight;
    const w = Math.min(DEFAULT_W, Math.max(MIN_W, hostW - 2 * MARGIN));
    const h = Math.min(DEFAULT_H, Math.max(MIN_H, hostH - 2 * MARGIN));
    // canto inferior esquerdo, acima da altura da barra de modos (centro inferior)
    return { x: MARGIN, y: Math.max(MARGIN, hostH - h - 80), w, h };
  }

  /** Limita o retângulo ao tamanho do canvas: tamanho nunca maior que o
   * host, e a janela inteira sempre dentro dele (a barra de título nunca
   * some fora da tela, então sempre dá pra arrastá-la de volta). */
  _clampRect(r) {
    const hostW = this.floatHost.clientWidth;
    const hostH = this.floatHost.clientHeight;
    const w = Math.max(Math.min(MIN_W, hostW), Math.min(r.w, hostW));
    const h = Math.max(Math.min(MIN_H, hostH), Math.min(r.h, hostH));
    const x = Math.min(Math.max(0, r.x), Math.max(0, hostW - w));
    const y = Math.min(Math.max(0, r.y), Math.max(0, hostH - h));
    return { x, y, w, h };
  }

  _applyRect(rect = this.rect ?? this._defaultRect()) {
    const r = this._clampRect(rect);
    Object.assign(this.el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.w}px`, height: `${r.h}px` });
    return r;
  }

  /** Volta a janela flutuante pra posição/tamanho padrão ("Restaurar
   * padrões" das Configurações). */
  resetRect() {
    this.rect = null;
    if (this.floating && !this.el.hidden) this._applyRect();
    this._save();
  }

  /** Arraste da barra de título (`kind === 'move'`) ou de uma borda/canto
   * (`kind` = direção: n/s/e/w/ne/nw/se/sw). Só no modo flutuante. */
  _startGesture(e, kind) {
    if (!this.floating || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const start = this._clampRect(this.rect ?? this._defaultRect());
    const sx = e.clientX;
    const sy = e.clientY;
    this.el.classList.add('dragging');

    const onMove = (ev) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let { x, y, w, h } = start;
      if (kind === 'move') {
        x += dx;
        y += dy;
      } else {
        const hostW = this.floatHost.clientWidth;
        const hostH = this.floatHost.clientHeight;
        // cada borda arrastada anda sozinha — a oposta fica parada
        if (kind.includes('e')) w = Math.min(Math.max(MIN_W, w + dx), hostW - x);
        if (kind.includes('s')) h = Math.min(Math.max(MIN_H, h + dy), hostH - y);
        if (kind.includes('w')) {
          const nx = Math.min(Math.max(0, x + dx), x + w - MIN_W);
          w += x - nx;
          x = nx;
        }
        if (kind.includes('n')) {
          const ny = Math.min(Math.max(0, y + dy), y + h - MIN_H);
          h += y - ny;
          y = ny;
        }
      }
      this.rect = this._applyRect({ x, y, w, h });
    };
    const onUp = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      this.el.classList.remove('dragging');
      this._save();
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  }

  _save() {
    setSetting('consoleFloating', this.floating);
    setSetting('consoleRect', this.rect);
  }
}
