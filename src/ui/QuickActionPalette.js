/**
 * Caixa de "quick action" (Ctrl+Espaço, ver App#_openQuickActions): um campo
 * de comando no topo do canvas, com a lista de comandos que casam com o que
 * foi digitado logo abaixo. O comando que o Enter executaria aparece em
 * cinza no próprio campo — completando o texto quando ele é o começo do
 * nome ("new po" + "inter"), ou à direita ("n p  → new pointer") quando foi
 * digitado abreviado.
 *
 * Só UI: os comandos (nome, descrição, `run`) vêm de quem abre a caixa.
 *
 * Por padrão a lista só aparece depois do 1º caractere, com no máximo 3
 * comandos; aberta pelo menu ☰ ("Ações rápidas", `showAll`), lista todos.
 *
 * Teclas: Enter executa o comando em destaque; Tab completa o campo com o
 * nome dele; ↑/↓ trocam o destaque; Esc (ou clicar fora) fecha.
 */

/** Pontuação de `query` contra UM nome de comando — menor é melhor;
 * `null` se não casa. Cada palavra digitada é o começo de uma palavra do
 * nome, na ordem ("n p" e "new po" -> "new pointer"; "n t n" -> "new tree
 * node"); uma palavra só também vale como iniciais ("np", "ntn"). */
function scoreName(query, name) {
  if (query === name) return 0;
  if (name.startsWith(query)) return 1;
  const tokens = query.split(' ');
  const words = name.split(' ');
  // palavra a palavra, sem pular nenhuma: "n p" -> "new pointer"
  if (tokens.length <= words.length && tokens.every((t, i) => words[i].startsWith(t))) return 2;
  // pulando palavras do nome: "n n" -> "new tree node"
  let w = 0;
  const skipping = tokens.every((t) => {
    while (w < words.length && !words[w].startsWith(t)) w += 1;
    if (w === words.length) return false;
    w += 1;
    return true;
  });
  if (skipping) return 3;
  // iniciais: "np" -> "new pointer"
  if (tokens.length === 1 && words.map((x) => x[0]).join('').startsWith(tokens[0])) return 4;
  return null;
}

/** Comandos que casam com `query`, do melhor pro pior (empate: ordem da
 * lista, então os comandos mais usados vêm antes — ex.: "n a" é "new
 * array", não "new area"). Cada item é `{command, name}`, `name` sendo o
 * nome (ou apelido) que casou. Campo vazio lista tudo. */
export function matchCommands(rawQuery, commands) {
  const query = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ');
  const results = [];
  commands.forEach((command, order) => {
    if (!query) {
      results.push({ command, name: command.name, score: 0, order });
      return;
    }
    let best = null;
    [command.name, ...(command.aliases ?? [])].forEach((name) => {
      const score = scoreName(query, name);
      if (score !== null && (best === null || score < best.score)) best = { command, name, score, order };
    });
    if (best) results.push(best);
  });
  results.sort((a, b) => a.score - b.score || a.order - b.order);
  return results;
}

/** Quantos comandos a caixa mostra no modo normal (Ctrl+Espaço) — só os
 * melhores, e só depois do primeiro caractere. O modo `showAll` (menu ☰ →
 * "Ações rápidas") mostra a lista inteira, inclusive com o campo vazio. */
const COMPACT_MAX = 3;

export class QuickActionPalette {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  get isOpen() {
    return !!this.el;
  }

  /**
   * @param commands lista de `{name, aliases?, description, disabled?, run}`
   *   — `disabled` (texto) mostra o comando acinzentado, com o motivo, e o
   *   Enter não o executa.
   * @param options.showAll lista TODOS os comandos (também os desabilitados,
   *   e já com o campo vazio). Sem ele, a lista só aparece depois do 1º
   *   caractere, com no máximo `COMPACT_MAX` comandos que dá pra executar.
   * @param options.returnFocusTo elemento que recebe o foco ao fechar sem
   *   executar nada (Esc) — quem executa um comando cuida do próprio foco
   *   (normalmente um editor inline que já abre focado).
   */
  open(commands, { showAll = false, returnFocusTo = null } = {}) {
    this.close();
    this.commands = commands;
    this.showAll = showAll;
    this.returnFocusTo = returnFocusTo;
    this.shown = []; // comandos na lista agora (`{command, name}`), na ordem
    this.selected = 0;

    const box = document.createElement('div');
    box.className = 'quick-action';
    box.addEventListener('pointerdown', (e) => e.stopPropagation());

    const field = document.createElement('div');
    field.className = 'quick-action-field';
    // texto fantasma por TRÁS do input (que tem fundo transparente): o que
    // foi digitado fica invisível aqui, só pra empurrar o cinza pro lugar
    // certo; a fonte é a mesma (monoespaçada), então alinha caractere a
    // caractere
    const ghost = document.createElement('div');
    ghost.className = 'quick-action-ghost';
    const ghostTyped = document.createElement('span');
    ghostTyped.className = 'quick-action-ghost-typed';
    const ghostRest = document.createElement('span');
    ghostRest.className = 'quick-action-ghost-rest';
    ghost.append(ghostTyped, ghostRest);

    const input = document.createElement('input');
    input.className = 'quick-action-input';
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = 'Comando… (ex: new pointer, n p)';
    field.append(ghost, input);

    const list = document.createElement('div');
    list.className = 'quick-action-list';

    box.append(field, list);
    this.container.appendChild(box);
    this.el = box;
    this.input = input;
    this.ghostTyped = ghostTyped;
    this.ghostRest = ghostRest;
    this.list = list;

    input.addEventListener('input', () => {
      this.selected = 0;
      this._refresh();
    });
    input.addEventListener('keydown', (e) => this._onKeyDown(e));
    input.addEventListener('blur', () => this.close());

    this._refresh();
    input.focus();
  }

