import { parseStatement, parseExpression } from '../interpreter/parser.js';
import { logicalLineAt } from '../interpreter/blockParser.js';

const KEYWORDS = new Set([
  'def', 'return', 'if', 'elif', 'else', 'while', 'for', 'in', 'not', 'and', 'or', 'is',
  'None', 'True', 'False', 'class', 'pass', 'break', 'continue', 'import', 'from', 'as',
  'lambda', 'print', 'yield', 'with', 'try', 'except', 'finally', 'raise', 'global',
  'nonlocal', 'del', 'assert',
]);

// grupos: 1 comentário · 2 string · 3 número · 4 identificador
// (só pra colorir a sintaxe — o Ctrl+Enter usa o lexer/parser de verdade em
// src/interpreter/, que produz uma AST em vez de HTML)
const TOKEN_RE = /(#.*$)|([fF]?"(?:[^"\\]|\\.)*"|[fF]?'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|([A-Za-z_][A-Za-z0-9_]*)/g;
const WORD_RE = /[A-Za-z0-9_]/;

const PAD_TOP = 10;
const BP_ZONE_W = 16;
const INDENT = '    ';
const FONT_MIN = 16;
const FONT_MAX = 32;
const FONT_DEFAULT = 22;
const LINE_HEIGHT_RATIO = 1.54;
const clampFontSize = (px) => Math.max(FONT_MIN, Math.min(FONT_MAX, Math.round(Number(px) || FONT_DEFAULT)));

const DEFAULT_CODE = `def inserir_no_fim(head, tail, valor):
    novo = Node(valor)
    if head is None:
        head = novo
        tail = novo
    else:
        tail.next = novo
        novo.prev = tail
        tail = novo
    return head, tail
`;

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function highlightLine(line, selectedName) {
  let out = '';
  let lastIndex = 0;
  TOKEN_RE.lastIndex = 0;
  let m;
  while ((m = TOKEN_RE.exec(line))) {
    // guarda a posição: realçar uma f-string chama highlightLine de novo
    // (recursivo, ver highlightFString), que reusa o MESMO regex global
    const tokenEnd = TOKEN_RE.lastIndex;
    if (m.index > lastIndex) out += escapeHtml(line.slice(lastIndex, m.index));
    const text = m[0];
    if (m[1]) out += `<span class="tok-comment">${escapeHtml(text)}</span>`;
    else if (m[2]) out += /^[fF]/.test(text) ? highlightFString(text, selectedName) : `<span class="tok-string">${escapeHtml(text)}</span>`;
    else if (m[3]) out += `<span class="tok-number">${escapeHtml(text)}</span>`;
    else if (m[4]) {
      if (selectedName && text === selectedName) out += `<span class="tok-model-ref">${escapeHtml(text)}</span>`;
      else if (KEYWORDS.has(text)) out += `<span class="tok-keyword">${escapeHtml(text)}</span>`;
      else out += escapeHtml(text);
    }
    lastIndex = tokenEnd;
    TOKEN_RE.lastIndex = tokenEnd;
  }
  if (lastIndex < line.length) out += escapeHtml(line.slice(lastIndex));
  return out;
}

/** f-string (`text` inclui o "f" e as aspas): texto literal na cor de string,
 * cada campo "{expr!conv:spec}" com a expressão realçada como código normal
 * (chaves e spec na cor de string). Só visual — quem valida de verdade é o
 * lexer (src/interpreter/lexer.js#readFStringParts). */
function highlightFString(text, selectedName) {
  const str = (s) => (s ? `<span class="tok-string">${escapeHtml(s)}</span>` : '');
  let out = '';
  let literal = text.slice(0, 2); // f"
  const end = text.length - 1; // aspa de fechamento
  let i = 2;
  while (i < end) {
    const c = text[i];
    if ((c === '{' || c === '}') && text[i + 1] === c) {
      literal += c + c;
      i += 2;
      continue;
    }
    if (c !== '{') {
      literal += c;
      i += 1;
      continue;
    }
    // acha o "}" que fecha o campo (fora de parênteses/strings aninhados) e,
    // dentro dele, onde a expressão termina (":" ou "!" no nível 0)
    let depth = 0;
    let exprEnd = -1;
    let j = i + 1;
    for (; j < end; j += 1) {
      const d = text[j];
      if (d === '"' || d === "'") {
        const close = text.indexOf(d, j + 1);
        if (close === -1 || close >= end) break;
        j = close;
      } else if (d === '(' || d === '[' || d === '{') depth += 1;
      else if (d === ')' || d === ']') depth = Math.max(0, depth - 1);
      else if (d === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (depth === 0 && exprEnd === -1 && (d === ':' || (d === '!' && text[j + 1] !== '='))) exprEnd = j;
    }
    if (exprEnd === -1) exprEnd = j;
    out += str(`${literal}{`);
    literal = '';
    out += highlightLine(text.slice(i + 1, exprEnd), selectedName);
    out += str(text.slice(exprEnd, Math.min(j + 1, end)));
    i = j + 1;
  }
  return out + str(literal + text.slice(end));
}

/**
 * Editor de código standalone (sem dependências externas), sintaxe estilo Python.
 *
 * Dois destaques distintos:
 *  - linha ativa: segue o cursor de edição (sempre ligado).
 *  - linha marcada: um único "breakpoint" ligado clicando ao lado do número da
 *    linha; Ctrl+Seta cima/baixo move a MARCA (não o conteúdo da linha);
 *    Ctrl+Seta direita marca a linha atual (onde está o cursor); Ctrl+Seta
 *    esquerda desliga o destaque. Enquanto uma linha está marcada, as demais
 *    ficam com opacidade reduzida — pensado pra aulas/apresentações, onde só
 *    a linha marcada deve chamar atenção.
 *
 * Identificadores só ganham destaque de "referência do modelo" quando o
 * usuário clica sobre o nome no código (e o nome bate com um ponteiro/array
 * vivo do modelo) ou quando `setSelectedName` é chamado de fora (ex: ao
 * selecionar a estrutura correspondente no canvas).
 *
 * Ctrl+Enter numa linha "alvo = expressão" faz o parse da linha (ver
 * src/interpreter/parser.js — um subconjunto de sintaxe Python: atribuição +
 * expressões com `.campo`, `[índice]`, operadores `+ - * / == != < <= > >=
 * and or not`, sem if/while/for) e repassa a AST pronta pra
 * `onExecuteStatement(ast)` interpretar contra o modelo. Linha vazia ou com
 * erro de sintaxe é ignorada silenciosamente (mesmo comportamento de sempre).
 *
 * Dois modos, alternados pela UI (`Sandbox`/`Simulação` — internamente
 * 'manual'/'run'):
 *  - "manual" (padrão): Ctrl+Enter aplica só a linha do cursor, como acima.
 *  - "run": Ctrl+Enter (ou o botão ▶) chama `onRun(código inteiro)` —
 *    quem trata a execução do programa (hoje: App.js + MicroProgramRunner)
 *    decide o que fazer; o editor só entrega o texto e expõe
 *    `setExecutionLine`/`clearExecutionLine` pra quem estiver tocando a
 *    reprodução destacar a linha correspondente a cada passo (reaproveita a
 *    mesma "linha marcada" do modo de ensino).
 */
export class CodeEditor {
  constructor(container, { onSelectName, onExecuteStatement, onEvaluateCondition, onRun, onModeChange, onToggleCursor, onTogglePointer, onFontSizeChange, onCodeChange, initialCode, initialFontSize } = {}) {
    this.container = container;
    this.knownNames = new Set();
    this.selectedName = null;
    this.activeLine = 0;
    this.markedLine = null;
    this.mode = 'manual';
    this.fontSize = clampFontSize(initialFontSize ?? FONT_DEFAULT);
    this.lineHeight = Math.round(this.fontSize * LINE_HEIGHT_RATIO);
    this.onSelectName = onSelectName || (() => {});
    this.onExecuteStatement = onExecuteStatement || (() => {});
    // Ctrl+Enter numa linha "if/elif/while cond:" no Sandbox — recebe a AST
    // da condição (ver _handleGenerateFromLine)
    this.onEvaluateCondition = onEvaluateCondition || (() => {});
    this.onRun = onRun || (() => {});
    this.onModeChange = onModeChange || (() => {});
    this.onToggleCursor = onToggleCursor || (() => {});
    this.onTogglePointer = onTogglePointer || (() => {});
    this.onFontSizeChange = onFontSizeChange || (() => {});
    // chamado a cada edição do texto feita pelo usuário (não por `setValue`)
    this.onCodeChange = onCodeChange || (() => {});
    this._lastText = null;
    this._build();
    this.setValue(initialCode ?? DEFAULT_CODE);
  }

  _build() {
    this.container.innerHTML = '';
    const panel = document.createElement('div');
    panel.className = 'code-editor-toolbar';
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.type = 'button';
    zoomOutBtn.className = 'code-editor-font-btn';
    zoomOutBtn.textContent = '−';
    zoomOutBtn.title = 'Diminuir o texto';
    zoomOutBtn.addEventListener('click', () => this._changeFontSize(-1));
    const fontSizeLabel = document.createElement('span');
    fontSizeLabel.className = 'code-editor-font-size';
    const zoomInBtn = document.createElement('button');
    zoomInBtn.type = 'button';
    zoomInBtn.className = 'code-editor-font-btn';
    zoomInBtn.textContent = '+';
    zoomInBtn.title = 'Aumentar o texto';
    zoomInBtn.addEventListener('click', () => this._changeFontSize(1));
    // tamanho do texto fica no fim da barra, alinhado à direita (ver
    // .code-editor-font-group) — à esquerda ficam o modo e os botões dele
    const fontGroup = document.createElement('div');
    fontGroup.className = 'code-editor-font-group';
    fontGroup.appendChild(zoomOutBtn);
    fontGroup.appendChild(fontSizeLabel);
    fontGroup.appendChild(zoomInBtn);
    this.fontSizeLabel = fontSizeLabel;

    const modeToggle = document.createElement('div');
    modeToggle.className = 'code-editor-mode-toggle';
    const manualBtn = document.createElement('button');
    manualBtn.type = 'button';
    manualBtn.className = 'code-editor-mode-btn active';
    manualBtn.textContent = 'Sandbox';
    manualBtn.title = 'Sandbox: Ctrl+Enter aplica só a linha do cursor';
    manualBtn.addEventListener('click', () => this._setMode('manual'));
    const runModeBtn = document.createElement('button');
    runModeBtn.type = 'button';
    runModeBtn.className = 'code-editor-mode-btn';
    runModeBtn.textContent = 'Simulação';
    runModeBtn.title = 'Simulação: roda o programa inteiro, com reprodução passo a passo';
    runModeBtn.addEventListener('click', () => this._setMode('run'));
    modeToggle.appendChild(manualBtn);
    modeToggle.appendChild(runModeBtn);
    // modo + botões dele (pilha, ▶) ficam juntos num grupo que nunca quebra
    // — com o painel estreito, só o grupo de tamanho do texto desce de linha
    const mainGroup = document.createElement('div');
    mainGroup.className = 'code-editor-toolbar-main';
    mainGroup.appendChild(modeToggle);
    panel.appendChild(mainGroup);
    this.manualModeBtn = manualBtn;
    this.runModeBtn = runModeBtn;

    const runBtn = document.createElement('button');
    runBtn.type = 'button';
    runBtn.className = 'code-editor-run-btn';
    // só o ícone (triângulo verde em SVG — o caractere ▶ vira emoji em
    // algumas fontes)
    runBtn.innerHTML = '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 2.5v11l9.5-5.5z" fill="currentColor"/></svg>';
    runBtn.title = 'Rodar o programa inteiro (Ctrl+Enter)';
    runBtn.setAttribute('aria-label', runBtn.title);
    runBtn.hidden = true;
    runBtn.addEventListener('click', () => this.onRun(this.getValue()));
    mainGroup.appendChild(runBtn);
    panel.appendChild(fontGroup);
    this.runBtn = runBtn;
    this.toolbar = panel;

    this.container.appendChild(panel);

    const wrap = document.createElement('div');
    wrap.className = 'code-editor';

    const gutter = document.createElement('div');
    gutter.className = 'code-editor-gutter';
    const gutterInner = document.createElement('div');
    gutterInner.className = 'code-editor-gutter-inner';
    gutter.appendChild(gutterInner);
    gutterInner.addEventListener('click', (e) => {
      const bp = e.target.closest('.code-editor-bp-zone');
      if (bp) {
        this._toggleMarkedLine(Number(bp.dataset.line));
        return;
      }
      const num = e.target.closest('.code-editor-gutter-num');
      if (num) this._setCursorToLine(Number(num.dataset.line));
    });

    const body = document.createElement('div');
    body.className = 'code-editor-body';

    const lineBg = document.createElement('div');
    lineBg.className = 'code-editor-line-bg';

    const lineMark = document.createElement('div');
    lineMark.className = 'code-editor-line-mark';
    lineMark.hidden = true;

    const highlightWrap = document.createElement('div');
    highlightWrap.className = 'code-editor-highlight-wrap';
    const pre = document.createElement('pre');
    pre.className = 'code-editor-highlight';
    const code = document.createElement('code');
    pre.appendChild(code);
    highlightWrap.appendChild(pre);

    const textarea = document.createElement('textarea');
    textarea.className = 'code-editor-textarea';
    textarea.spellcheck = false;
    textarea.autocapitalize = 'off';
    textarea.autocomplete = 'off';
    textarea.wrap = 'off';

    body.appendChild(lineBg);
    body.appendChild(lineMark);
    body.appendChild(highlightWrap);
    body.appendChild(textarea);

    wrap.appendChild(gutter);
    wrap.appendChild(body);
    this.container.appendChild(wrap);

    this.gutterInner = gutterInner;
    this.pre = pre;
    this.code = code;
    this.body = body;
    this.lineBg = lineBg;
    this.lineMark = lineMark;
    this.textarea = textarea;

    textarea.addEventListener('input', () => this._onInput());
    textarea.addEventListener('scroll', () => this._onScroll());
    textarea.addEventListener('keydown', (e) => this._onKeyDown(e));
    textarea.addEventListener('keyup', () => this._syncActiveLine());
    textarea.addEventListener('click', () => {
      this._syncActiveLine();
      this._handleWordClick();
    });
    textarea.addEventListener('contextmenu', (e) => this._onContextMenu(e));

    this.wrap = wrap;
    this._applyFontSize();
  }

  // ---- tamanho do texto ----

  _applyFontSize() {
    this.lineHeight = Math.round(this.fontSize * LINE_HEIGHT_RATIO);
    this.wrap.style.setProperty('--code-font-size', `${this.fontSize}px`);
    this.wrap.style.setProperty('--code-line-height', `${this.lineHeight}px`);
    if (this.fontSizeLabel) this.fontSizeLabel.textContent = String(this.fontSize);
    this.onFontSizeChange(this.fontSize);
    this._renderGutter();
    this._updateLineBg();
    this._updateLineMark();
  }

  _changeFontSize(delta) {
    this.setFontSize(this.fontSize + delta);
  }

  /** Botões −/+ da barra ou janela de Configurações. */
  setFontSize(px) {
    const next = clampFontSize(px);
    if (next === this.fontSize) return;
    this.fontSize = next;
    this._applyFontSize();
  }

  /** Nomes válidos do modelo (rótulos de ponteiro, nomes de array) — usado só
   * para validar cliques em identificadores, não destaca tudo automaticamente. */
  setKnownNames(names) {
    this.knownNames = names instanceof Set ? names : new Set(names);
    if (this.selectedName && !this.knownNames.has(this.selectedName)) this.selectedName = null;
    this._renderHighlight();
    this._updateLineMark();
  }

  /** Define (ou limpa, se null) o identificador atualmente destacado no código. */
  setSelectedName(name) {
    const next = name || null;
    const changed = next !== this.selectedName;
    this.selectedName = next;
    this._renderHighlight();
    // _renderHighlight reconstrói as linhas do zero, perdendo a classe
    // "marked" — reaplica pra não sumir o selo de referência na linha destacada.
    this._updateLineMark();
    if (changed && next) this._pulseSelectedName();
  }

  _pulseSelectedName() {
    if (!this.wrap) return;
    this.wrap.classList.remove('name-pulse');
    void this.wrap.offsetWidth; // força reflow para poder reiniciar a animação
    this.wrap.classList.add('name-pulse');
    clearTimeout(this._namePulseTimer);
    this._namePulseTimer = setTimeout(() => this.wrap.classList.remove('name-pulse'), 650);
  }

  getValue() {
    return this.textarea.value;
  }

  setValue(code) {
    this.textarea.value = code;
    this._lastText = code; // troca programática — não conta como edição (ver _onInput)
    this.activeLine = 0;
    this.markedLine = null;
    this._onInput();
  }

  // ---- render ----

  _onInput() {
    const text = this.textarea.value;
    const edited = this._lastText !== null && text !== this._lastText;
    this._lastText = text;
    if (edited) this.onCodeChange(text);
    this._renderHighlight();
    this._renderGutter();
    this._syncActiveLine(true);
    this._updateLineMark();
  }

  _renderHighlight() {
    const lines = this.textarea.value.split('\n');
    this.code.innerHTML = lines
      .map((line, i) => `<div class="code-editor-line" data-line="${i}">${highlightLine(line, this.selectedName)}</div>`)
      .join('');
  }

  _renderGutter() {
    const lineCount = this.textarea.value.split('\n').length;
    let html = '';
    for (let i = 0; i < lineCount; i += 1) {
      html += `<div class="code-editor-gutter-row"><span class="code-editor-bp-zone" data-line="${i}" title="Marcar linha"></span><span class="code-editor-gutter-num" data-line="${i}">${i + 1}</span></div>`;
    }
    this.gutterInner.innerHTML = html;
    const digits = String(lineCount).length;
    // dígitos em "ch" (largura do "0" na fonte do próprio gutter, que segue
    // o tamanho de texto escolhido — ver _applyFontSize): a coluna cresce
    // junto com a fonte. Antes eram 8px fixos por dígito, e os números
    // ficavam cortados com fonte grande. 14px = folga + padding do número.
    this.gutterInner.parentElement.style.width = `calc(${BP_ZONE_W + 14}px + ${Math.max(2, digits)}ch)`;
    if (this.markedLine != null && this.markedLine >= lineCount) this.markedLine = lineCount - 1;
  }

  _onScroll() {
    const { scrollTop, scrollLeft } = this.textarea;
    this.gutterInner.style.transform = `translateY(${-scrollTop}px)`;
    this.lineBg.style.transform = `translateY(${-scrollTop}px)`;
    this.lineMark.style.transform = `translateY(${-scrollTop}px)`;
    this.pre.style.transform = `translate(${-scrollLeft}px, ${-scrollTop}px)`;
  }

  _updateLineBg() {
    this.lineBg.style.top = `${PAD_TOP + this.activeLine * this.lineHeight}px`;
    this.gutterInner.querySelectorAll('.code-editor-gutter-num').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.line) === this.activeLine);
    });
  }

  _updateLineMark() {
    if (this.markedLine == null) {
      this.lineMark.hidden = true;
    } else {
      this.lineMark.hidden = false;
      this.lineMark.style.top = `${PAD_TOP + this.markedLine * this.lineHeight}px`;
    }
    this.gutterInner.querySelectorAll('.code-editor-bp-zone').forEach((el) => {
      el.classList.toggle('active', Number(el.dataset.line) === this.markedLine);
    });
    this.wrap.classList.toggle('line-focus', this.markedLine != null);
    this.code.querySelectorAll('.code-editor-line').forEach((el) => {
      el.classList.toggle('marked', Number(el.dataset.line) === this.markedLine);
    });
  }

  // ---- linha ativa (segue o cursor) ----

  _lineStartOffsets(lines) {
    const offsets = [];
    let acc = 0;
    for (const l of lines) {
      offsets.push(acc);
      acc += l.length + 1;
    }
    return offsets;
  }

  _currentLineIndex() {
    const pos = this.textarea.selectionStart;
    const value = this.textarea.value;
    let idx = 0;
    for (let i = 0; i < pos && i < value.length; i += 1) if (value[i] === '\n') idx += 1;
    return idx;
  }

  _syncActiveLine(force = false) {
    const idx = this._currentLineIndex();
    if (force || idx !== this.activeLine) {
      this.activeLine = idx;
      this._updateLineBg();
    }
  }

  _setCursorToLine(idx) {
    const lines = this.textarea.value.split('\n');
    const clamped = Math.max(0, Math.min(idx, lines.length - 1));
    const offsets = this._lineStartOffsets(lines);
    this.textarea.focus();
    this.textarea.selectionStart = offsets[clamped];
    this.textarea.selectionEnd = offsets[clamped];
    this.activeLine = clamped;
    this._updateLineBg();
  }

  /** Ctrl+Enter também desce o cursor uma linha, como um Enter normal — mas
   * NUNCA quebra a linha atual no meio, mesmo com o cursor no meio dela: se
   * já existe uma próxima linha, só move o cursor pra ela (sem tocar no
   * texto) — logo DEPOIS da indentação dela, onde o código começa (ou no
   * fim, se ela só tem espaços); só insere uma linha nova quando o cursor
   * está na ÚLTIMA linha do editor — e mesmo aí, sempre no FIM do documento
   * (nunca no meio da própria última linha), já com a indentação que o
   * Enter normal daria ali (a mesma da linha, +1 nível depois de ":"). */
  _advanceToNextLine() {
    const lines = this.textarea.value.split('\n');
    const currentIdx = this._currentLineIndex();
    if (currentIdx < lines.length - 1) {
      const next = currentIdx + 1;
      this._setCursorToLine(next);
      // linha só com espaços: `lead` já é o tamanho dela (cursor no fim)
      const lead = lines[next].match(/^[ \t]*/)[0].length;
      const pos = this.textarea.selectionStart + lead;
      this.textarea.setSelectionRange(pos, pos);
      return;
    }
    const end = this.textarea.value.length;
    this._replaceRange(end, end, `\n${this._autoIndentAt(end)}`);
  }

  // ---- destaque de identificador por clique ----

  _wordAtCursor() {
    const pos = this.textarea.selectionStart;
    const value = this.textarea.value;
    let start = pos;
    let end = pos;
    while (start > 0 && WORD_RE.test(value[start - 1])) start -= 1;
    while (end < value.length && WORD_RE.test(value[end])) end += 1;
    if (start === end) return null;
    return value.slice(start, end);
  }

  _handleWordClick() {
    const word = this._wordAtCursor();
    const name = word && this.knownNames.has(word) ? word : null;
    this.setSelectedName(name);
    this.onSelectName(name);
  }

  /** Clique com o botão direito sobre um trecho "nome[expr]" (ex: "nums[i]",
   * "a[i + 1]") alterna visível/oculto o cursor de leitura correspondente no
   * canvas (ver App#_toggleMicroReadCursor); sobre um identificador solto
   * conhecido (ex: "head", "tn" — não um "nome[expr]", esse caso acima tem
   * prioridade) alterna visível/oculto o PONTEIRO correspondente (ver
   * App#_toggleMicroPointerVisibility) — mesma ideia, alvo diferente. Nos
   * dois casos, abre o menu do navegador só se não caiu em nenhum dos dois —
   * o usuário ainda precisa de recortar/colar/etc no texto. */
  _onContextMenu(e) {
    const lines = this.textarea.value.split('\n');
    const idx = this._currentLineIndex();
    const line = lines[idx] ?? '';
    const lineStart = this._lineStartOffsets(lines)[idx];
    const offsetInLine = this.textarea.selectionStart - lineStart;
    const key = this._indexExprKeyAt(line, offsetInLine);
    if (key) {
      e.preventDefault();
      this.onToggleCursor(key);
      return;
    }
    const word = this._wordAtCursor();
    if (word && this.knownNames.has(word)) {
      e.preventDefault();
      this.onTogglePointer(word);
    }
  }

  /** Acha o trecho "nome[expr]" (ou "nome[expr][expr]", célula de matriz) da
   * linha que contém `offset` e devolve a chave normalizada (sem espaço) que
   * identifica o cursor de leitura correspondente — mesmo formato de
   * MicroRuntimeAdapter#_showReadCursor/_showMatrixCursor. */
  _indexExprKeyAt(line, offset) {
    const re = /([A-Za-z_][A-Za-z0-9_]*)\s*\[([^[\]]*)\](?:\s*\[([^[\]]*)\])?/g;
    let m;
    while ((m = re.exec(line))) {
      const start = m.index;
      const end = start + m[0].length;
      if (offset >= start && offset <= end) {
        const arrayName = m[1];
        const normalized = m[2].replace(/\s+/g, '');
        if (m[3] !== undefined) return `${arrayName}[${normalized}][${m[3].replace(/\s+/g, '')}]`;
        return `${arrayName}[${normalized}]`;
      }
    }
    return null;
  }

  // ---- linha marcada (estilo breakpoint) ----

  _toggleMarkedLine(idx) {
    this.textarea.focus();
    this.markedLine = this.markedLine === idx ? null : idx;
    this._updateLineMark();
  }

  _moveMarkedLine(direction) {
    const lineCount = this.textarea.value.split('\n').length;
    const base = this.markedLine == null ? this.activeLine : this.markedLine;
    this.markedLine = Math.max(0, Math.min(lineCount - 1, base + direction));
    this._updateLineMark();
  }

  /** Ctrl+Seta direita: destaca a linha onde está o cursor. */
  _setMarkedLine(idx) {
    this.markedLine = idx;
    this._updateLineMark();
  }

  /** Ctrl+Seta esquerda: desliga o destaque de linha. */
  _clearMarkedLine() {
    this.markedLine = null;
    this._updateLineMark();
  }

  // ---- modo manual / executar ----

  _setMode(mode) {
    if (this.mode === mode) return;
    this.mode = mode;
    this.manualModeBtn.classList.toggle('active', mode === 'manual');
    this.runModeBtn.classList.toggle('active', mode === 'run');
    this.runBtn.hidden = mode !== 'run';
    this.onModeChange(mode);
  }

  /** Botão extra na barra do topo, entre o seletor de modo e o ▶ (ex: mostrar/ocultar a
   * pilha de chamadas, ver App.js) — o editor só hospeda, quem chama cuida
   * do estado. Devolve o botão. */
  addToolbarButton({ className = '', title, html, onClick }) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `code-editor-tool-btn ${className}`.trim();
    btn.title = title;
    btn.setAttribute('aria-label', title);
    btn.innerHTML = html;
    btn.addEventListener('click', onClick);
    this.runBtn.before(btn);
    return btn;
  }

  /** Destaca (reaproveitando a "linha marcada") a linha do passo de execução
   * atual — usado por quem estiver tocando a reprodução do modo "Executar". */
  setExecutionLine(idx) {
    this._setMarkedLine(idx);
  }

  /** Desliga o destaque de execução — chamado ao voltar pro modo manual ou
   * ao limpar a reprodução (nenhum passo selecionado). */
  clearExecutionLine() {
    this._clearMarkedLine();
  }

  // ---- teclado ----

  _onKeyDown(e) {
    if (e.ctrlKey && e.key === 'Enter') {
      e.preventDefault();
      if (this.mode === 'run') this.onRun(this.getValue());
      else this._handleGenerateFromLine();
      // além de rodar, também se comporta como um Enter normal — desce o
      // cursor pra próxima linha, pra digitar a instrução seguinte direto em
      // seguida. Roda ANTES de mover (_handleGenerateFromLine usa a posição
      // atual do cursor/linha marcada pra saber o que executar).
      this._advanceToNextLine();
      return;
    }
    if (e.ctrlKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      this._moveMarkedLine(e.key === 'ArrowUp' ? -1 : 1);
      return;
    }
    if (e.ctrlKey && e.key === 'ArrowRight') {
      e.preventDefault();
      this._setMarkedLine(this._currentLineIndex());
      return;
    }
    if (e.ctrlKey && e.key === 'ArrowLeft') {
      e.preventDefault();
      this._clearMarkedLine();
      return;
    }
    // Tab indenta, Shift+Tab desindenta (ver _indent) — sem Ctrl/Alt/Meta,
    // pra não roubar atalhos do navegador/sistema (ex.: Ctrl+Tab).
    if (e.key === 'Tab' && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault();
      this._indent(e.shiftKey);
      return;
    }
    if (e.key === 'Backspace' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && this._smartBackspace()) {
      e.preventDefault();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      this._insertNewlineWithAutoIndent();
    }
  }

  /** Backspace na indentação: com o cursor numa linha em que só há espaços
   * ANTES dele (e sem seleção), apaga até a parada de indentação anterior
   * (múltiplo de 4) — um nível inteiro de uma vez, igual editores de código
   * ("        |x" vira "    |x"; "      |x", fora de parada, vira
   * "    |x"). `false` (Backspace normal, de 1 caractere) em qualquer outro
   * caso: seleção, coluna 0, texto antes do cursor, tab no meio. */
  _smartBackspace() {
    const { selectionStart: s, selectionEnd: e, value } = this.textarea;
    if (s !== e) return false;
    const lineStart = value.lastIndexOf('\n', s - 1) + 1;
    const col = s - lineStart;
    if (col === 0 || !/^ +$/.test(value.slice(lineStart, s))) return false;
    const del = ((col - 1) % INDENT.length) + 1;
    this._replaceRange(s - del, s, '');
    return true;
  }

  // ---- gerar elementos do modelo a partir do código ----

  /** Ctrl+Enter: parseia a linha ATIVA — a marcada (breakpoint), se houver
   * uma, senão a linha onde está o cursor de edição — e, se deu certo,
   * repassa a AST pra quem interpreta contra o modelo. Uma linha marcada
   * existe justamente pra fixar "qual linha roda", independente de pra onde
   * o cursor de texto tenha ido enquanto o usuário lê/navega o código.
   * Linha vazia ou com erro de sintaxe é ignorada silenciosamente. Um
   * statement que ocupa várias linhas (colchete aberto ou "\" no fim, ex. um
   * dict com um par por linha) roda inteiro, com a linha ativa em qualquer
   * uma delas — ver blockParser.js#logicalLineAt. */
  /** Linha vazia continua sem nenhum feedback (nada pra rodar) — qualquer
   * outra tentativa pulsa o fundo da(s) linha(s): verde se
   * `onExecuteStatement` rodou sem lançar, vermelho se o parse falhou OU se
   * `onExecuteStatement` lançou (operação impossível contra o modelo atual,
   * ex: campo de um ponteiro nulo) — ver `flashLine`. */
  _handleGenerateFromLine() {
    const idx = this.markedLine != null ? this.markedLine : this._currentLineIndex();
    // já sem comentário e sem espaços nas pontas
    const { content: line, start, end } = logicalLineAt(this.textarea.value, idx);
    if (!line) return;
    const flash = (ok) => {
      for (let i = start; i <= end; i += 1) this.flashLine(i, ok);
    };
    // "if/elif/while condição:" — não dá pra executar o bloco (é uma linha
    // só), mas dá pra avaliar a condição: quem trata destaca os elementos
    // envolvidos e mostra o resultado (ver App#_evaluateCondition)
    const cond = line.match(/^(?:if|elif|while)\s+(.*):$/);
    if (cond) {
      const test = parseExpression(cond[1]);
      if (!test.ok) {
        flash(false);
        return;
      }
      try {
        this.onEvaluateCondition(test.ast);
        flash(true);
      } catch (err) {
        flash(false);
      }
      return;
    }
    const result = parseStatement(line);
    if (!result.ok) {
      flash(false);
      return;
    }
    try {
      this.onExecuteStatement(result.ast);
      flash(true);
    } catch (err) {
      flash(false);
    }
  }

  /** Pulso de feedback (verde = sucesso, vermelho = erro) no fundo de uma
   * linha inteira, do modo manual (ver `_handleGenerateFromLine`) — elemento
   * solto que se auto-remove ao fim da animação CSS (`code-editor-line-flash`,
   * ver codeEditor.css), não precisa ser rastreado depois de criado. */
  flashLine(idx, ok) {
    const el = document.createElement('div');
    el.className = `code-editor-line-flash ${ok ? 'success' : 'error'}`;
    el.style.top = `${PAD_TOP + idx * this.lineHeight - this.textarea.scrollTop}px`;
    el.style.height = `${this.lineHeight}px`;
    el.addEventListener('animationend', () => el.remove());
    this.body.appendChild(el);
  }

  /** Troca o trecho [start, end) do texto por `text` e posiciona a seleção
   * (por padrão, cursor logo depois do texto inserido). Toda edição feita
   * pelo próprio editor passa por aqui: usa o "insertText" do navegador
   * (entra no histórico — Ctrl+Z/Ctrl+Y continuam funcionando, o que
   * atribuir `textarea.value` direto apagaria), com fallback pra atribuição
   * direta se ele não existir. */
  _replaceRange(start, end, text, selStart = start + text.length, selEnd = selStart) {
    const ta = this.textarea;
    const expected = ta.value.slice(0, start) + text + ta.value.slice(end);
    ta.focus();
    ta.setSelectionRange(start, end);
    try {
      // só apagar (texto vazio): "delete" — "insertText" com "" não apaga
      // em todo navegador
      if (text === '' && start !== end) document.execCommand('delete', false);
      else document.execCommand('insertText', false, text);
    } catch {
      // sem suporte — cai na atribuição direta logo abaixo
    }
    // confere o resultado (ex.: "insertText" com texto vazio não apaga em
    // todo navegador) — no pior caso, atribui direto (perde o Ctrl+Z)
    if (ta.value !== expected) ta.value = expected;
    ta.setSelectionRange(selStart, selEnd);
    this._onInput(); // "insertText" já dispara "input", mas a seleção final só existe agora
  }

  _insertAtCursor(text) {
    const { selectionStart, selectionEnd } = this.textarea;
    this._replaceRange(selectionStart, selectionEnd, text);
  }

  /** Indentação do texto ANTES de `pos` na linha dele, mais um nível se a
   * linha (até `pos`) termina em ":" — a da próxima linha após um Enter. */
  _autoIndentAt(pos) {
    const value = this.textarea.value;
    const lineStart = value.lastIndexOf('\n', pos - 1) + 1;
    const before = value.slice(lineStart, pos);
    let indent = before.match(/^[ \t]*/)[0];
    if (/:\s*$/.test(before)) indent += INDENT;
    return indent;
  }

  _insertNewlineWithAutoIndent() {
    this._insertAtCursor(`\n${this._autoIndentAt(this.textarea.selectionStart)}`);
  }

  /** Tab / Shift+Tab, como em editores de código:
   *  - Tab sem seleção (ou seleção dentro de uma linha só): insere espaços
   *    até a próxima parada de indentação (múltiplo de 4 colunas);
   *  - Tab com seleção em várias linhas: +1 nível em cada linha tocada
   *    (linhas vazias ficam como estão);
   *  - Shift+Tab: -1 nível em cada linha tocada (a do cursor, se não há
   *    seleção) — tira até a parada anterior ("      x" vira "    x"), ou
   *    um tab.
   * A seleção/cursor acompanha o texto deslocado. */
  _indent(outdent) {
    const ta = this.textarea;
    const { selectionStart: s, selectionEnd: e, value } = ta;
    const multiline = value.slice(s, e).includes('\n');
    if (!outdent && !multiline) {
      const col = s - (value.lastIndexOf('\n', s - 1) + 1);
      this._insertAtCursor(' '.repeat(INDENT.length - (col % INDENT.length)));
      return;
    }

    // linhas tocadas pela seleção — uma seleção que termina no começo de
    // uma linha (seleção de linhas inteiras) não inclui essa linha
    const first = value.lastIndexOf('\n', s - 1) + 1;
    const endRef = e > s && value[e - 1] === '\n' ? e - 1 : e;
    let last = value.indexOf('\n', endRef);
    if (last === -1) last = value.length;
    const lines = value.slice(first, last).split('\n');

    const edits = []; // {at, ins, del} — posições no texto ORIGINAL
    let at = first;
    const newLines = lines.map((line) => {
      let out = line;
      if (!outdent) {
        if (line.length > 0) {
          edits.push({ at, ins: INDENT.length, del: 0 });
          out = INDENT + line;
        }
      } else {
        const lead = line.match(/^[ \t]*/)[0];
        let del = 0;
        if (lead.startsWith('\t')) del = 1;
        else if (lead.length > 0) del = ((lead.length - 1) % INDENT.length) + 1;
        if (del > 0) {
          edits.push({ at, ins: 0, del });
          out = line.slice(del);
        }
      }
      at += line.length + 1;
      return out;
    });
    if (edits.length === 0) return;

    // posição p no texto antigo -> no novo. `keepAtLineStart`: o início de
    // uma seleção de várias linhas que está na coluna 0 fica na coluna 0
    // (as linhas continuam inteiras selecionadas, com o recuo novo dentro).
    const mapPos = (p, keepAtLineStart) => {
      let delta = 0;
      for (const ed of edits) {
        if (ed.at > p) break;
        if (ed.ins && (p > ed.at || !keepAtLineStart)) delta += ed.ins;
        if (ed.del) delta -= Math.min(ed.del, p - ed.at);
      }
      return p + delta;
    };
    const hasSelection = e > s;
    const newStart = mapPos(s, hasSelection);
    const newEnd = hasSelection ? mapPos(e, false) : newStart;
    this._replaceRange(first, last, newLines.join('\n'), newStart, newEnd);
  }
}
