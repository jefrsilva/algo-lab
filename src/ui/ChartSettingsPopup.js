import { CHART_FUNCTIONS, CHART_N_LIMITS, CHART_Y_LIMITS, chartNMax, chartYMax } from '../render/MicroCanvasView.js';
import { fitPopupInContainer } from './fitPopup.js';

/** Sugestões do título do eixo vertical (o campo aceita qualquer texto). */
const Y_SUGGESTIONS = ['Tempo', 'Memória', 'Operações', 'Espaço'];
const X_SUGGESTIONS = ['Número de elementos (n)', 'n', 'Tamanho da entrada (n)'];
/** Fim do slider de n — valores maiores (até CHART_N_LIMITS.max) só pelo campo numérico. */
const N_SLIDER_MAX = 100;

let datalistSeq = 0;

/** Arredonda um limite de eixo pra exibir no campo (até 1 casa decimal). */
const roundForInput = (v) => Math.round(v * 10) / 10;

/**
 * Popup HTML flutuante de um gráfico de complexidade (Big-O) do canvas
 * micro — aberto com o botão direito sobre o gráfico (ver
 * App#_openMicroChartSettingsPopup). Marca quais funções clássicas exibir
 * (cada uma com a cor da sua curva), ajusta a escala (n máximo; eixo
 * vertical automático ou com valor máximo manual) e renomeia os dois eixos.
 * Ao contrário de `LabelSettingsPopup`, não tem "Salvar": cada mudança já
 * vale na hora (`onChange`), pra ver as curvas mudando enquanto mexe.
 * `node` é o próprio gráfico (App aplica cada `onChange` nele), então o
 * popup lê dele o estado atual. Mesmo visual (`.array-settings-*`).
 */
export class ChartSettingsPopup {
  constructor(container) {
    this.container = container;
    this.el = null;
  }

  open(screenX, screenY, node, { onChange, onRemove, returnFocusTo }) {
    this.close();
    this._returnFocusTo = returnFocusTo || null;
    const selected = new Set(node.functions || []);

    const el = document.createElement('div');
    el.className = 'array-settings-popup chart-settings-popup';
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;

    const section = (text) => {
      const title = document.createElement('div');
      title.className = 'chart-settings-title';
      title.textContent = text;
      el.appendChild(title);
    };
    const row = (labelText, ...children) => {
      const r = document.createElement('div');
      r.className = 'array-settings-row';
      const label = document.createElement('label');
      label.textContent = labelText;
      r.appendChild(label);
      children.forEach((c) => r.appendChild(c));
      el.appendChild(r);
      return r;
    };
    const numberInput = (limits) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = String(limits.min);
      input.max = String(limits.max);
      input.className = 'array-settings-input chart-settings-number';
      return input;
    };
    // número válido digitado no campo, ou null (campo vazio/fora dos limites
    // no meio da digitação: não aplica nada até o valor fazer sentido)
    const parseIn = (input, limits) => {
      const v = Number(input.value);
      return input.value.trim() !== '' && Number.isFinite(v) && v >= limits.min && v <= limits.max ? v : null;
    };
    const clampIn = (input, limits, fallback) => {
      const v = Number(input.value);
      return Number.isFinite(v) && input.value.trim() !== '' ? Math.max(limits.min, Math.min(v, limits.max)) : fallback;
    };

    // ---- funções ----
    section('Funções exibidas');
    const list = document.createElement('div');
    list.className = 'chart-settings-functions';
    const boxes = CHART_FUNCTIONS.map((fn) => {
      const label = document.createElement('label');
      label.className = 'chart-settings-fn';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = selected.has(fn.id);
      const swatch = document.createElement('span');
      swatch.className = 'chart-settings-swatch';
      swatch.style.background = fn.color;
      const name = document.createElement('span');
      name.textContent = fn.label;
      label.appendChild(box);
      label.appendChild(swatch);
      label.appendChild(name);
      list.appendChild(label);
      box.addEventListener('change', () => {
        // mantém a ordem de CHART_FUNCTIONS, não a ordem dos cliques
        const functions = CHART_FUNCTIONS.filter((f, i) => boxes[i].checked).map((f) => f.id);
        change({ functions });
      });
      return box;
    });
    el.appendChild(list);

    // ---- escala ----
    section('Escala');
    const nSlider = document.createElement('input');
    nSlider.type = 'range';
    nSlider.className = 'chart-settings-slider';
    nSlider.min = String(CHART_N_LIMITS.min);
    nSlider.max = String(N_SLIDER_MAX);
    nSlider.step = '1';
    const nInput = numberInput(CHART_N_LIMITS);
    row('n máximo', nSlider, nInput);

