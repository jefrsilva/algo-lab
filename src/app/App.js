import { nextId } from '../core/id.js';
import { MicroModel, MAX_ARRAY_SIZE } from '../core/micro/MicroModel.js';

import {
  MicroCanvasView,
  STRUCT_W,
  STRUCT_H,
  STRUCT_CIRCLE_R,
  PTR_W,
  PTR_H,
  VAR_W,
  VAR_H,
  VAR_HEADER_H,
  structPrevPort,
  structNextPort,
  structNeighborPort,
  structDataRect,
  pointerPort,
  pointerWidth,
  variableWidth,
  variableValueRect,
  arrayLayout,
  arrayHandleRect,
  arrayDividers,
  isVerticalOrientation,
  dictHandleRect,
  matrixHandleRect,
  boxWithHandle,
  dictLayout,
  matrixLayout,
  matrixCellRect,
  labelSize,
  labelCssColor,
  LABEL_PAD_X,
  LABEL_PAD_Y,
  LABEL_LINE_HEIGHT,
  areaHandles,
  GRID_SIZE,
  GRID_DOT,
  CHART_FUNCTIONS,
  CHART_MIN_W,
  CHART_MIN_H,
  CHART_DEFAULT_RANGE,
  CHART_N_LIMITS,
  CHART_Y_LIMITS,
  chartLayout,
  chartReadout,
} from '../render/MicroCanvasView.js';

import { evaluate, assign, assignChain, assignTuple, truthy } from '../interpreter/evaluator.js';
import { parseExpression } from '../interpreter/parser.js';
import { MicroRuntimeAdapter } from './MicroRuntimeAdapter.js';
import { microLayoutKey } from './microLayoutKey.js';
import { MicroProgramRunner } from './MicroProgramRunner.js';
import { alignRects, distributeRects } from './microAlign.js';
import { TREE_GAPS, treeLayout } from './microTreeLayout.js';

import { PlaybackControls } from '../ui/PlaybackControls.js';
import { NodePopup } from '../ui/NodePopup.js';
import { ArraySettingsPopup } from '../ui/ArraySettingsPopup.js';
import { InlineValueEditor } from '../ui/InlineValueEditor.js';
import { ModeToolbar } from '../ui/ModeToolbar.js';
import { AlignToolbar } from '../ui/AlignToolbar.js';
import { TreeLayoutToolbar } from '../ui/TreeLayoutToolbar.js';
import { CodeEditor } from '../ui/CodeEditor.js';
import { CallTree } from '../ui/CallTree.js';
import { CanvasTitle } from '../ui/CanvasTitle.js';
import { LabelSettingsPopup } from '../ui/LabelSettingsPopup.js';
import { ChartSettingsPopup } from '../ui/ChartSettingsPopup.js';
import { AppMenu } from '../ui/AppMenu.js';
import { Dialog } from '../ui/Dialog.js';
import { ConsoleWindow } from '../ui/ConsoleWindow.js';
import { QuickActionPalette } from '../ui/QuickActionPalette.js';
import { SettingsDialog } from '../ui/SettingsDialog.js';
import { applyTheme } from './theme.js';
import { getSetting, setSetting, SETTINGS_DEFAULTS } from './settings.js';

/** Modos da barra de ferramentas inferior do canvas (ver
 * App#_buildLayout/_setMicroMode). */
const MICRO_MODES = [
  { id: 'select', label: 'Selecionar / Mover', shortcut: '1 / V' },
  { id: 'text', label: 'Texto (cor: Alt+1…Alt+0)', shortcut: '2 / T' },
  { id: 'area', label: 'Área hachurada (cor: Alt+1…Alt+0, grid: G)', shortcut: '3 / R' },
  { id: 'chart', label: 'Gráfico Big-O (botão direito: funções exibidas; mouse sobre ele: lê f(n))', shortcut: '4 / B' },
  {
    id: 'link',
    label: 'Ligar nós (clique no nó de origem e depois no de destino; de novo desliga — Shift + arrastar também liga)',
    shortcut: '5 / L',
  },
];

/** Paleta das áreas hachuradas (modo "Área") — Alt+1…Alt+9 e Alt+0 (a 10ª),
 * ver _applyMicroPaletteColor. Tons médios, legíveis tanto no tema escuro quanto
 * no claro (a área é translúcida, então a cor sempre aparece atenuada). */
const AREA_COLORS = [
  '#3b82f6', // 1 azul
  '#ef4444', // 2 vermelho
  '#22c55e', // 3 verde
  '#eab308', // 4 amarelo
  '#a855f7', // 5 roxo
  '#f97316', // 6 laranja
  '#06b6d4', // 7 ciano
  '#ec4899', // 8 rosa
  '#a16207', // 9 marrom
  '#94a3b8', // 0 cinza
];
/** Tamanho de uma área criada com um clique simples (sem arrastar), em
 * células do grid — arrastando, o tamanho é o do retângulo desenhado. */
const AREA_DEFAULT_CELLS = { w: 6, h: 4 };
/** Lado das alças de redimensionamento, em px de TELA (não muda com o zoom). */
const AREA_HANDLE_PX = 10;

/** Gráfico de complexidade (modo "Gráfico", ver `_createMicroChart`): tamanho
 * de um criado com clique simples, e os títulos com que nasce — sem nenhuma
 * função marcada; o botão direito escolhe quais exibir. */
const CHART_DEFAULT_SIZE = { width: 400, height: 280 };
const CHART_DEFAULT_X_LABEL = 'Número de elementos (n)';
const CHART_DEFAULT_Y_LABEL = 'Tempo';
/** Limite de eixo vindo de um projeto salvo: número dentro de `limits`, ou o padrão. */
const clampChartNumber = (v, limits) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(limits.min, Math.min(n, limits.max)) : CHART_DEFAULT_RANGE;
};

const LABEL_DEFAULT_COLOR = '#f0f8ff'; // "gelo" — quase branco, com leve tom azulado
const LABEL_DEFAULT_FONT_SIZE = 16;
/** Paleta das labels de texto (mesmos atalhos Alt+1…Alt+0 das áreas) — as
 * mesmas cores, só que a 10ª (Alt+0) é a cor padrão do texto, que acompanha
 * o tema (ver labelCssColor em MicroCanvasView.js), em vez do cinza. */
const TEXT_COLORS = [...AREA_COLORS.slice(0, 9), LABEL_DEFAULT_COLOR];
/** Paleta dos elementos do modelo (struct/ponteiro/array/dict/matriz/
 * variável) — mesmos atalhos; a 10ª (Alt+0, `null`) tira a cor manual e
 * devolve o elemento à cor padrão do tema. */
const ELEMENT_COLORS = [...AREA_COLORS.slice(0, 9), null];

const EMPTY_SET = new Set();
const CONSOLE_MAX_LINES = 3; // linhas de saída visíveis no console (ver _renderConsoleLines)
const CLICK_THRESHOLD = 4;
// distância entre um elemento recém-criado e o ponteiro dele (ver
// `_microPointerSpotNear`) — folga pra seta, com a ponta (15), aparecer
const MICRO_POINTER_GAP = 48;

export class App {
  constructor(root) {
    this.root = root;
    // diálogo modal centralizado (ver src/ui/Dialog.js) — substitui
    // window.confirm/window.alert nativos em toda a aplicação. Montado sobre
    // document.body (não `root`) porque precisa cobrir a tela inteira,
    // qualquer que seja o estado do resto do layout.
    this.dialog = new Dialog();

    // o app abre com canvas e código vazios
    this.micro = new MicroModel();
    this.microViewport = { tx: 0, ty: 0, scale: 1 };
    this.microMode = 'select'; // 'select' | 'text' | 'area' | 'chart' | 'link' — modos da barra inferior (ver MICRO_MODES)
    // preferências de tela (ver settings.js / _applySetting) — salvas no
    // navegador, editáveis pela janela de Configurações e pelos atalhos
    this.codePanelHidden = getSetting('codePanelHidden'); // Ctrl+H, ver _toggleCodePanel
    this.microSimplifiedNodes = getSetting('simplifiedNodes'); // Ctrl+A, ver _toggleMicroSimplifiedNodes
    this.microFullNames = getSetting('fullNames'); // N, ver _toggleMicroFullNames — padrão: nomes truncados
    this.microSelectedId = null;
    // seleção em área (modo Selecionar, arraste a partir de espaço vazio) —
    // além do `microSelectedId` de sempre (clique único); os dois convivem:
    // quando a área seleciona só 1 elemento, `microSelectedId` também é
    // preenchido, pelo mesmo motivo de sempre (edges "linked" etc).
    this.microSelectedIds = new Set();
    this.microLabels = new Map(); // id -> {id,x,y,text,color,fontSize} — labels do modo "Texto"
    // áreas hachuradas do modo "Área" — mesmo status das labels: só canvas,
    // fora do MicroModel e da reprodução do modo Executar.
    this.microAreas = new Map(); // id -> {id,x,y,width,height,color}
    // gráficos de complexidade Big-O (modo "Gráfico") — mesmo status das
    // áreas: só canvas, fora do MicroModel e da reprodução do modo Executar.
    this.microCharts = new Map(); // id -> {id,x,y,width,height,xLabel,yLabel,functions:string[],nMax,yMode:'manual'|'auto',yMax}
    this._microEditingChartAxis = null; // {id, axis:'x'|'y'} título de eixo em edição in place
    // cor manual dos elementos do modelo (Alt+1…Alt+0 com o elemento
    // selecionado, ver _applyMicroPaletteColor) — ex.: marcar nós já
    // visitados. Fora do MicroModel de propósito, pelo mesmo motivo das
    // posições: a reprodução do modo Executar restaura snapshots do modelo a
    // cada passo (MicroProgramRunner#_restore), mas preserva os ids — então
    // um mapa por id sobrevive a avançar/voltar passos sem ser desfeito.
    this.microColors = new Map(); // id -> cor CSS
    // janelas deslizantes ("new sliding window", ver `_quickNewSlidingWindow`):
    // pares de cursores agrupados — selecionar um seleciona o outro, e as
    // células do array entre os dois acendem. Também fora do MicroModel, e
    // por CHAVE estável do cursor (ver `_microPointerWindowKey`), não por id:
    // vale em qualquer passo da reprodução, numa nova execução (que recria
    // os cursores com outros ids) e no projeto salvo. A cor da janela
    // (`color`, cor CSS ou null = a padrão do tema) é a cor ÚNICA dos dois
    // cursores e do colchete — guardada aqui, e não em `microColors` (por
    // id), pra sobreviver às mesmas coisas que a janela (ver
    // `_microEffectiveColors`).
    this.microWindows = []; // {a: chave, b: chave, color: cor CSS | null}
    this.microAreaColor = AREA_COLORS[0]; // cor atual (Alt+1…Alt+0)
    this.microLabelColor = LABEL_DEFAULT_COLOR; // cor das próximas labels (Alt+1…Alt+0 no modo Texto)
    this._microEditingLabelId = null; // label em edição in place (texto some por baixo do editor)
    this.microAreaSnap = getSetting('areaSnap'); // encaixe no grid (G, ver _toggleMicroAreaSnap)
    // posição escolhida pelo usuário pra cada elemento NOMEÁVEL do modo micro
    // (array/dict/ponteiro/variável/cursor de leitura — ver microLayoutKey.js),
    // por uma chave ESTÁVEL (nome, não id — id muda a cada criação). Ao
    // contrário de `MicroProgramRunner#positions` (só dura uma corrida, por
    // id), este mapa nunca é limpo entre execuções — só ao começar/carregar
    // outro projeto (ver _newProject/_applyLoadedProject) — é o que faz
    // apagar um elemento e rodar a linha de novo (ou rodar o programa inteiro
    // de novo) reproduzir a MESMA posição que o usuário já tinha ajustado.
    this.microLayout = new Map(); // key -> {x,y}
    // ids destacados por uma instrução do editor de código (leituras via
    // cursor de array + a escrita final de um passo) — além, não em vez, de
    // `microSelectedId` (que continua sendo o clique manual do usuário).
    this.microRunHighlightIds = new Set();
    this.microRunPrimaryId = null; // alvo principal do passo atual (ver _activeRunHighlightIds)
    // aba selecionada manualmente na árvore de chamadas (ver
    // `_onSelectCallFrame`) — `null` significa "segue o passo atual da
    // reprodução automaticamente" (ver `_renderMicroOnly`).
    this.manualFrameId = null;
    this._microPointer = null;
    // leitura de gráfico com o mouse sobre ele (ver `_updateMicroChartReadout`):
    // estado transitório de hover — fora do MicroModel, dos snapshots e do
    // projeto salvo. `_microHoverScreen` é a última posição do mouse sobre o
    // canvas (pra reler depois de um zoom com o mouse parado).
    this._microHoverScreen = null;
    this._microChartReadout = null; // { chartId, n, value, fnId, color, x, y } | null
    this._microDragId = null;
    this._microDragPos = null;
    this._microPortDrag = null;
    // ligação da ferramenta "Ligar nós" em andamento — { fromId, field
    // ('prev'|'next', ou null num nó de grafo), toPt, targetId|null,
    // pending } — `pending` quando começou por clique (espera o clique no
    // destino, ver `_onMicroLinkPointerDown`), senão é um Shift + arraste
    // (ver `_startMicroLinkDrag`)
    this._microLinkDraft = null;
    // metade do nó sob o mouse com a ferramenta "Ligar nós" e nenhuma
    // ligação em andamento — { id, field }, ver `_updateMicroLinkHover`
    this._microLinkHover = null;
    this._microGroupDragPositions = null; // Map<id,{x,y}> durante um arraste de grupo (seleção múltipla)
    this._microSelectionPreview = null; // {x0,y0,x1,y1} durante um arraste de seleção em área
    // o Set `microSelectedIds` de uma seleção que COMEÇOU por retângulo (sem
    // ordem de clique) — alinhar usa os extremos do grupo em vez do primeiro
    // selecionado, ver `_microSelectionAnchor`
    this._microAnchorlessSelection = null;
    this._spaceDown = false; // barra de espaço — botão esquerdo passa a mover o canvas enquanto pressionada

    this._boundKeyDown = (e) => this._onKeyDown(e);
    this._boundKeyUp = (e) => this._onKeyUp(e);
    window.addEventListener('keydown', this._boundKeyDown);
    window.addEventListener('keyup', this._boundKeyUp);
    // solta a barra de espaço "presa" se a janela perder o foco no meio do
    // pressionamento (ex: alt-tab) — sem isso o botão esquerdo continuaria
    // movendo o canvas indefinidamente.
    window.addEventListener('blur', () => {
      this._setSpaceDown(false);
      this._setMicroChartReadout(null);
    });

    this._microBoundMove = (e) => this._onMicroPointerMoveWindow(e);
    this._microBoundUp = (e) => this._onMicroPointerUpWindow(e);

    this._buildLayout();
    this._resetMicroViewport();
    this.renderAll();
  }

  _buildLayout() {
    this.root.innerHTML = '';
    const shell = document.createElement('div');
    shell.className = 'app-shell';

    // Sem barra de título — o app abre direto no canvas. "Centralizar vista"
    // e o menu viram botões flutuantes no canto do canvas (ver mais abaixo,
    // depois de microContainer existir), não elementos de header.
    const main = document.createElement('main');
    main.className = 'main-grid';

    const canvasArea = document.createElement('section');
    canvasArea.className = 'canvas-area';
    const microSplit = document.createElement('div');
    microSplit.className = 'micro-split';
    const microContainer = document.createElement('div');
    microContainer.className = 'canvas-container micro-container';
    const callTreeContainer = document.createElement('div');
    callTreeContainer.className = 'call-tree-panel';
    callTreeContainer.hidden = true;
    const codeEditorPanel = document.createElement('div');
    codeEditorPanel.className = 'code-editor-panel';
    const codeEditorContainer = document.createElement('div');
    codeEditorContainer.className = 'code-editor-inner';
    const microRunBarContainer = document.createElement('div');
    microRunBarContainer.className = 'micro-run-bar';
    microRunBarContainer.hidden = true;
    // Console ("print(...)") fica embaixo do canvas, não no painel de código:
    // `microMain` empilha canvas + console numa coluna, e é ELA (não o
    // canvas sozinho) o lado esquerdo que a divisória redimensiona. O
    // console em si (ConsoleWindow, montado mais abaixo) também pode virar
    // uma janela flutuante sobre o canvas (Alt+C; C mostra/oculta, ver _onKeyDown).
    const microMain = document.createElement('div');
    microMain.className = 'micro-main';
    microMain.appendChild(microContainer);
    codeEditorPanel.appendChild(codeEditorContainer);
    codeEditorPanel.appendChild(microRunBarContainer);
    // borda inferior arrastável do painel de código: reserva uma faixa vazia
    // embaixo (ex: janela da webcam numa gravação) — ver _setupCodeBottomResizer
    const codeBottomResizer = document.createElement('div');
    codeBottomResizer.className = 'code-bottom-resizer';
    codeBottomResizer.title = 'Arraste para limitar a altura do código (duplo clique: restaurar)';
    const codeBottomReserved = document.createElement('div');
    codeBottomReserved.className = 'code-bottom-reserved';
    codeEditorPanel.appendChild(codeBottomResizer);
    codeEditorPanel.appendChild(codeBottomReserved);
    this.codeBottomReserved = codeBottomReserved;
    this._setupCodeBottomResizer(codeEditorPanel, codeBottomResizer);
    const splitResizer = document.createElement('div');
    splitResizer.className = 'split-resizer';
    splitResizer.title = 'Arraste para redimensionar';
    microSplit.appendChild(microMain);
    microSplit.appendChild(callTreeContainer);
    microSplit.appendChild(splitResizer);
    microSplit.appendChild(codeEditorPanel);
    this._setupSplitResizer(microSplit, microMain, splitResizer);
    canvasArea.appendChild(microSplit);

    main.appendChild(canvasArea);

    shell.appendChild(main);
    this.root.appendChild(shell);

    this.microSplit = microSplit;
    this.microSplit.classList.toggle('code-panel-hidden', this.codePanelHidden);
    this.microContainer = microContainer;
    this.codeEditorPanel = codeEditorPanel;
    this.splitResizer = splitResizer;
    this.callTreeContainer = callTreeContainer;
    this.callTree = new CallTree(callTreeContainer, {
      onSelectFrame: (frameId) => this._onSelectCallFrame(frameId),
      onModeChange: () => {
        this._syncCallTreeButton();
        this.settingsDialog?.refresh();
      },
    });
    this.microView = new MicroCanvasView(microContainer);
    this.microCanvasTitle = new CanvasTitle(microContainer, { placeholder: 'Sem título' });
    this.microPopup = new NodePopup(microContainer);
    this.microArraySettingsPopup = new ArraySettingsPopup(microContainer);
    this.microDictSettingsPopup = new ArraySettingsPopup(microContainer);
    this.microMatrixSettingsPopup = new ArraySettingsPopup(microContainer);
    this.microLabelSettingsPopup = new LabelSettingsPopup(microContainer);
    this.microChartSettingsPopup = new ChartSettingsPopup(microContainer);
    this.microInlineEditor = new InlineValueEditor(microContainer);
    this.microQuickActions = new QuickActionPalette(microContainer);
    this.microRuntime = new MicroRuntimeAdapter(this.micro, {
      createPosition: (kind, size, layoutKey, near) => this._microCreatePosition(kind, size, layoutKey, near),
      onChange: () => this._renderMicroOnly(),
      onArrayCreated: (node, opts) => this._createArrayLabelPointer(node, opts),
      onDictCreated: (node, opts) => this._createDictLabelPointer(node, opts),
      onMatrixCreated: (node, opts) => this._createMatrixLabelPointer(node, opts),
    });
    this.microRunBarContainer = microRunBarContainer;
    this.microConsole = new ConsoleWindow({
      dockHost: microMain,
      floatHost: microContainer,
      maxDockedLines: CONSOLE_MAX_LINES,
      onModeChange: () => this.settingsDialog?.refresh(),
      onClear: () => this._clearMicroConsole(),
    });
    // linhas da reprodução escondidas pelo botão de limpar (ver _clearMicroConsole)
    this.microConsoleClearedLines = 0;
    this.microPlayback = new PlaybackControls(microRunBarContainer, {
      goToStep: (i) => this.microRunner.goToStep(i),
      togglePlay: () => this.microRunner.togglePlay(),
      // sem _applySetting de propósito: re-renderizar a barra aqui trocaria
      // o slider no meio do arraste
      setSpeed: (speed) => {
        this.microRunner.setSpeed(setSetting('playbackSpeed', speed));
        this.settingsDialog?.refresh();
      },
    });
    this.microRunner = new MicroProgramRunner(this.micro, {
      // o passo atual da reprodução destaca TODOS os elementos que ele
      // tocou (leituras via cursor de array + a escrita final), igual o modo
      // manual já faz a cada Ctrl+Enter — precisa rodar ANTES do render
      // (_renderMicroOnly calcula selected/linked no começo).
      onSelect: (touched) => this._applyMicroTouchHighlight(touched),
      // precisa redesenhar o canvas inteiro (não só a barra de reprodução) —
      // goToStep troca os dados do modelo (restaura um snapshot antigo) sem
      // passar pelo MicroRuntimeAdapter, então nada mais dispara o re-render
      // do SVG nesse caminho. _renderMicroOnly já chama _renderMicroRunBar
      // no final, então isso cobre os dois.
      onChange: () => this._renderMicroOnly(),
    });
    this.microRunner.setSpeed(getSetting('playbackSpeed'));
    this.codeEditor = new CodeEditor(codeEditorContainer, {
      onSelectName: (name) => this._selectMicroByName(name),
      onExecuteStatement: (ast) => this._executeStatement(ast),
      onEvaluateCondition: (ast) => this._evaluateCondition(ast),
      onRun: (source) => this._runMicroProgram(source),
      onModeChange: (mode) => this._onCodeEditorModeChange(mode),
      // console acompanha o tamanho de texto escolhido no painel de código
      onFontSizeChange: (px) => {
        this.microConsole.setFontSize(px);
        setSetting('codeFontSize', px);
        this.settingsDialog?.refresh();
      },
      onToggleCursor: (key) => this._toggleMicroReadCursor(key),
      onTogglePointer: (name) => this._toggleMicroPointerVisibility(name),
      onCodeChange: () => this._onMicroCodeEdited(),
      initialCode: '', // canvas e código começam vazios (ver constructor)
      initialFontSize: getSetting('codeFontSize'),
    });
    // mostrar/ocultar a pilha de chamadas direto da barra do código (também
    // no menu ☰) — só no modo Simulação, o único que tem chamadas
    this.callTreeButton = this.codeEditor.addToolbarButton({
      title: 'Mostrar/ocultar a pilha de chamadas',
      html: '<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><rect x="2.5" y="2" width="11" height="3" rx="1"/><rect x="4.5" y="6.5" width="9" height="3" rx="1"/><rect x="6.5" y="11" width="7" height="3" rx="1"/></svg>',
      onClick: () => this.callTree.toggleHidden(),
    });
    this._syncCallTreeButton();

    // um gesto (clique/arrasto) começando esconde a leitura do gráfico
    this.microView.svg.addEventListener('pointerdown', () => this._setMicroChartReadout(null));
    this.microView.svg.addEventListener('pointerdown', (e) => this._onMicroPointerDown(e));
    this.microView.svg.addEventListener('pointermove', (e) => this._onMicroHoverMove(e));
    this.microView.svg.addEventListener('pointerleave', () => {
      this._microHoverScreen = null;
      this._setMicroChartReadout(null);
      if (this._microLinkHover) {
        this._microLinkHover = null;
        this._renderMicroOnly();
      }
    });
    this.microView.svg.addEventListener('wheel', (e) => {
      this._onMicroWheel(e);
      this._updateMicroChartReadout(e.buttons === 0); // o zoom mudou o que está sob o mouse
    }, { passive: false });
    this.microView.svg.addEventListener('dblclick', (e) => this._onMicroDblClick(e));
    this.microView.svg.addEventListener('contextmenu', (e) => this._onMicroContextMenu(e));
    this.microView.svg.addEventListener('dragstart', (e) => e.preventDefault());
    // botão do meio dispara o autoscroll nativo do browser ao pressionar —
    // atrapalha o "mover o canvas" que ele passa a fazer aqui (ver
    // _onMicroPointerDown).
    this.microView.svg.addEventListener('mousedown', (e) => { if (e.button === 1) e.preventDefault(); });
    // torna o canvas focável pra ter sentido falar em "foco do teclado está
    // na visualização" (Tab pro código, ver _onKeyDown) — sem isso um <svg>
    // nunca recebe foco de teclado, só clique.
    this.microView.svg.tabIndex = 0;

    this.microContainer.dataset.mode = this.microMode;

    // barra de ferramentas do modo micro (Selecionar/Texto/Área/Gráfico),
    // canto inferior do canvas (`.mode-toolbar-host`/`.mode-toolbar`).
    const microModeToolbarHost = document.createElement('div');
    microModeToolbarHost.className = 'mode-toolbar-host';
    microContainer.appendChild(microModeToolbarHost);
    const modeToolbarEl = document.createElement('div');
    microModeToolbarHost.appendChild(modeToolbarEl);
    this.microModeToolbar = new ModeToolbar(modeToolbarEl, { setMode: (m) => this._setMicroMode(m) }, MICRO_MODES);
    // logo acima dela, lado a lado no mesmo host: alinhar/distribuir, só com
    // seleção múltipla (ver AlignToolbar.js e `_runMicroAlignAction`), e
    // organizar como árvore, só com um TreeNode selecionado (ver
    // TreeLayoutToolbar.js e `_runMicroTreeLayout`)
    const selectionToolbarsHost = document.createElement('div');
    selectionToolbarsHost.className = 'align-toolbar-host';
    microModeToolbarHost.appendChild(selectionToolbarsHost);
    const alignToolbarEl = document.createElement('div');
    selectionToolbarsHost.appendChild(alignToolbarEl);
    this.microAlignToolbar = new AlignToolbar(alignToolbarEl, { run: (action) => this._runMicroAlignAction(action) });
    const treeToolbarEl = document.createElement('div');
    selectionToolbarsHost.appendChild(treeToolbarEl);
    this.microTreeToolbar = new TreeLayoutToolbar(treeToolbarEl, { run: (orientation) => this._runMicroTreeLayout(orientation) });

    // canto superior direito: centralizar vista (agora reenquadra TODO o
    // conteúdo do canvas, em vez de só recentralizar na origem — ver
    // _fitMicroViewport).
    const topRightControls = document.createElement('div');
    topRightControls.className = 'canvas-top-right-controls';
    const fitBtn = document.createElement('button');
    fitBtn.type = 'button';
    fitBtn.className = 'canvas-icon-btn';
    fitBtn.title = 'Centralizar vista';
    fitBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4"/>
    </svg>`;
    fitBtn.addEventListener('click', () => this._fitMicroViewport());
    topRightControls.appendChild(fitBtn);
    microContainer.appendChild(topRightControls);

    // canto inferior esquerdo: logo (cor por tema, ver --logo em variables.css)
    const logo = document.createElement('div');
    logo.className = 'canvas-logo';
    logo.setAttribute('aria-hidden', 'true');
    logo.innerHTML = `<svg viewBox="0 0 25.5028 31.7088" width="100%" height="100%">
      <path d="M21.5357 31.7088L15.2591 5.60453C15.061 4.81207 14.8015 4.3029 14.4701 4.04831C14.135 3.79014 13.5765 3.66464 12.7514 3.66464C11.9263 3.66464 11.3678 3.79014 11.0327 4.04831C10.7012 4.30648 10.4418 4.81566 10.2436 5.60453L3.97062 31.7088H0L6.49639 4.67582C6.8531 3.28096 7.61696 2.13711 8.76274 1.28728C9.91213 0.433876 11.2525 0 12.7514 0C14.2503 0 15.5906 0.433876 16.74 1.28728C17.8858 2.14069 18.646 3.28096 19.0064 4.68299L25.5028 31.7088H21.5321H21.5357Z" fill="currentColor"/>
    </svg>`;
    microContainer.appendChild(logo);

    // janela de Configurações (item do menu ☰) — ver _applySetting
    this.settingsDialog = new SettingsDialog({
      getValues: () => this._settingsValues(),
      onChange: (key, value) => this._applySetting(key, value),
      onReset: () => this._resetSettings(),
    });

    // canto superior esquerdo: menu (projeto, ações rápidas, configurações)
    const menuHost = document.createElement('div');
    menuHost.className = 'canvas-top-left-controls';
    microContainer.appendChild(menuHost);
    this.appMenu = new AppMenu(menuHost, {
      items: [
        { id: 'new', label: 'Novo projeto' },
        { id: 'save', label: 'Salvar projeto' },
        { id: 'load', label: 'Carregar projeto' },
        { separator: true },
        { id: 'quick-actions', label: 'Ações rápidas (Ctrl+Espaço)' },
        { separator: true },
        { id: 'settings', label: 'Configurações…' },
      ],
      onSelect: (id) => {
        if (id === 'new') this._newProject();
        else if (id === 'save') this._saveProject();
        else if (id === 'load') this._loadProject();
        else if (id === 'quick-actions') this._openQuickActions({ showAll: true });
        else if (id === 'settings') this.settingsDialog.open();
      },
    });
  }

  _seedMicroExample() {
    const n1 = this.micro.addStruct(-260, -40, 10);
    const n2 = this.micro.addStruct(-80, -40, 24);
    const n3 = this.micro.addStruct(100, -40, 37);
    this.micro.setField(n1.id, 'next', n2.id);
    this.micro.setField(n2.id, 'prev', n1.id);
    this.micro.setField(n2.id, 'next', n3.id);
    this.micro.setField(n3.id, 'prev', n2.id);
    const head = this.micro.addPointer(-260, -150, 'head');
    this.micro.setPointerTarget(head.id, { kind: 'struct', id: n1.id });
    const tail = this.micro.addPointer(100, -150, 'tail');
    this.micro.setPointerTarget(tail.id, { kind: 'struct', id: n3.id });
  }

  /** Atalhos de teclado do modo micro (único modo alcançável pela UI, ver
   * constructor) + a barra de espaço, que vira "modificador de pan": com ela
   * pressionada, o cursor vira a mão de pan e o botão esquerdo passa a mover
   * o canvas em vez de selecionar/arrastar elementos (ver _onMicroPointerDown
   * e `_setSpaceDown`). */
  _onKeyDown(e) {
    // janela de Configurações é modal: ela mesma trata Esc/Tab, e nenhum
    // atalho do app vale por trás dela
    if (this.settingsDialog.isOpen) return;
    // ligação pendente da ferramenta "Ligar nós" (ver
    // `_onMicroLinkPointerDown`): Tab troca o ponteiro (prev↔next,
    // left↔right) e Esc cancela — antes do Tab-pro-código logo abaixo, e
    // só com o foco fora de campos de texto/do editor
    if (this._microLinkDraft?.pending && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const t = e.target?.tagName;
      const typing = t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT' || e.target?.isContentEditable;
      if (!typing && e.key === 'Tab' && this._toggleMicroLinkField()) {
        e.preventDefault();
        return;
      }
      if (!typing && e.key === 'Escape') {
        e.preventDefault();
        this._cancelMicroLink();
        return;
      }
    }
    // Tab com o foco FORA do painel de código pula direto pro editor — MUITO
    // mais cômodo que o Tab "de navegador" (que passaria por cada botão da
    // barra/menu antes de chegar lá). "Fora" é qualquer coisa: o canvas, um
    // editor inline (valor de um nó, texto de uma label), os botões do
    // canvas, a árvore de chamadas, o console — e também NADA focado (o
    // <body>), que é onde o foco fica ao abrir a página, depois de clicar no
    // console encaixado (texto não focável) ou de escolher um item do menu
    // ☰ (que some). Antes isso só valia com o foco DENTRO do canvas, e esses
    // casos caíam no Tab do navegador. Exceções: diálogo aberto (Tab circula
    // nos botões dele), painel de código oculto (Ctrl+H — não há pra onde
    // ir), e popups de configurações com vários campos (array/dict/label —
    // eles mesmos seguram o Tab pra pular entre os campos, ver
    // ArraySettingsPopup/LabelSettingsPopup). Dentro do painel de código, o
    // próprio editor trata Tab/Shift+Tab (indentação) e os botões seguem o
    // Tab do navegador.
    if (
      e.key === 'Tab' &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      !this.dialog.isOpen &&
      !this.codePanelHidden &&
      !this.codeEditorPanel.contains(document.activeElement)
    ) {
      e.preventDefault();
      this.codeEditor.textarea.focus();
      return;
    }
    // Ctrl+,/Ctrl+. — voltar/avançar um passo da reprodução do modo
    // "Executar" (ver MicroProgramRunner). De propósito ANTES do `isTyping`
    // abaixo: precisa funcionar mesmo com o foco no editor de código (onde o
    // usuário passa a maior parte do tempo enquanto acompanha a reprodução),
    // e `CodeEditor#_onKeyDown` não intercepta Ctrl+,/Ctrl+. (só Ctrl+Enter/
    // Ctrl+Seta), então o evento chega até aqui normalmente.
    if ((e.key === ',' || e.key === '.') && e.ctrlKey && !e.metaKey && !e.altKey && !this.microPopup.isOpen && !this.dialog.isOpen) {
      e.preventDefault();
      this._stepMicroPlayback(e.key === ',' ? -1 : 1);
      return;
    }
    // Ctrl+H — oculta/mostra o painel de código/execução (editor + barra de
    // reprodução + console), mesmo espírito do Ctrl+,/Ctrl+. acima: precisa
    // funcionar com o foco em qualquer lugar (inclusive dentro do próprio
    // editor de código), por isso também fica ANTES do `isTyping` abaixo.
    // Ctrl+,/Ctrl+. continuam avançando/voltando passos normalmente com o
    // painel oculto (ver _toggleCodePanel).
    if (e.key.toLowerCase() === 'h' && e.ctrlKey && !e.metaKey && !e.altKey && !this.microPopup.isOpen && !this.dialog.isOpen) {
      e.preventDefault();
      this._toggleCodePanel();
      return;
    }
    // Ctrl+Espaço — caixa de quick action (ver `_openQuickActions`). Também
    // ANTES do `isTyping`: vale com o foco no editor de código. Precisa vir
    // antes do Espaço sozinho logo abaixo (que segura o pan do canvas).
    if (e.code === 'Space' && e.ctrlKey && !e.metaKey && !e.altKey && !this.microPopup.isOpen && !this.dialog.isOpen) {
      e.preventDefault();
      this._openQuickActions();
      return;
    }
    const tag = e.target?.tagName;
    const isTyping = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    if (e.code === 'Space' && !isTyping) {
      this._setSpaceDown(true);
      e.preventDefault(); // barra de espaço não deve rolar a página
      return;
    }
    if (isTyping || this.microPopup.isOpen) return;
    // Ctrl+A — alterna a visualização simplificada dos nós de estrutura
    // (círculo só com "data", ver _toggleMicroSimplifiedNodes). DEPOIS do
    // `isTyping` acima (ao contrário de Ctrl+H/Ctrl+,/Ctrl+.) de propósito:
    // com o foco no editor de código (ou em qualquer campo de texto), Ctrl+A
    // precisa continuar sendo "selecionar tudo" do navegador, não esse
    // atalho — só dispara com o foco em QUALQUER outro lugar (o canvas, um
    // botão...).
    if (e.key.toLowerCase() === 'a' && e.ctrlKey && !e.metaKey && !e.altKey && !this.dialog.isOpen) {
      e.preventDefault();
      this._toggleMicroSimplifiedNodes();
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault(); // Backspace sem estar num campo de texto não deve voltar a página
      this._deleteMicroSelection();
      return;
    }
    // Alt+1…Alt+9, Alt+0 — cor das áreas/labels (ver _applyMicroPaletteColor)
    const paletteIndex = this._paletteIndexFromKey(e);
    if (paletteIndex != null) {
      e.preventDefault();
      this._applyMicroPaletteColor(paletteIndex);
      return;
    }
    // Enter com uma única label selecionada: edita o texto no lugar
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      const label = this._microSingleSelectedLabel();
      if (label) {
        e.preventDefault();
        this._editMicroLabelInPlace(label);
        return;
      }
    }
    // Alt+C — console na barra inferior x janela flutuante (C sozinho mostra/
    // oculta, ver abaixo). Pelo `e.code`: no macOS Alt+C produz "ç".
    if (e.code === 'KeyC' && e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      e.preventDefault();
      this._applySetting('consoleFloating', !this.microConsole.floating);
      // trocar a posição de um console oculto não teria efeito visível
      if (this.microConsole.userHidden) this._applySetting('consoleHidden', false);
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key.toLowerCase();
    if (key === '1' || key === 'v') this._setMicroMode('select');
    else if (key === '2' || key === 't') this._setMicroMode('text');
    else if (key === '3' || key === 'r') this._setMicroMode('area');
    else if (key === '4' || key === 'b') this._setMicroMode('chart');
    else if (key === '5' || key === 'l') this._setMicroMode('link');
    else if (key === 'g') this._toggleMicroAreaSnap();
    else if (key === 'n') this._toggleMicroFullNames();
    else if (key === 'c') this._applySetting('consoleHidden', !this.microConsole.userHidden);
  }