  close({ refocus = false } = {}) {
    if (!this.el) return;
    const el = this.el;
    this.el = null; // antes do remove(): o blur do input chama close() de novo
    el.remove();
    if (refocus && this.returnFocusTo) this.returnFocusTo.focus({ preventScroll: true });
  }

  _onKeyDown(e) {
    // nada daqui vaza pros atalhos globais/do canvas (Delete, V, T...)
    e.stopPropagation();
    if (e.key === 'Escape' || (e.key === ' ' && e.ctrlKey)) {
      e.preventDefault();
      this.close({ refocus: true });
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this._runSelected();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = this.shown.length;
      if (n === 0) return;
      this.selected = (this.selected + (e.key === 'ArrowDown' ? 1 : n - 1)) % n;
      this._refresh();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const match = this.shown[this.selected];
      if (!match) return;
      this.input.value = match.name;
      this._refresh();
    }
  }

  _runSelected() {
    const match = this.shown[this.selected];
    if (!match || match.command.disabled) return;
    this.close();
    match.command.run();
  }

  /** O que entra na lista pro texto atual. Modo normal: nada com o campo
   * vazio; depois, os `COMPACT_MAX` melhores que dá pra executar — e, se
   * nenhum dá, o melhor desabilitado (com o motivo), pra não ficar sem
   * explicação. Modo `showAll`: todos, na ordem de `matchCommands`. */
  _shownFor(typed) {
    const matches = matchCommands(typed, this.commands);
    if (this.showAll) return matches;
    if (!typed.trim()) return [];
    const valid = matches.filter((m) => !m.command.disabled);
    if (valid.length) return valid.slice(0, COMPACT_MAX);
    return matches.slice(0, 1);
  }

  _refresh() {
    const typed = this.input.value;
    this.shown = this._shownFor(typed);
    if (this.selected >= this.shown.length) this.selected = 0;
    // no modo `showAll` um desabilitado pode vir no topo — o destaque
    // automático pula pro primeiro que dá pra executar
    if (this.selected === 0 && this.shown[0]?.command.disabled) {
      this.selected = Math.max(0, this.shown.findIndex((m) => !m.command.disabled));
    }
    const match = this.shown[this.selected];

    // cinza no campo: o resto do nome quando o digitado é o começo dele,
    // senão o nome inteiro à direita
    this.ghostTyped.textContent = typed;
    const lower = typed.toLowerCase();
    if (!match || !typed.trim()) this.ghostRest.textContent = '';
    else if (match.name.startsWith(lower)) this.ghostRest.textContent = match.name.slice(lower.length);
    else this.ghostRest.textContent = `  → ${match.name}`;

    this.list.replaceChildren();
    this.list.hidden = !typed.trim() && !this.showAll;
    if (this.shown.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'quick-action-empty';
      empty.textContent = 'Nenhum comando encontrado';
      this.list.appendChild(empty);
      return;
    }
    this.shown.forEach((m, i) => {
      const item = document.createElement('div');
      item.className = 'quick-action-item';
      item.classList.toggle('selected', i === this.selected);
      item.classList.toggle('disabled', !!m.command.disabled);
      const name = document.createElement('span');
      name.className = 'quick-action-item-name';
      name.textContent = m.command.name;
      const desc = document.createElement('span');
      desc.className = 'quick-action-item-desc';
      desc.textContent = m.command.disabled || m.command.description;
      item.append(name, desc);
      // pointerdown (não click): o blur do input fecharia a caixa antes do click
      item.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.selected = i;
        this._runSelected();
      });
      this.list.appendChild(item);
    });
  }
}
