/**
 * Título editável centralizado no topo do canvas —
 * elemento HTML solto por cima do SVG (não dentro do `viewport` que recebe
 * pan/zoom), então o tamanho na tela fica sempre fixo, não escala junto com
 * o zoom do canvas. Clicar entra em edição inline (vira um `<input>`); Enter
 * ou perder o foco confirma; Esc cancela e volta pro texto anterior.
 *
 * Não guarda nem repõe estado sozinho além do próprio texto — quem instancia
 * decide o texto inicial e é avisado de mudanças via `onChange`. Como o
 * elemento nunca é removido/recriado por nenhum outro código (os renders do
 * canvas só mexem nos próprios nós SVG), o título sobrevive naturalmente a
 * troca de passo de reprodução, restauração de snapshot, etc. — sem precisar
 * de nenhuma lógica extra de persistência.
 */
export class CanvasTitle {
  constructor(container, { initialText = '', placeholder = 'Sem título', onChange } = {}) {
    this.onChange = onChange || (() => {});
    this.placeholder = placeholder;
    this.text = initialText;
    this.editing = false;

    this.el = document.createElement('div');
    this.el.className = 'canvas-title';
    this.el.title = 'Clique para editar o título';
    this.el.addEventListener('click', () => this._startEdit());
    this._renderText();

    container.appendChild(this.el);
  }

  /** Define o texto programaticamente (ex: ao começar um projeto novo do
   * zero) — mesmo caminho de render de uma edição confirmada pelo usuário,
   * mas sem passar por `onChange` (quem chamou já sabe). */
  setText(text) {
    this.text = text || '';
    this._renderText();
  }

  _renderText() {
    this.el.textContent = this.text || this.placeholder;
    this.el.classList.toggle('is-placeholder', !this.text);
  }

  _startEdit() {
    if (this.editing) return;
    this.editing = true;

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'canvas-title-input';
    input.value = this.text;
    input.placeholder = this.placeholder;
    input.maxLength = 80;
    this.el.replaceWith(input);
    input.focus();
    input.select();

    const finish = (commit) => {
      if (!this.editing) return; // já finalizado (blur depois de Enter dispara de novo)
      this.editing = false;
      if (commit) {
        this.text = input.value.trim();
        this.onChange(this.text);
      }
      this._renderText();
      input.replaceWith(this.el);
    };

    input.addEventListener('blur', () => finish(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        input.blur(); // dispara o "blur" acima, que confirma
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
  }
}
