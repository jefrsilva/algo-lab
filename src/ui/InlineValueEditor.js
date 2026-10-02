const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
const QUOTED_RE = /^(['"])([\s\S]*)\1$/;

/**
 * Texto digitado no editor de VALOR (`type: 'value'`) -> valor cru do modelo
 * (number | string | boolean), com a sintaxe do Python mas sem exigir aspas
 * no caso comum:
 *   "42" / 'oi' / ""  -> texto (aspas forçam texto, mesmo parecendo número)
 *   True / False      -> bool (só com `allowBool` — dado de nó não aceita,
 *                        igual "Node(True)" no código)
 *   42 / -1.5 / 1e3   -> número
 *   qualquer outra    -> texto, sem os espaços das pontas
 */
export function parseEditedValue(raw, { allowBool = true } = {}) {
  const t = raw.trim();
  const quoted = QUOTED_RE.exec(t);
  if (quoted) return quoted[2];
  if (allowBool && (t === 'True' || t === 'False')) return t === 'True';
  if (NUMBER_RE.test(t)) return Number(t);
  return t;
}

/** Inverso de `parseEditedValue`: texto que o campo mostra ao abrir. Texto
 * ganha aspas só quando, sem elas, seria lido como OUTRA coisa (número,
 * bool, texto vazio, espaços nas pontas, já entre aspas) — assim confirmar
 * sem mexer nunca troca o tipo do valor. */
export function valueToEditText(v, { allowBool = true } = {}) {
  if (typeof v === 'boolean') return v ? 'True' : 'False';
  if (typeof v !== 'string') return String(v);
  const ambiguous =
    v === '' || v !== v.trim() || NUMBER_RE.test(v) || QUOTED_RE.test(v) || (allowBool && (v === 'True' || v === 'False'));
  if (!ambiguous) return v;
  return v.includes('"') ? `'${v}'` : `"${v}"`;
}

/**
 * Editor inline (sem popup flutuante): sobrepõe um <input> exatamente sobre o
 * valor clicado no canvas (data de um nó, célula de array, valor de
 * variável), na posição e no tamanho de tela do próprio elemento, para editar
 * "no lugar" — sem abrir um cartão separado.
 */
export class InlineValueEditor {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  /**
   * @param rect {x,y,width,height} em coordenadas de tela (já convertidas do
   *   mundo e escaladas pelo zoom do viewport), relativas a `container`.
   * @param initialValue valor atual (numérico, ou texto quando `type: 'text'`).
   * @param fontSize tamanho de fonte em px de tela (já escalado pelo zoom).
   * @param onCommit(value) chamado ao confirmar (Enter ou perder o foco) —
   *   com um número válido no modo padrão, ou o texto (possivelmente vazio)
   *   no modo `type: 'text'`; não é chamado se o usuário cancelar (Esc).
   * @param options.type 'number' (padrão), 'text' — texto não valida/
   *   converte pra número, e aceita string vazia como valor confirmado — ou
   *   'value': número, texto OU bool, decidido pelo que foi digitado (ver
   *   `parseEditedValue`; campo vazio mantém o valor atual) — o dos valores
   *   do modelo (nó, variável, célula de lista/matriz).
   * @param options.allowBool (só com `type: 'value'`) aceita True/False
   *   como bool (padrão true).
   * @param options.onCancel chamado ao cancelar (Esc) — além de, não em vez
   *   de, simplesmente fechar sem chamar `onCommit`.
   * @param options.autoGrow(value) => {width,height} (px de tela) — quando
   *   dado, o campo é redimensionado a cada tecla pra caber o conteúdo atual
   *   (ver App#_editMicroLabelInPlace); sem isso o campo fica fixo no
   *   tamanho de `rect`, como sempre (edição de valor numérico de tamanho
   *   sempre igual, ex: dado de um nó).
   * @param options.returnFocusTo elemento a receber o foco de teclado de
   *   volta quando este editor fechar POR TECLADO (Enter/Esc, com o campo
   *   ainda focado no momento — ver `close`) — sem isso, confirmar/cancelar
   *   deixa o foco preso no `<input>` recém-removido do DOM, que o navegador
   *   então joga pro `<body>`; sem foco em lugar nenhum reconhecível, o
   *   atalho de Tab pro painel de código (ver App#_onKeyDown) não tem de onde
   *   partir. Fechar por PERDER o foco (ex: o usuário clicou direto no
   *   editor de código pra já sair digitando) não rouba esse foco de volta —
   *   `close` só recupera o foco se `this.el` ainda era quem o tinha.
   * @param options.multiline (só com `type: 'text'`) usa um `<textarea>`:
   *   Enter confirma, Shift+Enter quebra a linha (ver labels de texto,
   *   App#_editMicroLabelInPlace).
   * @param options.style estilos CSS extras aplicados ao campo (padding,
   *   line-height, cor... — pra casar com o elemento desenhado por baixo).
   * @param options.onKeyDown(e, el) chamado antes do tratamento padrão de
   *   cada tecla; devolvendo `true`, a tecla é considerada tratada (ex: Alt+N
   *   troca a cor da label em edição, ver App#_editMicroLabelInPlace).
   */
  open(
    rect,
    initialValue,
    fontSize,
    onCommit,
    { type = 'number', allowBool = true, onCancel, autoGrow, returnFocusTo, multiline = false, style = null, onKeyDown = null } = {},
  ) {
    this.close();
    this._returnFocusTo = returnFocusTo || null;

    const isArea = multiline && type === 'text';
    const input = document.createElement(isArea ? 'textarea' : 'input');
    if (isArea) {
      input.rows = 1;
      input.wrap = 'off';
      input.spellcheck = false;
    } else {
      input.type = type === 'number' ? 'number' : 'text';
      if (type === 'value') input.spellcheck = false;
    }
    input.className = 'inline-value-editor' + (isArea ? ' multiline' : '');
    input.value = type === 'value' ? valueToEditText(initialValue, { allowBool }) : String(initialValue);
    input.style.left = `${rect.x}px`;
    input.style.top = `${rect.y}px`;
    input.style.width = `${rect.width}px`;
    input.style.height = `${rect.height}px`;
    input.style.fontSize = `${fontSize}px`;
    if (style) Object.assign(input.style, style);

    this.container.appendChild(input);
    this.el = input;

    if (autoGrow) {
      const applyGrow = () => {
        const size = autoGrow(input.value);
        input.style.width = `${size.width}px`;
        input.style.height = `${size.height}px`;
      };
      input.addEventListener('input', applyGrow);
    }

    input.focus();
    input.select();

    let settled = false;
    const commit = () => {
      if (settled) return;
      settled = true;
      if (type === 'text') {
        const value = input.value;
        this.close();
        onCommit(value);
        return;
      }
      if (type === 'value') {
        const raw = input.value;
        this.close();
        onCommit(raw.trim() === '' ? initialValue : parseEditedValue(raw, { allowBool }));
        return;
      }
      const raw = input.value.trim();
      const value = raw === '' ? initialValue : Number(raw);
      this.close();
      if (!Number.isNaN(value)) onCommit(value);
    };
    const cancel = () => {
      if (settled) return;
      settled = true;
      this.close();
      if (onCancel) onCancel();
    };

    input.addEventListener('keydown', (e) => {
      if (onKeyDown && onKeyDown(e, input)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (e.key === 'Enter' && isArea && e.shiftKey) {
        // Shift+Enter: quebra de linha (comportamento nativo do textarea)
        e.stopPropagation();
      } else if (e.key === 'Enter') {
        e.preventDefault(); // no textarea, Enter sozinho não insere quebra
        commit();
        e.stopPropagation();
      } else if (e.key === 'Escape') {
        cancel();
        e.stopPropagation();
      } else if (e.key !== 'Tab') {
        // Tab NÃO é interceptado aqui de propósito — precisa borbulhar até o
        // listener global (App#_onKeyDown), que redireciona o foco pro
        // painel de código quando ele está em algo dentro da visualização
        // (ver ali); as demais teclas continuam bloqueadas pra não vazar
        // atalhos do canvas (delete, modos, etc.) enquanto o campo está
        // sendo editado.
        e.stopPropagation();
      }
    });
    input.addEventListener('pointerdown', (e) => e.stopPropagation());
    input.addEventListener('blur', commit);
  }

  close() {
    if (this.el) {
      // se o campo ainda tinha o foco agora (fechou por Enter/Esc, não por
      // ter perdido o foco pra outro lugar), devolve pro alvo combinado.
      const shouldRefocus = document.activeElement === this.el;
      this.el.remove();
      this.el = null;
      if (shouldRefocus && this._returnFocusTo) {
        const target = this._returnFocusTo;
        this._returnFocusTo = null;
        target.focus({ preventScroll: true });
      } else {
        this._returnFocusTo = null;
      }
    }
  }

  get isOpen() {
    return !!this.el;
  }
}