  /** Alterna entre nomes de ponteiros/variáveis truncados (padrão, até
   * NAME_MAX_CHARS caracteres — o nome inteiro fica no tooltip) e completos,
   * com a caixa alargando pra caber (tecla N ou item do menu ☰). Só
   * apresentação, igual ao Ctrl+A: não mexe no modelo — larguras/pinos/
   * hit-tests saem de `pointerWidth`/`variableWidth` (MicroCanvasView.js). */
  _toggleMicroFullNames() {
    this._applySetting('fullNames', !this.microFullNames);
  }

  /** Liga/desliga o encaixe das áreas hachuradas no grid (tecla G ou item do
   * menu ☰) — vale pra criar, mover e redimensionar áreas. Shift durante o
   * arraste inverte a preferência só naquele gesto (ver _microAreaFree). */
  _toggleMicroAreaSnap() {
    this._applySetting('areaSnap', !this.microAreaSnap);
  }

  // ---- configurações (preferências de tela, ver settings.js) ----

  /** Valores atuais de todas as configurações, pra janela de Configurações. */
  _settingsValues() {
    const values = {};
    Object.keys(SETTINGS_DEFAULTS).forEach((key) => {
      values[key] = getSetting(key);
    });
    return values;
  }

  /** Único caminho pra mudar uma configuração — janela de Configurações e
   * atalhos de teclado (G, N, C, Ctrl+A, Ctrl+H) passam por aqui: aplica na
   * tela, grava no navegador (settings.js) e atualiza a janela se aberta. */
  _applySetting(key, value) {
    switch (key) {
      case 'theme':
        applyTheme(value);
        break;
      case 'codeFontSize':
        this.codeEditor.setFontSize(value); // grava via onFontSizeChange
        break;
      case 'simplifiedNodes':
        this.microSimplifiedNodes = setSetting(key, value);
        this._renderMicroOnly();
        break;
      case 'fullNames':
        this.microFullNames = setSetting(key, value);
        this._renderMicroOnly();
        break;
      case 'areaSnap':
        this.microAreaSnap = setSetting(key, value);
        this._renderMicroOnly();
        break;
      case 'codePanelHidden':
        this.codePanelHidden = setSetting(key, value);
        this.microSplit.classList.toggle('code-panel-hidden', this.codePanelHidden);
        // oculto, o painel tem altura 0 e a faixa de baixo é limitada a 0
        if (!this.codePanelHidden) this._applyCodeBottomInset(getSetting('codePanelBottomInset'));
        break;
      case 'codePanelBottomInset':
        this._applyCodeBottomInset(setSetting(key, value));
        break;
      case 'consoleFloating':
        this.microConsole.setFloating(value); // grava sozinho (ConsoleWindow#_save)
        break;
      case 'consoleHidden':
        this.microConsole.setHidden(value); // grava sozinho (ConsoleWindow#setHidden)
        break;
      case 'callTreeMode':
        this.callTree.setMode(value); // grava sozinho (CallTree#setMode)
        break;
      case 'playbackSpeed':
        this.microRunner.setSpeed(setSetting(key, value));
        this._renderMicroRunBar();
        break;
      default:
        setSetting(key, value);
    }
    this.settingsDialog?.refresh();
  }

  /** "Restaurar padrões" — a geometria da janela flutuante do console também
   * volta ao padrão (não aparece na janela, mas é preferência de tela). */
  _resetSettings() {
    Object.entries(SETTINGS_DEFAULTS).forEach(([key, value]) => {
      if (key === 'consoleRect') return;
      this._applySetting(key, value);
    });
    this.microConsole.resetRect();
  }

