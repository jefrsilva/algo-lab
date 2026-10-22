/**
 * Janela "Atalhos de teclado" (item do menu ☰, ou a tecla ?) — lista todos os
 * atalhos da ferramenta, por assunto. Modal centralizado, com a mesma caixa
 * da janela de Configurações (classes `.app-dialog*` e `.settings-*`).
 *
 * Só leitura: não guarda estado. A lista é escrita à mão em `SHORTCUT_SECTIONS`
 * — ao criar/mudar um atalho (App#_onKeyDown, CodeEditor#_onKeyDown), mude
 * aqui também. Cada tecla alternativa vem separada por " / ".
 */
export const SHORTCUT_SECTIONS = [
  {
    title: 'Geral',
    items: [
      { keys: 'Ctrl+Espaço', label: 'Ações rápidas (criar elementos, alinhar, etc.)' },
      { keys: '?', label: 'Mostrar esta lista de atalhos' },
      { keys: 'Tab', label: 'Levar o foco para o editor de código (com o foco fora dele)' },
      { keys: 'Esc', label: 'Fechar popups e cancelar a ação em andamento' },
      { keys: 'Ctrl+H', label: 'Ocultar/mostrar o painel de código' },
      { keys: 'C', label: 'Ocultar/mostrar o console' },
      { keys: 'Alt+C', label: 'Console na barra inferior ou em janela flutuante' },
    ],
  },
  {
    title: 'Ferramentas do canvas',
    items: [
      { keys: '1 / V', label: 'Selecionar / Mover' },
      { keys: '2 / T', label: 'Texto' },
      { keys: '3 / R', label: 'Área hachurada' },
      { keys: '4 / B', label: 'Gráfico Big-O' },
      { keys: '5 / L', label: 'Ligar nós' },
      { keys: '6 / A', label: 'Seta' },
      { keys: '7 / M', label: 'Régua' },
    ],
  },
  {
    title: 'Canvas',
    items: [
      { keys: 'Espaço + arrastar', label: 'Mover a vista do canvas' },
      { keys: 'Delete / Backspace', label: 'Remover o que está selecionado' },
      { keys: 'Enter', label: 'Editar o texto da label selecionada' },
      { keys: 'Alt+1 … Alt+9', label: 'Cor do elemento selecionado (Alt+0 tira a cor)' },
      { keys: 'Ctrl+Shift (segurar)', label: 'Roda de cores em volta do mouse' },
      { keys: 'Shift (ao arrastar)', label: 'Setas e réguas na horizontal/vertical; inverte o encaixe de áreas no grid' },
      { keys: 'Ctrl+A', label: 'Nós de estrutura simplificados/completos' },
      { keys: 'N', label: 'Nomes de ponteiros e variáveis truncados/completos' },
      { keys: 'G', label: 'Encaixar áreas hachuradas no grid' },
    ],
  },
  {
    title: 'Código e simulação',
    items: [
      { keys: 'Ctrl+Enter', label: 'Sandbox: executa a linha do cursor · Simulação: roda o programa' },
      { keys: 'Ctrl+Shift+Enter', label: 'Passa para a Simulação e roda o programa inteiro' },
      { keys: 'Ctrl+,', label: 'Volta um passo da simulação' },
      { keys: 'Ctrl+.', label: 'Avança um passo da simulação' },
      { keys: 'Ctrl+→', label: 'Marca a linha do cursor (as outras ficam esmaecidas)' },
      { keys: 'Ctrl+←', label: 'Tira a marca da linha' },
      { keys: 'Ctrl+↑ / Ctrl+↓', label: 'Move a linha marcada' },
      { keys: 'Tab / Shift+Tab', label: 'Indenta / desindenta (no editor de código)' },
    ],
  },
];

export class ShortcutsDialog {
  constructor({ container = document.body } = {}) {
    this.container = container;
    this.el = null;
    this._returnFocusTo = null;
  }

  get isOpen() {
    return !!this.el;
  }

  open() {
    if (this.el) return;
    this._returnFocusTo = document.activeElement;

    const backdrop = document.createElement('div');
    backdrop.className = 'app-dialog-backdrop';
    backdrop.addEventListener('pointerdown', (e) => {
      if (e.target === backdrop) this.close();
    });

    const box = document.createElement('div');
    box.className = 'app-dialog settings-dialog shortcuts-dialog';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'shortcuts-dialog-title');
    box.addEventListener('pointerdown', (e) => e.stopPropagation());

    const titleEl = document.createElement('h2');
    titleEl.className = 'app-dialog-title';
    titleEl.id = 'shortcuts-dialog-title';
    titleEl.textContent = 'Atalhos de teclado';
    box.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'settings-body';
    SHORTCUT_SECTIONS.forEach((section) => {
      const sec = document.createElement('section');
      sec.className = 'settings-section';
      const h = document.createElement('h3');
      h.className = 'settings-section-title';
      h.textContent = section.title;
      sec.appendChild(h);
      section.items.forEach(({ keys, label }) => {
        const row = document.createElement('div');
        row.className = 'settings-row';
        const text = document.createElement('span');
        text.className = 'settings-label-text';
        text.textContent = label;
        const kbd = document.createElement('kbd');
        kbd.className = 'settings-shortcut shortcuts-keys';
        kbd.textContent = keys.trim();
        row.appendChild(text);
        row.appendChild(kbd);
        sec.appendChild(row);
      });
      body.appendChild(sec);
    });
    box.appendChild(body);

    const actions = document.createElement('div');
    actions.className = 'app-dialog-actions';
    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'btn primary';
    closeBtn.textContent = 'Fechar';
    closeBtn.addEventListener('click', () => this.close());
    actions.appendChild(closeBtn);
    box.appendChild(actions);

    backdrop.appendChild(box);
    this.container.appendChild(backdrop);
    this.el = backdrop;

    // modal: nenhum atalho do app vale com a janela aberta (ver App#_onKeyDown);
    // o único controle é o botão Fechar, então Tab fica nele
    this._boundKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      } else if (e.key === 'Tab') {
        e.preventDefault();
        closeBtn.focus();
      }
    };
    document.addEventListener('keydown', this._boundKeyDown);
    closeBtn.focus();
  }

  close() {
    if (!this.el) return;
    this.el.remove();
    this.el = null;
    document.removeEventListener('keydown', this._boundKeyDown);
    this._boundKeyDown = null;
    const back = this._returnFocusTo;
    this._returnFocusTo = null;
    if (back && back !== document.body && document.contains(back)) back.focus();
  }
}
