const STRUCTURE_LABELS = {
  list: 'Lista Ligada',
  stack: 'Pilha',
  queue: 'Fila',
  tree: 'Árvore (BST)',
  graph: 'Grafo',
};

const STRUCTURE_HINTS = {
  list: 'Solte um nó no início, no fim ou entre dois nós para inserir naquela posição.',
  stack: 'Solte um nó sobre a pilha para empilhar (push). Arraste o nó do topo para fora para desempilhar.',
  queue: 'Nós entram sempre pelo fim (enqueue). Arraste o nó da frente ou de trás para fora para remover.',
  tree: 'Solte um nó sobre a árvore para inserir seguindo a regra de BST. Só folhas podem ser removidas por arraste.',
  graph: 'Solte um nó dentro do grafo para adicioná-lo na posição escolhida. Ligue arestas pela lista abaixo.',
};

/**
 * Sidebar: criação de frames + painel do frame selecionado (sandbox). Rodar
 * um algoritmo contra a estrutura é feito pelo editor de código sempre
 * visível ao lado do canvas (ver App.js#_buildLayout/_runMacroCode) — não é
 * mais responsabilidade da Sidebar. Não guarda estado próprio — lê `ctx` e
 * delega tudo a `actions`.
 */
export class Sidebar {
  constructor(container, actions) {
    this.container = container;
    this.actions = actions;
  }

  render(ctx) {
    this.container.innerHTML = '';
    this.container.appendChild(this._buildAddFrame());
    if (ctx.selectedFrame) {
      this.container.appendChild(this._buildFrameDetail(ctx));
    } else {
      this.container.appendChild(this._buildEmptyHint());
    }
  }

  _buildAddFrame() {
    const wrap = document.createElement('div');
    wrap.className = 'panel-block';
    const title = document.createElement('h2');
    title.textContent = 'Adicionar estrutura';
    wrap.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'add-frame-grid';
    Object.entries(STRUCTURE_LABELS).forEach(([type, label]) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'btn add-frame-btn';
      btn.addEventListener('click', () => this.actions.addFrame(type));
      grid.appendChild(btn);
    });
    wrap.appendChild(grid);

    const tip = document.createElement('p');
    tip.className = 'muted-text';
    tip.textContent = 'Clique num espaço vazio do canvas para criar um nó solto. Arraste-o para dentro de uma estrutura.';
    wrap.appendChild(tip);

    return wrap;
  }

  _buildEmptyHint() {
    const wrap = document.createElement('div');
    wrap.className = 'panel-block';
    const p = document.createElement('p');
    p.className = 'muted-text';
    p.textContent = 'Selecione um frame no canvas (clique nele) para ver suas ações e rodar algoritmos.';
    wrap.appendChild(p);
    return wrap;
  }

  _buildFrameDetail(ctx) {
    const { selectedFrame } = ctx;
    const wrap = document.createElement('div');
    wrap.className = 'panel-block';

    const title = document.createElement('h2');
    title.textContent = STRUCTURE_LABELS[selectedFrame.type];
    wrap.appendChild(title);

    const hint = document.createElement('p');
    hint.className = 'muted-text hint-text';
    hint.textContent = STRUCTURE_HINTS[selectedFrame.type];
    wrap.appendChild(hint);

    if (selectedFrame.type === 'graph') {
      wrap.appendChild(this._buildEdgeForm(ctx));
    }

    const row = document.createElement('div');
    row.className = 'btn-row';
    const randomBtn = document.createElement('button');
    randomBtn.textContent = 'Popular aleatório';
    randomBtn.className = 'btn subtle';
    randomBtn.addEventListener('click', () => this.actions.populateRandom(selectedFrame.id));
    row.appendChild(randomBtn);

    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'Limpar';
    clearBtn.className = 'btn subtle';
    clearBtn.addEventListener('click', () => this.actions.clearFrame(selectedFrame.id));
    row.appendChild(clearBtn);

    const removeBtn = document.createElement('button');
    removeBtn.textContent = 'Remover frame';
    removeBtn.className = 'btn danger';
    removeBtn.addEventListener('click', () => this.actions.removeFrame(selectedFrame.id));
    row.appendChild(removeBtn);

    wrap.appendChild(row);
    return wrap;
  }

  _buildEdgeForm(ctx) {
    const wrap = document.createElement('div');
    wrap.className = 'edge-form';

    const from = document.createElement('select');
    const to = document.createElement('select');
    (ctx.selectedFrameNodes ?? []).forEach(({ id, label }) => {
      const opt1 = document.createElement('option');
      opt1.value = id;
      opt1.textContent = `Nó ${label}`;
      from.appendChild(opt1);
      to.appendChild(opt1.cloneNode(true));
    });

    const btn = document.createElement('button');
    btn.textContent = 'Ligar arestas';
    btn.className = 'btn';
    btn.disabled = (ctx.selectedFrameNodes ?? []).length < 2;
    btn.addEventListener('click', () => {
      if (from.value && to.value) this.actions.addGraphEdge(ctx.selectedFrame.id, from.value, to.value);
    });

    wrap.appendChild(from);
    wrap.appendChild(to);
    wrap.appendChild(btn);
    return wrap;
  }

}

export { STRUCTURE_LABELS };