  /** Índice na paleta (0…9) de um Alt+1…Alt+9/Alt+0, ou null. Pelo
   * `e.code` (tecla física), não `e.key`: em alguns layouts/sistemas
   * Alt+número produz outro caractere (ex: "¡" no macOS). */
  _paletteIndexFromKey(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey) return null;
    const m = /^(?:Digit|Numpad)(\d)$/.exec(e.code);
    if (!m) return null;
    const digit = Number(m[1]);
    return digit === 0 ? 9 : digit - 1;
  }

  /** Alt+1…Alt+0 (ver _onKeyDown): no modo Área/Texto, define a cor das
   * próximas áreas/labels; em qualquer modo, recolore as áreas e labels
   * selecionadas (áreas com AREA_COLORS, labels com TEXT_COLORS) — e a cor
   * atual de cada tipo presente na seleção passa a ser essa também. Elementos
   * do modelo selecionados (struct/ponteiro/array/dict/matriz/variável)
   * ganham a cor manual de ELEMENT_COLORS (Alt+0 tira a cor). No modo
   * Selecionar sem nada selecionado, define a cor atual das duas ferramentas. */
  _applyMicroPaletteColor(index) {
    const areaColor = AREA_COLORS[index];
    const textColor = TEXT_COLORS[index];
    const elementColor = ELEMENT_COLORS[index];
    const ids = this.microSelectedIds.size ? Array.from(this.microSelectedIds) : this.microSelectedId ? [this.microSelectedId] : [];
    let hadArea = false;
    let hadLabel = false;
    ids.forEach((id) => {
      const area = this.microAreas.get(id);
      if (area) {
        area.color = areaColor;
        hadArea = true;
      }
      const label = this.microLabels.get(id);
      if (label) {
        label.color = textColor;
        hadLabel = true;
      }
      if (this._isMicroModelElement(id)) {
        // cursor de uma janela deslizante: a cor é da janela (os dois
        // cursores e o colchete mudam juntos), não do id
        const win = this._microPointerWindow(this.micro.pointers.get(id));
        if (win) win.color = elementColor;
        else if (elementColor) this.microColors.set(id, elementColor);
        else this.microColors.delete(id);
      }
    });
    const noSelection = this.microMode === 'select' && ids.length === 0;
    if (this.microMode === 'area' || hadArea || noSelection) this.microAreaColor = areaColor;
    if (this.microMode === 'text' || hadLabel || noSelection) this.microLabelColor = textColor;
    this._renderMicroOnly();
  }

  /** `id` é de um elemento do MicroModel (os que aceitam cor manual)? */
  _isMicroModelElement(id) {
    const m = this.micro;
    return m.structs.has(id) || m.pointers.has(id) || m.arrays.has(id) || m.dicts.has(id) || m.matrices.has(id) || m.variables.has(id);
  }

  /** Cores manuais por id que o canvas desenha: `microColors`, com a cor da
   * janela deslizante (ver `microWindows`) por cima da de cada cursor que
   * está numa — os dois cursores da janela sempre na mesma cor do colchete
   * (sem cor na janela, os dois na cor padrão do tema). */
  _microEffectiveColors() {
    if (!this.microWindows.length) return this.microColors;
    const colors = new Map(this.microColors);
    this.micro.pointers.forEach((p) => {
      const win = this._microPointerWindow(p);
      if (!win) return;
      if (win.color) colors.set(p.id, win.color);
      else colors.delete(p.id);
    });
    return colors;
  }

  /** A label selecionada, quando a seleção inteira é exatamente UMA label. */
  _microSingleSelectedLabel() {
    const ids = this.microSelectedIds.size ? Array.from(this.microSelectedIds) : this.microSelectedId ? [this.microSelectedId] : [];
    return ids.length === 1 ? this.microLabels.get(ids[0]) ?? null : null;
  }

  /** Alterna a visibilidade do painel de código/execução (Ctrl+H, ver
   * _onKeyDown). O canvas continua totalmente funcional com o painel
   * oculto — Ctrl+,/Ctrl+. seguem avançando/voltando passos da reprodução
   * normalmente (o handler fica no `window`, não depende do painel estar
   * visível nem em foco). */
  _toggleCodePanel() {
    this._applySetting('codePanelHidden', !this.codePanelHidden);
  }

  /** Alterna a visualização simplificada dos nós de estrutura (Ctrl+A, ver
   * _onKeyDown) — troca a caixa de 3 células (prev/left | data | next/right)
   * de TODO struct (Node e TreeNode juntos, é um ajuste global de canvas, não
   * por nó) por um círculo só com `data`; os ponteiros prev/next (ou
   * left/right) passam a sair direto da borda do círculo, e só aparecem
   * quando o campo tem link — sem pino nem marca de ∅ pra campo vazio (ver
   * MicroCanvasView#_renderStructs). Não mexe no MODELO, só na apresentação
   * — mesmo dado, mesmas posições, mesmo código continua funcionando (ver
   * MicroRuntimeAdapter, que nem sabe que isso existe). */
  _toggleMicroSimplifiedNodes() {
    this._applySetting('simplifiedNodes', !this.microSimplifiedNodes);
  }

  /** Move `delta` passos (positivo = avançar, negativo = voltar) na
   * reprodução ativa do modo "Executar" (ver Ctrl+,/Ctrl+. em `_onKeyDown`)
   * — sem efeito se não há nenhuma reprodução em andamento (`goToStep` já
   * ignora silenciosamente nesse caso, mesmo critério de sempre). */
  _stepMicroPlayback(delta) {
    if (!this.microRunner.steps.length) return;
    this.microRunner.goToStep(this.microRunner.stepIndex + delta);
  }

  _onKeyUp(e) {
    if (e.code === 'Space') this._setSpaceDown(false);
  }

  /** Barra de espaço pressionada/solta: a classe `space-pan` no container
   * troca o cursor do canvas inteiro pela mão de pan (ver canvas.css). */
  _setSpaceDown(down) {
    this._spaceDown = down;
    this.microContainer?.classList.toggle('space-pan', down);
  }

  // ---- modo micro: leitura de gráfico (mouse sobre ele) ----

  /** Mouse andando sobre o canvas (os arrastos têm os próprios listeners em
   * `window`, ver `_onMicroPointerDown`): guarda a posição e atualiza a
   * leitura do gráfico sob ele — só sem botão pressionado. */
  _onMicroHoverMove(e) {
    this._microHoverScreen = this._microScreenPointFromEvent(e);
    this._updateMicroChartReadout(e.buttons === 0);
    if (e.buttons === 0 && this.microMode === 'link') {
      const { x, y } = this._microHoverScreen;
      this._updateMicroLinkHover(this.microView.screenToWorld(x, y, this.microViewport));
    }
  }

  /** Recalcula a leitura (ver `chartReadout`) na última posição do mouse:
   * basta o hover (sem tecla), mas só sem botão pressionado (`idle`) nem
   * gesto em andamento (`_microPointer` — clique, arrasto, redimensionamento)
   * e sobre a área de plotagem do gráfico de cima (o último desenhado) — o de
   * baixo não é lido através do de cima. */
  _updateMicroChartReadout(idle) {
    let next = null;
    if (idle && this._microHoverScreen && !this._microPointer && this.microCharts.size) {
      const { x, y } = this._microHoverScreen;
      const world = this.microView.screenToWorld(x, y, this.microViewport);
      const charts = Array.from(this.microCharts.values());
      for (let i = charts.length - 1; i >= 0; i -= 1) {
        const c = charts[i];
        if (world.x < c.x || world.x > c.x + c.width || world.y < c.y || world.y > c.y + c.height) continue;
        const r = chartReadout(c, { x: world.x - c.x, y: world.y - c.y });
        if (r) next = { chartId: c.id, ...r };
        break;
      }
    }
    this._setMicroChartReadout(next);
  }

  /** Troca a leitura exibida — re-renderiza só quando muda o que aparece
   * (gráfico, n ou curva), não a cada pixel. Não marca o projeto como alterado. */
  _setMicroChartReadout(next) {
    const cur = this._microChartReadout;
    if (cur === next) return;
    if (cur && next && cur.chartId === next.chartId && cur.n === next.n && cur.fnId === next.fnId && cur.value === next.value) {
      return;
    }
    this._microChartReadout = next;
    this._renderMicroOnly();
  }

  // ---- pan / zoom ----

  _resetMicroViewport() {
    const size = this.microView.getSize();
    this.microViewport = { tx: size.width / 2, ty: size.height / 2, scale: 1 };
    this.microView.setViewport(this.microViewport);
  }

  /** Botão "Centralizar vista" (canto superior direito do canvas, ver
   * _buildLayout): reenquadra a câmera pra caber TODO o conteúdo do canvas
   * (structs/ponteiros/arrays/dicts/variáveis/labels), com uma margem —
   * diferente de `_resetMicroViewport`, que só recentraliza na origem. Sem
   * nenhum elemento, cai de volta nesse comportamento de sempre. */
  _fitMicroViewport() {
    const rects = [];
    this.micro.structs.forEach((n) => rects.push({ x: n.x, y: n.y, w: STRUCT_W, h: STRUCT_H }));
    this.micro.pointers.forEach((n) => rects.push({ x: n.x, y: n.y, w: pointerWidth(n, this.microFullNames), h: PTR_H }));
    this.micro.variables.forEach((n) => rects.push({ x: n.x, y: n.y, w: variableWidth(n, this.microFullNames), h: VAR_H }));
    this.micro.arrays.forEach((n) => rects.push(this._microBoundsWithHandle(n, arrayLayout(n), arrayHandleRect(n))));
    this.micro.dicts.forEach((n) => rects.push(this._microBoundsWithHandle(n, dictLayout(n), dictHandleRect(n))));
    this.micro.matrices.forEach((n) => rects.push(this._microBoundsWithHandle(n, matrixLayout(n), matrixHandleRect(n))));
    this.microLabels.forEach((n) => {
      const { width, height } = labelSize(n.text, n.fontSize);
      rects.push({ x: n.x, y: n.y, w: width, h: height });
    });
    this.microAreas.forEach((n) => rects.push({ x: n.x, y: n.y, w: n.width, h: n.height }));
    this.microCharts.forEach((n) => rects.push({ x: n.x, y: n.y, w: n.width, h: n.height }));

    const size = this.microView.getSize();
    if (rects.length === 0) {
      this._resetMicroViewport();
      return;
    }
    const minX = Math.min(...rects.map((r) => r.x));
    const minY = Math.min(...rects.map((r) => r.y));
    const maxX = Math.max(...rects.map((r) => r.x + r.w));
    const maxY = Math.max(...rects.map((r) => r.y + r.h));
    const PAD = 60;
    const contentW = Math.max(1, maxX - minX);
    const contentH = Math.max(1, maxY - minY);
    const scale = Math.max(
      0.3,
      Math.min(2.5, Math.min((size.width - PAD * 2) / contentW, (size.height - PAD * 2) / contentH, 1.5)),
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.microViewport = { tx: size.width / 2 - cx * scale, ty: size.height / 2 - cy * scale, scale };
    this.microView.setViewport(this.microViewport);
  }

  /** Usado pelas três opções do menu (novo/salvar por cima/carregar) pra
   * decidir se vale a pena pedir confirmação antes de descartar o que está
   * na tela. */
  _hasMicroContent() {
    return (
      this.micro.structs.size > 0 ||
      this.micro.pointers.size > 0 ||
      this.micro.arrays.size > 0 ||
      this.micro.dicts.size > 0 ||
      this.micro.matrices.size > 0 ||
      this.micro.variables.size > 0 ||
      this.microLabels.size > 0 ||
      this.microAreas.size > 0 ||
      this.microCharts.size > 0 ||
      this.codeEditor.getValue().trim() !== ''
    );
  }

  /** Menu (☰, canto superior esquerdo): descarta tudo (modelo micro, labels,
   * código, reprodução) e volta ao estado com que o app abre (ver
   * constructor/_buildLayout). Pede confirmação só quando há algo pra
   * perder. */
  async _newProject() {
    if (
      this._hasMicroContent() &&
      !(await this.dialog.confirm('Começar um novo projeto do zero? O trabalho atual será perdido.', {
        title: 'Novo projeto',
        confirmLabel: 'Começar do zero',
        danger: true,
      }))
    )
      return;

    this.microRunner.stop();
    this.microRunner.clearStepLayout();
    this.micro.clear();
    this.microLabels.clear();
    this.microAreas.clear();
    this.microCharts.clear();
    this.microColors.clear();
    this.microWindows = [];
    this.microLayout.clear();
    this.microSelectedId = null;
    this.microSelectedIds = new Set();
    this.microRunHighlightIds = new Set();
    this.manualFrameId = null;
    this.microRuntime.output = [];
    this.codeEditor.setValue('');
    this.codeEditor.clearExecutionLine();
    this.microCanvasTitle.setText('');
    this._setMicroMode('select');
    this._resetMicroViewport();
    this.renderAll();
  }

  /** Menu → "Salvar projeto": baixa um `.json` com tudo que é preciso pra
   * reabrir o projeto exatamente como está agora — código-fonte, título,
   * labels de texto soltas, e o modelo micro inteiro com a posição e os
   * dados de CADA elemento (ver MicroModel#toJSON, inclui elementos de fora
   * da aba/frame selecionada no momento). Não salva estado de reprodução
   * (steps/stepIndex/console) — carregar sempre abre "parado", com o layout
   * congelado do jeito que foi salvo, pronto pra rodar de novo ou só exibir
   * (esse é o caso de uso: rodar uma vez, ajustar as posições à mão, salvar,
   * e depois recarregar sempre nesse layout pra gravações/demonstrações). */
  _saveProject() {
    const project = {
      format: 'algo-visualizer-project',
      version: 1,
      title: this.microCanvasTitle.text,
      code: this.codeEditor.getValue(),
      micro: this.micro.toJSON(),
      labels: Array.from(this.microLabels.values()).map((l) => ({ ...l })),
      areas: Array.from(this.microAreas.values()).map((a) => ({ ...a })),
      charts: Array.from(this.microCharts.values()).map((c) => ({ ...c, functions: [...c.functions] })),
      windows: this.microWindows.map((w) => ({ ...w })),
      // cor manual por id (ids do `micro` acima são preservados no load) —
      // só de elementos que existem no modelo salvo
      colors: Array.from(this.microColors.entries()).filter(([id]) => this._isMicroModelElement(id)),
      // posições memorizadas por NOME, não por id (ver microLayoutKey.js) —
      // é o que faz apagar um elemento e rodar a linha de novo (já no
      // projeto recarregado) reproduzir a posição escolhida à mão, mesmo com
      // esse elemento especificamente ausente do `micro` acima no momento do
      // save (ex: apagado antes de salvar).
      layout: Array.from(this.microLayout.entries()),
      // posições por passo da reprodução (ver MicroProgramRunner#stepLayout)
      stepLayout: this.microRunner.exportStepLayout(),
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (project.title || 'projeto').trim().replace(/[\\/:*?"<>|]+/g, '-') || 'projeto';
    a.download = `${safeName}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /** Menu → "Carregar projeto": abre o seletor de arquivo nativo do
   * navegador (input escondido, recriado só na primeira vez) e lê o `.json`
   * escolhido. `input.value = ''` depois de ler permite escolher de novo o
   * MESMO arquivo em seguida (o navegador não dispara `change` se o valor
   * "não mudou"). */
  _loadProject() {
    if (!this._loadProjectInput) {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json,.json';
      input.hidden = true;
      input.addEventListener('change', () => {
        const file = input.files?.[0];
        input.value = '';
        if (file) this._readProjectFile(file);
      });
      document.body.appendChild(input);
      this._loadProjectInput = input;
    }
    this._loadProjectInput.click();
  }

  _readProjectFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let project;
      try {
        project = JSON.parse(String(reader.result));
      } catch {
        this.dialog.alert('Arquivo inválido: não é um JSON válido.', { title: 'Não foi possível carregar' });
        return;
      }
      if (!project || typeof project !== 'object' || !project.micro) {
        this.dialog.alert('Arquivo inválido: não parece ser um projeto desta ferramenta.', { title: 'Não foi possível carregar' });
        return;
      }
      this._applyLoadedProject(project);
    };
    reader.onerror = () => this.dialog.alert('Não foi possível ler o arquivo.', { title: 'Não foi possível carregar' });
    reader.readAsText(file);
  }

  /** Aplica um projeto já parseado e validado (ver `_readProjectFile`) — o
   * mesmo "reset" de `_newProject`, mas repovoando o modelo/labels/código/
   * título a partir do arquivo em vez de deixar tudo vazio. `_fitMicroViewport`
   * (em vez de `_resetMicroViewport`) porque o layout salvo pode estar
   * espalhado longe da origem — melhor já abrir enquadrando tudo. */
  async _applyLoadedProject(project) {
    if (
      this._hasMicroContent() &&
      !(await this.dialog.confirm('Carregar este projeto? O trabalho atual será perdido.', {
        title: 'Carregar projeto',
        confirmLabel: 'Carregar mesmo assim',
        danger: true,
      }))
    )
      return;

    this.microRunner.stop();
    this.microRunner.importStepLayout(project.stepLayout);
    this.micro.loadFrom(project.micro);
    this.microLabels.clear();
    (project.labels || []).forEach((l) => l && l.id && this.microLabels.set(l.id, { ...l }));
    this.microAreas.clear();
    (project.areas || []).forEach((a) => a && a.id && this.microAreas.set(a.id, { ...a }));
    this.microCharts.clear();
    (project.charts || []).forEach((c) => {
      if (!c || !c.id) return;
      const functions = Array.isArray(c.functions) ? c.functions.filter((f) => CHART_FUNCTIONS.some((fn) => fn.id === f)) : [];
      this.microCharts.set(c.id, {
        ...c,
        width: Math.max(CHART_MIN_W, Number(c.width) || CHART_DEFAULT_SIZE.width),
        height: Math.max(CHART_MIN_H, Number(c.height) || CHART_DEFAULT_SIZE.height),
        xLabel: typeof c.xLabel === 'string' ? c.xLabel : CHART_DEFAULT_X_LABEL,
        yLabel: typeof c.yLabel === 'string' ? c.yLabel : CHART_DEFAULT_Y_LABEL,
        functions,
        nMax: clampChartNumber(c.nMax, CHART_N_LIMITS),
        yMode: c.yMode === 'auto' ? 'auto' : 'manual',
        yMax: clampChartNumber(c.yMax, CHART_Y_LIMITS),
      });
    });
    this.microWindows = (Array.isArray(project.windows) ? project.windows : [])
      .filter((w) => w && typeof w.a === 'string' && typeof w.b === 'string')
      // `color` ausente em projetos de antes da cor da janela: cor padrão
      .map((w) => ({ a: w.a, b: w.b, color: typeof w.color === 'string' ? w.color : null }));
    this.microColors = new Map(
      Array.isArray(project.colors) ? project.colors.filter((e) => Array.isArray(e) && typeof e[1] === 'string') : [],
    );
    this.microLayout = new Map(
      Array.isArray(project.layout) ? project.layout.filter((e) => Array.isArray(e) && typeof e[0] === 'string') : [],
    );
    this.microSelectedId = null;
    this.microSelectedIds = new Set();
    this.microRunHighlightIds = new Set();
    this.manualFrameId = null;
    this.microRuntime.output = [];
    this.codeEditor.setValue(project.code || '');
    this.codeEditor.clearExecutionLine();
    this.microCanvasTitle.setText(project.title || '');
    this._setMicroMode('select');
    this._fitMicroViewport();
    this.renderAll();
  }

  _microViewportCenter() {
    const size = this.microView.getSize();
    return this.microView.screenToWorld(size.width / 2, size.height / 2, this.microViewport);
  }

  _microWorldToScreen(pt) {
    return { x: pt.x * this.microViewport.scale + this.microViewport.tx, y: pt.y * this.microViewport.scale + this.microViewport.ty };
  }

  /** Converte um retângulo em coordenadas de mundo (x,y,width,height) para
   * tela, escalando também as dimensões pelo zoom do viewport micro — usado
   * pra encaixar o input de edição inline exatamente sobre o valor no canvas. */
  _microWorldRectToScreen(rect) {
    const topLeft = this._microWorldToScreen({ x: rect.x, y: rect.y });
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: rect.width * this.microViewport.scale,
      height: rect.height * this.microViewport.scale,
    };
  }

  /** `onCancel` (opcional): chamado se o usuário cancelar com Esc — o nó
   * recém-criado por "new node" (ver `_quickNewNode`) some nesse caso. */
  _openMicroDataPopup(node, { onCancel } = {}) {
    const rect = this._microWorldRectToScreen(structDataRect(node, this.microSimplifiedNodes));
    const fontSize = 17 * this.microViewport.scale; // = .struct-data-label (canvas.css)
    this.microInlineEditor.open(
      rect,
      node.data,
      fontSize,
      (value) => {
        this.micro.setData(node.id, value);
        this._renderMicroOnly();
      },
      // número ou texto (ver InlineValueEditor#parseEditedValue) — sem bool,
      // igual "Node(valor)" no código
      { type: 'value', allowBool: false, onCancel, returnFocusTo: this.microView.svg },
    );
  }

  _openMicroVariablePopup(node) {
    const rect = this._microWorldRectToScreen(variableValueRect(node, this.microFullNames));
    const fontSize = 16 * this.microViewport.scale; // = .variable-value/.array-value-label (canvas.css)
    this.microInlineEditor.open(
      rect,
      node.value,
      fontSize,
      (value) => {
        this.micro.setVariableValue(node.id, value);
        this._renderMicroOnly();
      },
      { type: 'value', returnFocusTo: this.microView.svg }, // número, texto ou bool
    );
  }

  /** Todo array nasce com um ponteiro dedicado, rotulado com o nome do array
   * e "apontando" pra ele (`{kind:'array', id}`) — é isso que mostra o nome
   * no canvas agora que o array não tem mais barra de título própria (o
   * popup de configurações — nome/tamanho/orientação — abre pelo botão
   * direito no PUXADOR do array, não neste ponteiro; ver
   * `_onMicroContextMenu`). Posicionado acima do array, com a mesma busca de
   * espaço livre usada pra qualquer elemento novo, pra não nascer em cima de
   * outra coisa (nem do próprio array) — a MENOS que o usuário já tenha
   * reposicionado o rótulo deste array antes (ver `microLayout`), aí volta
   * direto pra lá, mesmo espírito de `_microCreatePosition`. */
  _createArrayLabelPointer(arrayNode, { movable = true } = {}) {
    const key = microLayoutKey('array-label', { name: arrayNode.name, frameId: arrayNode.frameId });
    let pos = key ? this.microLayout.get(key) : null;
    if (!pos) {
      pos = this._microPointerSpotNear(arrayNode.id, arrayNode.name, {
        movable,
        layoutKey: microLayoutKey('array', { name: arrayNode.name, frameId: arrayNode.frameId }),
      });
      if (key) this.microLayout.set(key, pos);
    }
    const pointer = this.micro.addPointer(pos.x, pos.y, arrayNode.name, arrayNode.frameId ?? 'global');
    this.micro.linkArrayLabelPointer(arrayNode.id, pointer.id);
    return pointer;
  }

  /** Irmã de `_createArrayLabelPointer` — mesma ideia pro dict (ver
   * MicroModel#linkDictLabelPointer). */
  _createDictLabelPointer(dictNode, { movable = true } = {}) {
    const key = microLayoutKey('dict-label', { name: dictNode.name, frameId: dictNode.frameId });
    let pos = key ? this.microLayout.get(key) : null;
    if (!pos) {
      pos = this._microPointerSpotNear(dictNode.id, dictNode.name, {
        movable,
        layoutKey: microLayoutKey('dict', { name: dictNode.name, frameId: dictNode.frameId }),
      });
      if (key) this.microLayout.set(key, pos);
    }
    const pointer = this.micro.addPointer(pos.x, pos.y, dictNode.name, dictNode.frameId ?? 'global');
    this.micro.linkDictLabelPointer(dictNode.id, pointer.id);
    return pointer;
  }

  /** Irmã de `_createArrayLabelPointer` — mesma ideia pra matriz (ver
   * MicroModel#linkMatrixLabelPointer). */
  _createMatrixLabelPointer(matrixNode, { movable = true } = {}) {
    const key = microLayoutKey('matrix-label', { name: matrixNode.name, frameId: matrixNode.frameId });
    let pos = key ? this.microLayout.get(key) : null;
    if (!pos) {
      pos = this._microPointerSpotNear(matrixNode.id, matrixNode.name, {
        movable,
        layoutKey: microLayoutKey('matrix', { name: matrixNode.name, frameId: matrixNode.frameId }),
      });
      if (key) this.microLayout.set(key, pos);
    }
    const pointer = this.micro.addPointer(pos.x, pos.y, matrixNode.name, matrixNode.frameId ?? 'global');
    this.micro.linkMatrixLabelPointer(matrixNode.id, pointer.id);
    return pointer;
  }

  /** Posição (x,y) pra um novo nó criado a partir do interpretador —
   * `layoutKey` (ver microLayoutKey.js) é a chave ESTÁVEL desse elemento
   * (nome, não id): se o usuário já reposicionou um elemento com essa chave
   * antes (nesta sessão ou num projeto carregado), devolve a MESMA posição
   * direto, sem procurar espaço livre — é o que faz apagar+recriar (ou rodar
   * o programa inteiro de novo) preservar o layout escolhido à mão. Sem
   * chave (`null` — caso de struct anônimo, ver MicroRuntimeAdapter#createStruct)
   * ou na primeira vez que a chave aparece, cai no cascateamento de sempre a
   * partir do centro do viewport (`_findFreeMicroPosition`) e, se houver
   * chave, registra a posição escolhida pra próxima vez. */
  _microCreatePosition(kind, size = 1, layoutKey = null, near = null) {
    const fresh = near && this._microFindById(near.id);
    if (layoutKey && this.microLayout.has(layoutKey)) {
      const pos = { ...this.microLayout.get(layoutKey), remembered: true };
      // numa chamada, o mesmo nome lembrado vale pra todas — não junta os nós lá
      if (fresh && near.global) this._microPlaceUnderPointer(near.id, pos, near.label);
      return pos;
    }
    if (kind === 'pointer' && fresh) {
      const pos = this._microPointerSpotNear(near.id, near.label, { movable: true });
      if (layoutKey) this.microLayout.set(layoutKey, pos);
      return pos;
    }
    const center = this._microViewportCenter();
    let width = VAR_W;
    let height = VAR_H;
    if (kind === 'pointer') {
      width = PTR_W;
      height = PTR_H;
    } else if (kind === 'struct') {
      width = STRUCT_W;
      height = STRUCT_H;
    } else if (kind === 'array') {
      const layout = arrayLayout({ cells: new Array(Math.max(1, size)).fill(0), orientation: 'horizontal' });
      width = layout.width;
      height = layout.height;
    } else if (kind === 'dict') {
      const fakeCells = new Array(Math.max(1, size)).fill({ key: '', kind: 'value', value: 0 });
      const layout = dictLayout({ cells: fakeCells, orientation: 'horizontal' });
      width = layout.width;
      height = layout.height;
    } else if (kind === 'matrix') {
      // `size` aqui é {rows, cols} (ver MicroRuntimeAdapter#assignName)
      const rows = Math.max(1, size?.rows ?? 1);
      const cols = Math.max(1, size?.cols ?? 1);
      const layout = matrixLayout({ cells: Array.from({ length: rows }, () => new Array(cols).fill(0)) });
      width = layout.width;
      height = layout.height;
    }
    const base = { x: center.x - width / 2, y: center.y - height / 2 };
    const pos = this._findFreeMicroPosition(base, width, height);
    if (layoutKey) this.microLayout.set(layoutKey, pos);
    return pos;
  }

  /** Onde nasce o ponteiro de um elemento que acabou de ser criado — o
   * ponteiro-rótulo de uma lista/set/deque/dict/matriz, o "p" de "p =
   * Node(1)" —, longe o bastante dele pra seta aparecer
   * (`MICRO_POINTER_GAP`): à ESQUERDA de coleções (onde fica o puxador em
   * que a seta pousa) e de nós de grafo, ACIMA de Node/TreeNode (ver
   * `_microPointerIdealSpot`). Se esse lugar estiver ocupado:
   * - `movable` (o elemento também acabou de nascer, num lugar que ninguém
   *   escolheu): elemento e ponteiro vão JUNTOS pro espaço livre mais
   *   próximo (ver `_microMoveWithPointer`); `layoutKey` é a chave de
   *   posição do elemento, atualizada se ele sair do lugar;
   * - senão (o elemento está onde o usuário o pôs): o ponteiro procura mais
   *   pra fora daquele lado (`_findFreeMicroPosition` com `side`), nunca
   *   mais perto do elemento. */
  _microPointerSpotNear(elementId, label, { movable = false, layoutKey = null } = {}) {
    const w = pointerWidth({ label }, this.microFullNames);
    const side = this._microPointerSide(elementId);
    if (movable) this._microTidyOwned(elementId);
    const ideal = this._microPointerIdealSpot(elementId, w);
    if (this._microFreeAt(ideal, w, PTR_H)) return ideal;
    if (!movable) return this._findFreeMicroPosition(ideal, w, PTR_H, side);
    const pos = this._microMoveWithPointer(elementId, ideal, w);
    const n = this._microFindById(elementId);
    if (layoutKey && this.microLayout.has(layoutKey)) this.microLayout.set(layoutKey, { x: n.x, y: n.y });
    return pos;
  }

  /** Lado do elemento em que nasce o ponteiro dele (ver `_microPointerSpotNear`). */
  _microPointerSide(elementId) {
    const struct = this.micro.structs.get(elementId);
    return struct && struct.type !== 'graph' ? 'above' : 'left';
  }

  /** Canto do ponteiro (largura `w`) colado no lado certo do elemento, a
   * `MICRO_POINTER_GAP` dele: centralizado em cima, ou na altura do meio à
   * esquerda. */
  _microPointerIdealSpot(elementId, w) {
    const r = this._microElementRect(elementId);
    return this._microPointerSide(elementId) === 'above'
      ? { x: r.x + r.w / 2 - w / 2, y: r.y - MICRO_POINTER_GAP - PTR_H }
      : { x: r.x - MICRO_POINTER_GAP - w, y: r.y + r.h / 2 - PTR_H / 2 };
  }

  /** O elemento e o que é dele e anda junto: a lista de vizinhos de um nó de
   * grafo (ver MicroRuntimeAdapter#createStruct). */
  _microOwnedIds(elementId) {
    const nbrs = this.micro.structs.get(elementId)?.neighborsArrayId;
    return nbrs && this.micro.arrays.has(nbrs) ? [elementId, nbrs] : [elementId];
  }

  /** Nó de grafo recém-criado: a lista de vizinhos (que nasce vazia, em
   * qualquer lugar livre) vai pra logo abaixo do nó, alinhada à direita —
   * do lado da célula "nbrs" de onde sai a seta, e nunca à esquerda, onde
   * fica o ponteiro. */
  _microTidyOwned(elementId) {
    const struct = this.micro.structs.get(elementId);
    const arr = struct && this.micro.arrays.get(struct.neighborsArrayId);
    if (!arr) return;
    arr.x = struct.x + STRUCT_W - arrayLayout(arr).width;
    arr.y = struct.y + STRUCT_H + MICRO_POINTER_GAP / 2;
  }

  /** Um retângulo `width`x`height` em `pos` cabe sem encostar em nada? */
  _microFreeAt(pos, width, height, exceptIds = []) {
    return this._microFitsFn(width, height, exceptIds)(pos.x, pos.y);
  }

  /** Leva o elemento (com o que é dele, ver `_microOwnedIds`) e o ponteiro
   * que vai nascer em `ideal` (largura `w`) juntos, como um bloco, pro
   * espaço livre mais próximo. Devolve a posição do ponteiro. */
  _microMoveWithPointer(elementId, ideal, w) {
    const ids = this._microOwnedIds(elementId);
    const rects = [...ids.map((id) => this._microElementRect(id)), { x: ideal.x, y: ideal.y, w, h: PTR_H }];
    const x0 = Math.min(...rects.map((r) => r.x));
    const y0 = Math.min(...rects.map((r) => r.y));
    const x1 = Math.max(...rects.map((r) => r.x + r.w));
    const y1 = Math.max(...rects.map((r) => r.y + r.h));
    const pos = this._findFreeMicroPosition({ x: x0, y: y0 }, x1 - x0, y1 - y0, null, ids);
    const dx = pos.x - x0;
    const dy = pos.y - y0;
    ids.forEach((id) => {
      const n = this._microFindById(id);
      n.x += dx;
      n.y += dy;
    });
    return { x: ideal.x + dx, y: ideal.y + dy };
  }

  /** O contrário de `_microPointerSpotNear`, pra quando o ponteiro já tem
   * lugar lembrado (ver `microLayout`) e o elemento acabou de nascer: o
   * elemento vai pro lugar dele em relação ao ponteiro, se estiver livre —
   * rodar o programa de novo repete o par como ficou da primeira vez. */
  _microPlaceUnderPointer(elementId, pointerPos, label) {
    this._microTidyOwned(elementId);
    const ids = this._microOwnedIds(elementId);
    const ideal = this._microPointerIdealSpot(elementId, pointerWidth({ label }, this.microFullNames));
    const dx = pointerPos.x - ideal.x;
    const dy = pointerPos.y - ideal.y;
    if (!dx && !dy) return;
    const fits = ids.every((id) => {
      const r = this._microElementRect(id);
      return this._microFreeAt({ x: r.x + dx, y: r.y + dy }, r.w, r.h, ids);
    });
    if (!fits) return;
    ids.forEach((id) => {
      const n = this._microFindById(id);
      n.x += dx;
      n.y += dy;
    });
  }

  /** Retângulos ocupados por todo elemento vivo do canvas micro (usado só
   * pra evitar sobreposição ao posicionar um elemento novo). */
  _microOccupiedRects(exceptIds = []) {
    const rects = [];
    const skip = new Set(exceptIds);
    const each = (map, rectOf) => map.forEach((n, id) => skip.has(id) || rects.push(rectOf(n)));
    each(this.micro.structs, (n) => ({ x: n.x, y: n.y, w: STRUCT_W, h: STRUCT_H }));
    each(this.micro.pointers, (n) => ({ x: n.x, y: n.y, w: pointerWidth(n, this.microFullNames), h: PTR_H }));
    each(this.micro.variables, (n) => ({ x: n.x, y: n.y, w: variableWidth(n, this.microFullNames), h: VAR_H }));
    each(this.micro.arrays, (n) => this._microBoundsWithHandle(n, arrayLayout(n), arrayHandleRect(n)));
    each(this.micro.dicts, (n) => this._microBoundsWithHandle(n, dictLayout(n), dictHandleRect(n)));
    each(this.micro.matrices, (n) => this._microBoundsWithHandle(n, matrixLayout(n), matrixHandleRect(n)));
    return rects;
  }

  /** `fits(x, y)`: uma caixa `width`x`height` com o canto em (x, y) fica a
   * pelo menos uma margem de todo elemento do canvas (menos `exceptIds`)? */
  _microFitsFn(width, height, exceptIds = []) {
    const margin = 14;
    const overlaps = (a, b) => !(a.x + a.w + margin <= b.x || b.x + b.w + margin <= a.x || a.y + a.h + margin <= b.y || b.y + b.h + margin <= a.y);
    const rects = this._microOccupiedRects(exceptIds);
    return (x, y) => {
      const candidate = { x, y, w: width, h: height };
      return !rects.some((r) => overlaps(candidate, r));
    };
  }

  /** Parte de `base` (topo-esquerdo de uma caixa `width`x`height`) e procura
   * em anéis ao redor a posição mais próxima que não sobrepõe nenhum
   * elemento já no canvas (fora `exceptIds`) — assim um elemento recém-criado (pelo código, via
   * "nome = 5" etc) não nasce em cima de outro. Desiste depois de algumas
   * voltas e usa `base` mesmo (raríssimo — canvas realmente lotado).
   * `side` ('left' | 'above'): só anda pra fora daquele lado (e de lado ao
   * longo dele), nunca na direção oposta — é o ponteiro de um elemento (ver
   * `_microPointerSpotNear`), que não pode chegar mais perto dele. */
  _findFreeMicroPosition(base, width, height, side = null, exceptIds = []) {
    const fits = this._microFitsFn(width, height, exceptIds);
    if (fits(base.x, base.y)) return { x: base.x, y: base.y };

    const STEP = 40;
    if (side) {
      // `out` passos pra fora do lado, `along` passos ao longo dele — os
      // mais próximos de `base` primeiro
      const offsets = [];
      for (let out = 0; out <= 10; out += 1) {
        for (let along = -10; along <= 10; along += 1) offsets.push([out, along]);
      }
      offsets.sort((a, b) => Math.hypot(...a) - Math.hypot(...b) || Math.abs(a[1]) - Math.abs(b[1]));
      for (const [out, along] of offsets) {
        const x = side === 'left' ? base.x - out * STEP : base.x + along * STEP;
        const y = side === 'left' ? base.y + along * STEP : base.y - out * STEP;
        if (fits(x, y)) return { x, y };
      }
      return { x: base.x, y: base.y };
    }
    for (let ring = 1; ring <= 10; ring += 1) {
      const offsets = [];
      for (let d = -ring; d <= ring; d += 1) {
        offsets.push([d, -ring], [d, ring]);
      }
      for (let d = -ring + 1; d <= ring - 1; d += 1) {
        offsets.push([-ring, d], [ring, d]);
      }
      for (const [dx, dy] of offsets) {
        const x = base.x + dx * STEP;
        const y = base.y + dy * STEP;
        if (fits(x, y)) return { x, y };
      }
    }
    return { x: base.x, y: base.y };
  }

  /** Ctrl+Enter: `ast` é a instrução já parseada pelo CodeEditor
   * (src/interpreter/parser.js) — `Assign` ("alvo = expressão"), `ExprStmt`
   * (uma chamada sozinha na linha, ex: "arr.append(x)"/"arr.pop()", sem "="),
   * ou `TupleAssign` ("a, b = b, a", ver ast.js#TupleAssign). Avalia (e, se
   * for atribuição, aplica o(s) alvo(s)) contra o modelo via `microRuntime`
   * (src/app/MicroRuntimeAdapter.js) — toda a lógica de "que combinação de
   * alvo/valor faz sentido" mora no avaliador (src/interpreter/evaluator.js)
   * e no adapter, não aqui. Mesmo dispatch por `ast.type` que o
   * interpretador do modo Executar já faz (ver interpreter.js#execStmt). */
  _executeStatement(ast) {
    this.microRuntime.touched = [];
    if (ast.type === 'Import') return; // "from collections import deque": sem efeito (ver ast.js#Import)
    if (ast.type === 'ExprStmt') {
      const value = evaluate(ast.expr, this.microRuntime);
      // "nums[i]" sozinho na linha: o efeito é o cursor de leitura (criado
      // pelo próprio getIndex) — sem valor, nem array/índice válido houve,
      // então nenhum cursor apareceu: avisa como erro (linha pisca vermelho)
      if (ast.expr.type === 'Index' && value === undefined) throw new Error('Leitura inválida');
    } else if (ast.type === 'TupleAssign') {
      // todo valor é avaliado ANTES de qualquer atribuição — troca de
      // verdade sem variável temporária (ver interpreter.js#execStmt, mesmo
      // motivo).
      const values = ast.values.map((v) => evaluate(v, this.microRuntime));
      assignTuple(ast.targets, values, this.microRuntime);
    } else if (ast.type === 'ChainAssign') {
      assignChain(ast.targets, evaluate(ast.value, this.microRuntime), this.microRuntime);
    } else {
      const value = evaluate(ast.value, this.microRuntime);
      assign(ast.target, value, this.microRuntime);
    }
    // evaluate/assign já dispararam renders "cedo demais" pelo caminho (cada
    // leitura/escrita chama onChange na hora, via _touch) — a seleção final
    // só fica pronta agora, então precisa de um render por cima pra não ficar
    // um passo atrasada (mostrando o destaque da instrução ANTERIOR).
    this._applyMicroTouchHighlight(this.microRuntime.touched);
    this._renderMicroOnly();
  }

  /** Ctrl+Enter numa linha "if/elif/while condição:" no Sandbox (ver
   * CodeEditor#_handleGenerateFromLine): avalia só a condição — destaca os
   * elementos que ela leu, igual a Simulação faz no passo do teste — e
   * escreve o resultado no console ("> True" verde / "> False" vermelho, ver
   * fillConsoleLines). Condição que não resolve (nome desconhecido, índice
   * fora da lista) lança, pra linha piscar vermelho em vez de dizer False. */
  _evaluateCondition(ast) {
    this.microRuntime.touched = [];
    const value = evaluate(ast, this.microRuntime);
    if (value === undefined) {
      this._applyMicroTouchHighlight(this.microRuntime.touched);
      this._renderMicroOnly();
      throw new Error('Condição não resolvida');
    }
    this.microRuntime.print(truthy(value, this.microRuntime) ? '> True' : '> False');
    this._applyMicroTouchHighlight(this.microRuntime.touched);
    this._renderMicroOnly();
  }

  /** Botão "▶ Rodar" / Ctrl+Enter no modo "Executar": compila o buffer
   * inteiro (com if/while/for) e roda contra o modelo real via
   * MicroProgramRunner, que devolve pronto pra reprodução (um passo por
   * atribuição/condição avaliada, com snapshot do modelo). */
  _runMicroProgram(source) {
    this.microConsoleClearedLines = 0; // limpeza do console vale só pra reprodução anterior
    this.microRunner.run(source, this.microRuntime);
  }

  /** Alternância Sandbox/Simulação ('manual'/'run') no editor de código: ao trocar de modo,
   * limpa a reprodução em andamento e o destaque de execução, pra não deixar
   * lixo visual de um modo enquanto se está no outro. */
  /** Botão da pilha de chamadas na barra do código: visível só na
   * Simulação, "ligado" enquanto o painel não está oculto. */
  _syncCallTreeButton() {
    if (!this.callTreeButton) return;
    this.callTreeButton.hidden = this.codeEditor.mode !== 'run';
    const shown = this.callTree.mode !== 'hidden';
    this.callTreeButton.classList.toggle('on', shown);
    this.callTreeButton.setAttribute('aria-pressed', String(shown));
    this.callTreeButton.title = shown ? 'Ocultar a pilha de chamadas' : 'Mostrar a pilha de chamadas';
  }

  /** Edição no código durante a Simulação: a reprodução em tela é do código
   * de ANTES — apaga o destaque da linha em execução (e o esmaecimento das
   * outras linhas) pra o código inteiro voltar a ficar legível, e pausa a
   * reprodução automática (o próximo passo acenderia de novo). Volta a
   * acender quando o usuário navega pra outro passo ou roda de novo (ver
   * _renderMicroRunBar). */
  _onMicroCodeEdited() {
    if (this.codeEditor.mode !== 'run' || !this.microRunner.hasSteps) return;
    if (this.microRunner.playing) this.microRunner.togglePlay();
    this._microExecLineHiddenAt = { steps: this.microRunner.steps, index: this.microRunner.stepIndex };
    this.codeEditor.clearExecutionLine();
  }

  _onCodeEditorModeChange(mode) {
    this._syncCallTreeButton();
    this.microRunner.stop();
    this.codeEditor.clearExecutionLine();
    this.microRunHighlightIds = new Set();
    this.manualFrameId = null;
    this.microRuntime.output = [];
    this._renderMicroOnly();
  }

  _openMicroArrayCellPopup(node, index) {
    const c = arrayLayout(node).cells[index];
    const rect = this._microWorldRectToScreen({ x: node.x + c.x, y: node.y + c.y, width: c.w, height: c.h });
    const fontSize = 16 * this.microViewport.scale; // = .variable-value/.array-value-label (canvas.css)
    this.microInlineEditor.open(
      rect,
      node.cells[index],
      fontSize,
      (value) => {
        this.micro.setArrayCellValue(node.id, index, value);
        this._renderMicroOnly();
      },
      { type: 'value', returnFocusTo: this.microView.svg }, // número, texto ou bool
    );
  }

  /** Nome, tamanho e orientação de um array. Set não tem campo de tamanho:
   * crescer encheria o conjunto de 0s repetidos e tiraria o `hashTable` (a
   * ordem do CPython, ver pyset.js) de sincronia com as células — um set só
   * muda de tamanho pelo código (`add`/`remove`/`discard`). Deque com
   * `maxlen` não passa desse limite (com `maxlen=0` não há o que mudar). */
  _openMicroArraySettingsPopup(node, screenPt) {
    const maxlen = node.isDeque && Number.isInteger(node.maxlen) ? node.maxlen : null;
    const showSize = !node.isSet && maxlen !== 0;
    this.microArraySettingsPopup.open(screenPt.x, screenPt.y, node, {
      returnFocusTo: this.microView.svg,
      maxSize: maxlen !== null ? Math.min(maxlen, MAX_ARRAY_SIZE) : MAX_ARRAY_SIZE,
      showSize,
      // pilha (índices crescendo pra cima) só faz sentido com posição — set não tem
      showStack: !node.isSet,
      onSave: ({ name, size, orientation }) => {
        this.micro.renameArray(node.id, name);
        // orientação antes do tamanho: virando pilha, as células novas já
        // entram em cima (base parada, ver MicroModel#_keepStackBase)
        this.micro.setArrayOrientation(node.id, orientation);
        this.microRunner.updateOrientation(node.id, orientation);
        if (size !== undefined) this.micro.resizeArray(node.id, size);
        if (this.microSelectedId === node.id) this._syncCodeEditorSelection('array', node.id);
        this._renderMicroOnly();
      },
      onRemove: () => {
        this.micro.removeArray(node.id);
        if (this.microSelectedId === node.id) {
          this.microSelectedId = null;
          this._syncCodeEditorSelection(null, null);
        }
        this._renderMicroOnly();
      },
    });
  }

  /** Duplo clique numa célula de dict — edição inline do valor da chave
   * `key`, igual célula de array. Só célula de valor: uma que guarda um nó
   * ou uma lista (ref/arrayref) é ligada arrastando o pino, não digitando. */
  _openMicroDictCellPopup(node, key) {
    const cell = node.cells.find((c) => c.key === key);
    const c = dictLayout(node).cells.find((lc) => lc.key === key);
    if (!cell || cell.kind !== 'value' || !c) return;
    const rect = this._microWorldRectToScreen({ x: node.x + c.x, y: node.y + c.y, width: c.w, height: c.h });
    const fontSize = 16 * this.microViewport.scale; // = .array-value-label (canvas.css)
    this.microInlineEditor.open(
      rect,
      cell.value,
      fontSize,
      (value) => {
        this.micro.setDictCellValue(node.id, key, value);
        this._renderMicroOnly();
      },
      { type: 'value', returnFocusTo: this.microView.svg }, // número, texto ou bool
    );
  }

  /** Clique numa célula de matriz — edição inline no lugar do valor, igual
   * célula de array (ver `_openMicroArrayCellPopup`). */
  _openMicroMatrixCellPopup(node, row, col) {
    const rect = this._microWorldRectToScreen(matrixCellRect(node, row, col));
    const fontSize = 16 * this.microViewport.scale; // = .array-value-label (canvas.css)
    this.microInlineEditor.open(
      rect,
      node.cells[row][col],
      fontSize,
      (value) => {
        this.micro.setMatrixCellValue(node.id, row, col, value);
        this._renderMicroOnly();
      },
      { type: 'value', returnFocusTo: this.microView.svg }, // número, texto ou bool
    );
  }

  /** Irmã de `_openMicroArraySettingsPopup` — nome, linhas e colunas (sem
   * orientação nem limite de tamanho). */
  _openMicroMatrixSettingsPopup(node, screenPt) {
    this.microMatrixSettingsPopup.open(screenPt.x, screenPt.y, node, {
      returnFocusTo: this.microView.svg,
      showOrientation: false,
      sizeFields: [
        { key: 'rows', label: 'Linhas', value: node.cells.length },
        { key: 'cols', label: 'Colunas', value: node.cells[0]?.length ?? 1 },
      ],
      removeLabel: 'Remover matriz',
      onSave: ({ name, rows, cols }) => {
        this.micro.renameMatrix(node.id, name);
        this.micro.resizeMatrix(node.id, rows, cols);
        if (this.microSelectedId === node.id) this._syncCodeEditorSelection('matrix', node.id);
        this._renderMicroOnly();
      },
      onRemove: () => {
        this.micro.removeMatrix(node.id);
        if (this.microSelectedId === node.id) {
          this.microSelectedId = null;
          this._syncCodeEditorSelection(null, null);
        }
        this._renderMicroOnly();
      },
    });
  }

  /** Irmã de `_openMicroArraySettingsPopup` — sem `maxSize`/tamanho (dict
   * cresce por inserção de chave, não tem "tamanho" pra editar aqui). */
  _openMicroDictSettingsPopup(node, screenPt) {
    this.microDictSettingsPopup.open(screenPt.x, screenPt.y, node, {
      returnFocusTo: this.microView.svg,
      showSize: false,
      removeLabel: 'Remover dicionário',
      onSave: ({ name, orientation }) => {
        this.micro.renameDict(node.id, name);
        this.micro.setDictOrientation(node.id, orientation);
        this.microRunner.updateOrientation(node.id, orientation);
        if (this.microSelectedId === node.id) this._syncCodeEditorSelection('dict', node.id);
        this._renderMicroOnly();
      },
      onRemove: () => {
        this.micro.removeDict(node.id);
        if (this.microSelectedId === node.id) {
          this.microSelectedId = null;
          this._syncCodeEditorSelection(null, null);
        }
        this._renderMicroOnly();
      },
    });
  }

  /** Seleciona (destaca) UM elemento do canvas micro — clique manual do
   * usuário no canvas/código, ou o alvo "principal" de uma instrução (ver
   * `_applyMicroTouchHighlight`). `kind`/`id` nulos limpam a seleção. */
  _selectMicroElement(kind, id) {
    this.microSelectedId = id ?? null;
    this._syncCodeEditorSelection(kind ?? null, id ?? null);
  }

  /** Destaca TODOS os elementos que uma instrução tocou — não só o alvo
   * final da atribuição, também toda célula de array lida pelo caminho (ex:
   * "sum = sum + nums[i]" destaca `sum` E o cursor `nums[i]` juntos).
   * `touched` é a lista `{kind,id}` coletada pelo MicroRuntimeAdapter durante
   * evaluate+assign de uma instrução (ver `_executeStatement`, modo manual, e
   * `MicroProgramRunner`, um passo do modo "Executar" por vez). A escrita
   * final (sempre o último toque da lista) ainda sincroniza o destaque de
   * identificador no editor de código, como antes. */
  _applyMicroTouchHighlight(touched) {
    const list = touched || [];
    this.microRunHighlightIds = new Set(list.map((t) => t.id));
    const primary = list.length ? list[list.length - 1] : null;
    this.microRunPrimaryId = primary?.id ?? null;
    this._selectMicroElement(primary?.kind ?? null, primary?.id ?? null);
    // uma instrução de verdade rodou (linha manual, ou passo da reprodução) —
    // qualquer aba escolhida manualmente na árvore de chamadas pra inspecionar
    // uma chamada já retornada deixa de valer; volta a seguir o passo atual.
    this.manualFrameId = null;
  }

  /** Clique num nó da árvore de chamadas (ver `src/ui/CallTree.js`) — troca
   * a aba do canvas estrutural pra mostrar os locais daquela chamada
   * específica, sem alterar o passo atual da reprodução (dá pra inspecionar
   * uma chamada já retornada). Volta a seguir o passo atual automaticamente
   * assim que uma nova instrução rodar (ver `_applyMicroTouchHighlight`). */
  _onSelectCallFrame(frameId) {
    this.manualFrameId = frameId;
    this._renderMicroOnly();
  }

  /** Um elemento (ou aresta ligada a ele) fica com o estilo "selecionado" se
   * for o clique manual do usuário, um dos toques da instrução atual (ver
   * `_applyMicroTouchHighlight`) OU parte da seleção em área atual (ver
   * `_microFindIdsInRect`) — os três se somam, não competem. */
  _isMicroHighlighted(id) {
    return id === this.microSelectedId || this._activeRunHighlightIds().has(id) || this.microSelectedIds.has(id);
  }

  /** Toques da instrução atual (ver `_applyMicroTouchHighlight`) só valem
   * enquanto a seleção ainda é o alvo principal que o passo escolheu — assim
   * que o usuário seleciona outra coisa (clique, seleção em área, clique no
   * vazio), a seleção dele substitui o destaque do passo, em vez de somar a
   * ele (senão ficavam dois ou mais elementos "selecionados" ao mesmo tempo
   * e não dava pra ver num relance qual era o clicado). */
  _activeRunHighlightIds() {
    if (this.microSelectedId == null || this.microSelectedId !== this.microRunPrimaryId) return EMPTY_SET;
    return this.microRunHighlightIds;
  }

  /** Durante a reprodução do modo Executar: ids de todo elemento FORA do
   * escopo da chamada `activeFrameId` — pro canvas desenhar mais
   * transparente e destacar só o que a chamada em execução enxerga. No
   * escopo: os ponteiros/variáveis/listas do próprio frame (no global, também
   * dicts e matrizes, que não têm frame) e tudo que dá pra alcançar a partir
   * deles seguindo referências (alvo de ponteiro, next/prev/vizinhos de nó,
   * células de lista de nós e de dict, rótulo de lista/dict/matriz). Ex:
   * dentro de "merge(left, right)" ficam em destaque "left", "right",
   * "result", "i", "j" e as listas para onde "left"/"right" apontam; as
   * variáveis do global e as listas de outras chamadas ficam apagadas.
   * `keepIds` (o que a instrução atual tocou/está selecionado) nunca apaga.
   * Fora da reprodução, nada apaga. */
  _microOutOfScopeIds(activeFrameId, keepIds) {
    if (!this.microRunner.hasSteps) return EMPTY_SET;
    const m = this.micro;
    const reached = new Set();
    const pending = [];
    const reach = (id) => {
      if (id && !reached.has(id)) {
        reached.add(id);
        pending.push(id);
      }
    };
    const own = (n) => (n.frameId ?? 'global') === activeFrameId;
    m.pointers.forEach((p) => own(p) && reach(p.id));
    m.variables.forEach((v) => own(v) && reach(v.id));
    m.arrays.forEach((a) => own(a) && reach(a.id));
    if (activeFrameId === 'global') {
      m.dicts.forEach((d) => reach(d.id));
      m.matrices.forEach((x) => reach(x.id));
    }
    while (pending.length) {
      const id = pending.pop();
      const p = m.pointers.get(id);
      if (p) {
        const t = p.target;
        if (t) reach(t.kind === 'arrayCell' ? t.arrayId : t.kind === 'dictCell' ? t.dictId : t.kind === 'matrixCell' ? t.matrixId : t.id);
        continue;
      }
      const s = m.structs.get(id);
      if (s) {
        reach(s.prev);
        reach(s.next);
        reach(s.neighborsArrayId);
        continue;
      }
      const a = m.arrays.get(id);
      if (a) {
        if (a.kind === 'ref') a.cells.forEach(reach);
        reach(a.labelPointerId);
        continue;
      }
      const d = m.dicts.get(id);
      if (d) {
        d.cells.forEach((c) => c.kind !== 'value' && reach(c.value));
        reach(d.labelPointerId);
        continue;
      }
      reach(m.matrices.get(id)?.labelPointerId);
    }
    const out = new Set();
    [m.structs, m.pointers, m.arrays, m.dicts, m.matrices, m.variables].forEach((map) =>
      map.forEach((_, id) => {
        if (!reached.has(id) && !keepIds.has(id)) out.add(id);
      }),
    );
    return out;
  }

  // ---- modo micro: elementos por id (qualquer tipo — struct/ponteiro/array/dict/variável/label) ----

  _microNodeMaps() {
    return [
      this.micro.structs,
      this.micro.pointers,
      this.micro.arrays,
      this.micro.dicts,
      this.micro.matrices,
      this.micro.variables,
      this.microLabels,
      this.microAreas,
      this.microCharts,
    ];
  }

  _microFindById(id) {
    for (const map of this._microNodeMaps()) {
      if (map.has(id)) return map.get(id);
    }
    return null;
  }

  /** Remove QUALQUER elemento do canvas micro pelo id, qualquer que seja o
   * tipo — cada tipo tem seu próprio método de remoção no MicroModel (labels
   * não fazem parte dele, saem direto de `microLabels`). Usado pelo atalho
   * Delete (ver `_deleteMicroSelection`). */
  _microRemoveById(id) {
    if (this.micro.structs.has(id)) this.micro.removeStruct(id);
    else if (this.micro.pointers.has(id)) this.micro.removePointer(id);
    else if (this.micro.arrays.has(id)) this.micro.removeArray(id);
    else if (this.micro.dicts.has(id)) this.micro.removeDict(id);
    else if (this.micro.matrices.has(id)) this.micro.removeMatrix(id);
    else if (this.micro.variables.has(id)) this.micro.removeVariable(id);
    else if (this.microAreas.has(id)) this.microAreas.delete(id);
    else if (this.microCharts.has(id)) this.microCharts.delete(id);
    else this.microLabels.delete(id);
  }

  /** Atalho Delete/Backspace: remove todo o conjunto selecionado no momento
   * — a seleção em área (`microSelectedIds`, pode ter vários) OU o clique
   * único de sempre (`microSelectedId`), o que estiver ativo. Não faz nada
   * sem seleção. */
  _deleteMicroSelection() {
    const ids = this.microSelectedIds.size ? Array.from(this.microSelectedIds) : this.microSelectedId ? [this.microSelectedId] : [];
    if (!ids.length) return;
    ids.forEach((id) => this._microRemoveById(id));
    this.microSelectedIds = new Set();
    this.microSelectedId = null;
    this._syncCodeEditorSelection(null, null);
    this._renderMicroOnly();
  }

  /** Chave estável (ver microLayoutKey.js) do elemento de id `id`, calculada
   * a partir dos campos que ele JÁ TEM no modelo (nome/label/frameId/chave de
   * cursor) — usada só pra ATUALIZAR `microLayout` quando o usuário arrasta
   * algo que já existe (ver `_microSetNodePos`; na CRIAÇÃO a chave é montada
   * do outro lado, em MicroRuntimeAdapter, antes do elemento existir). Struct
   * (sem nome próprio) e label de texto (não nasce de código) devolvem
   * `null` de propósito — nenhum dos dois tem posição memorizável por nome
   * (ver comentário de microLayoutKey.js). */
  _microLayoutKeyForLiveNode(id) {
    const pointer = this.micro.pointers.get(id);
    if (pointer) {
      if (pointer.isArrayLabel) {
        const arr = this.micro.arrays.get(pointer.labelArrayId);
        return arr ? microLayoutKey('array-label', { name: arr.name, frameId: arr.frameId }) : null;
      }
      if (pointer.isDictLabel) {
        const dict = this.micro.dicts.get(pointer.labelDictId);
        return dict ? microLayoutKey('dict-label', { name: dict.name, frameId: dict.frameId }) : null;
      }
      if (pointer.isMatrixLabel) {
        const matrix = this.micro.matrices.get(pointer.labelMatrixId);
        return matrix ? microLayoutKey('matrix-label', { name: matrix.name, frameId: matrix.frameId }) : null;
      }
      if (pointer.readCursorKey) return microLayoutKey('cursor', { cursorKey: pointer.readCursorKey });
      return microLayoutKey('pointer', { name: pointer.label, frameId: pointer.frameId });
    }
    const array = this.micro.arrays.get(id);
    if (array) return microLayoutKey('array', { name: array.name, frameId: array.frameId });
    const dict = this.micro.dicts.get(id);
    if (dict) return microLayoutKey('dict', { name: dict.name, frameId: dict.frameId });
    const matrix = this.micro.matrices.get(id);
    if (matrix) return microLayoutKey('matrix', { name: matrix.name, frameId: matrix.frameId });
    const variable = this.micro.variables.get(id);
    if (variable) return microLayoutKey('variable', { name: variable.name, frameId: variable.frameId });
    return null;
  }

  /** Aplica uma posição final a QUALQUER elemento do canvas micro, pelo id —
   * usado ao soltar um arraste (de um item só ou de um grupo inteiro, ver
   * _onMicroPointerUpWindow). Labels não passam por `microRunner` (não fazem
   * parte do MicroModel nem da reprodução do modo Executar) nem por
   * `microLayout` (não nascem de código, não têm chave estável por nome). */
  _microSetNodePos(id, x, y) {
    const node = this._microFindById(id);
    if (!node) return;
    node.x = x;
    node.y = y;
    if (this.microLabels.has(id) || this.microAreas.has(id) || this.microCharts.has(id)) return;
    this.microRunner.updatePosition(id, x, y);
    // durante a reprodução a posição vira quadro-chave DAQUELE passo (ver
    // MicroProgramRunner#updatePosition) — não mexe na posição de nascimento
    // lembrada por nome, senão os passos anteriores também mudariam na
    // próxima execução
    if (this.microRunner.hasSteps) return;
    const key = this._microLayoutKeyForLiveNode(id);
    if (key) this.microLayout.set(key, { x, y });
  }

  /** Posição "ao vivo" de um elemento durante um render — prioriza um
   * arraste de grupo em andamento, depois um arraste de item único, senão a
   * posição de verdade do modelo. Usado por todo bloco de `_renderMicroOnly`
   * que monta structs/ponteiros/arrays/dicts/variáveis/labels. */
  _microNodePos(n) {
    if (this._microGroupDragPositions?.has(n.id)) return { pos: this._microGroupDragPositions.get(n.id), dragging: true };
    if (this._microDragId === n.id && this._microDragPos) return { pos: this._microDragPos, dragging: true };
    return { pos: n, dragging: false };
  }

  /** Ids de todo elemento cuja caixa cruza o retângulo de seleção em área
   * (mundo, não normalizado — `_microFindIdsInRect` normaliza). */
  _microFindIdsInRect(rect) {
    const minX = Math.min(rect.x0, rect.x1);
    const maxX = Math.max(rect.x0, rect.x1);
    const minY = Math.min(rect.y0, rect.y1);
    const maxY = Math.max(rect.y0, rect.y1);
    const hitBox = (x, y, w, h) => x <= maxX && x + w >= minX && y <= maxY && y + h >= minY;
    // labels/áreas nunca ficam inertes (ver `_microPickable`)
    const hits = (x, y, w, h, id) => hitBox(x, y, w, h) && !this._microInertIds?.has(id);
    const ids = [];
    this.micro.structs.forEach((n) => { if (hits(n.x, n.y, STRUCT_W, STRUCT_H, n.id)) ids.push(n.id); });
    this.micro.pointers.forEach((n) => { if (hits(n.x, n.y, pointerWidth(n, this.microFullNames), PTR_H, n.id)) ids.push(n.id); });
    this.micro.arrays.forEach((n) => {
      const { width, height } = arrayLayout(n);
      if (hits(n.x, n.y, width, height, n.id)) ids.push(n.id);
    });
    this.micro.dicts.forEach((n) => {
      const { width, height } = dictLayout(n);
      if (hits(n.x, n.y, width, height, n.id)) ids.push(n.id);
    });
    this.micro.matrices.forEach((n) => {
      const { width, height } = matrixLayout(n);
      if (hits(n.x, n.y, width, height, n.id)) ids.push(n.id);
    });
    this.micro.variables.forEach((n) => { if (hits(n.x, n.y, variableWidth(n, this.microFullNames), VAR_H, n.id)) ids.push(n.id); });
    this.microLabels.forEach((n) => {
      const { width, height } = labelSize(n.text, n.fontSize);
      if (hits(n.x, n.y, width, height, n.id)) ids.push(n.id);
    });
    this.microCharts.forEach((n) => { if (hits(n.x, n.y, n.width, n.height, n.id)) ids.push(n.id); });
    // áreas só entram se couberem INTEIRAS no retângulo — costumam envolver
    // outros elementos, e selecionar (e depois arrastar) esses elementos com
    // um retângulo por dentro da área não deveria levar a área junto.
    this.microAreas.forEach((n) => {
      if (n.x >= minX && n.x + n.width <= maxX && n.y >= minY && n.y + n.height <= maxY) ids.push(n.id);
    });
    return ids;
  }

  /** Clique com o botão direito num trecho "nome[expr]" no editor de código
   * (ver CodeEditor#_onContextMenu) — alterna visível/oculto o cursor de
   * leitura correspondente. `key` já vem normalizada (sem espaço) do editor,
   * no mesmo formato de `MicroRuntimeAdapter#_showReadCursor`. Não faz nada
   * se aquele cursor específico ainda não foi criado (a expressão nunca foi
   * lida) — não há o que esconder. */
  _toggleMicroReadCursor(key) {
    const cursor = Array.from(this.micro.pointers.values()).find((p) => p.readCursorKey === key);
    if (!cursor) return;
    cursor.readCursorHidden = !cursor.readCursorHidden;
    this._renderMicroOnly();
  }

  /** Clique com o botão direito sobre um identificador comum (não um
   * "nome[expr]", esse é `_toggleMicroReadCursor`) no editor de código — ver
   * CodeEditor#_onContextMenu. Mesma ideia do cursor de leitura: alterna
   * visível/oculto o ponteiro correspondente no canvas, sem apagá-lo do
   * modelo (o código continua enxergando/reatribuindo o nome normalmente,
   * só o desenho some — ver o filtro `!n.hidden` em `_renderMicroOnly`).
   * Rótulo-automático de array/dict (ver App#_create*LabelPointer) e cursor
   * de leitura ficam de fora — cada um já tem seu próprio mecanismo de
   * visibilidade (a barra de ferramentas do array/dict, e este clique
   * direito só que na EXPRESSÃO de índice, respectivamente). Não faz nada se
   * "nome" não é um ponteiro vivo (ex: é array/dict/variável, ou não existe
   * ainda) — não há o que esconder. */
  _toggleMicroPointerVisibility(name) {
    const pointer = Array.from(this.micro.pointers.values()).find(
      (p) => p.label === name && !p.isArrayLabel && !p.isDictLabel && !p.isMatrixLabel && !p.readCursorKey,
    );
    if (!pointer) return;
    pointer.hidden = !pointer.hidden;
    this._renderMicroOnly();
  }

  /** Sincroniza o destaque de identificador do editor de código com a seleção do
   * canvas micro: ponteiros/arrays têm nome próprio, structs não têm (limpa). */
  _syncCodeEditorSelection(kind, id) {
    if (!kind || id == null) {
      this.codeEditor.setSelectedName(null);
      return;
    }
    if (kind === 'pointer') this.codeEditor.setSelectedName(this.micro.pointers.get(id)?.label ?? null);
    else if (kind === 'array') this.codeEditor.setSelectedName(this.micro.arrays.get(id)?.name ?? null);
    else if (kind === 'dict') this.codeEditor.setSelectedName(this.micro.dicts.get(id)?.name ?? null);
    else if (kind === 'matrix') this.codeEditor.setSelectedName(this.micro.matrices.get(id)?.name ?? null);
    else if (kind === 'variable') this.codeEditor.setSelectedName(this.micro.variables.get(id)?.name ?? null);
    else this.codeEditor.setSelectedName(null);
  }

  /** Sentido inverso: clique num identificador no editor de código seleciona (e
   * destaca) o ponteiro/array/variável correspondente no canvas micro. */
  _selectMicroByName(name) {
    if (!name) {
      if (this.microSelectedId != null) {
        this.microSelectedId = null;
        this._renderMicroOnly();
      }
      return;
    }
    for (const p of this.micro.pointers.values()) {
      if (p.label === name) {
        this.microSelectedId = p.id;
        this._renderMicroOnly();
        return;
      }
    }
    for (const a of this.micro.arrays.values()) {
      if (a.name === name) {
        this.microSelectedId = a.id;
        this._renderMicroOnly();
        return;
      }
    }
    for (const d of this.micro.dicts.values()) {
      if (d.name === name) {
        this.microSelectedId = d.id;
        this._renderMicroOnly();
        return;
      }
    }
    for (const m of this.micro.matrices.values()) {
      if (m.name === name) {
        this.microSelectedId = m.id;
        this._renderMicroOnly();
        return;
      }
    }
    for (const v of this.micro.variables.values()) {
      if (v.name === name) {
        this.microSelectedId = v.id;
        this._renderMicroOnly();
        return;
      }
    }
    if (this.microSelectedId != null) {
      this.microSelectedId = null;
      this._renderMicroOnly();
    }
  }

  // ---- divisória arrastável entre visualização e código ----

  /** Arraste na divisória entre o canvas (+ árvore de chamadas) e o painel
   * de código (`.micro-split`, ver _buildLayout): define uma largura FIXA em
   * px pro lado esquerdo (`leftEl`, normalmente `microMain`) via
   * `style.flex`, sobrepondo o `flex-basis: 67%` inicial do CSS — o painel de código
   * continua com `flex-grow: 1` e absorve o espaço restante sozinho, então
   * não precisa de nenhum cálculo pro lado direito aqui. */
  _setupSplitResizer(splitEl, leftEl, resizerEl) {
    const MIN_WIDTH = 240;
    resizerEl.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      resizerEl.classList.add('dragging');
      const startX = e.clientX;
      const startWidth = leftEl.getBoundingClientRect().width;

      const onMove = (ev) => {
        const totalWidth = splitEl.getBoundingClientRect().width;
        const maxWidth = Math.max(MIN_WIDTH, totalWidth - MIN_WIDTH - resizerEl.getBoundingClientRect().width);
        const newWidth = Math.max(MIN_WIDTH, Math.min(maxWidth, startWidth + (ev.clientX - startX)));
        leftEl.style.flex = `0 0 ${newWidth}px`;
      };
      const onUp = () => {
        resizerEl.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  }

  /** Arraste na borda inferior do painel de código (`.code-bottom-resizer`,
   * ver _buildLayout): sobe o fim do painel e deixa uma faixa vazia embaixo
   * (`.code-bottom-reserved`) — pensado pra gravações com a webcam no canto
   * inferior direito da tela, que senão cobriria as últimas linhas do código.
   * O editor e a barra de reprodução ficam todos acima da borda; código que
   * não cabe ganha barra de rolagem. Guardado em px (distância até o pé da
   * tela, como a janela da webcam) em `codePanelBottomInset`; duplo clique
   * zera. */
  _setupCodeBottomResizer(panelEl, resizerEl) {
    resizerEl.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      resizerEl.classList.add('dragging');
      const startY = e.clientY;
      const startInset = this.codeBottomReserved.getBoundingClientRect().height;
      let inset = startInset;

      const onMove = (ev) => {
        inset = this._applyCodeBottomInset(startInset - (ev.clientY - startY));
      };
      const onUp = () => {
        resizerEl.classList.remove('dragging');
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        setSetting('codePanelBottomInset', inset);
        this.settingsDialog?.refresh();
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
    resizerEl.addEventListener('dblclick', () => this._applySetting('codePanelBottomInset', 0));
    // janela menor (ou maior) que na hora do arraste: re-limita só na tela,
    // sem perder o valor guardado
    window.addEventListener('resize', () => this._applyCodeBottomInset(getSetting('codePanelBottomInset')));
    // o painel ainda não está no documento aqui (altura 0) — aplica depois
    requestAnimationFrame(() => this._applyCodeBottomInset(getSetting('codePanelBottomInset')));
  }

  /** Aplica a faixa reservada embaixo do painel de código, limitada pra
   * sempre sobrar espaço útil pro código. Devolve o valor efetivo em px. */
  _applyCodeBottomInset(px) {
    const MIN_CONTENT = 180;
    const panelHeight = this.codeEditorPanel?.getBoundingClientRect().height ?? 0;
    const max = Math.max(0, panelHeight - MIN_CONTENT);
    const inset = Math.round(Math.max(0, Math.min(max, px || 0)));
    this.codeBottomReserved.style.height = `${inset}px`;
    return inset;
  }

  // ---- modo micro: modo de interação (barra inferior) ----

  /** Troca o modo da barra inferior (Selecionar/Texto — ver MICRO_MODES).
   * `data-mode` no container muda o cursor por CSS (ver canvas.css). */
  _setMicroMode(mode) {
    if (this.microMode === mode) return;
    this.microMode = mode;
    this.microContainer.dataset.mode = mode;
    this._microPointer = null;
    this.microContainer.classList.remove('panning');
    this._microSelectionPreview = null;
    this._microAreaDraft = null;
    this._microChartDraft = null;
    this._microAreaResize = null;
    this._microLinkDraft = null;
    this._microLinkHover = null;
    this._renderMicroOnly();
  }

  // ---- modo micro: pan / zoom ----

  _microScreenPointFromEvent(e) {
    const rect = this.microView.getSize();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  _onMicroWheel(e) {
    e.preventDefault();
    const screenPt = this._microScreenPointFromEvent(e);
    const worldBefore = this.microView.screenToWorld(screenPt.x, screenPt.y, this.microViewport);
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.max(0.3, Math.min(2.5, this.microViewport.scale * factor));
    this.microViewport.tx = screenPt.x - worldBefore.x * newScale;
    this.microViewport.ty = screenPt.y - worldBefore.y * newScale;
    this.microViewport.scale = newScale;
    this.microView.setViewport(this.microViewport);
    // alças de redimensionamento têm tamanho fixo na TELA — recalcula no zoom
    if (this._microSingleSelectedAreaId()) this._renderMicroOnly();
  }

  // ---- modo micro: hit testing (contra o modelo, não o DOM) ----

  /** O hit testing roda contra o MODELO, não contra o que está desenhado —
   * sem este filtro, um elemento que não aparece (ponteiro/variável de outra
   * chamada, ponteiro ou cursor oculto, lista de vizinhos no modo
   * simplificado) ou que está apagado por estar fora do escopo da chamada
   * em execução (ver `_microOutOfScopeIds`) roubava cliques, arrastes e
   * seleção de quem está visível no mesmo lugar. `_microInertIds` é
   * montado a cada render (ver `_renderMicroOnly`). */
  _microPickable(node) {
    return !this._microInertIds?.has(node.id);
  }

  _findMicroStructAt(worldPt) {
    for (const node of this.micro.structs.values()) {
      if (!this._microPickable(node)) continue;
      if (worldPt.x >= node.x && worldPt.x <= node.x + STRUCT_W && worldPt.y >= node.y && worldPt.y <= node.y + STRUCT_H) return node;
    }
    return null;
  }

  _findMicroPointerAt(worldPt) {
    for (const node of this.micro.pointers.values()) {
      if (!this._microPickable(node)) continue;
      if (worldPt.x >= node.x && worldPt.x <= node.x + pointerWidth(node, this.microFullNames) && worldPt.y >= node.y && worldPt.y <= node.y + PTR_H) return node;
    }
    return null;
  }

  _findMicroVariableAt(worldPt) {
    for (const node of this.micro.variables.values()) {
      if (!this._microPickable(node)) continue;
      if (worldPt.x >= node.x && worldPt.x <= node.x + variableWidth(node, this.microFullNames) && worldPt.y >= node.y && worldPt.y <= node.y + VAR_H) return node;
    }
    return null;
  }

  _findMicroVariableValueAt(worldPt) {
    for (const node of this.micro.variables.values()) {
      if (!this._microPickable(node)) continue;
      const r = variableValueRect(node, this.microFullNames);
      if (worldPt.x >= r.x && worldPt.x <= r.x + r.width && worldPt.y >= r.y && worldPt.y <= r.y + r.height) return node;
    }
    return null;
  }

  _findMicroArrayAt(worldPt) {
    for (const node of this.micro.arrays.values()) {
      if (!this._microPickable(node)) continue;
      const { width, height } = arrayLayout(node);
      if (worldPt.x >= node.x && worldPt.x <= node.x + width && worldPt.y >= node.y && worldPt.y <= node.y + height) return node;
    }
    // o puxador também é o array — clicar/arrastar por ele seleciona/move,
    // como a barra de título de uma janela
    return this._findMicroHandleAt(this.micro.arrays, arrayHandleRect, worldPt);
  }

  /** Elemento de `map` (arrays, dicts ou matrizes) cujo puxador (`handleOf`,
   * ver MicroCanvasView#handleRectFor) está sob o ponto — alvo de soltura pra
   * ligar um ponteiro à coleção INTEIRA. */
  _findMicroHandleAt(map, handleOf, worldPt) {
    for (const node of map.values()) {
      if (!this._microPickable(node)) continue;
      const h = handleOf(node);
      const x = node.x + h.x;
      const y = node.y + h.y;
      if (worldPt.x >= x && worldPt.x <= x + h.w && worldPt.y >= y && worldPt.y <= y + h.h) return node;
    }
    return null;
  }

  /** Retângulo (mundo) de uma coleção com o puxador (à esquerda ou em cima,
   * ver MicroCanvasView#boxWithHandle) — pra enquadrar a vista e achar
   * espaço livre sem cobrir a aba. */
  _microBoundsWithHandle(n, { width, height }, handle) {
    const b = boxWithHandle(width, height, handle);
    return { x: n.x + b.x, y: n.y + b.y, w: b.w, h: b.h };
  }

  /** Retorna {array, index} da célula de QUALQUER array (valores ou refs) sob o ponto — usado
   * tanto para editar uma célula de valor quanto para resolver o alvo de um ponteiro solto. */
  _findMicroArrayCellAt(worldPt) {
    for (const node of this.micro.arrays.values()) {
      if (!this._microPickable(node)) continue;
      const layout = arrayLayout(node);
      for (const c of layout.cells) {
        const wx = node.x + c.x;
        const wy = node.y + c.y;
        if (worldPt.x >= wx && worldPt.x <= wx + c.w && worldPt.y >= wy && worldPt.y <= wy + c.h) {
          return { array: node, index: c.index };
        }
      }
    }
    return null;
  }

  /** Índice (o número na faixa acima das células, ou à esquerda delas na
   * vertical) do array `node` sob o ponto, ou null — arrastar dali cria um
   * cursor já apontando pra essa posição (ver _startMicroIndexCursorDrag).
   * Set não tem índice. A faixa de cada célula vai da borda da caixa até a
   * célula: `c.y` (horizontal) / `c.x` (vertical) é justamente a altura/
   * largura dela. */
  _findMicroArrayIndexAt(node, worldPt) {
    if (node.isSet) return null;
    const vertical = isVerticalOrientation(node.orientation);
    const lx = worldPt.x - node.x;
    const ly = worldPt.y - node.y;
    for (const c of arrayLayout(node).cells) {
      const r = vertical ? { x: 0, y: c.y, w: c.x, h: c.h } : { x: c.x, y: 0, w: c.w, h: c.y };
      if (lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h) return c.index;
    }
    return null;
  }

  /** Divisória entre duas células do array `node` sob o ponto (ver
   * MicroCanvasView#arrayDividers) — devolve o índice de corte (a primeira
   * célula depois dela), ou null. */
  _findMicroArrayDividerAt(node, worldPt) {
    const lx = worldPt.x - node.x;
    const ly = worldPt.y - node.y;
    const d = arrayDividers(node).find((r) => lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h);
    return d ? d.at : null;
  }

  /** Duplo clique numa divisória: cria DOIS arrays novos abaixo de `node`,
   * com as células antes e depois de `at` — como se ele tivesse sido cortado
   * ali. O original fica intacto. Os pedaços são anônimos (nome "__…", sem
   * ponteiro-rótulo, igual o array de vizinhos de um nó de grafo) e lado a
   * lado, com o mesmo tipo/orientação do original; se o espaço logo abaixo
   * estiver ocupado, descem juntos até caber. */
  _splitMicroArray(node, at) {
    // ocupação ANTES de criar os pedaços (senão eles mesmos contariam)
    const occupied = this._microOccupiedRects();
    const opts = { kind: node.kind, orientation: node.orientation, isDeque: !!node.isDeque, size: 0, name: '' };
    const [first, second] = [node.cells.slice(0, at), node.cells.slice(at)].map((cells) => {
      const arr = this.micro.addArray(node.x, node.y, opts);
      this.micro.setArrayContents(arr.id, node.kind, cells);
      arr.name = `__split_${arr.id}`;
      return arr;
    });
    // caixa + aba de cada um, relativa ao canto da caixa (ver boxWithHandle)
    const bounds = (n) => {
      const { width, height } = arrayLayout(n);
      return boxWithHandle(width, height, arrayHandleRect(n));
    };
    const src = bounds(node);
    const a = bounds(first);
    const b = bounds(second);
    const gap = 24;
    const margin = 14; // = _findFreeMicroPosition
    const secondDx = a.x + a.w + gap - b.x; // o segundo à direita do primeiro
    const rectsAt = (y) => [
      { x: node.x + a.x, y: y + a.y, w: a.w, h: a.h },
      { x: node.x + secondDx + b.x, y: y + b.y, w: b.w, h: b.h },
    ];
    const overlaps = (p, q) => !(p.x + p.w + margin <= q.x || q.x + q.w + margin <= p.x || p.y + p.h + margin <= q.y || q.y + q.h + margin <= p.y);
    let y = node.y + src.y + src.h + gap - Math.min(a.y, b.y);
    for (let i = 0; i < 30 && rectsAt(y).some((p) => occupied.some((r) => overlaps(p, r))); i += 1) y += 40;
    first.x = node.x;
    first.y = y;
    second.x = node.x + secondDx;
    second.y = y;
    this.microSelectedIds = new Set();
    this._selectMicroElement('array', first.id);
    this._renderMicroOnly();
  }

  _findMicroDictAt(worldPt) {
    for (const node of this.micro.dicts.values()) {
      if (!this._microPickable(node)) continue;
      const { width, height } = dictLayout(node);
      if (worldPt.x >= node.x && worldPt.x <= node.x + width && worldPt.y >= node.y && worldPt.y <= node.y + height) return node;
    }
    return this._findMicroHandleAt(this.micro.dicts, dictHandleRect, worldPt); // puxador, igual array
  }

  /** Irmã de `_findMicroArrayCellAt` — devolve {dict, key} (não índice: alvo
   * de célula de dict é sempre por CHAVE, ver MicroModel.js). */
  _findMicroDictCellAt(worldPt) {
    for (const node of this.micro.dicts.values()) {
      if (!this._microPickable(node)) continue;
      const layout = dictLayout(node);
      for (const c of layout.cells) {
        const wx = node.x + c.x;
        const wy = node.y + c.y;
        if (worldPt.x >= wx && worldPt.x <= wx + c.w && worldPt.y >= wy && worldPt.y <= wy + c.h) {
          return { dict: node, key: c.key };
        }
      }
    }
    return null;
  }

  _findMicroMatrixAt(worldPt) {
    for (const node of this.micro.matrices.values()) {
      if (!this._microPickable(node)) continue;
      const { width, height } = matrixLayout(node);
      if (worldPt.x >= node.x && worldPt.x <= node.x + width && worldPt.y >= node.y && worldPt.y <= node.y + height) return node;
    }
    return this._findMicroHandleAt(this.micro.matrices, matrixHandleRect, worldPt); // puxador, igual array
  }

  /** {matrix, row, col} da célula de matriz sob o ponto. */
  _findMicroMatrixCellAt(worldPt) {
    for (const node of this.micro.matrices.values()) {
      if (!this._microPickable(node)) continue;
      for (const c of matrixLayout(node).cells) {
        const wx = node.x + c.x;
        const wy = node.y + c.y;
        if (worldPt.x >= wx && worldPt.x <= wx + c.w && worldPt.y >= wy && worldPt.y <= wy + c.h) {
          return { matrix: node, row: c.row, col: c.col };
        }
      }
    }
    return null;
  }

  /** Label de texto solta (modo "Texto") sob o ponto — geometria em
   * `labelSize` (mesma função usada pelo render, ver MicroCanvasView.js). */
  _findMicroLabelAt(worldPt) {
    for (const node of this.microLabels.values()) {
      const { width, height } = labelSize(node.text, node.fontSize);
      if (worldPt.x >= node.x && worldPt.x <= node.x + width && worldPt.y >= node.y && worldPt.y <= node.y + height) return node;
    }
    return null;
  }

  /** Área hachurada sob o ponto — de trás pra frente (a mais recente fica
   * por cima no render, ver MicroCanvasView#_renderAreas). */
  _findMicroAreaAt(worldPt) {
    const areas = Array.from(this.microAreas.values());
    for (let i = areas.length - 1; i >= 0; i -= 1) {
      const n = areas[i];
      if (worldPt.x >= n.x && worldPt.x <= n.x + n.width && worldPt.y >= n.y && worldPt.y <= n.y + n.height) return n;
    }
    return null;
  }

  /** Gráfico de complexidade sob o ponto — de trás pra frente, como as áreas. */
  _findMicroChartAt(worldPt) {
    const charts = Array.from(this.microCharts.values());
    for (let i = charts.length - 1; i >= 0; i -= 1) {
      const n = charts[i];
      if (worldPt.x >= n.x && worldPt.x <= n.x + n.width && worldPt.y >= n.y && worldPt.y <= n.y + n.height) return n;
    }
    return null;
  }

  /** Título de eixo ('x' | 'y') do gráfico `chart` sob o ponto, ou null —
   * retângulos de `chartLayout` (os mesmos do render). */
  _findMicroChartAxisAt(chart, worldPt) {
    const { xAxis, yAxis } = chartLayout(chart);
    const inside = (r) =>
      worldPt.x >= chart.x + r.x && worldPt.x <= chart.x + r.x + r.width && worldPt.y >= chart.y + r.y && worldPt.y <= chart.y + r.y + r.height;
    if (inside(xAxis.rect)) return 'x';
    if (inside(yAxis.rect)) return 'y';
    return null;
  }

  /** Área OU gráfico (os elementos redimensionáveis pelas alças) de id `id`. */
  _microResizableById(id) {
    return this.microAreas.get(id) ?? this.microCharts.get(id) ?? null;
  }

  /** Id da área/gráfico que mostra alças de redimensionamento: só no modo
   * Selecionar, e só quando a seleção inteira é exatamente UM deles. */
  _microSingleSelectedAreaId() {
    if (this.microMode !== 'select') return null;
    const ids = this.microSelectedIds.size ? Array.from(this.microSelectedIds) : this.microSelectedId ? [this.microSelectedId] : [];
    return ids.length === 1 && this._microResizableById(ids[0]) ? ids[0] : null;
  }

  /** Alça de redimensionamento (da área/gráfico selecionado) sob o ponto,
   * com uma folga de alguns px de tela em volta pra facilitar a pega. */
  _findMicroAreaHandleAt(worldPt) {
    const id = this._microSingleSelectedAreaId();
    if (!id) return null;
    const scale = this.microViewport.scale;
    const slack = 3 / scale;
    const handle = areaHandles(this._microResizableById(id), AREA_HANDLE_PX / scale).find(
      (h) =>
        worldPt.x >= h.x - slack &&
        worldPt.x <= h.x + h.size + slack &&
        worldPt.y >= h.y - slack &&
        worldPt.y <= h.y + h.size + slack,
    );
    return handle ? { id, dir: handle.dir } : null;
  }

  /** Se um gesto de área (criar/mover/redimensionar) deve ignorar o grid:
   * segue a preferência `microAreaSnap` (tecla G), e o Shift pressionado
   * inverte essa preferência só durante o gesto. */
  _microAreaFree(e) {
    return this.microAreaSnap === !!e.shiftKey;
  }

  /** Encaixa uma coordenada de mundo no ponto mais próximo do grid de fundo
   * (ver GRID_SIZE/GRID_DOT em MicroCanvasView.js) — usado por criar, mover
   * e redimensionar áreas. `free` (ver _microAreaFree) desliga o encaixe. */
  _snapMicroArea(v, free = false) {
    if (free) return v;
    return Math.round((v - GRID_DOT) / GRID_SIZE) * GRID_SIZE + GRID_DOT;
  }

  /** Retângulo (normalizado) entre dois pontos de mundo, encaixado no grid
   * — prévia/criação de uma área arrastando no modo "Área". */
  _microAreaRectFromDrag(a, b, free) {
    const x0 = this._snapMicroArea(Math.min(a.x, b.x), free);
    const y0 = this._snapMicroArea(Math.min(a.y, b.y), free);
    const x1 = this._snapMicroArea(Math.max(a.x, b.x), free);
    const y1 = this._snapMicroArea(Math.max(a.y, b.y), free);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** Novo retângulo de uma área sendo redimensionada pela alça `dir` (n/s/e/w
   * e combinações) — a borda oposta fica parada; tamanho mínimo de uma
   * célula do grid em cada direção (ou `min` {w,h}, ver gráficos). */
  _microAreaResizedRect(start, dir, worldPt, free, min = null) {
    let x0 = start.x;
    let y0 = start.y;
    let x1 = start.x + start.width;
    let y1 = start.y + start.height;
    const minW = min ? min.w : free ? 8 : GRID_SIZE;
    const minH = min ? min.h : free ? 8 : GRID_SIZE;
    if (dir.includes('w')) x0 = Math.min(this._snapMicroArea(worldPt.x, free), x1 - minW);
    if (dir.includes('e')) x1 = Math.max(this._snapMicroArea(worldPt.x, free), x0 + minW);
    if (dir.includes('n')) y0 = Math.min(this._snapMicroArea(worldPt.y, free), y1 - minH);
    if (dir.includes('s')) y1 = Math.max(this._snapMicroArea(worldPt.y, free), y0 + minH);
    return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  }

  /** Modo "Área": cria a área ao soltar o arraste (ou, num clique simples,
   * uma área de tamanho padrão com o canto no ponto clicado), na cor atual.
   * Volta pro modo Selecionar com a área nova já selecionada — pronta pra
   * ser movida/redimensionada, mesmo fluxo do modo Texto. */
  _createMicroArea(rect) {
    const id = nextId('area');
    this.microAreas.set(id, { id, ...rect, color: this.microAreaColor });
    this._setMicroMode('select');
    this.microSelectedIds = new Set();
    this.microSelectedId = id;
    this._syncCodeEditorSelection(null, null);
  }

  /** Retângulo de um gráfico desenhado arrastando de `a` até `b` no modo
   * "Gráfico" — livre (sem grid), nunca menor que o mínimo legível. */
  _microChartRectFromDrag(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.max(CHART_MIN_W, Math.abs(b.x - a.x)),
      height: Math.max(CHART_MIN_H, Math.abs(b.y - a.y)),
    };
  }

  /** Modo "Gráfico": cria um gráfico de complexidade Big-O (vazio, sem
   * nenhuma função marcada — o botão direito escolhe quais exibir, ver
   * `_openMicroChartSettingsPopup`). Mesmo fluxo de `_createMicroArea`: volta
   * pro modo Selecionar com o gráfico novo já selecionado, pronto pra ser
   * movido/redimensionado. */
  _createMicroChart(rect) {
    const id = nextId('chart');
    this.microCharts.set(id, {
      id,
      ...rect,
      xLabel: CHART_DEFAULT_X_LABEL,
      yLabel: CHART_DEFAULT_Y_LABEL,
      functions: [],
      nMax: CHART_DEFAULT_RANGE,
      yMode: 'manual',
      yMax: CHART_DEFAULT_RANGE,
    });
    this._setMicroMode('select');
    this.microSelectedIds = new Set();
    this.microSelectedId = id;
    this._syncCodeEditorSelection(null, null);
  }

  // ---- seleção múltipla (Ctrl+clique) e janelas deslizantes ----

  /** Ids selecionados agora, de qualquer jeito que tenham sido (clique único,
   * seleção em área, Ctrl+clique). */
  _microSelectionIds() {
    if (this.microSelectedIds.size) return Array.from(this.microSelectedIds);
    return this.microSelectedId != null ? [this.microSelectedId] : [];
  }

  /** Ctrl+clique num elemento: entra na seleção se não estava, sai se
   * estava — o cursor de uma janela deslizante leva o par junto. Com um
   * elemento só, também vira o `microSelectedId` (destaque do alvo,
   * sincronização com o código), igual à seleção em área. */
  _toggleMicroSelection(id) {
    const set = new Set(this._microSelectionIds());
    const partner = this._microWindowPartner(this.micro.pointers.get(id));
    const ids = partner ? [id, partner.id] : [id];
    if (set.has(id)) ids.forEach((x) => set.delete(x));
    else ids.forEach((x) => set.add(x));
    // seleção que começou por retângulo continua sem âncora (ver
    // `_microSelectionAnchor`)
    if (this._microAnchorlessSelection === this.microSelectedIds && set.size > 1) this._microAnchorlessSelection = set;
    this.microSelectedIds = set;
    this.microSelectedId = set.size === 1 ? [...set][0] : null;
    const only = this.microSelectedId;
    const byKind = { pointer: this.micro.pointers, variable: this.micro.variables, array: this.micro.arrays, dict: this.micro.dicts, matrix: this.micro.matrices };
    const kind = only == null ? null : Object.keys(byKind).find((k) => byKind[k].has(only)) ?? null;
    this._syncCodeEditorSelection(kind, only);
  }

  /** Seleção em área (arraste no vazio): `ids` são os elementos dentro do
   * retângulo. Com Ctrl soma à seleção atual em vez de substituí-la. Se a
   * seleção COMEÇA por aqui (sem Ctrl, ou com Ctrl mas nada selecionado
   * antes), não tem um "primeiro clicado" — a ordem de `ids` é só a dos
   * tipos — e fica marcada como sem âncora (ver `_microSelectionAnchor`). */
  _selectMicroRect(ids, ctrl = false) {
    const before = ctrl ? this._microSelectionIds() : [];
    const all = [...before, ...ids];
    this.microSelectedIds = new Set(all);
    this.microSelectedId = this.microSelectedIds.size === 1 ? all[0] : null;
    this._microAnchorlessSelection = before.length ? null : this.microSelectedIds;
  }

  // ---- alinhar e distribuir a seleção (AlignToolbar, Ctrl+Espaço) ----

  /** Retângulo (mundo) desenhado de um elemento, pra alinhar: coleções com a
   * aba (ver boxWithHandle), nó simplificado só o círculo, o resto a caixa. */
  _microElementRect(id) {
    const n = this._microFindById(id);
    if (!n) return null;
    if (this.micro.structs.has(id)) {
      if (!this.microSimplifiedNodes) return { x: n.x, y: n.y, w: STRUCT_W, h: STRUCT_H };
      const cx = n.x + STRUCT_W / 2;
      const cy = n.y + STRUCT_H / 2;
      return { x: cx - STRUCT_CIRCLE_R, y: cy - STRUCT_CIRCLE_R, w: 2 * STRUCT_CIRCLE_R, h: 2 * STRUCT_CIRCLE_R };
    }
    if (this.micro.pointers.has(id)) return { x: n.x, y: n.y, w: pointerWidth(n, this.microFullNames), h: PTR_H };
    if (this.micro.variables.has(id)) return { x: n.x, y: n.y, w: variableWidth(n, this.microFullNames), h: VAR_H };
    if (this.micro.arrays.has(id)) return this._microBoundsWithHandle(n, arrayLayout(n), arrayHandleRect(n));
    if (this.micro.dicts.has(id)) return this._microBoundsWithHandle(n, dictLayout(n), dictHandleRect(n));
    if (this.micro.matrices.has(id)) return this._microBoundsWithHandle(n, matrixLayout(n), matrixHandleRect(n));
    if (this.microLabels.has(id)) {
      const { width, height } = labelSize(n.text, n.fontSize);
      return { x: n.x, y: n.y, w: width, h: height };
    }
    return { x: n.x, y: n.y, w: n.width, h: n.height }; // área, gráfico
  }

  /** Ids da seleção que dá pra alinhar/mover agora — mesmo filtro do
   * arraste em grupo (ver `_onMicroPointerDown`), mais os ponteiros/cursores
   * escondidos, que não estão desenhados. */
  _microAlignableIds() {
    return this._microSelectionIds().filter((id) => {
      const n = this._microFindById(id);
      return n && this._microPickable(n) && !n.hidden && !n.readCursorHidden;
    });
  }

  /** Referência do alinhamento: o primeiro elemento selecionado (ordem de
   * clique/Ctrl+clique), ou null — os extremos do grupo — numa seleção que
   * começou por retângulo (ver `_selectMicroRect`). */
  _microSelectionAnchor() {
    if (this._microAnchorlessSelection && this._microAnchorlessSelection === this.microSelectedIds) return null;
    return this._microSelectionIds()[0] ?? null;
  }

  /** Botão da AlignToolbar / comando do Ctrl+Espaço: `action` é um modo de
   * ALIGN_MODES ('left', 'center', …) ou 'distribute-x'/'distribute-y'.
   * Cada elemento vai pra posição nova por `_microSetNodePos`, o mesmo
   * caminho de soltar um arraste — na reprodução da Simulação vale só pro
   * passo atual, igual mover com o mouse. */
  _runMicroAlignAction(action) {
    const ids = this._microAlignableIds();
    const rects = ids.map((id) => ({ id, ...this._microElementRect(id) }));
    const moves = action.startsWith('distribute-')
      ? distributeRects(rects, action.slice('distribute-'.length))
      : rects.length >= 2
        ? alignRects(rects, action, this._microSelectionAnchor())
        : new Map();
    moves.forEach(({ dx, dy }, id) => {
      const n = this._microFindById(id);
      this._microSetNodePos(id, n.x + dx, n.y + dy);
    });
    this._renderMicroOnly();
  }

  // ---- organizar uma árvore por níveis (TreeLayoutToolbar, Ctrl+Espaço) ----

  /** O TreeNode a organizar: o único elemento selecionado (e móvel, mesmo
   * filtro de `_microAlignableIds`), se for um struct 'tree'; senão null. */
  _microSelectedTreeRoot() {
    const ids = this._microAlignableIds();
    if (ids.length !== 1) return null;
    const node = this.micro.structs.get(ids[0]);
    return node?.type === 'tree' ? node : null;
  }

  /** Botão "Árvore ↕"/"Árvore ↔" / comando "layout tree …" do Ctrl+Espaço:
   * arranja por níveis a subárvore que começa no TreeNode selecionado
   * (structs não guardam o pai, então não dá pra subir até a raiz), com o
   * selecionado parado no lugar. `orientation`: 'vertical' (níveis um abaixo
   * do outro) ou 'horizontal' (lado a lado). Só segue left/right (campos
   * físicos prev/next, ver MicroRuntimeAdapter#_structFieldForAttr) que
   * apontam pra outro TreeNode. A caixa de cada nó é a desenhada (ver
   * `_microElementRect`: o círculo no modo simplificado), e como ela tem o
   * mesmo deslocamento em relação a (x, y) em todo struct, o deslocamento
   * da caixa vale direto pra posição do nó. Cada nó vai pro lugar por
   * `_microSetNodePos`, como soltar um arraste — na reprodução da Simulação
   * vale só pro passo atual. Ponteiros e variáveis não se movem. */
  _runMicroTreeLayout(orientation) {
    const root = this._microSelectedTreeRoot();
    if (!root) return;
    const { w, h } = this._microElementRect(root.id);
    const childrenOf = (id) => {
      const node = this.micro.structs.get(id);
      const tree = (childId) => (childId && this.micro.structs.get(childId)?.type === 'tree' ? childId : null);
      return node ? [tree(node.prev), tree(node.next)] : [null, null];
    };
    const gaps = TREE_GAPS[orientation][this.microSimplifiedNodes ? 'simplified' : 'detailed'];
    const offsets = treeLayout(root.id, childrenOf, { orientation, w, h, ...gaps });
    const { x, y } = root;
    offsets.forEach(({ dx, dy }, id) => {
      if (id !== root.id) this._microSetNodePos(id, x + dx, y + dy);
    });
    this._renderMicroOnly();
  }

  /** Chave ESTÁVEL de um ponteiro pras janelas deslizantes (`microWindows`):
   * o cursor de leitura pela expressão ("nums[l]", ver
   * MicroRuntimeAdapter#_showReadCursor), um ponteiro comum pelo nome — mais
   * o escopo (global ou dentro de uma chamada), igual microLayoutKey.js. */
  _microPointerWindowKey(p) {
    const scope = (p.frameId ?? 'global') === 'global' ? 'global' : 'call';
    return p.readCursorKey ? `cursor:${scope}:${p.readCursorKey}` : `pointer:${scope}:${p.label}`;
  }

  /** A janela deslizante (`microWindows`) de que `p` faz parte, ou null. */
  _microPointerWindow(p) {
    if (!p) return null;
    const key = this._microPointerWindowKey(p);
    return this.microWindows.find((w) => w.a === key || w.b === key) ?? null;
  }

  /** O outro cursor da janela deslizante de `p` (no mesmo frame), ou null. */
  _microWindowPartner(p) {
    const win = this._microPointerWindow(p);
    if (!win) return null;
    const key = this._microPointerWindowKey(p);
    const otherKey = win.a === key ? win.b : win.a;
    for (const q of this.micro.pointers.values()) {
      if (q.id !== p.id && q.frameId === p.frameId && this._microPointerWindowKey(q) === otherKey) return q;
    }
    return null;
  }

  /** Índices do array cobertos pela janela de `p` — do índice de um cursor
   * ao do outro, inclusive, em qualquer ordem — ou null se `p` não está numa
   * janela, ou se os dois cursores não estão apontando pra células do MESMO
   * array agora. */
  _microWindowRange(p) {
    const q = this._microWindowPartner(p);
    if (!q || q.readCursorHidden || p.target?.kind !== 'arrayCell' || q.target?.kind !== 'arrayCell') return null;
    if (p.target.arrayId !== q.target.arrayId) return null;
    const lo = Math.min(p.target.index, q.target.index);
    const hi = Math.max(p.target.index, q.target.index);
    return { arrayId: p.target.arrayId, indexes: Array.from({ length: hi - lo + 1 }, (_, k) => lo + k) };
  }

  /** "new sliding window": agrupa os dois cursores selecionados (ver
   * `_openQuickActions`, que só habilita o comando com exatamente 2
   * ponteiros apontando pra células do mesmo array). Um cursor só pode
   * estar numa janela — agrupar de novo desfaz a anterior. */
  _quickNewSlidingWindow([p, q]) {
    const a = this._microPointerWindowKey(p);
    const b = this._microPointerWindowKey(q);
    // cor única dos dois cursores e do colchete: a cor de um deles, se já
    // tiver (a da janela antiga ou a manual), senão uma da paleta que
    // nenhuma outra janela usa — janelas diferentes ficam distinguíveis
    const own = (x) => this._microPointerWindow(x)?.color ?? this.microColors.get(x.id) ?? null;
    this.microWindows = this.microWindows.filter((w) => ![a, b].includes(w.a) && ![a, b].includes(w.b));
    const used = new Set(this.microWindows.map((w) => w.color));
    const palette = ELEMENT_COLORS.filter(Boolean);
    const color =
      own(p) ?? own(q) ?? palette.find((c) => !used.has(c)) ?? palette[this.microWindows.length % palette.length];
    this.microColors.delete(p.id);
    this.microColors.delete(q.id);
    this.microWindows.push({ a, b, color });
    this.microSelectedIds = new Set([p.id, q.id]);
    this.microSelectedId = p.id;
    this._syncCodeEditorSelection('pointer', p.id);
    this._renderMicroOnly();
  }

  /** "remove sliding window": desfaz a janela de cada cursor selecionado —
   * os dois cursores continuam com a cor que a janela tinha. */
  _quickRemoveSlidingWindow(pointers) {
    pointers.forEach((p) => {
      const color = this._microPointerWindow(p)?.color;
      if (!color) return;
      [p, this._microWindowPartner(p)].forEach((x) => x && this.microColors.set(x.id, color));
    });
    const keys = pointers.map((p) => this._microPointerWindowKey(p));
    this.microWindows = this.microWindows.filter((w) => !keys.includes(w.a) && !keys.includes(w.b));
    this._renderMicroOnly();
  }

  // ---- quick actions (Ctrl+Espaço) ----

  /** Abre (ou fecha, se já aberta) a caixa de comandos — ver
   * QuickActionPalette.js. Cada "new <elemento>" cria o elemento no centro
   * da tela (primeiro espaço livre) e já abre a edição in place do que
   * importa nele: o nome (ponteiro, variável, lista, set, dict, matriz) ou o
   * dado (nós). Esc nessa edição desfaz a criação. Elementos do modelo não
   * podem ser criados durante a reprodução da Simulação (cada passo restaura
   * um snapshot, o elemento sumiria) — labels e áreas, que não fazem parte
   * do modelo, podem. `showAll` (menu ☰): a caixa já abre com a lista
   * inteira de comandos — pelo atalho, ela só mostra os 3 melhores depois
   * do 1º caractere (ver QuickActionPalette.js). */
  _openQuickActions({ showAll = false } = {}) {
    if (this.microQuickActions.isOpen) {
      this.microQuickActions.close({ refocus: true });
      return;
    }
    const previous = document.activeElement;
    const busy = this.microRunner.hasSteps ? 'indisponível na Simulação (volte pro Sandbox)' : null;
    const model = (name, aliases, description, run) => ({ name, aliases, description, disabled: busy, run });
    // janela deslizante: só agrupa (não mexe no modelo) — vale também durante
    // a Simulação, que é justamente quando os cursores "nums[l]"/"nums[r]"
    // aparecem
    const selection = this._microSelectionIds();
    const pointers = selection.map((id) => this.micro.pointers.get(id)).filter(Boolean);
    let windowBlocked = null;
    if (selection.length !== 2 || pointers.length !== 2) {
      windowBlocked = 'selecione 2 cursores (Ctrl+clique) que apontem pro mesmo array';
    } else if (!pointers.every((p) => p.target?.kind === 'arrayCell') || pointers[0].target.arrayId !== pointers[1].target.arrayId) {
      windowBlocked = 'os 2 cursores precisam apontar pra posições do mesmo array';
    } else if (this._microPointerWindowKey(pointers[0]) === this._microPointerWindowKey(pointers[1])) {
      windowBlocked = 'os 2 cursores têm o mesmo nome';
    }
    const inWindow = pointers.filter((p) => this._microWindowPartner(p));
    const windowCommands = [
      {
        name: 'new sliding window',
        aliases: ['new window'],
        description: 'agrupa os 2 cursores selecionados — destaca as posições entre eles',
        disabled: windowBlocked,
        run: () => this._quickNewSlidingWindow(pointers),
      },
      {
        name: 'remove sliding window',
        aliases: ['delete sliding window'],
        description: 'desagrupa os cursores da janela selecionada',
        disabled: inWindow.length ? null : 'selecione um cursor de uma janela deslizante',
        run: () => this._quickRemoveSlidingWindow(inWindow),
      },
    ];
    // alinhar/distribuir: só posição (não mexe no modelo), vale também na
    // Simulação — mesmos botões da AlignToolbar
    const alignable = this._microAlignableIds().length;
    const alignCommands = [
      ['align left', 'left', 'iguala a borda esquerda à do 1º selecionado'],
      ['align center', 'center', 'iguala o centro horizontal ao do 1º selecionado'],
      ['align right', 'right', 'iguala a borda direita à do 1º selecionado'],
      ['align top', 'top', 'iguala a borda de cima à do 1º selecionado'],
      ['align middle', 'middle', 'iguala o centro vertical ao do 1º selecionado'],
      ['align bottom', 'bottom', 'iguala a borda de baixo à do 1º selecionado'],
      ['distribute horizontally', 'distribute-x', 'mesmo espaço entre os elementos, da esquerda à direita'],
      ['distribute vertically', 'distribute-y', 'mesmo espaço entre os elementos, de cima a baixo'],
    ].map(([name, action, description]) => {
      const min = action.startsWith('distribute-') ? 3 : 2;
      return {
        name,
        aliases: [],
        description,
        disabled: alignable >= min ? null : `selecione ${min} ou mais elementos`,
        run: () => this._runMicroAlignAction(action),
      };
    });
    // organizar como árvore: também só posição — mesmos botões da
    // TreeLayoutToolbar
    const treeBlocked = this._microSelectedTreeRoot() ? null : 'selecione um só nó de árvore (TreeNode)';
    const treeCommands = [
      ['layout tree vertical', 'vertical', 'árvore por níveis, um abaixo do outro, a partir do nó selecionado'],
      ['layout tree horizontal', 'horizontal', 'árvore por níveis, um ao lado do outro, a partir do nó selecionado'],
    ].map(([name, orientation, description]) => ({
      name,
      aliases: [],
      description,
      disabled: treeBlocked,
      run: () => this._runMicroTreeLayout(orientation),
    }));
    const commands = [
      model('new pointer', ['new ptr'], 'ponteiro solto — pede o nome', () => this._quickNewPointer()),
      model('new variable', ['new var'], 'variável — pede o nome', () => this._quickNewVariable()),
      model('new node', [], 'nó de lista, Node(v) — pede o dado', () => this._quickNewNode('list')),
      model('new tree node', [], 'nó de árvore, TreeNode(v) — pede o dado', () => this._quickNewNode('tree')),
      model('new graph node', [], 'nó de grafo, GraphNode(v) — pede o dado', () => this._quickNewNode('graph')),
      model('new array', ['new list'], 'lista com 4 posições — pede o nome', () => this._quickNewCollection('array')),
      model('new set', [], 'set vazio — pede o nome', () => this._quickNewCollection('set')),
      model('new deque', ['new queue'], 'deque vazio, deque() — pede o nome', () => this._quickNewCollection('deque')),
      model('new dict', ['new dictionary'], 'dicionário vazio — pede o nome', () => this._quickNewCollection('dict')),
      model('new matrix', [], 'matriz 3×3 — pede o nome', () => this._quickNewCollection('matrix')),
      { name: 'new label', aliases: ['new text'], description: 'texto livre no canvas', run: () => this._quickNewLabel() },
      { name: 'new area', aliases: [], description: 'área retangular pra agrupar elementos', run: () => this._quickNewArea() },
      {
        name: 'new chart',
        aliases: ['new big o chart', 'new complexity chart'],
        description: 'gráfico Big-O — botão direito escolhe as funções',
        run: () => this._quickNewChart(),
      },
      ...windowCommands,
      ...alignCommands,
      ...treeCommands,
    ];
    this.microQuickActions.open(commands, {
      showAll,
      returnFocusTo: previous && previous !== document.body ? previous : this.microView.svg,
    });
  }

  /** Algum ponteiro/variável/lista/dict/matriz GLOBAL (o que o código do
   * topo enxerga) já usa `name`? `exceptIds`: o próprio elemento em edição
   * (e o ponteiro-rótulo dele). */
  _microNameInUse(name, exceptIds = []) {
    const global = (n) => (n.frameId ?? 'global') === 'global' && !exceptIds.includes(n.id);
    return (
      [...this.micro.pointers.values()].some((n) => global(n) && n.label === name) ||
      [...this.micro.variables.values()].some((n) => global(n) && n.name === name) ||
      [...this.micro.arrays.values()].some((n) => global(n) && n.name === name) ||
      [...this.micro.dicts.values()].some((n) => global(n) && n.name === name) ||
      [...this.micro.matrices.values()].some((n) => global(n) && n.name === name)
    );
  }

  /** Nome válido no código e livre, a partir do que foi digitado: o que não
   * é letra/dígito/_ vira "_" ("minha lista" -> "minha_lista"), começar com
   * dígito ganha "_" na frente, e um nome já usado ganha um número no fim
   * ("p" -> "p2"). Sempre devolve algo usável — a edição in place não fica
   * presa num nome inválido. */
  _microFreeName(raw, exceptIds = []) {
    let base = raw.trim().replace(/[^A-Za-z0-9_]/g, '_') || 'x';
    if (/^[0-9]/.test(base)) base = `_${base}`;
    if (!this._microNameInUse(base, exceptIds)) return base;
    for (let i = 2; ; i += 1) {
      if (!this._microNameInUse(`${base}${i}`, exceptIds)) return `${base}${i}`;
    }
  }

  /** Edição in place de um NOME (ponteiro, variável, rótulo de lista/dict/
   * matriz), mesmo editor dos valores (`InlineValueEditor`), crescendo
   * conforme se digita. `rectFor(nome)` dá o retângulo (mundo) do texto do
   * nome pra um nome daquele tamanho. Confirmar aplica `rename` (com o nome
   * já ajustado por `_microFreeName`); Esc ou campo vazio chamam `remove` —
   * o elemento acabou de nascer, cancelar é desistir de criá-lo.
   * `interpret(texto)` (opcional) vem antes: devolvendo true, o texto já foi
   * tratado de outro jeito e `rename` não é chamado (ver `_quickNewPointer`). */
  _editMicroNameInPlace({ initial, rectFor, fontSize, exceptIds, rename, remove, interpret }) {
    const scale = this.microViewport.scale;
    const done = () => this._renderMicroOnly();
    this.microInlineEditor.open(
      this._microWorldRectToScreen(rectFor(initial)),
      initial,
      fontSize * scale,
      (text) => {
        if (!text.trim()) remove();
        else if (!interpret?.(text)) rename(this._microFreeName(text, exceptIds));
        done();
      },
      {
        type: 'text',
        onCancel: () => {
          remove();
          done();
        },
        // `x`/`y` também: um nome ancorado pela direita (ver
        // `_quickNewCollection`) cresce pra esquerda
        autoGrow: (value) => this._microWorldRectToScreen(rectFor(value || ' ')),
        returnFocusTo: this.microView.svg,
      },
    );
  }

  /** Desfaz a criação de um elemento recém-criado (Esc na edição in place). */
  _quickDiscard(id) {
    this._microRemoveById(id);
    if (this.microSelectedId === id) this._selectMicroElement(null, null);
  }

  /** Posição de onde um cursor pode nascer, sob o ponto, na coleção `node`
   * (array ou matriz) — ou null. Índice de array (ver
   * _findMicroArrayIndexAt) sempre; com `shift`, também a própria célula do
   * array ou da matriz. Devolve `{index}` (array) ou `{row, col}` (matriz). */
  _findMicroCursorCellAt(node, worldPt, shift) {
    if (!node) return null;
    if (this.micro.matrices.has(node.id)) {
      const c = shift ? this._findMicroMatrixCellAt(worldPt) : null;
      return c?.matrix.id === node.id ? { row: c.row, col: c.col } : null;
    }
    if (node.isSet) return null;
    let index = this._findMicroArrayIndexAt(node, worldPt);
    if (index == null && shift) {
      const c = this._findMicroArrayCellAt(worldPt);
      if (c?.array.id === node.id) index = c.index;
    }
    return index == null ? null : { index };
  }

  /** Cria o cursor de leitura da posição `cell` (ver _findMicroCursorCellAt)
   * da coleção `collectionId` em (x, y) — "nums[2]" / "m[1][0]", o mesmo que
   * "new pointer" com esse nome criaria (ver
   * MicroRuntimeAdapter#adoptReadCursor). Se esse cursor já existe, o
   * ponteiro novo é descartado e é o existente que volta. Coleção sem nome
   * no código (lista de vizinhos de um nó de grafo) ganha um ponteiro comum
   * apontando pra posição. Devolve o id do cursor, ou null. */
  _createMicroIndexCursor(collectionId, cell, x, y) {
    const matrix = this.micro.matrices.get(collectionId);
    const coll = matrix ?? this.micro.arrays.get(collectionId);
    if (!coll) return null;
    let target;
    let expr;
    if (matrix) {
      if (cell.row >= matrix.cells.length || cell.col >= (matrix.cells[cell.row]?.length ?? 0)) return null;
      target = { kind: 'matrixCell', matrixId: matrix.id, row: cell.row, col: cell.col };
      expr = `${matrix.name}[${cell.row}][${cell.col}]`;
    } else {
      if (cell.index >= coll.cells.length) return null;
      target = { kind: 'arrayCell', arrayId: coll.id, index: cell.index };
      expr = `${coll.name}[${cell.index}]`;
    }
    const node = this.micro.addPointer(x, y, this._microFreeName('p'));
    this.micro.setPointerTarget(node.id, target);
    if (!coll.name || coll.name.startsWith('__')) return node.id;
    const parsed = parseExpression(expr);
    return (parsed.ok && this.microRuntime.adoptReadCursor(node.id, parsed.ast)) || node.id;
  }

  /** Arraste a partir do índice de um array, ou com Shift a partir de uma
   * célula de array/matriz (ver _findMicroCursorCellAt), no primeiro
   * movimento: nasce o cursor de leitura dessa posição, já selecionado, e o
   * gesto vira o arraste DELE — sai preso ao mouse e fica onde for solto,
   * sem pedir nome. */
  _startMicroIndexCursorDrag(worldPt) {
    const gesture = this._microPointer;
    const cell = gesture.cursorCell;
    gesture.cursorCell = null;
    // segura o ponteiro pela ponta esquerda, na altura do meio
    const grabOffset = { x: 10, y: PTR_H / 2 };
    const id = this._createMicroIndexCursor(gesture.id, cell, worldPt.x - grabOffset.x, worldPt.y - grabOffset.y);
    if (id == null) return;
    this._selectMicroElement('pointer', id);
    Object.assign(gesture, { hit: 'pointer', id, grabOffset, groupStart: null });
  }

  /** Shift+clique (sem arraste) numa célula: o mesmo cursor do arraste
   * acima, num espaço livre logo abaixo da célula (à direita, num array
   * vertical). Um cursor que já existia fica onde estava — só é selecionado. */
  _createMicroIndexCursorNearCell(collectionId, cell) {
    const matrix = this.micro.matrices.get(collectionId);
    const arr = matrix ? null : this.micro.arrays.get(collectionId);
    const w = pointerWidth({ label: 'p' }, this.microFullNames);
    let desired;
    if (matrix) {
      const r = matrixCellRect(matrix, cell.row, cell.col);
      desired = { x: r.x + r.width / 2 - w / 2, y: matrix.y + matrixLayout(matrix).height + 30 };
    } else if (arr) {
      const layout = arrayLayout(arr);
      const c = layout.cells[cell.index];
      if (!c) return;
      desired =
        isVerticalOrientation(arr.orientation)
          ? { x: arr.x + layout.width + 40, y: arr.y + c.y + c.h / 2 - PTR_H / 2 }
          : { x: arr.x + c.x + c.w / 2 - w / 2, y: arr.y + layout.height + 30 };
    } else return;
    const pos = this._findFreeMicroPosition(desired, w, PTR_H);
    const id = this._createMicroIndexCursor(collectionId, cell, pos.x, pos.y);
    if (id == null) return;
    this.microSelectedIds = new Set();
    this._selectMicroElement('pointer', id);
  }

  _quickNewPointer() {
    const pos = this._microCreatePosition('pointer');
    const node = this.micro.addPointer(pos.x, pos.y, this._microFreeName('p'));
    this._selectMicroElement('pointer', node.id);
    this._renderMicroOnly();
    this._editMicroNameInPlace({
      initial: node.label,
      // nome inteiro (`fullNames`), mesmo fora do modo de nomes completos —
      // o que está sendo digitado precisa caber
      rectFor: (label) => ({ x: node.x, y: node.y, width: pointerWidth({ label }, true), height: PTR_H }),
      fontSize: 14, // = .pointer-label (canvas.css)
      exceptIds: [node.id],
      rename: (name) => this.micro.renamePointer(node.id, name),
      remove: () => this._quickDiscard(node.id),
      // "nums[i]" / "nums[1]" / "m[i][j]": cursor de leitura de verdade
      // (aponta já pra posição e anda junto com "i"), não um ponteiro
      // chamado "nums_i" — ver MicroRuntimeAdapter#adoptReadCursor
      interpret: (text) => {
        const parsed = parseExpression(text.trim());
        if (!parsed.ok || parsed.ast.type !== 'Index') return false;
        const cursorId = this.microRuntime.adoptReadCursor(node.id, parsed.ast);
        if (cursorId == null) {
          this.microRuntime.warn(`"${text.trim()}" não é uma posição de lista/matriz existente — criado um ponteiro comum.`);
          return false;
        }
        this._selectMicroElement('pointer', cursorId);
        return true;
      },
    });
  }

  _quickNewVariable() {
    const pos = this._microCreatePosition('variable');
    const node = this.micro.addVariable(pos.x, pos.y, this._microFreeName('x'), 0);
    this._selectMicroElement('variable', node.id);
    this._renderMicroOnly();
    this._editMicroNameInPlace({
      initial: node.name,
      // cabeçalho da caixa (onde o nome aparece)
      rectFor: (name) => ({ x: node.x, y: node.y, width: variableWidth({ name, value: node.value }, true), height: VAR_HEADER_H }),
      fontSize: 12, // = .variable-name (canvas.css)
      exceptIds: [node.id],
      rename: (name) => this.micro.renameVariable(node.id, name),
      remove: () => this._quickDiscard(node.id),
    });
  }

  /** Nó de lista/árvore/grafo — nó de grafo ganha o array de vizinhos
   * anônimo, igual "GraphNode(v)" no código (ver MicroRuntimeAdapter#createStruct). */
  _quickNewNode(type) {
    const pos = this._microCreatePosition('struct');
    const node = this.micro.addStruct(pos.x, pos.y, 0, type);
    if (type === 'graph') {
      const arrPos = this._microCreatePosition('array', 0);
      const arr = this.micro.addArray(arrPos.x, arrPos.y, { kind: 'ref', size: 0, name: `__graph_neighbors_${node.id}` });
      this.micro.setStructNeighborsArray(node.id, arr.id);
    }
    this._selectMicroElement('struct', node.id);
    this._renderMicroOnly();
    this._openMicroDataPopup(node, {
      onCancel: () => {
        this._quickDiscard(node.id);
        this._renderMicroOnly();
      },
    });
  }

  /** Lista, set, deque, dict ou matriz — com o ponteiro-rótulo de sempre (o nome
   * visível no canvas), cujo nome é editado in place. Sem `microLayout`
   * (ver `_createArrayLabelPointer`): o nome inicial é provisório, não
   * deve virar posição lembrada. */
  _quickNewCollection(kind) {
    let node;
    if (kind === 'array') {
      const pos = this._microCreatePosition('array', 4);
      node = this.micro.addArray(pos.x, pos.y, { size: 4, name: this._microFreeName('arr') });
    } else if (kind === 'set') {
      const pos = this._microCreatePosition('array', 1);
      node = this.micro.addArray(pos.x, pos.y, { size: 0, name: this._microFreeName('s'), isSet: true });
    } else if (kind === 'deque') {
      const pos = this._microCreatePosition('array', 1);
      node = this.micro.addArray(pos.x, pos.y, { size: 0, name: this._microFreeName('q'), isDeque: true });
    } else if (kind === 'dict') {
      const pos = this._microCreatePosition('dict', 1);
      node = this.micro.addDict(pos.x, pos.y, { name: this._microFreeName('d') });
    } else {
      const pos = this._microCreatePosition('matrix', { rows: 3, cols: 3 });
      node = this.micro.addMatrix(pos.x, pos.y, { name: this._microFreeName('m'), cells: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] });
    }
    const labelPos = this._microPointerSpotNear(node.id, node.name, { movable: true });
    const label = this.micro.addPointer(labelPos.x, labelPos.y, node.name);
    // o rótulo fica à esquerda da coleção: cresce pra ESQUERDA conforme o
    // nome é digitado, com a ponta direita (e a seta) parada
    const right = label.x + pointerWidth(label, this.microFullNames);
    const modelKind = kind === 'set' || kind === 'deque' ? 'array' : kind;
    if (modelKind === 'array') this.micro.linkArrayLabelPointer(node.id, label.id);
    else if (modelKind === 'dict') this.micro.linkDictLabelPointer(node.id, label.id);
    else this.micro.linkMatrixLabelPointer(node.id, label.id);
    this._selectMicroElement(modelKind, node.id);
    this._renderMicroOnly();
    const rename = {
      array: (name) => this.micro.renameArray(node.id, name),
      dict: (name) => this.micro.renameDict(node.id, name),
      matrix: (name) => this.micro.renameMatrix(node.id, name),
    }[modelKind];
    this._editMicroNameInPlace({
      initial: node.name,
      rectFor: (name) => {
        const width = pointerWidth({ label: name }, true);
        return { x: right - width, y: label.y, width, height: PTR_H };
      },
      fontSize: 14, // = .pointer-label (canvas.css)
      exceptIds: [node.id, label.id],
      rename: (name) => {
        rename(name);
        label.x = right - pointerWidth(label, this.microFullNames);
        this._syncCodeEditorSelection(modelKind, node.id);
      },
      remove: () => this._quickDiscard(node.id),
    });
  }

  _quickNewLabel() {
    const center = this._microViewportCenter();
    this._startCreateMicroLabel(null, { x: center.x - 40, y: center.y - LABEL_DEFAULT_FONT_SIZE });
  }

  _quickNewArea() {
    const center = this._microViewportCenter();
    const a = { x: center.x - 120, y: center.y - 80 };
    const b = { x: center.x + 120, y: center.y + 80 };
    this._createMicroArea(this._microAreaRectFromDrag(a, b, !this.microAreaSnap));
    this._renderMicroOnly();
  }

  _quickNewChart() {
    const center = this._microViewportCenter();
    const { width, height } = CHART_DEFAULT_SIZE;
    this._createMicroChart({ x: center.x - width / 2, y: center.y - height / 2, width, height });
    this._renderMicroOnly();
  }

  /** Modo "Texto": clique (sem arraste) em espaço vazio cria uma label ali,
   * já em edição IN PLACE (o texto é digitado direto em cima da label no
   * canvas, não num popup à parte — ver `_editMicroLabelInPlace`). Confirmar
   * sem digitar nada (Enter/perder o foco com o campo vazio) ou cancelar
   * (Esc) descarta a label recém-criada. Volta pro modo Selecionar assim que
   * a edição termina, de um jeito ou de outro. */
  _startCreateMicroLabel(screenPt, worldPt) {
    const id = nextId('label');
    const node = { id, x: worldPt.x, y: worldPt.y, text: '', color: this.microLabelColor, fontSize: LABEL_DEFAULT_FONT_SIZE };
    this.microLabels.set(id, node);
    this.microSelectedId = id;
    this.microSelectedIds = new Set();
    this._renderMicroOnly();
    this._editMicroLabelInPlace(node, { isNew: true });
  }

  /** Edição de texto in place de uma label — mesmo padrão de
   * `_openMicroDataPopup`/`_openMicroVariablePopup` (um campo sobreposto
   * exatamente em cima do elemento no canvas, via `InlineValueEditor`), só
   * que de texto multi-linha (`<textarea>`: Enter confirma, Shift+Enter
   * quebra a linha). Serve tanto pra label nova (`isNew`, caminho de
   * _startCreateMicroLabel — descartada se o usuário não confirmar nada ou
   * cancelar com Esc) quanto pra editar uma existente (clique numa label já
   * selecionada, ou Enter com ela selecionada — texto vazio/Esc mantém o
   * texto anterior). Alt+1…Alt+0 durante a edição troca a cor da label. */
  _editMicroLabelInPlace(node, { isNew = false } = {}) {
    const scale = this.microViewport.scale;
    const { width, height } = labelSize(node.text, node.fontSize);
    const rect = this._microWorldRectToScreen({ x: node.x, y: node.y, width, height });
    const fontSize = node.fontSize * scale;
    this._microEditingLabelId = node.id;
    this.microSelectedIds = new Set();
    this.microSelectedId = node.id;
    this._renderMicroOnly();
    const finish = () => {
      this._microEditingLabelId = null;
      this._setMicroMode('select');
      this._renderMicroOnly();
    };
    this.microInlineEditor.open(
      rect,
      node.text,
      fontSize,
      (text) => {
        // tira linhas/espaços sobrando nas pontas e no fim de cada linha
        const cleaned = text.split('\n').map((l) => l.replace(/\s+$/, '')).join('\n').trim();
        if (!cleaned) {
          if (isNew) this.microLabels.delete(node.id);
        } else {
          node.text = cleaned;
        }
        finish();
      },
      {
        type: 'text',
        multiline: true,
        // mesma geometria do render (padding/altura de linha/cor, ver
        // _renderLabels em MicroCanvasView.js) — o texto não "pula" ao
        // entrar/sair da edição
        style: {
          padding: `${LABEL_PAD_Y * scale}px ${LABEL_PAD_X * scale}px`,
          lineHeight: `${node.fontSize * LABEL_LINE_HEIGHT * scale}px`,
          color: labelCssColor(node.color),
        },
        onKeyDown: (e, el) => {
          const index = this._paletteIndexFromKey(e);
          if (index == null) return false;
          node.color = TEXT_COLORS[index];
          this.microLabelColor = node.color;
          el.style.color = labelCssColor(node.color);
          this._renderMicroOnly();
          return true;
        },
        onCancel: () => {
          if (isNew) this.microLabels.delete(node.id);
          finish();
        },
        // o campo cresce (largura/altura) a cada tecla, acompanhando a MESMA
        // geometria do render de verdade (labelSize) — sem isso o texto digitado
        // não cabia no campo, ficando ilegível (ver relato do usuário).
        autoGrow: (value) => {
          const size = labelSize(value, node.fontSize);
          return { width: size.width * scale, height: size.height * scale };
        },
        returnFocusTo: this.microView.svg,
      },
    );
  }

  /** Botão direito sobre uma label (modo Selecionar) — mesmo padrão de
   * `_openMicroArraySettingsPopup`/`_openMicroDictSettingsPopup`. */
  _openMicroLabelSettingsPopup(node, screenPt) {
    this.microLabelSettingsPopup.open(screenPt.x, screenPt.y, node, {
      returnFocusTo: this.microView.svg,
      onSave: ({ text, color, fontSize }) => {
        node.text = text;
        node.color = color;
        node.fontSize = fontSize;
        this._renderMicroOnly();
      },
      onRemove: () => {
        this.microLabels.delete(node.id);
        this.microSelectedIds.delete(node.id);
        if (this.microSelectedId === node.id) {
          this.microSelectedId = null;
          this._syncCodeEditorSelection(null, null);
        }
        this._renderMicroOnly();
      },
    });
  }

  /** Ponto (mundo) do alvo atual de um ponteiro — usado só para decidir de qual
   * lado da caixa (esquerda/direita/cima/baixo) o pino de conexão deve sair. */
  _pointerAnchor(pointer) {
    if (!pointer.target) return null;
    if (pointer.target.kind === 'struct') {
      const s = this.micro.structs.get(pointer.target.id);
      return s ? { x: s.x + STRUCT_W / 2, y: s.y + STRUCT_H / 2 } : null;
    }
    if (pointer.target.kind === 'arrayCell') {
      const arr = this.micro.arrays.get(pointer.target.arrayId);
      if (!arr) return null;
      const cell = arrayLayout(arr).cells[pointer.target.index];
      return cell ? { x: arr.x + cell.x + cell.w / 2, y: arr.y + cell.y + cell.h / 2 } : null;
    }
    if (pointer.target.kind === 'array') {
      const arr = this.micro.arrays.get(pointer.target.id);
      if (!arr) return null;
      const { width } = arrayLayout(arr);
      return { x: arr.x + width / 2, y: arr.y };
    }
    if (pointer.target.kind === 'dictCell') {
      const dict = this.micro.dicts.get(pointer.target.dictId);
      if (!dict) return null;
      const i = dict.cells.findIndex((c) => c.key === pointer.target.key);
      const cell = i === -1 ? null : dictLayout(dict).cells[i];
      return cell ? { x: dict.x + cell.x + cell.w / 2, y: dict.y + cell.y + cell.h / 2 } : null;
    }
    if (pointer.target.kind === 'dict') {
      const dict = this.micro.dicts.get(pointer.target.id);
      if (!dict) return null;
      const { width } = dictLayout(dict);
      return { x: dict.x + width / 2, y: dict.y };
    }
    if (pointer.target.kind === 'matrixCell') {
      const m = this.micro.matrices.get(pointer.target.matrixId);
      if (!m) return null;
      const r = matrixCellRect(m, pointer.target.row, pointer.target.col);
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }
    if (pointer.target.kind === 'matrix') {
      const m = this.micro.matrices.get(pointer.target.id);
      if (!m) return null;
      const { width } = matrixLayout(m);
      return { x: m.x + width / 2, y: m.y };
    }
    return null;
  }

  /** Ponto (mundo) do struct apontado por um campo prev/next — mesma ideia de
   * `_pointerAnchor`, mas pro pino prev/next de um struct. */
  _structFieldAnchor(targetStructId) {
    if (!targetStructId) return null;
    const s = this.micro.structs.get(targetStructId);
    return s ? { x: s.x + STRUCT_W / 2, y: s.y + STRUCT_H / 2 } : null;
  }

  /** Quando dois nós têm uma ligação "de volta" (ex: A.next -> B e B.prev -> A,
   * o caso comum de lista duplamente ligada com vizinhos lado a lado), os dois
   * pinos naturalmente calculariam a mesma posição — pra separar isso de forma
   * genérica (não hardcoded em "next sobe, prev desce"), agrupamos TODAS as
   * ligações struct->struct pelo par não-ordenado de nós que elas conectam;
   * grupos com mais de uma ligação (ida e volta) recebem um pequeno desvio
   * simétrico, na direção perpendicular à reta que une os CENTROS dos dois
   * nós (canônica: a mesma pra ambos os lados da ligação, senão o desvio de um
   * cancelaria o do outro) — distribuído em ordem determinística (por
   * "structId:campo").
   *
   * Importante: o desvio é somado direto ao ponto já resolvido pelo pino, sem
   * reclampar na borda da célula. Em nós vizinhos "em escada" (bordas
   * alinhadas na diagonal, ex: nó 2 embaixo e à direita do nó 1 com as bordas
   * laterais coincidindo), os dois pinos convergem pro MESMO canto — ali as
   * duas bordas que formam o canto colapsam num único ponto sem folga lateral,
   * então só um leve deslocamento pra fora da borda consegue separá-los de
   * fato (por isso não fica restrito à própria borda nesse caso).
   *
   * Retorna um Map de "structId:campo" -> {x,y} (offset em px, {0,0} se não
   * houver par). */
  _computeStructPairOffsets() {
    const fieldLinks = [];
    for (const n of this.micro.structs.values()) {
      if (n.prev) fieldLinks.push({ ownerId: n.id, field: 'prev', targetId: n.prev });
      if (n.next) fieldLinks.push({ ownerId: n.id, field: 'next', targetId: n.next });
    }
    const groups = new Map();
    fieldLinks.forEach((link) => {
      const key = [link.ownerId, link.targetId].sort().join('|');
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(link);
    });
    const PAIR_PIN_STEP = 18; // px de afastamento entre pinos de um mesmo par
    const offsets = new Map();
    groups.forEach((group, key) => {
      if (group.length < 2) return; // ligação única (sem "volta"): sem desvio
      const [idA, idB] = key.split('|');
      const a = this.micro.structs.get(idA);
      const b = this.micro.structs.get(idB);
      if (!a || !b) return;
      // direção canônica: centro a centro dos dois nós do par — estável e
      // compartilhada pelas duas pontas da ligação, não depende de qual
      // campo/porta está sendo calculada
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const perp = { x: -dy / len, y: dx / len };

      group.sort((l1, l2) => {
        const k1 = `${l1.ownerId}:${l1.field}`;
        const k2 = `${l2.ownerId}:${l2.field}`;
        return k1 < k2 ? -1 : k1 > k2 ? 1 : 0;
      });
      const n = group.length;
      group.forEach((link, i) => {
        const mag = (i - (n - 1) / 2) * PAIR_PIN_STEP;
        offsets.set(`${link.ownerId}:${link.field}`, { x: perp.x * mag, y: perp.y * mag });
      });
    });
    return offsets;
  }

  _findMicroPortAt(worldPt) {
    const HIT_R = 10;
    const pairOffsets = this._computeStructPairOffsets();
    for (const node of this.micro.structs.values()) {
      if (!this._microPickable(node)) continue;
      // struct 'graph' não tem pino prev/next arrastável — "neighbors" é uma
      // LISTA (ver MicroModel#setStructNeighborsArray), e o gesto de religar
      // é outro: a ferramenta "Ligar nós" (5/L, ou Shift + arraste no nó),
      // que põe o alvo no FIM da lista ou o tira dela (ver
      // `_applyMicroLink`/MicroModel#toggleStructNeighbor). Sem esse
      // `continue`, um arraste nessa área acabaria escrevendo direto em
      // `model.next` (campo que graph nunca usa/desenha) através do caminho
      // genérico de baixo, um estado fantasma que nada mais leria de volta.
      if (node.type === 'graph') continue;
      const prev = structPrevPort(
        {
          ...node,
          prevAnchor: this._structFieldAnchor(node.prev),
          prevPairOffset: pairOffsets.get(`${node.id}:prev`),
        },
        this.microSimplifiedNodes,
      );
      if (Math.hypot(prev.x - worldPt.x, prev.y - worldPt.y) <= HIT_R) return { ownerKind: 'struct', ownerId: node.id, field: 'prev' };
      const next = structNextPort(
        {
          ...node,
          nextAnchor: this._structFieldAnchor(node.next),
          nextPairOffset: pairOffsets.get(`${node.id}:next`),
        },
        this.microSimplifiedNodes,
      );
      if (Math.hypot(next.x - worldPt.x, next.y - worldPt.y) <= HIT_R) return { ownerKind: 'struct', ownerId: node.id, field: 'next' };
    }
    for (const node of this.micro.pointers.values()) {
      if (!this._microPickable(node)) continue;
      const p = pointerPort({ ...node, anchor: this._pointerAnchor(node) }, this.microFullNames);
      if (Math.hypot(p.x - worldPt.x, p.y - worldPt.y) <= HIT_R) return { ownerKind: 'pointer', ownerId: node.id, field: 'target' };
    }
    for (const node of this.micro.arrays.values()) {
      if (!this._microPickable(node)) continue;
      if (node.kind !== 'ref') continue;
      const layout = arrayLayout(node);
      for (const c of layout.cells) {
        const p = { x: node.x + c.port.x, y: node.y + c.port.y };
        if (Math.hypot(p.x - worldPt.x, p.y - worldPt.y) <= HIT_R) {
          return { ownerKind: 'arrayCell', ownerId: node.id, field: 'ref', index: c.index };
        }
      }
    }
    for (const node of this.micro.dicts.values()) {
      if (!this._microPickable(node)) continue;
      const layout = dictLayout(node);
      for (let i = 0; i < layout.cells.length; i += 1) {
        if (node.cells[i]?.kind !== 'ref') continue;
        const c = layout.cells[i];
        const p = { x: node.x + c.port.x, y: node.y + c.port.y };
        if (Math.hypot(p.x - worldPt.x, p.y - worldPt.y) <= HIT_R) {
          return { ownerKind: 'dictCell', ownerId: node.id, field: 'ref', key: c.key };
        }
      }
    }
    return null;
  }

  _microPortWorldPos(port) {
    if (port.ownerKind === 'struct') {
      const node = this.micro.structs.get(port.ownerId);
      if (!node) return null;
      const pairOffsets = this._computeStructPairOffsets();
      return port.field === 'prev'
        ? structPrevPort(
            {
              ...node,
              prevAnchor: this._structFieldAnchor(node.prev),
              prevPairOffset: pairOffsets.get(`${node.id}:prev`),
            },
            this.microSimplifiedNodes,
          )
        : structNextPort(
            {
              ...node,
              nextAnchor: this._structFieldAnchor(node.next),
              nextPairOffset: pairOffsets.get(`${node.id}:next`),
            },
            this.microSimplifiedNodes,
          );
    }
    if (port.ownerKind === 'arrayCell') {
      const node = this.micro.arrays.get(port.ownerId);
      if (!node) return null;
      const cell = arrayLayout(node).cells[port.index];
      return cell ? { x: node.x + cell.port.x, y: node.y + cell.port.y } : null;
    }
    if (port.ownerKind === 'dictCell') {
      const node = this.micro.dicts.get(port.ownerId);
      if (!node) return null;
      const i = node.cells.findIndex((c) => c.key === port.key);
      const cell = i === -1 ? null : dictLayout(node).cells[i];
      return cell ? { x: node.x + cell.port.x, y: node.y + cell.port.y } : null;
    }
    const node = this.micro.pointers.get(port.ownerId);
    return node ? pointerPort({ ...node, anchor: this._pointerAnchor(node) }, this.microFullNames) : null;
  }

  /** Resolve o alvo válido sob `worldPt` para o arraste de um pino específico.
   * Pinos de ponteiro solto podem mirar em um struct OU numa célula de array;
   * pinos de campo (prev/next de struct, ou célula de array de referências)
   * só miram em structs. */
  _resolveMicroDropTarget(port, worldPt) {
    if (port.ownerKind === 'pointer') {
      // puxador: a coleção inteira, não uma posição
      const arrayHandle = this._findMicroHandleAt(this.micro.arrays, arrayHandleRect, worldPt);
      if (arrayHandle) return { kind: 'array', id: arrayHandle.id };
      const dictHandle = this._findMicroHandleAt(this.micro.dicts, dictHandleRect, worldPt);
      if (dictHandle) return { kind: 'dict', id: dictHandle.id };
      const matrixHandle = this._findMicroHandleAt(this.micro.matrices, matrixHandleRect, worldPt);
      if (matrixHandle) return { kind: 'matrix', id: matrixHandle.id };
      const cellHit = this._findMicroArrayCellAt(worldPt);
      if (cellHit) return { kind: 'arrayCell', arrayId: cellHit.array.id, index: cellHit.index };
      const dictCellHit = this._findMicroDictCellAt(worldPt);
      if (dictCellHit) return { kind: 'dictCell', dictId: dictCellHit.dict.id, key: dictCellHit.key };
      const matrixCellHit = this._findMicroMatrixCellAt(worldPt);
      if (matrixCellHit) return { kind: 'matrixCell', matrixId: matrixCellHit.matrix.id, row: matrixCellHit.row, col: matrixCellHit.col };
      const structNode = this._findMicroStructAt(worldPt);
      return structNode ? { kind: 'struct', id: structNode.id } : null;
    }
    const structNode = this._findMicroStructAt(worldPt);
    return structNode ? { kind: 'struct', id: structNode.id } : null;
  }

  // ---- modo micro: ferramenta "Ligar nós" ----

  _microStructContains(node, worldPt) {
    return worldPt.x >= node.x && worldPt.x <= node.x + STRUCT_W && worldPt.y >= node.y && worldPt.y <= node.y + STRUCT_H;
  }

  /** Ponteiro que a ferramenta "Ligar nós" usa começando no ponto `worldPt`
   * de `node`: a metade esquerda é 'prev' (prev do Node, left do TreeNode) e
   * a direita 'next' (next/right) — `null` num nó de grafo, que liga pela
   * lista "neighbors" (ver `_applyMicroLink`). */
  _microLinkFieldAt(node, worldPt) {
    if (node.type === 'graph') return null;
    return worldPt.x < node.x + STRUCT_W / 2 ? 'prev' : 'next';
  }

  /** Destino válido de uma ligação que sai do struct `fromId`: outro struct
   * visível do MESMO tipo sob o ponto (Node com Node, TreeNode com TreeNode,
   * nó de grafo com nó de grafo). O próprio nó de origem não é destino
   * (nem o que estiver atrás dele). */
  _findMicroLinkTarget(fromId, worldPt) {
    const from = this.micro.structs.get(fromId);
    if (!from || this._microStructContains(from, worldPt)) return null;
    for (const node of this.micro.structs.values()) {
      if (node.id === fromId || node.type !== from.type || !this._microPickable(node)) continue;
      if (this._microStructContains(node, worldPt)) return node;
    }
    return null;
  }

  /** Há algum elemento do canvas sob o ponto? Com a ferramenta "Ligar nós",
   * clicar onde NÃO há nenhum volta pra Selecionar (ver
   * `_onMicroLinkPointerDown`). */
  _microElementAt(worldPt) {
    return !!(
      this._findMicroStructAt(worldPt) ||
      this._findMicroPointerAt(worldPt) ||
      this._findMicroVariableAt(worldPt) ||
      this._findMicroArrayAt(worldPt) ||
      this._findMicroDictAt(worldPt) ||
      this._findMicroMatrixAt(worldPt) ||
      this._findMicroLabelAt(worldPt) ||
      this._findMicroChartAt(worldPt) ||
      this._findMicroAreaAt(worldPt)
    );
  }

  /** Clique esquerdo com a ferramenta "Ligar nós" (5/L). O padrão é clicar
   * no nó de origem — na metade do ponteiro desejado, ver `_microLinkFieldAt`
   * — e depois no de destino: o primeiro clique deixa a ligação pendente
   * (`_microLinkDraft.pending`, a seta de rascunho segue o mouse e Tab troca
   * prev↔next, ver `_onKeyDown`), o segundo a conclui (`_applyMicroLink`).
   * Shift + arraste a partir do nó liga ao soltar (`_startMicroLinkDrag`).
   * Clicar de novo no nó de origem recomeça com a metade clicada; num
   * elemento que não serve de destino, nada; em espaço vazio, volta pra
   * Selecionar. O botão direito cancela a ligação pendente sem trocar de
   * ferramenta (ver `_onMicroContextMenu`). */
  _onMicroLinkPointerDown(e, screenPt, worldPt) {
    const draft = this._microLinkDraft;
    if (draft?.pending) {
      const target = this._findMicroLinkTarget(draft.fromId, worldPt);
      const from = this.micro.structs.get(draft.fromId);
      if (target) {
        this._applyMicroLink(draft.fromId, draft.field, target.id);
        this._cancelMicroLink(worldPt);
      } else if (from && this._microStructContains(from, worldPt)) {
        this._microLinkDraft = { ...draft, field: this._microLinkFieldAt(from, worldPt), toPt: worldPt };
        this._renderMicroOnly();
      } else if (!this._microElementAt(worldPt)) {
        this._setMicroMode('select');
      }
      return;
    }
    const node = this._findMicroStructAt(worldPt);
    if (!node) {
      if (!this._microElementAt(worldPt)) this._setMicroMode('select');
      return;
    }
    const field = this._microLinkFieldAt(node, worldPt);
    if (e.shiftKey) {
      this._startMicroLinkDrag(node, field, screenPt, worldPt);
      return;
    }
    this._microLinkHover = null;
    this._microLinkDraft = { fromId: node.id, field, toPt: worldPt, targetId: null, pending: true };
    this._renderMicroOnly();
  }

  /** Desiste da ligação em andamento (botão direito, Esc, ou depois de
   * concluí-la) — a ferramenta continua escolhida, e o destaque de hover
   * volta pro nó sob `worldPt`, se houver. */
  _cancelMicroLink(worldPt = null) {
    this._microLinkDraft = null;
    this._microLinkHover = null;
    if (worldPt) this._updateMicroLinkHover(worldPt);
    this._renderMicroOnly();
  }

  /** Tab com uma ligação pendente de Node/TreeNode: troca o ponteiro usado
   * (prev↔next, left↔right). Num nó de grafo (um só, "neighbors") não faz
   * nada. Devolve se tratou a tecla. */
  _toggleMicroLinkField() {
    const draft = this._microLinkDraft;
    if (!draft?.pending || draft.field == null) return false;
    this._microLinkDraft = { ...draft, field: draft.field === 'prev' ? 'next' : 'prev' };
    this._renderMicroOnly();
    return true;
  }

  /** Mouse parado sobre o canvas (sem botão pressionado) com a ferramenta
   * "Ligar nós": com uma ligação pendente, a seta de rascunho segue o mouse;
   * sem, destaca a metade do nó sob ele (o ponteiro que um clique ali
   * usaria). Só re-renderiza quando algo muda. */
  _updateMicroLinkHover(worldPt) {
    if (this.microMode !== 'link' || this._microPointer) return;
    const draft = this._microLinkDraft;
    if (draft?.pending) {
      this._microLinkDraft = { ...draft, toPt: worldPt, targetId: this._findMicroLinkTarget(draft.fromId, worldPt)?.id ?? null };
      this._renderMicroOnly();
      return;
    }
    const node = worldPt ? this._findMicroStructAt(worldPt) : null;
    const next = node ? { id: node.id, field: this._microLinkFieldAt(node, worldPt) } : null;
    const cur = this._microLinkHover;
    if (cur === next || (cur && next && cur.id === next.id && cur.field === next.field)) return;
    this._microLinkHover = next;
    this._renderMicroOnly();
  }

  /** Começa o arraste de ligação a partir de `node`, pelo ponteiro `field`
   * — Shift + arraste com a ferramenta "Ligar nós" (5/L) ou no modo
   * Selecionar. A seta de rascunho (`_microLinkDraft`) segue o mouse; ao
   * soltar sobre um nó do mesmo tipo, `_applyMicroLink` liga ou desliga.
   * Como os arrastes de pino (`_microPortDrag`), vale também durante a
   * reprodução da Simulação — a mudança fica no passo em exibição até a
   * reprodução trocar de passo. */
  _startMicroLinkDrag(node, field, screenPt, worldPt) {
    this._microLinkHover = null;
    this._microPointer = {
      downScreen: screenPt,
      lastScreen: screenPt,
      moved: false,
      hit: 'link-drag',
      id: node.id,
      field,
      worldPtDown: worldPt,
    };
    window.addEventListener('pointermove', this._microBoundMove);
    window.addEventListener('pointerup', this._microBoundUp);
  }

  /** Conclui uma ligação `fromId` → `toId` pelo ponteiro `field`: num Node/
   * TreeNode, aponta prev/next (left/right) pro destino — ou o anula, se já
   * apontava pra ele (repetir desliga, como no grafo); num nó de grafo
   * (`field` null), liga/desliga a aresta (`_toggleMicroGraphNeighbor`). */
  _applyMicroLink(fromId, field, toId) {
    if (field == null) {
      this._toggleMicroGraphNeighbor(fromId, toId);
      return;
    }
    const from = this.micro.structs.get(fromId);
    if (!from) return;
    this.micro.setField(fromId, field, from[field] === toId ? null : toId);
  }

  /** Liga/desliga a aresta direcionada `fromId` → `toId` (ver
   * MicroModel#toggleStructNeighbor): entra no fim de "neighbors" ou sai
   * dele. Um nó de grafo sem lista de vizinhos (projeto antigo) ganha uma
   * num lugar livre, como "GraphNode(v)" faria. */
  _toggleMicroGraphNeighbor(fromId, toId) {
    const from = this.micro.structs.get(fromId);
    if (!from) return;
    const hasList = from.neighborsArrayId && this.micro.arrays.has(from.neighborsArrayId);
    const result = this.micro.toggleStructNeighbor(fromId, toId, hasList ? null : this._microCreatePosition('array', 0));
    if (result == null && (this.micro.arrays.get(from.neighborsArrayId)?.cells.length ?? 0) >= MAX_ARRAY_SIZE) {
      this.microRuntime.warn(`"neighbors" de um nó de grafo tem no máximo ${MAX_ARRAY_SIZE} vizinhos.`);
    }
  }

  // ---- modo micro: gestos (pointer) ----

  _onMicroPointerDown(e) {
    if (
      this.microPopup.isOpen ||
      this.microArraySettingsPopup.isOpen ||
      this.microDictSettingsPopup.isOpen ||
      this.microMatrixSettingsPopup.isOpen ||
      this.microLabelSettingsPopup.isOpen ||
      this.microChartSettingsPopup.isOpen
    )
      return;

    // clicar num <svg> não move o foco de teclado pra ele sozinho (diferente
    // de clicar num <input>/<button>) — precisa pedir explicitamente, senão
    // o Tab-pro-código (ver _onKeyDown) nunca teria de onde "voltar".
    this.microView.svg.focus();

    const screenPt = this._microScreenPointFromEvent(e);
    const worldPt = this.microView.screenToWorld(screenPt.x, screenPt.y, this.microViewport);

    // botão do meio, ou botão esquerdo com a barra de espaço pressionada:
    // sempre move o canvas, não importa o modo ou o que está sob o cursor —
    // a seleção/manipulação abaixo só vale com o botão esquerdo SEM o Espaço.
    if (e.button === 1 || (e.button === 0 && this._spaceDown)) {
      e.preventDefault();
      this._microPointer = { downScreen: screenPt, lastScreen: screenPt, moved: false, hit: 'pan' };
      this.microContainer.classList.add('panning');
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }
    if (e.button !== 0) return;

    // modo texto: qualquer clique esquerdo sem arraste cria uma label ali —
    // não faz hit-test contra os demais elementos (ver _onMicroPointerUpWindow).
    if (this.microMode === 'text') {
      this._microPointer = { downScreen: screenPt, lastScreen: screenPt, moved: false, hit: 'text-canvas', worldPtDown: worldPt };
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }

    // modo área: arrastar desenha o retângulo da área nova (clique simples
    // cria uma de tamanho padrão) — também sem hit-test contra o resto.
    if (this.microMode === 'area') {
      this._microPointer = { downScreen: screenPt, lastScreen: screenPt, moved: false, hit: 'area-create', worldPtDown: worldPt };
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }

    // modo gráfico: mesmo gesto do modo área — arrastar desenha o gráfico
    // novo, clique simples cria um de tamanho padrão com o canto ali.
    if (this.microMode === 'chart') {
      this._microPointer = { downScreen: screenPt, lastScreen: screenPt, moved: false, hit: 'chart-create', worldPtDown: worldPt };
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }

    // modo "Ligar nós": clique na origem e depois no destino, ou Shift +
    // arraste — sem hit-test contra o resto (ver `_onMicroLinkPointerDown`)
    if (this.microMode === 'link') {
      this._onMicroLinkPointerDown(e, screenPt, worldPt);
      return;
    }

    // alças de redimensionamento da área selecionada vêm antes de tudo —
    // ficam desenhadas por cima de todas as camadas (ver MicroCanvasView).
    const areaHandle = this._findMicroAreaHandleAt(worldPt);
    if (areaHandle) {
      const area = this._microResizableById(areaHandle.id);
      this._microPointer = {
        downScreen: screenPt,
        lastScreen: screenPt,
        moved: false,
        hit: 'area-resize',
        id: areaHandle.id,
        dir: areaHandle.dir,
        startRect: { x: area.x, y: area.y, width: area.width, height: area.height },
        worldPtDown: worldPt,
      };
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }

    const port = this._findMicroPortAt(worldPt);
    const structNode = !port ? this._findMicroStructAt(worldPt) : null;
    const arrayNode = !port && !structNode ? this._findMicroArrayAt(worldPt) : null;
    const dictNode = !port && !structNode && !arrayNode ? this._findMicroDictAt(worldPt) : null;
    const matrixNode = !port && !structNode && !arrayNode && !dictNode ? this._findMicroMatrixAt(worldPt) : null;
    const pointerNode = !port && !structNode && !arrayNode && !dictNode && !matrixNode ? this._findMicroPointerAt(worldPt) : null;
    const variableNode =
      !port && !structNode && !arrayNode && !dictNode && !matrixNode && !pointerNode ? this._findMicroVariableAt(worldPt) : null;
    const labelNode =
      !port && !structNode && !arrayNode && !dictNode && !matrixNode && !pointerNode && !variableNode
        ? this._findMicroLabelAt(worldPt)
        : null;
    // gráficos e áreas por último: ficam atrás de tudo, então qualquer
    // elemento em cima deles tem prioridade (e o gráfico, acima das áreas).
    const chartNode =
      !port && !structNode && !arrayNode && !dictNode && !matrixNode && !pointerNode && !variableNode && !labelNode
        ? this._findMicroChartAt(worldPt)
        : null;
    const areaNode =
      !port && !structNode && !arrayNode && !dictNode && !matrixNode && !pointerNode && !variableNode && !labelNode && !chartNode
        ? this._findMicroAreaAt(worldPt)
        : null;

    let hit = 'canvas';
    let id = null;
    let grabOffset = null;
    if (port) {
      hit = 'port';
    } else if (structNode) {
      hit = 'struct';
      id = structNode.id;
      grabOffset = { x: worldPt.x - structNode.x, y: worldPt.y - structNode.y };
    } else if (arrayNode) {
      hit = 'array';
      id = arrayNode.id;
      grabOffset = { x: worldPt.x - arrayNode.x, y: worldPt.y - arrayNode.y };
    } else if (dictNode) {
      hit = 'dict';
      id = dictNode.id;
      grabOffset = { x: worldPt.x - dictNode.x, y: worldPt.y - dictNode.y };
    } else if (matrixNode) {
      hit = 'matrix';
      id = matrixNode.id;
      grabOffset = { x: worldPt.x - matrixNode.x, y: worldPt.y - matrixNode.y };
    } else if (pointerNode) {
      hit = 'pointer';
      id = pointerNode.id;
      grabOffset = { x: worldPt.x - pointerNode.x, y: worldPt.y - pointerNode.y };
    } else if (variableNode) {
      hit = 'variable';
      id = variableNode.id;
      grabOffset = { x: worldPt.x - variableNode.x, y: worldPt.y - variableNode.y };
    } else if (labelNode) {
      hit = 'label';
      id = labelNode.id;
      grabOffset = { x: worldPt.x - labelNode.x, y: worldPt.y - labelNode.y };
    } else if (chartNode) {
      hit = 'chart';
      id = chartNode.id;
      grabOffset = { x: worldPt.x - chartNode.x, y: worldPt.y - chartNode.y };
    } else if (areaNode) {
      hit = 'area';
      id = areaNode.id;
      grabOffset = { x: worldPt.x - areaNode.x, y: worldPt.y - areaNode.y };
    }

    // Shift + arraste num nó (modo Selecionar): atalho da ferramenta "Ligar
    // nós", pelo ponteiro da metade onde começou (ver `_microLinkFieldAt`).
    // Só vale começando num nó — Shift numa célula de lista/matriz continua
    // criando cursor de leitura (ver `_findMicroCursorCellAt` abaixo) e em
    // qualquer outro lugar segue como sempre.
    if (hit === 'struct' && e.shiftKey && !e.ctrlKey && !e.metaKey) {
      this._startMicroLinkDrag(structNode, this._microLinkFieldAt(structNode, worldPt), screenPt, worldPt);
      return;
    }

    if (hit === 'canvas') {
      // seleção em área — mover o canvas com o clique esquerdo em espaço
      // vazio saiu daqui (ver botão do meio / direito+espaço acima).
      this._microPointer = {
        downScreen: screenPt,
        lastScreen: screenPt,
        moved: false,
        hit: 'areaselect',
        worldPtDown: worldPt,
        ctrl: e.ctrlKey || e.metaKey,
      };
      window.addEventListener('pointermove', this._microBoundMove);
      window.addEventListener('pointerup', this._microBoundUp);
      return;
    }

    // arrastar um elemento que já faz parte de uma seleção múltipla move o
    // grupo inteiro junto — do contrário é um arraste normal de um item só,
    // e substitui qualquer seleção múltipla anterior (ver _onMicroPointerUpWindow).
    // apertou no índice de um array, ou com Shift numa célula de array/
    // matriz: um arraste dali cria um cursor pra essa posição (ver
    // _startMicroIndexCursorDrag). Sem arraste, o índice continua só
    // selecionando o array; Shift+clique cria o cursor do mesmo jeito.
    const cursorCell = e.ctrlKey || e.metaKey ? null : this._findMicroCursorCellAt(arrayNode ?? matrixNode, worldPt, e.shiftKey);

    let groupStart = null;
    if (cursorCell == null && this.microSelectedIds.size > 1 && this.microSelectedIds.has(id)) {
      groupStart = new Map();
      this.microSelectedIds.forEach((gid) => {
        const node = this._microFindById(gid);
        // um item da seleção que deixou de estar visível/em destaque desde
        // que foi selecionado (outro passo da reprodução) não vai junto
        if (node && this._microPickable(node)) groupStart.set(gid, { x: node.x, y: node.y });
      });
    }

    this._microPointer = {
      downScreen: screenPt,
      lastScreen: screenPt,
      moved: false,
      hit,
      id,
      port,
      grabOffset,
      worldPtDown: worldPt,
      groupStart,
      cursorCell,
      shift: e.shiftKey,
      // Ctrl+clique (sem arraste) soma/tira o elemento da seleção, ver
      // `_toggleMicroSelection`
      ctrl: e.ctrlKey || e.metaKey,
    };
    window.addEventListener('pointermove', this._microBoundMove);
    window.addEventListener('pointerup', this._microBoundUp);
  }

  _onMicroPointerMoveWindow(e) {
    if (!this._microPointer) return;
    const screenPt = this._microScreenPointFromEvent(e);
    const dx = screenPt.x - this._microPointer.downScreen.x;
    const dy = screenPt.y - this._microPointer.downScreen.y;
    if (!this._microPointer.moved && Math.hypot(dx, dy) > CLICK_THRESHOLD) this._microPointer.moved = true;
    if (!this._microPointer.moved) return;

    const ddx = screenPt.x - this._microPointer.lastScreen.x;
    const ddy = screenPt.y - this._microPointer.lastScreen.y;
    const worldPt = this.microView.screenToWorld(screenPt.x, screenPt.y, this.microViewport);

    if (this._microPointer.cursorCell) this._startMicroIndexCursorDrag(worldPt);

    if (this._microPointer.hit === 'pan') {
      this.microViewport.tx += ddx;
      this.microViewport.ty += ddy;
      this.microView.setViewport(this.microViewport);
    } else if (this._microPointer.hit === 'areaselect') {
      this._microSelectionPreview = {
        x0: this._microPointer.worldPtDown.x,
        y0: this._microPointer.worldPtDown.y,
        x1: worldPt.x,
        y1: worldPt.y,
      };
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'text-canvas') {
      // sem prévia — a label só nasce ao soltar (ver _onMicroPointerUpWindow)
    } else if (this._microPointer.hit === 'area-create') {
      this._microAreaDraft = this._microAreaRectFromDrag(this._microPointer.worldPtDown, worldPt, this._microAreaFree(e));
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'chart-create') {
      this._microChartDraft = this._microChartRectFromDrag(this._microPointer.worldPtDown, worldPt);
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'area-resize') {
      // gráfico: redimensiona livre (sem grid), com um tamanho mínimo legível
      const isChart = this.microCharts.has(this._microPointer.id);
      this._microAreaResize = {
        id: this._microPointer.id,
        rect: isChart
          ? this._microAreaResizedRect(this._microPointer.startRect, this._microPointer.dir, worldPt, true, { w: CHART_MIN_W, h: CHART_MIN_H })
          : this._microAreaResizedRect(this._microPointer.startRect, this._microPointer.dir, worldPt, this._microAreaFree(e)),
      };
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'area' && !this._microPointer.groupStart) {
      // arraste de uma área sozinha encaixa o canto no grid (se ligado, ver G/Shift)
      const offset = this._microPointer.grabOffset;
      const free = this._microAreaFree(e);
      this._microDragId = this._microPointer.id;
      this._microDragPos = {
        x: this._snapMicroArea(worldPt.x - offset.x, free),
        y: this._snapMicroArea(worldPt.y - offset.y, free),
      };
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'link-drag') {
      this._microLinkDraft = {
        fromId: this._microPointer.id,
        field: this._microPointer.field,
        toPt: worldPt,
        targetId: this._findMicroLinkTarget(this._microPointer.id, worldPt)?.id ?? null,
        pending: false,
      };
      this._renderMicroOnly();
    } else if (this._microPointer.hit === 'port') {
      const fromPt = this._microPortWorldPos(this._microPointer.port);
      const resolved = this._resolveMicroDropTarget(this._microPointer.port, worldPt);
      this._microPortDrag = { ...this._microPointer.port, fromPt, toPt: worldPt, valid: !!resolved };
      this._renderMicroOnly();
    } else if (this._microPointer.groupStart) {
      const gdx = worldPt.x - this._microPointer.worldPtDown.x;
      const gdy = worldPt.y - this._microPointer.worldPtDown.y;
      this._microGroupDragPositions = new Map();
      this._microPointer.groupStart.forEach((start, gid) => {
        this._microGroupDragPositions.set(gid, { x: start.x + gdx, y: start.y + gdy });
      });
      this._renderMicroOnly();
    } else if (['struct', 'pointer', 'array', 'dict', 'matrix', 'variable', 'label', 'chart'].includes(this._microPointer.hit)) {
      const offset = this._microPointer.grabOffset;
      this._microDragId = this._microPointer.id;
      this._microDragPos = { x: worldPt.x - offset.x, y: worldPt.y - offset.y };
      this._renderMicroOnly();
    }

    this._microPointer.lastScreen = screenPt;
  }

  _onMicroPointerUpWindow() {
    if (!this._microPointer) return;
    const { hit, moved, id, port, worldPtDown, groupStart, ctrl, cursorCell, shift } = this._microPointer;

    if (hit === 'pan') {
      // nada a fazer — só moveu o canvas
    } else if (hit === 'areaselect') {
      if (moved && this._microSelectionPreview) {
        // com Ctrl, a área SOMA à seleção atual em vez de substituí-la
        this._selectMicroRect(this._microFindIdsInRect(this._microSelectionPreview), ctrl);
      } else if (ctrl) {
        // Ctrl+clique no vazio: não perde a seleção que está sendo montada
      } else {
        this.microSelectedIds = new Set();
        this.microSelectedId = null;
      }
      this._syncCodeEditorSelection(null, null);
      this._microSelectionPreview = null;
    } else if (hit === 'text-canvas') {
      if (!moved) this._startCreateMicroLabel(this._microPointer.downScreen, worldPtDown);
    } else if (hit === 'area-create') {
      const draft = this._microAreaDraft;
      if (moved && draft && draft.width >= 8 && draft.height >= 8) {
        this._createMicroArea(draft);
      } else if (!moved) {
        const x = this._snapMicroArea(worldPtDown.x, !this.microAreaSnap);
        const y = this._snapMicroArea(worldPtDown.y, !this.microAreaSnap);
        this._createMicroArea({ x, y, width: AREA_DEFAULT_CELLS.w * GRID_SIZE, height: AREA_DEFAULT_CELLS.h * GRID_SIZE });
      }
      this._microAreaDraft = null;
    } else if (hit === 'chart-create') {
      if (moved && this._microChartDraft) {
        this._createMicroChart(this._microChartDraft);
      } else if (!moved) {
        this._createMicroChart({ x: worldPtDown.x, y: worldPtDown.y, ...CHART_DEFAULT_SIZE });
      }
      this._microChartDraft = null;
    } else if (hit === 'area-resize') {
      const area = this._microResizableById(id);
      if (moved && area && this._microAreaResize?.id === id) Object.assign(area, this._microAreaResize.rect);
      this._microAreaResize = null;
    } else if (hit === 'link-drag') {
      const draft = this._microLinkDraft;
      this._microLinkDraft = null;
      if (moved) {
        if (draft?.targetId) this._applyMicroLink(id, draft.field, draft.targetId);
      } else if (this.microMode === 'link') {
        // Shift + clique sem arraste na ferramenta: o mesmo que um clique —
        // a ligação fica pendente esperando o destino
        this._microLinkDraft = { fromId: id, field: this._microPointer.field, toPt: worldPtDown, targetId: null, pending: true };
      } else {
        // clique sem arraste no modo Selecionar: só seleciona o nó
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('struct', id);
      }
    } else if (ctrl && !moved && id != null) {
      this._toggleMicroSelection(id);
    } else if (shift && cursorCell && !moved) {
      // Shift+clique numa célula: o mesmo cursor que o arraste criaria, num
      // lugar livre logo abaixo da célula
      this._createMicroIndexCursorNearCell(id, cursorCell);
    } else if (groupStart) {
      if (moved && this._microGroupDragPositions) {
        groupStart.forEach((start, gid) => {
          const finalPos = this._microGroupDragPositions.get(gid) ?? start;
          this._microSetNodePos(gid, finalPos.x, finalPos.y);
        });
      }
      // clique sem arraste num item já dentro da seleção múltipla: mantém a seleção como está
    } else if (hit === 'port') {
      if (moved) {
        const resolved = this._resolveMicroDropTarget(port, this._microPortDrag?.toPt ?? worldPtDown);
        if (port.ownerKind === 'struct') {
          this.micro.setField(port.ownerId, port.field, resolved?.kind === 'struct' ? resolved.id : null);
        } else if (port.ownerKind === 'pointer') {
          this.micro.setPointerTarget(port.ownerId, resolved);
        } else if (port.ownerKind === 'arrayCell') {
          this.micro.setArrayCellRef(port.ownerId, port.index, resolved?.kind === 'struct' ? resolved.id : null);
        } else if (port.ownerKind === 'dictCell') {
          this.micro.setDictCellRef(port.ownerId, port.key, resolved?.kind === 'struct' ? resolved.id : null);
        }
      }
    } else if (hit === 'struct') {
      // clique simples só seleciona — editar o dado é com duplo clique (ver
      // _onMicroDblClick), igual a todo valor/nome editável no canvas
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('struct', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    } else if (hit === 'pointer') {
      if (!moved) {
        // cursor de uma janela deslizante: o par entra junto na seleção
        const partner = this._microWindowPartner(this.micro.pointers.get(id));
        this.microSelectedIds = partner ? new Set([id, partner.id]) : new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('pointer', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }    } else if (hit === 'array') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('array', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    } else if (hit === 'dict') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('dict', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    } else if (hit === 'matrix') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('matrix', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    } else if (hit === 'variable') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection('variable', id);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    } else if (hit === 'label') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection(null, null);
      } else if (this._microDragPos) {
        const node = this.microLabels.get(id);
        if (node) {
          node.x = this._microDragPos.x;
          node.y = this._microDragPos.y;
        }
      }
    } else if (hit === 'area' || hit === 'chart') {
      if (!moved) {
        this.microSelectedIds = new Set();
        this.microSelectedId = id;
        this._syncCodeEditorSelection(null, null);
      } else if (this._microDragPos) {
        this._microSetNodePos(id, this._microDragPos.x, this._microDragPos.y);
      }
    }

    this._microPointer = null;
    this._microDragId = null;
    this._microDragPos = null;
    this._microPortDrag = null;
    if (!this._microLinkDraft?.pending) this._microLinkDraft = null;
    this._microGroupDragPositions = null;
    this.microContainer.classList.remove('panning');
    window.removeEventListener('pointermove', this._microBoundMove);
    window.removeEventListener('pointerup', this._microBoundUp);
    this._renderMicroOnly();
  }

  /** Clique com o botão direito no canvas micro: sobre uma label de texto,
   * o puxador de um array/set/deque, dict ou matriz (ver
   * `_findMicroHandleUnder`) ou um gráfico, seleciona o elemento (o puxador e
   * o gráfico) e abre o popup de configurações correspondente — em qualquer
   * outro ponto (inclusive o ponteiro-rótulo da coleção), só bloqueia o menu
   * nativo do navegador. */
  _onMicroContextMenu(e) {
    e.preventDefault();
    const screenPt = this._microScreenPointFromEvent(e);
    const worldPt = this.microView.screenToWorld(screenPt.x, screenPt.y, this.microViewport);
    // ligação pendente da ferramenta "Ligar nós": o botão direito só a
    // cancela, e a ferramenta continua escolhida
    if (this._microLinkDraft?.pending) {
      this._cancelMicroLink(worldPt);
      return;
    }
    const labelNode = this._findMicroLabelAt(worldPt);
    if (labelNode) {
      this._openMicroLabelSettingsPopup(labelNode, screenPt);
      return;
    }
    // ponteiro (o rótulo da coleção também), variável ou struct por cima:
    // ficam em camadas acima das coleções, então tapam o puxador e o gráfico
    const covered = this._findMicroPointerAt(worldPt) || this._findMicroVariableAt(worldPt) || this._findMicroStructAt(worldPt);
    if (covered) return;
    const handle = this._findMicroHandleUnder(worldPt);
    if (handle) {
      this._selectMicroForContextMenu(handle.kind, handle.node.id);
      if (handle.kind === 'array') this._openMicroArraySettingsPopup(handle.node, screenPt);
      else if (handle.kind === 'dict') this._openMicroDictSettingsPopup(handle.node, screenPt);
      else this._openMicroMatrixSettingsPopup(handle.node, screenPt);
      return;
    }
    // gráfico: só se nenhuma coleção estiver por cima dele nesse ponto
    const overChart = this._findMicroArrayAt(worldPt) || this._findMicroDictAt(worldPt) || this._findMicroMatrixAt(worldPt);
    const chartNode = overChart ? null : this._findMicroChartAt(worldPt);
    if (chartNode) {
      this._selectMicroForContextMenu(null, chartNode.id);
      this._openMicroChartSettingsPopup(chartNode, screenPt);
    }
  }

  /** Coleção cujo puxador está VISÍVEL sob o ponto: `{kind, node}`, com
   * `kind` 'matrix' | 'dict' | 'array'. Percorre as camadas de cima pra
   * baixo (matrizes, dicts, arrays — ver MicroCanvasView): o corpo de uma
   * coleção de camada mais alta tapa o puxador de uma de camada mais baixa. */
  _findMicroHandleUnder(worldPt) {
    const layers = [
      ['matrix', this.micro.matrices, matrixHandleRect, (pt) => this._findMicroMatrixAt(pt)],
      ['dict', this.micro.dicts, dictHandleRect, (pt) => this._findMicroDictAt(pt)],
      ['array', this.micro.arrays, arrayHandleRect, (pt) => this._findMicroArrayAt(pt)],
    ];
    for (const [kind, map, handleOf, findAt] of layers) {
      const node = this._findMicroHandleAt(map, handleOf, worldPt);
      if (node) return { kind, node };
      if (findAt(worldPt)) return null; // corpo desta camada por cima
    }
    return null;
  }

  /** Seleciona só o elemento cujo popup o botão direito vai abrir (`kind`
   * nulo pra elementos fora do código, como o gráfico). */
  _selectMicroForContextMenu(kind, id) {
    this.microSelectedIds = new Set();
    this.microSelectedId = id;
    this._syncCodeEditorSelection(kind, kind ? id : null);
    this._renderMicroOnly();
  }

  /** Popup do botão direito num gráfico de complexidade: quais funções
   * exibir e os títulos dos eixos — cada mudança já vale na hora. */
  _openMicroChartSettingsPopup(node, screenPt) {
    this.microChartSettingsPopup.open(screenPt.x, screenPt.y, node, {
      returnFocusTo: this.microView.svg,
      onChange: (patch) => {
        Object.assign(node, patch);
        this._renderMicroOnly();
      },
      onRemove: () => {
        this.microCharts.delete(node.id);
        this.microSelectedIds.delete(node.id);
        if (this.microSelectedId === node.id) this.microSelectedId = null;
        this._renderMicroOnly();
      },
    });
  }

  /** Duplo clique no título de um eixo do gráfico: renomeia no lugar (o
   * título girado do eixo vertical é editado na horizontal, sobre o centro
   * dele). Esc ou campo vazio mantêm o título atual. */
  _editMicroChartAxisInPlace(chart, axis) {
    const key = axis === 'x' ? 'xLabel' : 'yLabel';
    const { xAxis, yAxis } = chartLayout(chart);
    const center = (axis === 'x' ? xAxis : yAxis).center;
    const FONT = 12; // = .chart-axis-label (canvas.css)
    const scale = this.microViewport.scale;
    const rectFor = (text) => {
      const width = Math.max(80, String(text).length * FONT * 0.6 + 20);
      return { x: chart.x + center.x - width / 2, y: chart.y + center.y - 12, width, height: 24 };
    };
    const finish = () => {
      this._microEditingChartAxis = null;
      this._renderMicroOnly();
    };
    this._microEditingChartAxis = { id: chart.id, axis };
    this._renderMicroOnly();
    this.microInlineEditor.open(
      this._microWorldRectToScreen(rectFor(chart[key])),
      chart[key],
      FONT * scale,
      (text) => {
        if (text.trim()) chart[key] = text.trim();
        finish();
      },
      {
        type: 'text',
        onCancel: finish,
        autoGrow: (value) => {
          const r = rectFor(value || ' ');
          return { width: r.width * scale, height: r.height * scale };
        },
        returnFocusTo: this.microView.svg,
      },
    );
  }

  /** Duplo clique: edição IN PLACE do que estiver sob o cursor — o dado de
   * um nó, o valor de uma célula de array/dict (de valores)/matriz, o valor ou o
   * nome de uma variável, o nome de um ponteiro (o ponteiro-rótulo de uma
   * coleção renomeia a coleção) e o texto de uma label. Remover é com
   * Delete/Backspace (ver `_deleteMicroSelection`). Nos modos Texto/Área o
   * duplo clique é só dois cliques de criação — não edita nada. */
  _onMicroDblClick(e) {
    // Espaço pressionado: os cliques são de pan, não abrem edição in place
    if (this.microMode !== 'select' || this._spaceDown) return;
    const screenPt = this._microScreenPointFromEvent(e);
    const worldPt = this.microView.screenToWorld(screenPt.x, screenPt.y, this.microViewport);
    // mesma prioridade do hit-test de _onMicroPointerDown
    const structNode = this._findMicroStructAt(worldPt);
    if (structNode) {
      this._openMicroDataPopup(structNode);
      return;
    }
    const arrayNode = this._findMicroArrayAt(worldPt);
    if (arrayNode) {
      const splitAt = this._findMicroArrayDividerAt(arrayNode, worldPt);
      if (splitAt != null) {
        this._splitMicroArray(arrayNode, splitAt);
        return;
      }
      const cellHit = this._findMicroArrayCellAt(worldPt);
      if (arrayNode.kind === 'value' && cellHit?.array.id === arrayNode.id) this._openMicroArrayCellPopup(arrayNode, cellHit.index);
      return;
    }
    const dictNode = this._findMicroDictAt(worldPt);
    if (dictNode) {
      const cellHit = this._findMicroDictCellAt(worldPt);
      if (cellHit?.dict.id === dictNode.id) this._openMicroDictCellPopup(dictNode, cellHit.key);
      return;
    }
    const matrixNode = this._findMicroMatrixAt(worldPt);
    if (matrixNode) {
      const cellHit = this._findMicroMatrixCellAt(worldPt);
      if (cellHit?.matrix.id === matrixNode.id) this._openMicroMatrixCellPopup(matrixNode, cellHit.row, cellHit.col);
      return;
    }
    const pointerNode = this._findMicroPointerAt(worldPt);
    if (pointerNode) {
      this._renameMicroPointerInPlace(pointerNode);
      return;
    }
    const variableNode = this._findMicroVariableAt(worldPt);
    if (variableNode) {
      if (this._findMicroVariableValueAt(worldPt)?.id === variableNode.id) this._openMicroVariablePopup(variableNode);
      else this._renameMicroVariableInPlace(variableNode);
      return;
    }
    const labelNode = this._findMicroLabelAt(worldPt);
    if (labelNode) {
      this._editMicroLabelInPlace(labelNode);
      return;
    }
    const chartNode = this._findMicroChartAt(worldPt);
    const axis = chartNode ? this._findMicroChartAxisAt(chartNode, worldPt) : null;
    if (axis) this._editMicroChartAxisInPlace(chartNode, axis);
  }

  /** Duplo clique no nome de um ponteiro: renomeia no lugar. O
   * ponteiro-rótulo de uma lista/dict/matriz renomeia a coleção (o rótulo
   * acompanha, ver MicroModel#renameArray). Cursor de leitura ("nums[i]")
   * não tem nome próprio — o nome É a expressão — então não edita. Esc ou
   * campo vazio mantêm o nome atual. */
  _renameMicroPointerInPlace(node) {
    if (node.readCursorKey) return;
    let rename = (name) => this.micro.renamePointer(node.id, name);
    let exceptIds = [node.id];
    const collection = node.isArrayLabel
      ? ['array', node.labelArrayId, (name) => this.micro.renameArray(node.labelArrayId, name)]
      : node.isDictLabel
        ? ['dict', node.labelDictId, (name) => this.micro.renameDict(node.labelDictId, name)]
        : node.isMatrixLabel
          ? ['matrix', node.labelMatrixId, (name) => this.micro.renameMatrix(node.labelMatrixId, name)]
          : null;
    if (collection) {
      const [kind, collectionId, renameCollection] = collection;
      exceptIds = [node.id, collectionId];
      rename = (name) => {
        renameCollection(name);
        if (this.microSelectedId === collectionId) this._syncCodeEditorSelection(kind, collectionId);
      };
    }
    this._editMicroNameInPlace({
      initial: node.label,
      rectFor: (label) => ({ x: node.x, y: node.y, width: pointerWidth({ label }, true), height: PTR_H }),
      fontSize: 14, // = .pointer-label (canvas.css)
      exceptIds,
      rename,
      remove: () => {},
    });
  }

  /** Duplo clique no cabeçalho (nome) de uma variável: renomeia no lugar. */
  _renameMicroVariableInPlace(node) {
    this._editMicroNameInPlace({
      initial: node.name,
      rectFor: (name) => ({ x: node.x, y: node.y, width: variableWidth({ name, value: node.value }, true), height: VAR_HEADER_H }),
      fontSize: 12, // = .variable-name (canvas.css)
      exceptIds: [node.id],
      rename: (name) => this.micro.renameVariable(node.id, name),
      remove: () => {},
    });
  }

  // ---- modo micro: render ----

  _renderMicroOnly() {
    this.microModeToolbar.render({
      mode: this.microMode,
      swatches: { area: this.microAreaColor, text: labelCssColor(this.microLabelColor) },
    });
    this.microAlignToolbar.render({ count: this._microAlignableIds().length });
    this.microTreeToolbar.render({ enabled: !!this._microSelectedTreeRoot() });

    // Aba ativa (ver painel de árvore de chamadas): qual frame mostrar os
    // ponteiros/variáveis locais — segue o passo atual da reprodução
    // automaticamente, mas um clique manual na árvore (ver
    // `_onSelectCallFrame`) sobrepõe isso até o próximo passo real (quem
    // reseta é `_applyMicroTouchHighlight`, chamado a cada instrução
    // executada). Structs/arrays nunca são filtrados por frame — são o
    // "heap" compartilhado, sempre visível em qualquer aba.
    const activeStep = this.microRunner.steps[this.microRunner.stepIndex];
    const stepFrameId = activeStep?.activeFrameId ?? 'global';
    const activeFrameId = this.manualFrameId ?? stepFrameId;
    const inActiveFrame = (n) => {
      const frameId = n.frameId ?? 'global';
      return frameId === 'global' || frameId === activeFrameId;
    };

    // Todo ponteiro atualmente destacado (clique manual OU um dos toques da
    // instrução em execução — ver `_isMicroHighlighted`) também destaca (com
    // um estilo secundário) o struct/célula de array pra onde ele aponta —
    // é assim que o cursor de leitura "nums[i]" ilumina a célula lida, e dá
    // pra mais de um ponteiro apontando pro mesmo array iluminar células
    // diferentes ao mesmo tempo (ex: two pointers).
    const linkedStructIds = new Set();
    const linkedArrayCellIndexes = new Map(); // arrayId -> Set<index>
    const linkedArrayIds = new Set(); // arrays apontados por um ponteiro-rótulo (kind:'array') destacado
    const linkedDictCellKeys = new Map(); // dictId -> Set<key>
    const linkedDictIds = new Set(); // dicts apontados por um ponteiro-rótulo (kind:'dict') destacado
    const linkedMatrixCells = new Map(); // matrixId -> Set<"linha,coluna">
    const linkedMatrixIds = new Set(); // matrizes apontadas por um ponteiro-rótulo (kind:'matrix') destacado
    // inclui a seleção múltipla (Ctrl+clique / área): ponteiros selecionados
    // juntos acendem os alvos de todos
    const highlightedIds = new Set(
      [this.microSelectedId, ...this.microSelectedIds, ...this._activeRunHighlightIds()].filter((id) => id != null),
    );
    highlightedIds.forEach((id) => {
      const pointer = this.micro.pointers.get(id);
      if (!pointer?.target || pointer.readCursorHidden) return;
      if (pointer.target.kind === 'struct') {
        linkedStructIds.add(pointer.target.id);
      } else if (pointer.target.kind === 'arrayCell') {
        if (!linkedArrayCellIndexes.has(pointer.target.arrayId)) linkedArrayCellIndexes.set(pointer.target.arrayId, new Set());
        linkedArrayCellIndexes.get(pointer.target.arrayId).add(pointer.target.index);
        // cursor de uma janela deslizante: acende TODAS as posições entre
        // ele e o par — vale também quando o passo da Simulação destaca o
        // cursor sozinho (ex.: "r += 1" estica a janela na tela)
        const range = this._microWindowRange(pointer);
        range?.indexes.forEach((i) => linkedArrayCellIndexes.get(pointer.target.arrayId).add(i));
      } else if (pointer.target.kind === 'array') {
        linkedArrayIds.add(pointer.target.id);
      } else if (pointer.target.kind === 'dictCell') {
        if (!linkedDictCellKeys.has(pointer.target.dictId)) linkedDictCellKeys.set(pointer.target.dictId, new Set());
        linkedDictCellKeys.get(pointer.target.dictId).add(pointer.target.key);
      } else if (pointer.target.kind === 'dict') {
        linkedDictIds.add(pointer.target.id);
      } else if (pointer.target.kind === 'matrixCell') {
        if (!linkedMatrixCells.has(pointer.target.matrixId)) linkedMatrixCells.set(pointer.target.matrixId, new Set());
        linkedMatrixCells.get(pointer.target.matrixId).add(`${pointer.target.row},${pointer.target.col}`);
      } else if (pointer.target.kind === 'matrix') {
        linkedMatrixIds.add(pointer.target.id);
      }
    });

    // dois passos: o pino prev/next de um struct pode migrar de lado conforme a
    // direção do struct apontado, então precisamos das posições (já com arraste
    // em andamento) de TODOS os structs antes de calcular esses "anchors".
    const structModels = Array.from(this.micro.structs.values());
    const structPosById = new Map(
      structModels.map((n) => {
        const { pos, dragging } = this._microNodePos(n);
        return [n.id, { x: pos.x, y: pos.y, dragging }];
      }),
    );
    const structCenter = (id) => {
      const p = structPosById.get(id);
      return p ? { x: p.x + STRUCT_W / 2, y: p.y + STRUCT_H / 2 } : null;
    };

    const pairOffsetByOwnerField = this._computeStructPairOffsets();

    // struct 'graph' não usa a fatia next/prev pra NADA (ver MicroModel#addStruct)
    // — o campo "neighbors" (lista, não um único alvo) mora num array à parte
    // (`n.neighborsArrayId`, ver MicroRuntimeAdapter#createStruct). O pino
    // "neighbors" do modo detalhado (ver _renderStructs, variante 'graph')
    // reaproveita a MESMA geometria da célula "next" (structNextPort), só que
    // apontando pro CENTRO do array em vez de outro struct — por isso aqui
    // (só na construção do node de RENDER, nunca em `model.next` de verdade,
    // ver comentário de `_findMicroPortAt`/`_microPortWorldPos` sobre por que
    // graph fica de fora do drag-to-link) populamos hasNextLink/nextAnchor
    // com a posição do array em vez de deixar de fora.
    const graphNeighborsAnchor = (n) => {
      const arr = n.neighborsArrayId ? this.micro.arrays.get(n.neighborsArrayId) : null;
      if (!arr) return null;
      const { pos: arrPos } = this._microNodePos(arr);
      const { width } = arrayLayout(arr);
      return { x: arrPos.x + width / 2, y: arrPos.y };
    };
    const structs = structModels.map((n) => {
      const pos = structPosById.get(n.id);
      // o pino "neighbors" (-> array) só existe no modo DETALHADO — no
      // simplificado os vizinhos viram setas diretas struct->struct (ver
      // bloco de arestas abaixo), então aqui teria que ficar de fora, senão
      // o mecanismo genérico de "next" (ver MicroCanvasView#_renderStructs,
      // ramo simplificado) desenharia uma seta fantasma até a posição do
      // array escondido.
      const isGraph = n.type === 'graph' && !this.microSimplifiedNodes;
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        data: n.data,
        type: n.type,
        selected: this._isMicroHighlighted(n.id),
        linked: linkedStructIds.has(n.id),
        dragging: pos.dragging,
        hasPrevLink: !!n.prev,
        hasNextLink: isGraph ? !!n.neighborsArrayId : !!n.next,
        prevAnchor: n.prev ? structCenter(n.prev) : null,
        nextAnchor: isGraph ? graphNeighborsAnchor(n) : n.next ? structCenter(n.next) : null,
        prevPairOffset: pairOffsetByOwnerField.get(`${n.id}:prev`),
        nextPairOffset: pairOffsetByOwnerField.get(`${n.id}:next`),
      };
    });
    // arrays de vizinhos (struct 'graph', ver MicroModel#setStructNeighborsArray)
    // somem por completo no modo simplificado — a lista de adjacência vira
    // setas DIRETAS struct->struct (ver bloco de arestas abaixo), sem passar
    // pela caixa do array; no modo detalhado o array aparece normal (mesma
    // renderização genérica de qualquer array 'ref').
    const graphNeighborsArrayIds = new Set(
      structModels.filter((n) => n.type === 'graph' && n.neighborsArrayId).map((n) => n.neighborsArrayId),
    );
    // janelas deslizantes (ver `microWindows`): um colchete sob as posições
    // entre os dois cursores, SEMPRE visível (não só com o cursor
    // selecionado, ao contrário do destaque das células) — arrayId ->
    // [{lo, hi, selected, pointerIds, color}]. Só cursores desenhados agora (frame em exibição,
    // não ocultos); cada par conta uma vez.
    const windowBrackets = new Map();
    const seenWindowPairs = new Set();
    this.micro.pointers.forEach((p) => {
      if (p.readCursorHidden || p.hidden || !inActiveFrame(p)) return;
      const range = this._microWindowRange(p);
      if (!range) return;
      const partner = this._microWindowPartner(p);
      const pairKey = [p.id, partner.id].sort().join('|');
      if (seenWindowPairs.has(pairKey)) return;
      seenWindowPairs.add(pairKey);
      if (!windowBrackets.has(range.arrayId)) windowBrackets.set(range.arrayId, []);
      windowBrackets.get(range.arrayId).push({
        lo: range.indexes[0],
        hi: range.indexes[range.indexes.length - 1],
        selected: this._isMicroHighlighted(p.id) || this._isMicroHighlighted(partner.id),
        color: this._microPointerWindow(p)?.color ?? null,
        // as setas desses dois cursores decidem de que lado do array o
        // colchete fica (ver MicroCanvasView#_windowBracketSide)
        pointerIds: [p.id, partner.id],
      });
    });
    const arrays = Array.from(this.micro.arrays.values())
      .filter((n) => !(this.microSimplifiedNodes && graphNeighborsArrayIds.has(n.id)))
      .map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        kind: n.kind,
        orientation: n.orientation,
        cells: n.cells,
        name: n.name,
        isSet: !!n.isSet,
        isDeque: !!n.isDeque,
        maxlen: n.maxlen ?? null,
        selected: this._isMicroHighlighted(n.id),
        linked: linkedArrayIds.has(n.id),
        targetCellIndexes: linkedArrayCellIndexes.get(n.id) ?? null,
        windows: windowBrackets.get(n.id) ?? null,
        dragging,
      };
    });
    const dicts = Array.from(this.micro.dicts.values()).map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        orientation: n.orientation,
        cells: n.cells,
        name: n.name,
        selected: this._isMicroHighlighted(n.id),
        linked: linkedDictIds.has(n.id),
        targetCellKeys: linkedDictCellKeys.get(n.id) ?? null,
        dragging,
      };
    });

    const matrices = Array.from(this.micro.matrices.values()).map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        cells: n.cells,
        name: n.name,
        selected: this._isMicroHighlighted(n.id),
        linked: linkedMatrixIds.has(n.id),
        targetCells: linkedMatrixCells.get(n.id) ?? null,
        dragging,
      };
    });

    // mapa de posição atual dos arrays/dicts (já refletindo arraste em
    // andamento) — usado pra calcular pro que lado da caixa do ponteiro o
    // pino deve apontar (structCenter, pros alvos struct, já foi montado acima)
    const arrayPosById = new Map(arrays.map((n) => [n.id, n]));
    const dictPosById = new Map(dicts.map((n) => [n.id, n]));
    const matrixPosById = new Map(matrices.map((n) => [n.id, n]));
    const pointerAnchor = (target) => {
      if (!target) return null;
      if (target.kind === 'struct') return structCenter(target.id);
      if (target.kind === 'arrayCell') {
        const arr = arrayPosById.get(target.arrayId);
        if (!arr) return null;
        const cell = arrayLayout(arr).cells[target.index];
        return cell ? { x: arr.x + cell.x + cell.w / 2, y: arr.y + cell.y + cell.h / 2 } : null;
      }
      if (target.kind === 'array') {
        const arr = arrayPosById.get(target.id);
        if (!arr) return null;
        const { width } = arrayLayout(arr);
        return { x: arr.x + width / 2, y: arr.y };
      }
      if (target.kind === 'dictCell') {
        const dict = dictPosById.get(target.dictId);
        if (!dict) return null;
        const i = dict.cells.findIndex((c) => c.key === target.key);
        const cell = i === -1 ? null : dictLayout(dict).cells[i];
        return cell ? { x: dict.x + cell.x + cell.w / 2, y: dict.y + cell.y + cell.h / 2 } : null;
      }
      if (target.kind === 'dict') {
        const dict = dictPosById.get(target.id);
        if (!dict) return null;
        const { width } = dictLayout(dict);
        return { x: dict.x + width / 2, y: dict.y };
      }
      if (target.kind === 'matrixCell') {
        const m = matrixPosById.get(target.matrixId);
        if (!m) return null;
        const r = matrixCellRect(m, target.row, target.col);
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }
      if (target.kind === 'matrix') {
        const m = matrixPosById.get(target.id);
        if (!m) return null;
        const { width } = matrixLayout(m);
        return { x: m.x + width / 2, y: m.y };
      }
      return null;
    };
    const pointers = Array.from(this.micro.pointers.values())
      // cursor oculto por clique com o botão direito no código (ver
      // _toggleMicroReadCursor) OU ponteiro comum oculto do mesmo jeito (ver
      // _toggleMicroPointerVisibility) somem por completo — não desenham nem
      // o ponteiro nem sua aresta.
      .filter((n) => !n.readCursorHidden && !n.hidden)
      .filter(inActiveFrame)
      .map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      // cursor de leitura (ver MicroRuntimeAdapter#_showReadCursor): o label já
      // vem pronto ("nums[i]", com a expressão de índice simbólica) — não
      // sobrepor com o "[índice]" resolvido que os ponteiros normais ganham.
      let label = n.label;
      if (!n.readCursorKey && n.target?.kind === 'arrayCell') label = `${n.label}[${n.target.index}]`;
      else if (!n.readCursorKey && n.target?.kind === 'matrixCell') label = `${n.label}[${n.target.row}][${n.target.col}]`;
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        label,
        target: n.target,
        anchor: pointerAnchor(n.target),
        selected: this._isMicroHighlighted(n.id),
        dragging,
        // ponteiro de leitura auto-criado por "nome[i]" no código (ver
        // MicroRuntimeAdapter#_showReadCursor) — estilo visual diferente
        // pra não parecer um ponteiro "de verdade" (head/tail) que o usuário criou.
        cursor: !!n.readCursorKey,
        // ponteiro-rótulo de um array/dict (ver `_createArrayLabelPointer`/
        // `_createDictLabelPointer`) — estilo visual diferente pra sinalizar
        // que ele é "o nome ao lado", não um ponteiro comum, e que dá pra
        // clicar com o botão direito nele.
        arrayLabel: !!n.isArrayLabel || !!n.isDictLabel || !!n.isMatrixLabel,
      };
    });

    const variables = Array.from(this.micro.variables.values())
      .filter(inActiveFrame)
      .map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        name: n.name,
        value: n.value,
        selected: this._isMicroHighlighted(n.id),
        dragging,
      };
    });

    const labels = Array.from(this.microLabels.values()).map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      return {
        id: n.id,
        x: pos.x,
        y: pos.y,
        text: n.text,
        color: n.color,
        fontSize: n.fontSize,
        selected: this._isMicroHighlighted(n.id),
        dragging,
        editing: n.id === this._microEditingLabelId,
      };
    });

    const areas = Array.from(this.microAreas.values()).map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      const resized = this._microAreaResize?.id === n.id ? this._microAreaResize.rect : null;
      return {
        id: n.id,
        x: resized ? resized.x : pos.x,
        y: resized ? resized.y : pos.y,
        width: resized ? resized.width : n.width,
        height: resized ? resized.height : n.height,
        color: n.color,
        selected: this._isMicroHighlighted(n.id),
        dragging: dragging || !!resized,
      };
    });
    if (this._microAreaDraft) {
      areas.push({ id: '__area-draft', ...this._microAreaDraft, color: this.microAreaColor, selected: false, dragging: true });
    }
    const charts = Array.from(this.microCharts.values()).map((n) => {
      const { pos, dragging } = this._microNodePos(n);
      const resized = this._microAreaResize?.id === n.id ? this._microAreaResize.rect : null;
      return {
        id: n.id,
        x: resized ? resized.x : pos.x,
        y: resized ? resized.y : pos.y,
        width: resized ? resized.width : n.width,
        height: resized ? resized.height : n.height,
        xLabel: n.xLabel,
        yLabel: n.yLabel,
        functions: n.functions,
        nMax: n.nMax,
        yMode: n.yMode,
        yMax: n.yMax,
        selected: this._isMicroHighlighted(n.id),
        dragging: dragging || !!resized,
        editingAxis: this._microEditingChartAxis?.id === n.id ? this._microEditingChartAxis.axis : null,
        readout: this._microChartReadout?.chartId === n.id ? this._microChartReadout : null,
      };
    });
    if (this._microChartDraft) {
      charts.push({
        id: '__chart-draft',
        ...this._microChartDraft,
        xLabel: CHART_DEFAULT_X_LABEL,
        yLabel: CHART_DEFAULT_Y_LABEL,
        functions: [],
        selected: false,
        dragging: true,
      });
    }

    const handlesAreaId = this._microSingleSelectedAreaId();
    const handlesArea = handlesAreaId ? [...areas, ...charts].find((a) => a.id === handlesAreaId) : null;
    const areaHandlesRect = handlesArea
      ? { x: handlesArea.x, y: handlesArea.y, width: handlesArea.width, height: handlesArea.height, size: AREA_HANDLE_PX / this.microViewport.scale }
      : null;

    const edges = [];
    structs.forEach((n) => {
      const model = this.micro.structs.get(n.id);
      if (model.prev) {
        const start = structPrevPort(n, this.microSimplifiedNodes);
        edges.push({
          id: `${n.id}-prev`,
          x1: start.x,
          y1: start.y,
          targetKind: 'struct',
          targetId: model.prev,
          fromStructId: n.id,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `struct:${n.id}`,
          targetKey: `struct:${model.prev}`,
        });
      }
      if (model.next) {
        const start = structNextPort(n, this.microSimplifiedNodes);
        edges.push({
          id: `${n.id}-next`,
          x1: start.x,
          y1: start.y,
          targetKind: 'struct',
          targetId: model.next,
          fromStructId: n.id,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `struct:${n.id}`,
          targetKey: `struct:${model.next}`,
        });
      }
      // struct 'graph': "neighbors" nunca usa prev/next (ver bloco acima) —
      // tem seu próprio desenho, diferente conforme o modo (ver comentário
      // de `graphNeighborsArrayIds` acima de `arrays`).
      if (model.type === 'graph' && model.neighborsArrayId) {
        const neighborsArr = this.micro.arrays.get(model.neighborsArrayId);
        if (neighborsArr) {
          if (this.microSimplifiedNodes) {
            // uma seta DIRETA do círculo do struct pro círculo de CADA
            // vizinho — sem passar pela caixa do array (excluída de `arrays`
            // acima), mesmo espírito de desenhar um grafo de adjacência à
            // mão. Cada seta tem sua própria `sourceKey` (por índice, não só
            // por struct) — se A e B forem vizinhos um do outro, as DUAS
            // arestas (A->B, B->A) têm o MESMO par (sourceKey,targetKey) que
            // o merge de bidirecionais (ver MicroCanvasView#_renderEdges)
            // esperaria fundir; graph não tem esse merge (grau arbitrário,
            // não faria sentido fundir só o PRIMEIRO par que bater), então a
            // key inclui o índice pra nunca coincidir com a aresta de volta.
            neighborsArr.cells.forEach((targetStructId, i) => {
              if (!targetStructId) return;
              const anchor = this._structFieldAnchor(targetStructId);
              const start = structNeighborPort(n, anchor);
              edges.push({
                id: `${n.id}-neighbor${i}`,
                x1: start.x,
                y1: start.y,
                targetKind: 'struct',
                targetId: targetStructId,
                fromStructId: n.id,
                selected: this._isMicroHighlighted(n.id),
                sourceKey: `struct:${n.id}:neighbor:${i}`,
                targetKey: `struct:${targetStructId}`,
              });
            });
          } else {
            // modo detalhado: UMA aresta só do struct pro array de vizinhos
            // inteiro (mesmo desenho que um ponteiro-rótulo de array usa pro
            // alvo `{kind:'array', id}`) — as arestas de CADA célula do
            // array pros vizinhos já saem de graça do laço genérico
            // `arrays.forEach` (kind:'ref') logo abaixo, sem duplicar nada
            // aqui.
            const start = structNextPort(n, false);
            edges.push({
              id: `${n.id}-neighbors`,
              x1: start.x,
              y1: start.y,
              targetKind: 'array',
              targetArrayId: model.neighborsArrayId,
              fromStructId: n.id,
              selected: this._isMicroHighlighted(n.id),
              sourceKey: `struct:${n.id}`,
              targetKey: `array:${model.neighborsArrayId}`,
            });
          }
        }
      }
    });
    arrays.forEach((n) => {
      if (n.kind !== 'ref') return;
      const layout = arrayLayout(n);
      n.cells.forEach((targetStructId, i) => {
        if (!targetStructId) return;
        const c = layout.cells[i];
        edges.push({
          id: `${n.id}-cell${i}`,
          x1: n.x + c.port.x,
          y1: n.y + c.port.y,
          targetKind: 'struct',
          targetId: targetStructId,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `arrayCell:${n.id}:${i}`,
          targetKey: `struct:${targetStructId}`,
        });
      });
    });
    dicts.forEach((n) => {
      // kind é por CÉLULA aqui (diferente de array — ver MicroModel.js),
      // então cada célula decide por si se vira uma aresta de referência —
      // pra um struct ('ref') OU pro corpo inteiro de outro array ('arrayref',
      // ver MicroModel#setDictCellArrayRef), igual o ponteiro-rótulo de um
      // array aponta pro array inteiro, não por uma célula dele.
      const layout = dictLayout(n);
      n.cells.forEach((cell, i) => {
        if (!cell.value || (cell.kind !== 'ref' && cell.kind !== 'arrayref')) return;
        const c = layout.cells[i];
        const base = {
          id: `${n.id}-cell${i}`,
          x1: n.x + c.port.x,
          y1: n.y + c.port.y,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `dictCell:${n.id}:${cell.key}`,
        };
        if (cell.kind === 'ref') {
          edges.push({ ...base, targetKind: 'struct', targetId: cell.value, targetKey: `struct:${cell.value}` });
        } else {
          edges.push({ ...base, targetKind: 'array', targetArrayId: cell.value, targetKey: `array:${cell.value}` });
        }
      });
    });
    pointers.forEach((n) => {
      if (!n.target) return;
      const start = pointerPort(n, this.microFullNames);
      if (n.target.kind === 'struct') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'struct',
          targetId: n.target.id,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `struct:${n.target.id}`,
        });
      } else if (n.target.kind === 'arrayCell') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'arrayCell',
          targetArrayId: n.target.arrayId,
          targetIndex: n.target.index,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `arrayCell:${n.target.arrayId}:${n.target.index}`,
        });
      } else if (n.target.kind === 'array') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'array',
          targetArrayId: n.target.id,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `array:${n.target.id}`,
        });
      } else if (n.target.kind === 'dictCell') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'dictCell',
          targetDictId: n.target.dictId,
          targetCellKey: n.target.key,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `dictCell:${n.target.dictId}:${n.target.key}`,
        });
      } else if (n.target.kind === 'dict') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'dict',
          targetDictId: n.target.id,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `dict:${n.target.id}`,
        });
      } else if (n.target.kind === 'matrixCell') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'matrixCell',
          targetMatrixId: n.target.matrixId,
          targetRow: n.target.row,
          targetCol: n.target.col,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `matrixCell:${n.target.matrixId}:${n.target.row}:${n.target.col}`,
        });
      } else if (n.target.kind === 'matrix') {
        edges.push({
          id: `${n.id}-target`,
          x1: start.x,
          y1: start.y,
          targetKind: 'matrix',
          targetMatrixId: n.target.id,
          fromStructId: null,
          selected: this._isMicroHighlighted(n.id),
          sourceKey: `pointer:${n.id}`,
          targetKey: `matrix:${n.target.id}`,
        });
      }
    });

    // o que não está no escopo da chamada ativa fica mais transparente (ver
    // _microOutOfScopeIds) — a seta some junto com quem ela sai
    const dimmedIds = this._microOutOfScopeIds(activeFrameId, highlightedIds);
    // o que não foi desenhado (filtrado acima) ou está apagado não recebe
    // mouse — ver _microPickable
    const drawnIds = new Set([...structs, ...pointers, ...arrays, ...dicts, ...matrices, ...variables].map((n) => n.id));
    this._microInertIds = new Set(dimmedIds);
    this._microNodeMaps().forEach((map) =>
      map.forEach((_, id) => {
        if (!drawnIds.has(id) && !this.microLabels.has(id) && !this.microAreas.has(id)) this._microInertIds.add(id);
      }),
    );
    edges.forEach((e) => {
      e.dimmed = dimmedIds.has(e.sourceKey.split(':')[1]);
    });

    let previewEdge = null;
    if (this._microPortDrag) {
      previewEdge = {
        x1: this._microPortDrag.fromPt.x,
        y1: this._microPortDrag.fromPt.y,
        x2: this._microPortDrag.toPt.x,
        y2: this._microPortDrag.toPt.y,
        valid: this._microPortDrag.valid,
      };
    } else if (this._microLinkDraft) {
      // seta de rascunho da ferramenta "Ligar nós": sai da borda do nó
      // (círculo no modo simplificado; célula prev/left, next/right ou
      // "nbrs" no detalhado) na direção do mouse; tracejado apagado enquanto
      // não há destino válido sob o mouse (ver `_findMicroLinkTarget`)
      const draft = this._microLinkDraft;
      const from = this.micro.structs.get(draft.fromId);
      if (from) {
        const start =
          draft.field === 'prev'
            ? structPrevPort({ ...from, prevAnchor: draft.toPt }, this.microSimplifiedNodes)
            : structNextPort({ ...from, nextAnchor: draft.toPt }, this.microSimplifiedNodes);
        previewEdge = { x1: start.x, y1: start.y, x2: draft.toPt.x, y2: draft.toPt.y, valid: !!draft.targetId };
      } else {
        // o nó de origem sumiu (apagado, ou a reprodução trocou de passo)
        this._microLinkDraft = null;
      }
    }
    // campo de origem destacado: o da ligação em andamento, ou a metade do
    // nó sob o mouse (ver `_updateMicroLinkHover`)
    let linkSource = null;
    const linkFrom = this._microLinkDraft
      ? { id: this._microLinkDraft.fromId, field: this._microLinkDraft.field }
      : this.microMode === 'link'
        ? this._microLinkHover
        : null;
    const linkFromNode = linkFrom && this.micro.structs.get(linkFrom.id);
    if (linkFromNode) linkSource = { x: linkFromNode.x, y: linkFromNode.y, type: linkFromNode.type, field: linkFrom.field };

    this.microView.render({
      dimmedIds,
      structs,
      pointers,
      arrays,
      dicts,
      matrices,
      variables,
      labels,
      areas,
      areaHandles: areaHandlesRect,
      charts,
      edges,
      previewEdge,
      linkSource,
      selectionRect: this._microSelectionPreview,
      simplifiedNodes: this.microSimplifiedNodes,
      fullNames: this.microFullNames,
      colors: this._microEffectiveColors(),
    });
    this.callTree.render({ nodes: activeStep?.callTree, activeFrameId });

    const knownNames = new Set();
    this.micro.pointers.forEach((p) => { if (p.label) knownNames.add(p.label); });
    this.micro.arrays.forEach((a) => { if (a.name) knownNames.add(a.name); });
    this.micro.dicts.forEach((d) => { if (d.name) knownNames.add(d.name); });
    this.micro.matrices.forEach((m) => { if (m.name) knownNames.add(m.name); });
    this.micro.variables.forEach((v) => { if (v.name) knownNames.add(v.name); });
    this.codeEditor.setKnownNames(knownNames);

    this._renderMicroRunBar();
    this._renderMicroConsole();
  }

  /** Barra de reprodução do modo "Executar" (`PlaybackControls`), tocando o
   * `MicroProgramRunner`. Some quando não há passos (fora do modo "run", ou
   * "run" sem ter rodado ainda). */
  _renderMicroRunBar() {
    const { error } = this.microRunner;
    this.microRunBarContainer.hidden = !this.microRunner.hasSteps && !error;

    if (error) {
      this.microRunBarContainer.innerHTML = '';
      const p = document.createElement('p');
      p.className = 'micro-run-error';
      p.textContent = `Erro de sintaxe${error.at != null ? ` (linha ${error.at + 1})` : ''}: ${error.message}`;
      this.microRunBarContainer.appendChild(p);
      return;
    }

    const step = this.microRunner.steps[this.microRunner.stepIndex];
    // só ACENDE o destaque de execução aqui — apagar é responsabilidade de
    // quem para a reprodução (_onCodeEditorModeChange), pra não atropelar o
    // destaque manual de ensino (Ctrl+Seta) toda vez que o canvas re-renderiza
    // por outro motivo (arraste, edição inline, etc.) enquanto não há steps.
    const hiddenAt = this._microExecLineHiddenAt;
    const execLineHidden = hiddenAt && hiddenAt.steps === this.microRunner.steps && hiddenAt.index === this.microRunner.stepIndex;
    if (!execLineHidden) this._microExecLineHiddenAt = null;
    if (step && !execLineHidden) this.codeEditor.setExecutionLine(step.line);
    this.microPlayback.render({
      stepIndex: this.microRunner.stepIndex,
      totalSteps: this.microRunner.steps.length,
      playing: this.microRunner.playing,
      speed: this.microRunner.speed,
    });
  }

  /** Console do modo micro — texto escrito por "print(...)" (ver
   * MicroRuntimeAdapter#print). No modo "Executar" (reprodução por passo),
   * mostra só até o passo atual (`microRunner.steps[i].output`, capturado
   * pelo MicroProgramRunner); sem reprodução ativa (modo manual, cada
   * Ctrl+Enter roda direto contra o modelo), mostra tudo que já foi impresso
   * na sessão (`microRuntime.output`, só limpo ao trocar de modo — ver
   * `_onCodeEditorModeChange`). Escondido quando não há nada a mostrar, pra
   * não ocupar espaço à toa. Encaixado embaixo do canvas ou em janela
   * flutuante — isso (e o limite de linhas de cada modo) é com o
   * ConsoleWindow. */
  _renderMicroConsole() {
    const step = this.microRunner.steps[this.microRunner.stepIndex];
    const lines = this.microRunner.hasSteps
      ? (step?.output ?? []).slice(this.microConsoleClearedLines)
      : this.microRuntime.output;
    this.microConsole.render(lines);
  }

  /** Botão de limpar do console. Sem reprodução (modo manual), a saída é
   * uma só e acumulada — é só esvaziá-la. Na reprodução, cada passo guarda
   * a PRÓPRIA saída (snapshot, ver MicroProgramRunner), então limpar não
   * apaga nada: esconde as linhas impressas até o passo atual, e as
   * impressas depois (avançando a reprodução) aparecem normalmente, como
   * num terminal. Voltar pra antes desse ponto mostra o console vazio. Um
   * "Rodar" novo zera isso (ver _runMicroProgram). */
  _clearMicroConsole() {
    if (this.microRunner.hasSteps) {
      const step = this.microRunner.steps[this.microRunner.stepIndex];
      this.microConsoleClearedLines = step?.output?.length ?? 0;
    } else {
      this.microRuntime.output = [];
    }
    this._renderMicroConsole();
  }

  // ---- render ----

  renderAll() {
    this._renderMicroOnly();
  }
}
