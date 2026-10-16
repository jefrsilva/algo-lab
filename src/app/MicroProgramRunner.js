import { parseProgram } from '../interpreter/blockParser.js';
import { runProgram } from '../interpreter/interpreter.js';
import { isStackArray, ridesStackTop, stackHeight } from '../core/micro/MicroModel.js';
import { identifierKey } from './microVisibility.js';

const AUTOPLAY_BASE_MS = 700;

/**
 * Motor de execução do modo "Executar" do editor de código
 * (steps/stepIndex/playing, goToStep/togglePlay/setSpeed). Os passos não são
 * só uma decoração sobre uma estrutura que não muda: cada linha do
 * programa MUDA o MicroModel de verdade (move ponteiro, religa campo, altera
 * célula) — então navegar entre passos precisa restaurar um SNAPSHOT do
 * modelo, não só re-desenhar uma decoração por cima.
 *
 * O snapshot guarda só os dados LÓGICOS de cada elemento (data/value/cells/
 * target/prev/next) — nunca x/y. Posição é responsabilidade de quem arrasta
 * os nós no canvas, não da reprodução: o usuário deve poder posicionar os
 * elementos como preferir antes de rodar, e mover livremente durante a
 * reprodução, sem que voltar um passo "puxe" tudo de volta pro lugar de
 * quando aquele passo foi originalmente executado.
 *
 * Posição mora em `this.positions` (id -> {x,y}), um mapa à parte que NUNCA
 * encolhe durante uma execução — não dá pra simplesmente "ler a posição ao
 * vivo do modelo" na hora de restaurar, porque `_restore` troca os Maps do
 * MicroModel inteiros a cada passo, então o "ao vivo" de agora pode ser um
 * passo ANTERIOR (com menos elementos) a quem acabou de ser criado depois.
 * `this.positions` é povoado na primeira vez que cada id aparece (na posição
 * que `createPosition`/o usuário deu a ele) e atualizado por `updatePosition`
 * sempre que o usuário arrasta um elemento (ver App.js, _onMicroPointerUpWindow).
 *
 * `this.orientations` (id de array -> 'horizontal'|'vertical'|'stack') segue
 * exatamente o mesmo padrão de `this.positions`, pelo mesmo motivo: a
 * orientação de um array é preferência de layout do usuário (ver popup de
 * configurações, App#_openMicroArraySettingsPopup), não parte da lógica do
 * programa — trocar de orientação no meio de uma reprodução não pode ser
 * desfeito ao navegar pra outro passo.
 *
 * Arrastar um elemento DURANTE a reprodução grava a posição como um
 * "quadro-chave" daquele passo (`this.stepLayout`): do passo do arraste
 * em diante o elemento fica onde foi solto (até o próximo quadro-chave dele),
 * e nos passos anteriores continua onde estava. Os quadros-chave são
 * guardados por uma chave ESTÁVEL entre execuções (ver `_assignKeys` — ids
 * mudam a cada "Rodar"), então rodar o mesmo programa de novo já reproduz
 * as posições ajustadas. `this.positions` continua sendo a posição "de
 * nascimento" de cada elemento nesta execução, usada antes do 1º quadro-chave.
 *
 * Array em pilha (`orientation: 'stack'`) cresce pra cima com a BASE parada
 * (ver MicroModel#_keepStackBase), então a posição guardada dele — em
 * `this.positions` e nos quadros-chave — é a da base: `{x, y, bottom: true}`,
 * com `y` = borda de baixo da caixa. `_restore` tira dela a altura que a
 * pilha tem no passo restaurado (ver `_stackTop`); trocar a orientação de/pra
 * pilha converte o que já estava guardado (ver `updateOrientation`). O
 * rótulo com o nome, quando está acima da pilha (ver
 * MicroModel.js#ridesStackTop), anda junto com o topo: a posição dele
 * também é guardada relativa à base, do mesmo jeito.

 * O programa (com if/while/for — ver blockParser.js/interpreter.js) é
 * compilado e rodado de uma vez contra o modelo real, capturando um snapshot
 * depois de cada passo que o interpretador reporta; a guarda de loop
 * infinito mora no próprio `runProgram` (interpreter.js). Erro de sintaxe no
 * programa inteiro cancela a execução (nenhum passo é gerado) — diferente do
 * modo manual, que ignora só a linha com problema.
 */
