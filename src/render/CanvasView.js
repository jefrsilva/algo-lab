import { svgEl } from './svgUtils.js';
import { NODE_RADIUS } from './layouts.js';

export const LABEL_H = 40;
export const FRAME_TYPE_LABELS = {
  list: 'Lista Ligada',
  stack: 'Pilha',
  queue: 'Fila',
  tree: 'Árvore (BST)',
  graph: 'Grafo',
};

/**
 * Renderer puro: desenha frames, nós e arestas num SVG com pan/zoom, a
 * partir de um snapshot de dados já posicionados em coordenadas de MUNDO.
 * Não conhece estruturas de dados nem interpreta gestos — só desenha e
 * expõe conversões de coordenada. Toda a lógica de interação vive em
 * `CanvasController`/`App`.
 */
export class CanvasView {
  constructor(container) {
    this.container = container;
    this.svg = svgEl('svg', { class: 'graph-canvas' });
    this._buildDefs();
    this.viewport = svgEl('g', { class: 'viewport' });
    this.gridRect = svgEl('rect', {
      x: -20000,
      y: -20000,
      width: 40000,
      height: 40000,
      fill: 'url(#grid-pattern)',
    });
    this.framesLayer = svgEl('g', { class: 'frames-layer' });
    this.edgesLayer = svgEl('g', { class: 'edges-layer' });
    this.nodesLayer = svgEl('g', { class: 'nodes-layer' });

    this.viewport.appendChild(this.gridRect);
    this.viewport.appendChild(this.framesLayer);
    this.viewport.appendChild(this.edgesLayer);
    this.viewport.appendChild(this.nodesLayer);
    this.svg.appendChild(this.viewport);
    this.container.appendChild(this.svg);

    this.frameEls = new Map();
    this.nodeEls = new Map();
    this.edgeEls = new Map();
  }

  _buildDefs() {
    const defs = svgEl('defs');
    const marker = svgEl('marker', {
      id: 'arrowhead',
      viewBox: '0 0 10 10',
      refX: 9,
      refY: 5,
      markerWidth: 7,
      markerHeight: 7,
      orient: 'auto-start-reverse',
    });
    marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', class: 'arrowhead-path' }));
    defs.appendChild(marker);

    const pattern = svgEl('pattern', {
      id: 'grid-pattern',
      width: 26,
      height: 26,
      patternUnits: 'userSpaceOnUse',
    });
    pattern.appendChild(svgEl('circle', { cx: 1.5, cy: 1.5, r: 1.5, class: 'grid-dot' }));
    defs.appendChild(pattern);

    this.svg.appendChild(defs);
  }

  getSize() {
    const rect = this.container.getBoundingClientRect();
    return { width: rect.width || 600, height: rect.height || 400, left: rect.left, top: rect.top };
  }

  setViewport({ tx, ty, scale }) {
    this.viewport.setAttribute('transform', `translate(${tx}, ${ty}) scale(${scale})`);
  }

  screenToWorld(screenX, screenY, { tx, ty, scale }) {
    return { x: (screenX - tx) / scale, y: (screenY - ty) / scale };
  }

  /**
   * @param frames [{id,type,label,x,y,width,height,selected}]
   * @param nodes [{id,x,y,label,state}] state: 'current'|'visited'|'in-aux'|null
   * @param edges [{id,source,target,directed,active}]
   * @param previewEdge {source:{x,y}, target:{x,y}}|null linha tracejada do modo conectar
   */
  render({ frames, nodes, edges, previewEdge = null }) {
    this._renderFrames(frames);
    this._renderEdges(edges);
    this._renderNodes(nodes);
    this._renderPreviewEdge(previewEdge);
  }