    const modeGroup = document.createElement('div');
    modeGroup.className = 'array-settings-orientation';
    const modeBtn = (mode, text, title) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'array-orient-btn';
      b.textContent = text;
      b.title = title;
      b.dataset.mode = mode;
      modeGroup.appendChild(b);
      return b;
    };
    const autoBtn = modeBtn('auto', 'Automático', 'Cresce até caber a maior função marcada em n máximo');
    const manualBtn = modeBtn('manual', 'Manual', 'Valor máximo fixo, digitado ao lado');
    const yInput = numberInput(CHART_Y_LIMITS);
    row('Eixo vertical até', modeGroup, yInput);

    // ---- títulos dos eixos ----
    section('Títulos dos eixos');
    const axisInput = (labelText, value, suggestions, key) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'array-settings-input';
      input.spellcheck = false;
      input.value = value;
      const datalist = document.createElement('datalist');
      datalistSeq += 1;
      datalist.id = `chart-axis-suggestions-${datalistSeq}`;
      suggestions.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s;
        datalist.appendChild(opt);
      });
      input.setAttribute('list', datalist.id);
      input.addEventListener('input', () => change({ [key]: input.value }));
      row(labelText, input, datalist);
      return input;
    };
    axisInput('Vertical', node.yLabel, Y_SUGGESTIONS, 'yLabel');
    axisInput('Horizontal', node.xLabel, X_SUGGESTIONS, 'xLabel');

    const actions = document.createElement('div');
    actions.className = 'array-settings-actions';
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn danger';
    removeBtn.textContent = 'Remover gráfico';
    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = 'btn primary';
    okBtn.textContent = 'OK';
    actions.appendChild(removeBtn);
    actions.appendChild(okBtn);
    el.appendChild(actions);

    // reflete o estado atual do gráfico nos controles de escala — o valor
    // do eixo vertical no modo automático depende de n e das funções
    // marcadas, então é recalculado depois de toda mudança
    const refresh = ({ keepN = false, keepY = false } = {}) => {
      const nMax = chartNMax(node);
      if (!keepN) nInput.value = String(roundForInput(nMax));
      nSlider.value = String(Math.min(nMax, N_SLIDER_MAX));
      const auto = node.yMode === 'auto';
      autoBtn.classList.toggle('active', auto);
      manualBtn.classList.toggle('active', !auto);
      yInput.disabled = auto;
      if (!keepY) yInput.value = String(roundForInput(chartYMax(node)));
    };
    const change = (patch, keep) => {
      onChange(patch);
      refresh(keep);
    };

    nSlider.addEventListener('input', () => change({ nMax: Number(nSlider.value) }));
    nInput.addEventListener('input', () => {
      const v = parseIn(nInput, CHART_N_LIMITS);
      if (v != null) change({ nMax: v }, { keepN: true });
    });
    nInput.addEventListener('change', () => change({ nMax: clampIn(nInput, CHART_N_LIMITS, chartNMax(node)) }));
    autoBtn.addEventListener('click', () => change({ yMode: 'auto' }));
    // ao passar pra manual, parte do valor que o automático estava usando —
    // a escala não pula, só para de acompanhar n
    manualBtn.addEventListener('click', () => {
      if (node.yMode !== 'auto') return;
      const yMax = Math.max(CHART_Y_LIMITS.min, Math.min(Math.round(chartYMax(node)), CHART_Y_LIMITS.max));
      change({ yMode: 'manual', yMax });
    });
    yInput.addEventListener('input', () => {
      const v = parseIn(yInput, CHART_Y_LIMITS);
      if (v != null) change({ yMax: v }, { keepY: true });
    });
    yInput.addEventListener('change', () => change({ yMax: clampIn(yInput, CHART_Y_LIMITS, chartYMax(node)) }));

    refresh();
    this.container.appendChild(el);
    this.el = el;
    fitPopupInContainer(el, this.container, screenX, screenY);
    (boxes.find((b) => b.checked) ?? boxes[0]).focus();

    okBtn.addEventListener('click', () => this.close());
    removeBtn.addEventListener('click', () => {
      this.close();
      onRemove();
    });
    el.addEventListener('keydown', (e) => {
      const inField = e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number');
      if (e.key === 'Escape' || (e.key === 'Enter' && inField)) {
        e.preventDefault();
        // Enter num campo numérico: aplica o valor (ajustado aos limites) antes de fechar
        if (e.target === nInput || e.target === yInput) e.target.dispatchEvent(new Event('change'));
        this.close();
      }
      // atalhos do canvas (1/2/3, Delete…) não valem enquanto o popup está em foco
      e.stopPropagation();
    });
    el.addEventListener('pointerdown', (e) => e.stopPropagation());

    this._outsideHandler = (e) => {
      if (this.el && !this.el.contains(e.target)) this.close();
    };
    setTimeout(() => document.addEventListener('pointerdown', this._outsideHandler), 0);
  }

  close() {
    if (this.el) {
      // mesma lógica de LabelSettingsPopup#close
      const shouldRefocus = this.el.contains(document.activeElement);
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
    if (this._outsideHandler) {
      document.removeEventListener('pointerdown', this._outsideHandler);
      this._outsideHandler = null;
    }
  }

  get isOpen() {
    return !!this.el;
  }
}