export class MicroProgramRunner {
  constructor(micro, { onChange, onSelect } = {}) {
    this.micro = micro;
    this.onChange = onChange || (() => {});
    this.onSelect = onSelect || (() => {});
    this.steps = [];
    this.stepIndex = -1;
    this.playing = false;
    this.speed = 1;
    this.error = null;
    this._playTimer = null;
    this.positions = new Map();
    this.orientations = new Map();
    // id de array -> true quando os nós aparecem como círculos nas células
    // (`nodeCircles`): preferência visual, igual à orientação
    this.nodeCircles = new Map();
    // idem, pra "destacar os nós ao selecionar" (`highlightNodes`)
    this.highlightNodes = new Map();
    // quadros-chave de posição: chave estável -> [{step, x, y}] em ordem de
    // passo. Sobrevive a "Rodar" de novo (só some com `clearStepLayout` —
    // projeto novo/carregado); vai junto no arquivo do projeto.
    this.stepLayout = new Map();
    // nome do ponteiro -> oculto? (escolha do usuário, vale p/ todos os passos)
    this.pointerVisibility = new Map();
    // por execução: id -> chave estável, id -> passo em que nasceu, e quantos
    // elementos de cada "base" de chave já apareceram (ver `_assignKeys`)
    this.stableKeys = new Map();
    this.createdAt = new Map();
    this._keyCounts = new Map();
  }

  clearStepLayout() {
    this.stepLayout = new Map();
    this.pointerVisibility.clear();
  }

  /** Oculta/mostra identificadores (ponteiros, cursores de leitura e
   * variáveis — chaves de `identifierKey`) em TODOS os passos. O snapshot de
   * cada passo guarda o `hidden` de quando o programa rodou, então a escolha
   * do usuário fica aqui, por nome, e `_restore` a reaplica. */
  setHidden(keys, hidden) {
    [].concat(keys).forEach((key) => this.pointerVisibility.set(key, hidden));
    if (this.stepIndex >= 0 && this.steps[this.stepIndex]) this._restore(this.steps[this.stepIndex].snapshot, this.stepIndex);
  }

  /** Quadros-chave pro arquivo do projeto / de volta dele (ver App#_saveProject). */
  exportStepLayout() {
    return Array.from(this.stepLayout.entries()).map(([key, frames]) => [key, frames.map((f) => ({ ...f }))]);
  }