  _renderPreviewEdge(previewEdge) {
    if (!this._previewEdgeEl) {
      this._previewEdgeEl = svgEl('line', { class: 'preview-edge-line' });
      this.edgesLayer.appendChild(this._previewEdgeEl);
    }
    if (!previewEdge) {
      this._previewEdgeEl.setAttribute('display', 'none');
      return;
    }
    this._previewEdgeEl.removeAttribute('display');
    this._previewEdgeEl.setAttribute('x1', previewEdge.source.x);
    this._previewEdgeEl.setAttribute('y1', previewEdge.source.y);
    this._previewEdgeEl.setAttribute('x2', previewEdge.target.x);
    this._previewEdgeEl.setAttribute('y2', previewEdge.target.y);
  }

  /** Faz o nó/frame pulsar uma vez (modo "destacar"). */
  pulseNode(nodeId) {
    this._pulseElement(this.nodeEls.get(nodeId));
  }

  pulseFrame(frameId) {
    this._pulseElement(this.frameEls.get(frameId));
  }

  /**
   * Agenda a remoção da classe `no-enter-transition` de um elemento recém-criado.
   * A classe já deve ter sido incluída nos atributos de criação do elemento (antes
   * dele entrar no DOM) — adicioná-la depois da inserção deixa uma janela em que o
   * navegador pode computar a transição a partir do valor padrão (identidade) em
   * vez do valor final já atribuído, causando o nó a "nascer" fora do lugar e só
   * depois animar até a posição correta.
   */
  _suppressEnterTransition(el) {
    void el.getBoundingClientRect(); // força o navegador a comprometer o estado suprimido antes de liberar a transição
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        el.classList.remove('no-enter-transition');
      });
    });
  }

  _pulseElement(el) {
    if (!el) return;
    el.classList.remove('flash');
    void el.getBoundingClientRect(); // força reflow para poder reiniciar a animação
    el.classList.add('flash');
    const onEnd = () => {
      el.classList.remove('flash');
      el.removeEventListener('animationend', onEnd);
    };
    el.addEventListener('animationend', onEnd);
  }

  _renderFrames(frames) {
    const ids = new Set(frames.map((f) => f.id));
    for (const [id, el] of this.frameEls) {
      if (!ids.has(id)) {
        el.remove();
        this.frameEls.delete(id);
      }
    }
    frames.forEach((frame) => {
      let el = this.frameEls.get(frame.id);
      if (!el) {
        el = svgEl('g', { class: 'frame', 'data-id': frame.id, transform: `translate(${frame.x}, ${frame.y})` });
        const rect = svgEl('rect', { class: 'frame-rect', rx: 14, ry: 14 });
        const header = svgEl('rect', { class: 'frame-header', rx: 14, ry: 14 });
        const label = svgEl('text', { class: 'frame-label', x: 16, y: 25 });
        const closeBtn = svgEl('g', { class: 'frame-close' });
        const closeCircle = svgEl('circle', { r: 10, class: 'frame-close-circle' });
        const closeX = svgEl('text', { class: 'frame-close-x', 'text-anchor': 'middle', dy: '0.32em' });
        closeX.textContent = '×';
        closeBtn.appendChild(closeCircle);
        closeBtn.appendChild(closeX);
        el.appendChild(rect);
        el.appendChild(header);
        el.appendChild(label);
        el.appendChild(closeBtn);
        this.framesLayer.appendChild(el);
        this.frameEls.set(frame.id, el);
      } else {
        el.setAttribute('transform', `translate(${frame.x}, ${frame.y})`);
      }
      el.classList.toggle('selected', !!frame.selected);
      el.classList.toggle('drop-valid', frame.dropState === 'valid');
      el.classList.toggle('drop-invalid', frame.dropState === 'invalid');
      el.classList.toggle('frame-aux', frame.type === 'aux');
      const rect = el.querySelector('.frame-rect');
      rect.setAttribute('width', frame.width);
      rect.setAttribute('height', frame.height);
      const header = el.querySelector('.frame-header');
      header.setAttribute('width', frame.width);
      header.setAttribute('height', LABEL_H);
      const label = el.querySelector('.frame-label');
      if (label.textContent !== frame.label) label.textContent = frame.label;
      const closeBtn = el.querySelector('.frame-close');
      // Frames "aux" (fila/pilha/visitados do modo Executar do macro, ver
      // App.js#_buildMacroAuxFrames) são só uma visualização derivada do
      // passo atual — não existem em `this.frames`, então não há o que
      // fechar/remover; some o "×" pra não sugerir uma ação que não faz nada.
      closeBtn.style.display = frame.type === 'aux' ? 'none' : '';
      closeBtn.setAttribute('transform', `translate(${frame.width - 18}, 20)`);
    });
  }

  _renderEdges(edges) {
    const ids = new Set(edges.map((e) => e.id));
    for (const [id, el] of this.edgeEls) {
      if (!ids.has(id)) {
        el.remove();
        this.edgeEls.delete(id);
      }
    }
    edges.forEach((edge) => {
      let el = this.edgeEls.get(edge.id);
      if (!el) {
        el = svgEl('g', { class: 'edge', 'data-id': edge.id });
        const line = svgEl('line', { class: 'edge-line no-enter-transition' });
        this._positionEdgeLine(line, edge.source, edge.target);
        el.appendChild(line);
        this.edgesLayer.appendChild(el);
        this.edgeEls.set(edge.id, el);
        this._suppressEnterTransition(line);
      }
      const line = el.querySelector('line');
      this._positionEdgeLine(line, edge.source, edge.target);
      if (edge.directed) line.setAttribute('marker-end', 'url(#arrowhead)');
      else line.removeAttribute('marker-end');
      el.classList.toggle('active', !!edge.active);
    });
  }

  _positionEdgeLine(line, source, target) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const ux = dx / dist;
    const uy = dy / dist;
    line.setAttribute('x1', source.x + ux * NODE_RADIUS);
    line.setAttribute('y1', source.y + uy * NODE_RADIUS);
    line.setAttribute('x2', target.x - ux * (NODE_RADIUS + 4));
    line.setAttribute('y2', target.y - uy * (NODE_RADIUS + 4));
  }

  _renderNodes(nodes) {
    const ids = new Set(nodes.map((n) => n.id));
    for (const [id, el] of this.nodeEls) {
      if (!ids.has(id)) {
        el.remove();
        this.nodeEls.delete(id);
      }
    }
    nodes.forEach((node) => {
      let el = this.nodeEls.get(node.id);
      if (!el) {
        el = svgEl('g', {
          class: 'node no-enter-transition',
          'data-id': node.id,
          transform: `translate(${node.x}, ${node.y})`,
        });
        // O efeito de entrada (pop-in) anima `transform: scale(...)`, que substituiria
        // por completo o translate acima caso aplicado no mesmo elemento (CSS só permite
        // um valor de `transform`). Por isso vive num `<g>` interno separado, sem posição.
        const pop = svgEl('g', { class: 'node-pop' });
        pop.appendChild(svgEl('circle', { r: NODE_RADIUS, class: 'node-circle' }));
        pop.appendChild(svgEl('text', { class: 'node-label', 'text-anchor': 'middle', dy: '0.35em' }));
        pop.appendChild(
          svgEl('text', {
            class: 'node-top-label',
            'text-anchor': 'middle',
            y: -(NODE_RADIUS + 10),
          }),
        );
        el.appendChild(pop);
        this.nodesLayer.appendChild(el);
        this.nodeEls.set(node.id, el);
        this._suppressEnterTransition(el);
      } else {
        el.setAttribute('transform', `translate(${node.x}, ${node.y})`);
      }
      el.classList.toggle('dragging', !!node.dragging);
      el.classList.toggle('free', !!node.free);
      el.classList.toggle('selected', !!node.selected);
      el.classList.remove('current', 'visited', 'in-aux');
      if (node.state) el.classList.add(node.state);
      const text = el.querySelector('.node-label');
      if (text.textContent !== node.label) text.textContent = node.label;
      const topLabel = el.querySelector('.node-top-label');
      const topText = node.topLabel ?? '';
      if (topLabel.textContent !== topText) topLabel.textContent = topText;
    });
  }

  destroy() {
    this.svg.remove();
  }
}
