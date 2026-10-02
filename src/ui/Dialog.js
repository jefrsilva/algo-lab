/**
 * Diálogo modal centralizado na tela (fundo escurecido cobrindo a janela
 * inteira) — substitui `window.confirm`/`window.alert` nativos do browser,
 * que fogem do estilo visual da aplicação. Diferente dos popups contextuais
 * (NodePopup/ArraySettingsPopup/LabelSettingsPopup, ancorados numa
 * coordenada de tela perto do clique que os abriu), este NÃO é contextual:
 * sempre centralizado, por cima de tudo — por isso é montado uma vez sobre
 * `document.body` (ver App#dialog), não sobre um container de canvas
 * específico.
 *
 * API baseada em Promise — diferente do `window.confirm`/`alert` nativos,
 * não dá pra bloquear a thread esperando o clique, então todo chamador
 * precisa ser `async`/usar `.then()`. Só um diálogo por vez: abrir um novo
 * fecha (resolvendo com o valor "padrão", equivalente a cancelar) o
 * anterior, se ainda houver algum aberto.
 */
export class Dialog {
  constructor(container = document.body) {
    this.container = container;
    this.el = null;
    this._resolve = null;
    this._defaultValue = undefined;
  }

  /** Pergunta sim/não — resolve `true` (confirmou) ou `false` (cancelou,
   * inclusive por Esc ou clique fora). `danger: true` estiliza o botão de
   * confirmação como ação arriscada (mesma classe `.btn.danger` de sempre),
   * pra ações que descartam trabalho do usuário. */
  confirm(message, { title = null, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false } = {}) {
    return this._open({
      title,
      message,
      defaultValue: false,
      buttons: [
        { label: cancelLabel, variant: 'subtle', value: false },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', value: true, primary: true },
      ],
    });
  }

  /** Aviso com um botão só — resolve (sem valor útil) quando o usuário
   * fecha. */
  alert(message, { title = null, okLabel = 'OK' } = {}) {
    return this._open({
      title,
      message,
      defaultValue: undefined,
      buttons: [{ label: okLabel, variant: 'primary', value: undefined, primary: true }],
    });
  }

  _open({ title, message, buttons, defaultValue }) {
    this._close(this._defaultValue); // fecha um diálogo anterior ainda aberto, se houver

    return new Promise((resolve) => {
      this._resolve = resolve;
      this._defaultValue = defaultValue;

      const backdrop = document.createElement('div');
      backdrop.className = 'app-dialog-backdrop';
      backdrop.addEventListener('pointerdown', (e) => {
        if (e.target === backdrop) this._close(defaultValue);
      });

      const box = document.createElement('div');
      box.className = 'app-dialog';
      box.addEventListener('pointerdown', (e) => e.stopPropagation());

      if (title) {
        const titleEl = document.createElement('h2');
        titleEl.className = 'app-dialog-title';
        titleEl.textContent = title;
        box.appendChild(titleEl);
      }

      const messageEl = document.createElement('p');
      messageEl.className = 'app-dialog-message';
      messageEl.textContent = message;
      box.appendChild(messageEl);

      const actions = document.createElement('div');
      actions.className = 'app-dialog-actions';
      let primaryBtn = null;
      buttons.forEach(({ label, variant, value, primary }) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `btn ${variant}`.trim();
        btn.textContent = label;
        btn.addEventListener('click', () => this._close(value));
        actions.appendChild(btn);
        if (primary) primaryBtn = btn;
      });
      box.appendChild(actions);

      backdrop.appendChild(box);
      this.container.appendChild(backdrop);
      this.el = backdrop;

      this._boundKeyDown = (e) => {
        if (e.key === 'Escape') this._close(defaultValue);
        // modal: Tab/Shift+Tab circulam só pelos botões do diálogo — sem
        // isso o foco "escapava" pro canvas/editor por trás do fundo escuro
        else if (e.key === 'Tab') {
          const btns = [...actions.querySelectorAll('button')];
          if (btns.length === 0) return;
          e.preventDefault();
          const i = btns.indexOf(document.activeElement);
          const next = i === -1 ? 0 : (i + (e.shiftKey ? -1 : 1) + btns.length) % btns.length;
          btns[next].focus();
        }
      };
      document.addEventListener('keydown', this._boundKeyDown);

      (primaryBtn || actions.firstChild)?.focus();
    });
  }

  _close(value) {
    if (this.el) {
      this.el.remove();
      this.el = null;
    }
    if (this._boundKeyDown) {
      document.removeEventListener('keydown', this._boundKeyDown);
      this._boundKeyDown = null;
    }
    if (this._resolve) {
      const resolve = this._resolve;
      this._resolve = null;
      resolve(value);
    }
  }

  get isOpen() {
    return !!this.el;
  }
}