  importStepLayout(entries) {
    this.stepLayout = new Map(
      (Array.isArray(entries) ? entries : [])
        .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1]))
        .map(([key, frames]) => [
          key,
          frames
            .filter((f) => Number.isInteger(f?.step) && Number.isFinite(f.x) && Number.isFinite(f.y))
            .sort((a, b) => a.step - b.step),
        ]),
    );
  }

  get hasSteps() {
    return this.steps.length > 0;
  }

  /** Compila `source` (programa inteiro, com blocos) e roda contra `env` (o
   * Environment real — hoje App#microRuntime), capturando um snapshot do
   * modelo e a lista de elementos tocados (`env.touched` — leituras via
   * cursor de array E a escrita final, ver MicroRuntimeAdapter) depois de
   * cada passo que o interpretador reporta. Termina já restaurado no
   * primeiro passo, pronto pra reprodução. Erro de sintaxe: `this.error`
   * fica preenchido e nenhum passo é produzido. */
  run(source, env) {
    this.stop();
    const parsed = parseProgram(source);
    if (!parsed.ok) {
      this.error = parsed.error;
      this.onChange();
      return;
    }
    this.error = null;
    const steps = [];
    env.output = []; // cada "Rodar" reinterpreta o programa do zero — não arrasta print de uma corrida anterior
    // ...e é uma "execução nova" do Python: ordem de set de textos/nós muda
    // entre execuções (ver MicroRuntimeAdapter#newHashSeed)
    env.newHashSeed?.();
    this.stableKeys = new Map();
    this.createdAt = new Map();
    this._keyCounts = new Map();
    this._capturePositions(); // layout pré-existente, antes de qualquer linha rodar
    this._assignKeys(0);
    for (const step of runProgram(parsed.program, parsed.functions, env)) {
      const touched = env.touched;
      env.touched = [];
      this._capturePositions(); // pega a posição de quem acabou de ser criado neste passo
      this._assignKeys(steps.length);
      steps.push({ ...step, touched, snapshot: this._snapshot(), output: env.output.slice() });
    }
    this.steps = steps;
    if (steps.length) {
      this.stepIndex = 0;
      this._restore(steps[0].snapshot, 0);
      this.onSelect(steps[0].touched);
    } else {
      this.stepIndex = -1;
    }
    this.playing = false;
    this.onChange();
  }

  /** Limpa a reprodução (sem tocar no estado atual do modelo). */
  stop() {
    this.steps = [];
    this.stepIndex = -1;
    this.playing = false;
    this.error = null;
    this.positions = new Map();
    this.orientations = new Map();
    this.nodeCircles = new Map();
    this.highlightNodes = new Map();
    if (this._playTimer) {
      clearTimeout(this._playTimer);
      this._playTimer = null;
    }
  }

  /** Chamado por quem arrasta um elemento no canvas (App.js) — mantém
   * `this.positions` em dia com a posição que o usuário escolheu, mesmo
   * arrastando no meio de uma reprodução já em andamento. Só atualiza se o
   * id já é rastreado (arrastar algo fora de uma execução ativa não passa
   * por aqui — o modelo real já guarda a posição normalmente nesse caso). */
  updatePosition(id, x, y) {
    if (!this.positions.has(id)) return;
    const key = this.stableKeys.get(id);
    // pilha (e rótulo que anda com o topo dela): guarda relativo à base (ver
    // `bottom` no comentário da classe)
    const stack = this._stackOf(id, { y }, this.micro);
    const anchor = stack ? { x, y: y + stackHeight(stack.cells.length), bottom: true } : { x, y };
    if (this.stepIndex < 0 || !key) {
      this.positions.set(id, anchor);
      return;
    }
    let frames = this.stepLayout.get(key);
    if (!frames) {
      // 1º arraste deste elemento: congela onde ele estava nos passos
      // anteriores (desde que nasceu) — senão uma execução futura usaria a
      // posição de nascimento DAQUELA execução, que pode ser outra (depende
      // da vista/espaço livre no momento).
      frames = [];
      const born = this.createdAt.get(id) ?? 0;
      const base = this.positions.get(id);
      if (born < this.stepIndex) frames.push({ step: born, ...base });
      this.stepLayout.set(key, frames);
    }
    const existing = frames.find((f) => f.step === this.stepIndex);
    if (existing) {
      delete existing.bottom;
      Object.assign(existing, anchor);
    } else {
      frames.push({ step: this.stepIndex, ...anchor });
      frames.sort((a, b) => a.step - b.step);
    }
  }

  /** Posição de `id` no passo `stepIndex`: o último quadro-chave dele até
   * esse passo, senão a posição de nascimento nesta execução. */
  _positionAt(id, stepIndex) {
    const frames = this.stepLayout.get(this.stableKeys.get(id));
    if (frames) {
      let found = null;
      for (const f of frames) {
        if (f.step > stepIndex) break;
        found = f;
      }
      if (found) return { x: found.x, y: found.y, ...(found.bottom ? { bottom: true } : {}) };
    }
    return this.positions.get(id);
  }

  /** A pilha cuja base ancora a posição do elemento `id` (`n` = ele, ao
   * menos com `y`), no estado `state` (o MicroModel ou um snapshot): o
   * próprio array, se é uma pilha, ou o array de um rótulo que anda com o
   * topo dela. `orientation`, se dada, substitui a do array. */
  _stackOf(id, n, state, orientation) {
    const withOrientation = (arr) => (arr && orientation ? { ...arr, orientation } : arr);
    const arr = withOrientation(state.arrays.get(id));
    if (arr) return isStackArray(arr) ? arr : null;
    const pointer = state.pointers.get(id);
    if (!pointer?.isArrayLabel) return null;
    const owner = withOrientation(state.arrays.get(pointer.labelArrayId));
    return ridesStackTop({ ...pointer, y: n.y }, owner) ? owner : null;
  }

  /** `y` de um elemento a partir da posição guardada — que, pra uma pilha e
   * pro rótulo que anda com ela (`bottom`), é relativa à base: tira a altura
   * da pilha no passo restaurado (`arrays`, as do snapshot). */
  _stackTop(pos, n, arrays) {
    if (!pos.bottom) return pos.y;
    const arr = n.cells ? n : arrays.get(n.labelArrayId);
    return pos.y - stackHeight(arr?.cells.length ?? 0);
  }

  /** Quantas células o array `id` tinha no passo `step` (no passo atual, o
   * próprio modelo). */
  _arrayLenAt(id, step) {
    if (!id) return 0;
    if (step === this.stepIndex) return this.micro.arrays.get(id)?.cells.length ?? 0;
    return this.steps[step]?.snapshot.arrays.get(id)?.cells.length ?? this.micro.arrays.get(id)?.cells.length ?? 0;
  }

  /** Chamado por quem troca a orientação de um array pelo popup de
   * configurações (App#_openMicroArraySettingsPopup) — mesma lógica de
   * `updatePosition`, só que pra orientação em vez de x/y. */
  updateOrientation(id, orientation) {
    if (!this.orientations.has(id)) return;
    this.orientations.set(id, orientation);
    // de/pra pilha: a posição guardada passa a ser a base (ou volta a ser o
    // topo). Cada uma é convertida pela altura do passo a partir do qual
    // vale — e a que vale AGORA, pela altura atual, pra caixa não pular.
    const arr = this.micro.arrays.get(id);
    if (!arr) return;
    this._convertAnchors(id, id, !!this._stackOf(id, arr, this.micro, orientation));
    const label = this.micro.pointers.get(arr.labelPointerId);
    if (label) this._convertAnchors(label.id, id, !!this._stackOf(label.id, label, this.micro, orientation));
  }

  /** Converte as posições guardadas de `id` (a de nascimento e os
   * quadros-chave) pra relativas à base da pilha `arrayId` (`toBottom`) ou de
   * volta pro topo. */
  _convertAnchors(id, arrayId, toBottom) {
    const frames = this.stepLayout.get(this.stableKeys.get(id)) ?? [];
    const current = frames.filter((f) => f.step <= this.stepIndex).at(-1) ?? this.positions.get(id);
    const convert = (entry, step) => {
      if (!entry || !!entry.bottom === toBottom) return;
      const h = stackHeight(this._arrayLenAt(arrayId, entry === current ? this.stepIndex : step));
      if (toBottom) {
        entry.y += h;
        entry.bottom = true;
      } else {
        entry.y -= h;
        delete entry.bottom;
      }
    };
    convert(this.positions.get(id), this.createdAt.get(id) ?? 0);
    frames.forEach((f) => convert(f, f.step));
  }

  /** Idem `updateOrientation`, pra preferência "nós como círculos". */
  updateNodeCircles(id, on) {
    if (this.nodeCircles.has(id)) this.nodeCircles.set(id, !!on);
  }

  /** Idem `updateOrientation`, pra preferência "destacar os nós". */
  updateHighlightNodes(id, on) {
    if (this.highlightNodes.has(id)) this.highlightNodes.set(id, !!on);
  }

  goToStep(i) {
    if (!this.steps.length) return;
    const clamped = Math.max(0, Math.min(i, this.steps.length - 1));
    this.stepIndex = clamped;
    this._restore(this.steps[clamped].snapshot, clamped);
    this.onSelect(this.steps[clamped].touched);
    if (clamped >= this.steps.length - 1) this._pause();
    this.onChange();
  }

  togglePlay() {
    if (!this.steps.length) return;
    this.playing = !this.playing;
    if (this.playing) {
      if (this.stepIndex >= this.steps.length - 1) this.goToStep(0);
      this._schedulePlay();
    } else {
      this._pause();
    }
    this.onChange();
  }

  setSpeed(speed) {
    this.speed = speed;
  }

  _pause() {
    this.playing = false;
    if (this._playTimer) {
      clearTimeout(this._playTimer);
      this._playTimer = null;
    }
  }

  _schedulePlay() {
    if (this._playTimer) clearTimeout(this._playTimer);
    if (!this.playing) return;
    this._playTimer = setTimeout(() => {
      if (this.stepIndex >= this.steps.length - 1) {
        this._pause();
        this.onChange();
        return;
      }
      this.goToStep(this.stepIndex + 1);
      this._schedulePlay();
    }, AUTOPLAY_BASE_MS / this.speed);
  }

  // ---- snapshot/restore do MicroModel (dados lógicos — nunca x/y nem orientação de array) ----

  _snapshot() {
    const dropPos = ({ x, y, ...rest }) => rest;
    const dropArrayPrefs = ({ x, y, orientation, nodeCircles, highlightNodes, ...rest }) => rest;
    return {
      structs: new Map([...this.micro.structs].map(([id, n]) => [id, dropPos(n)])),
      pointers: new Map([...this.micro.pointers].map(([id, n]) => [id, { ...dropPos(n), target: n.target ? { ...n.target } : null }])),
      arrays: new Map([...this.micro.arrays].map(([id, n]) => [id, { ...dropArrayPrefs(n), cells: [...n.cells] }])),
      // célula de dict é um OBJETO ({key,kind,value}, ver MicroModel.js), não
      // um primitivo cru como célula de array — precisa clonar cada célula
      // também, senão duas snapshots comparilhariam a mesma referência de
      // objeto e uma mutação futura (ex: `d[chave]=novoValor`) vazaria pro
      // passado já congelado.
      dicts: new Map([...this.micro.dicts].map(([id, n]) => [id, { ...dropArrayPrefs(n), cells: n.cells.map((c) => ({ ...c })) }])),
      variables: new Map([...this.micro.variables].map(([id, n]) => [id, dropPos(n)])),
      // célula de matriz é uma LINHA (array JS) por vez — clona cada linha,
      // mesmo motivo das células de dict acima.
      matrices: new Map([...this.micro.matrices].map(([id, n]) => [id, { ...dropPos(n), cells: n.cells.map((row) => [...row]) }])),
    };
  }

  /** Registra (só na primeira vez que vê cada id) a posição atual de todo
   * elemento vivo do modelo em `this.positions`, e a orientação de todo
   * array em `this.orientations` — chamado depois de cada passo durante
   * `run()`, então um elemento recém-criado naquele passo já entra com a
   * posição que `createPosition` (com desvio de sobreposição) escolheu pra
   * ele, e o array com a orientação que nasceu tendo. */
  _capturePositions() {
    const note = (map) => {
      map.forEach((n, id) => {
        if (this.positions.has(id)) return;
        // pilha e rótulo que anda com ela: relativo à base (ver comentário da classe)
        const stack = this._stackOf(id, n, this.micro);
        this.positions.set(id, stack ? { x: n.x, y: n.y + stackHeight(stack.cells.length), bottom: true } : { x: n.x, y: n.y });
      });
    };
    note(this.micro.structs);
    note(this.micro.pointers);
    note(this.micro.arrays);
    note(this.micro.dicts);
    note(this.micro.variables);
    note(this.micro.matrices);
    this.micro.arrays.forEach((n, id) => {
      if (!this.orientations.has(id)) this.orientations.set(id, n.orientation);
      if (!this.nodeCircles.has(id)) this.nodeCircles.set(id, !!n.nodeCircles);
      if (!this.highlightNodes.has(id)) this.highlightNodes.set(id, !!n.highlightNodes);
    });
    this.micro.dicts.forEach((n, id) => {
      if (!this.orientations.has(id)) this.orientations.set(id, n.orientation);
    });
  }

  /** Chave estável de cada elemento que aparece pela 1ª vez (ver
   * `stepLayout`): uma "base" que descreve o elemento sem depender do id
   * (tipo + nome + escopo global/chamada) e a ordem de aparição entre os de
   * mesma base — ex: o 3º "leftHalf" criado dentro de uma chamada é sempre
   * "array:call:leftHalf#2" se o programa for o mesmo. Elementos que já
   * existiam antes de rodar entram primeiro, na ordem do modelo. */
  _assignKeys(stepIndex) {
    const scope = (n) => ((n.frameId ?? 'global') === 'global' ? 'global' : 'call');
    const note = (map, baseOf) => {
      map.forEach((n, id) => {
        if (this.stableKeys.has(id)) return;
        const base = baseOf(n);
        const count = this._keyCounts.get(base) ?? 0;
        this._keyCounts.set(base, count + 1);
        this.stableKeys.set(id, `${base}#${count}`);
        this.createdAt.set(id, stepIndex);
      });
    };
    note(this.micro.structs, () => 'struct');
    note(this.micro.arrays, (n) => `array:${scope(n)}:${n.name}`);
    note(this.micro.dicts, (n) => `dict:${scope(n)}:${n.name}`);
    note(this.micro.matrices, (n) => `matrix:${scope(n)}:${n.name}`);
    note(this.micro.variables, (n) => `variable:${scope(n)}:${n.name}`);
    note(this.micro.pointers, (n) => {
      if (n.readCursorKey) return `cursor:${scope(n)}:${n.readCursorKey}`;
      if (n.isArrayLabel || n.isDictLabel || n.isMatrixLabel) return `label:${scope(n)}:${n.label}`;
      return `pointer:${scope(n)}:${n.label}`;
    });
  }

  _restore(snapshot, stepIndex) {
    const withPos = (id, n) => {
      const pos = this._positionAt(id, stepIndex);
      return { ...n, x: pos ? pos.x : 0, y: pos ? this._stackTop(pos, n, snapshot.arrays) : 0 };
    };
    const withArrayPrefs = (id, n) => ({
      ...withPos(id, n),
      cells: [...n.cells],
      orientation: this.orientations.get(id) ?? 'horizontal',
      ...(this.nodeCircles.get(id) && n.kind !== 'arrayref' ? { nodeCircles: true } : {}),
      ...(this.highlightNodes.get(id) && n.kind !== 'arrayref' ? { highlightNodes: true } : {}),
    });
    const withDictPrefs = (id, n) => ({
      ...withPos(id, n),
      cells: n.cells.map((c) => ({ ...c })),
      orientation: this.orientations.get(id) ?? 'horizontal',
    });
    this.micro.structs = new Map([...snapshot.structs].map(([id, n]) => [id, withPos(id, n)]));
    this.micro.pointers = new Map(
      [...snapshot.pointers].map(([id, n]) => {
        const copy = { ...withPos(id, n), target: n.target ? { ...n.target } : null };
        const key = identifierKey(n);
        if (this.pointerVisibility.has(key)) {
          const hidden = this.pointerVisibility.get(key);
          if (n.readCursorKey) copy.readCursorHidden = hidden;
          else if (hidden) copy.hidden = true;
          else delete copy.hidden;
        }
        return [id, copy];
      }),
    );
    this.micro.arrays = new Map([...snapshot.arrays].map(([id, n]) => [id, withArrayPrefs(id, n)]));
    this.micro.dicts = new Map([...snapshot.dicts].map(([id, n]) => [id, withDictPrefs(id, n)]));
    this.micro.variables = new Map(
      [...snapshot.variables].map(([id, n]) => {
        const copy = withPos(id, n);
        if (this.pointerVisibility.has(n.name)) {
          if (this.pointerVisibility.get(n.name)) copy.hidden = true;
          else delete copy.hidden;
        }
        return [id, copy];
      }),
    );
    this.micro.matrices = new Map(
      [...snapshot.matrices].map(([id, n]) => [id, { ...withPos(id, n), cells: n.cells.map((row) => [...row]) }]),
    );
  }
}
