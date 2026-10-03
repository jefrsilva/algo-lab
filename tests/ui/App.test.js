// @vitest-environment jsdom
// Teste de integração da interface: monta o App inteiro no jsdom e usa os
// mesmos controles que a pessoa usa (editor, Sandbox/Simulação, ▶ Rodar,
// barra de reprodução, console, Ctrl+Espaço, atalhos, salvar/carregar).
// Não confere desenho/posição (o jsdom não faz layout) — pra isso há o
// smoke test com Playwright da skill verificar-mudanca.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { linhas } from '../helpers/runDsl.js';
import { STRUCT_W, arrayHandleRect, arrayLayout, chartLayout, dictHandleRect, matrixHandleRect } from '../../src/render/MicroCanvasView.js';

let app;
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];
const botao = (sel, texto) => $$(sel).find((b) => b.textContent.trim() === texto);
const consoleTexto = () => $('.micro-console .console-body').textContent;
const contador = () => $('.step-counter')?.textContent;
const textarea = () => $('.code-editor-textarea');

function escreverCodigo(codigo) {
  textarea().value = codigo;
  textarea().dispatchEvent(new Event('input', { bubbles: true }));
}

function rodarNaSimulacao(codigo) {
  botao('.code-editor-mode-btn', 'Simulação').click();
  escreverCodigo(codigo);
  $('.code-editor-run-btn').click();
}

/** Ctrl+Enter no Sandbox, com o cursor na linha `idx` (0-based). */
function ctrlEnterNaLinha(idx) {
  const ta = textarea();
  const inicio = ta.value.split('\n').slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(inicio, inicio);
  tecla(ta, 'Enter', { ctrlKey: true });
}

const variaveis = () => [...app.micro.variables.values()];

beforeEach(async () => {
  app = await montarApp();
});

afterEach(() => {
  desmontarApp(app);
  vi.restoreAllMocks();
});

describe('montagem', () => {
  test('a interface sobe vazia, com editor, canvas e modo Sandbox', () => {
    expect(textarea()).not.toBeNull();
    expect(textarea().value).toBe('');
    expect($('.micro-container svg')).not.toBeNull();
    expect(botao('.code-editor-mode-btn', 'Sandbox').classList.contains('active')).toBe(true);
    expect(app.micro.structs.size + app.micro.pointers.size + app.micro.arrays.size).toBe(0);
  });
});

describe('Simulação', () => {
  test('▶ Rodar gera os passos, e a barra de reprodução navega por eles', () => {
    rodarNaSimulacao(linhas('x = 1', 'print(x)', 'x = 2', 'print(x)'));
    expect(contador()).toBe('1 / 4');
    expect(variaveis()[0].value).toBe(1);

    botao('.playback-btn', '⏭').click();
    expect(contador()).toBe('4 / 4');
    expect(consoleTexto()).toContain('1');
    expect(consoleTexto()).toContain('2');
    expect(variaveis()[0].value).toBe(2);

    botao('.playback-btn', '◀').click();
    expect(contador()).toBe('3 / 4');
    expect(consoleTexto()).not.toContain('2');
  });

  test('Ctrl+. e Ctrl+, avançam e voltam um passo', () => {
    rodarNaSimulacao(linhas('a = 1', 'b = 2', 'c = 3'));
    tecla(window, '.', { ctrlKey: true });
    tecla(window, '.', { ctrlKey: true });
    expect(contador()).toBe('3 / 3');
    tecla(window, ',', { ctrlKey: true });
    expect(contador()).toBe('2 / 3');
  });

  test('o passo atual destaca a linha do código', () => {
    rodarNaSimulacao(linhas('a = 1', 'b = 2'));
    botao('.playback-btn', '▶|').click();
    expect(app.codeEditor.markedLine).toBe(1);
  });

  test('erro de sintaxe aparece na barra, com a linha', () => {
    rodarNaSimulacao(linhas('x = 1', 'y = (2'));
    expect($('.micro-run-error').textContent).toMatch(/^Erro de sintaxe \(linha 2\)/);
    expect(app.microRunner.hasSteps).toBe(false);
  });

  test('aviso do interpretador vai pro console com ⚠', () => {
    rodarNaSimulacao('r = range(0, 3, 0)');
    expect(consoleTexto()).toContain('range(): o passo não pode ser zero.');
  });

  test('o canvas desenha os elementos criados pelo programa', () => {
    rodarNaSimulacao(linhas('nums = [7, 8, 9]', 'a = Node(42)'));
    botao('.playback-btn', '⏭').click();
    const textoSvg = $('.micro-container svg').textContent;
    expect(textoSvg).toContain('nums');
    expect(textoSvg).toContain('42');
    // o código cria o ponteiro-rótulo do array (App#_createArrayLabelPointer)
    const nums = [...app.micro.arrays.values()][0];
    expect(app.micro.pointers.get(nums.labelPointerId).label).toBe('nums');
  });

  test('"x = x + [2]" com outro nome na lista antiga leva o rótulo "x" pra lista nova', () => {
    rodarNaSimulacao(linhas('x = [0]', 'y = x', 'x = x + [2]'));
    botao('.playback-btn', '⏭').click();
    const arrays = [...app.micro.arrays.values()];
    const nova = arrays.find((a) => a.name === 'x');
    const antiga = arrays.find((a) => a !== nova);
    expect(nova.cells).toEqual([0, 2]);
    expect(app.micro.pointers.get(nova.labelPointerId)).toMatchObject({ label: 'x', target: { kind: 'array', id: nova.id } });
    expect(antiga.labelPointerId).toBeFalsy();
    const y = [...app.micro.pointers.values()].find((p) => p.label === 'y');
    expect(y.target).toEqual({ kind: 'array', id: antiga.id });
  });

  test('dict reatribuído com alias leva o rótulo; dict local tem rótulo no frame da chamada', () => {
    rodarNaSimulacao(linhas('d = {"a": 1}', 'e = d', 'd = {"b": 2}', 'def f():', '    t = {}', '    return t', 'r = f()'));
    botao('.playback-btn', '⏭').click();
    const dicts = [...app.micro.dicts.values()];
    const d = dicts.find((x) => x.name === 'd');
    expect(app.micro.pointers.get(d.labelPointerId)).toMatchObject({ label: 'd', target: { kind: 'dict', id: d.id } });
    const antigo = dicts.find((x) => x.cells[0]?.key === 'a');
    expect(antigo.labelPointerId).toBeFalsy();
    const t = dicts.find((x) => x.name === 't');
    expect(t.frameId).not.toBe('global');
    expect(app.micro.pointers.get(t.labelPointerId).frameId).toBe(t.frameId);
  });

  test('voltar pro Sandbox encerra a reprodução', () => {
    rodarNaSimulacao('x = 1');
    botao('.code-editor-mode-btn', 'Sandbox').click();
    expect(app.microRunner.hasSteps).toBe(false);
  });
});

describe('Sandbox (Ctrl+Enter linha a linha)', () => {
  test('executa só a linha do cursor, direto no modelo', () => {
    escreverCodigo(linhas('x = 5', 'y = x * 2', 'print(y)'));
    ctrlEnterNaLinha(0);
    expect(variaveis().map((v) => [v.name, v.value])).toEqual([['x', 5]]);
    ctrlEnterNaLinha(1);
    ctrlEnterNaLinha(2);
    expect(variaveis().map((v) => [v.name, v.value])).toEqual([
      ['x', 5],
      ['y', 10],
    ]);
    expect(consoleTexto()).toContain('10');
  });

  test('linha válida pisca verde; inválida pisca vermelho', () => {
    escreverCodigo(linhas('x = 1', 'x = (', 'print(nada[0]'));
    ctrlEnterNaLinha(0);
    expect($('.code-editor-line-flash.success')).not.toBeNull();
    ctrlEnterNaLinha(1);
    expect($('.code-editor-line-flash.error')).not.toBeNull();
  });

  test('expressão condicional, abs/int e lista reatribuída também rodam linha a linha', () => {
    escreverCodigo(linhas('n = abs(int("-4")) if True else 0', 'xs = [n]', 'xs = xs + [1]', 'print(xs)'));
    [0, 1, 2, 3].forEach(ctrlEnterNaLinha);
    expect(variaveis().map((v) => [v.name, v.value])).toEqual([['n', 4]]);
    expect(consoleTexto()).toContain('[4, 1]');
    expect([...app.micro.arrays.values()]).toHaveLength(1);
  });

  test('condição de if/while é avaliada e mostra o resultado', () => {
    escreverCodigo(linhas('x = 3', 'if x > 2:'));
    ctrlEnterNaLinha(0);
    ctrlEnterNaLinha(1);
    expect(consoleTexto()).toContain('> True');
  });
});

describe('ações rápidas (Ctrl+Espaço)', () => {
  test('abre a paleta e "n v" + Enter cria uma variável editável no lugar', () => {
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    const input = $('.quick-action-input');
    expect(input).not.toBeNull();
    input.value = 'n v';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    tecla(input, 'Enter');
    expect(variaveis()).toHaveLength(1);
    expect($('.quick-action-input')).toBeNull();
    // já abre a edição do nome no lugar
    expect(app.microInlineEditor.isOpen).toBe(true);
    expect(document.activeElement.classList.contains('inline-value-editor')).toBe(true);
  });

  test('comandos que mexem no modelo ficam indisponíveis durante a Simulação', () => {
    rodarNaSimulacao('x = 1');
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    const input = $('.quick-action-input');
    input.value = 'new pointer';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect($('.quick-action-item.disabled')).not.toBeNull();
  });
});

describe('gráfico Big-O: leitura com o mouse sobre o gráfico (hover)', () => {
  /** Cria um gráfico por "new chart" e o põe na origem do mundo com a curva O(n). */
  function criarGrafico() {
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    const input = $('.quick-action-input');
    input.value = 'new chart';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    tecla(input, 'Enter');
    const chart = [...app.microCharts.values()][0];
    Object.assign(chart, { x: 0, y: 0, functions: ['n'] });
    return chart;
  }
  const svg = () => $('.micro-canvas');
  const leitura = () => $('.chart-readout');
  /** Mouse no ponto local (x, y) do gráfico — sem layout no jsdom, o canvas
   * fica em (0, 0) da janela e a tela é o mundo deslocado por tx/ty. */
  function moverLocal(x, y, opts = {}) {
    const { tx, ty } = app.microViewport;
    svg().dispatchEvent(new MouseEvent('pointermove', { clientX: x + tx, clientY: y + ty, bubbles: true, ...opts }));
  }
  /** Mouse sobre (n, f) do gráfico. */
  function mover(chart, n, v, opts = {}) {
    const { px, py } = chartLayout(chart);
    moverLocal(px(n), py(v), opts);
  }

  test('mouse sobre a plotagem (sem Shift) mostra n, f(n) e o ponto na curva', () => {
    const chart = criarGrafico();
    mover(chart, 5.2, 2);
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('5');
    expect($('.chart-readout-value').textContent).toBe('5');
    // ponto e guia na cor da curva
    expect($('.chart-readout-dot').getAttribute('fill')).toBe('#3b82f6');
    expect($('.chart-readout-guide').getAttribute('stroke')).toBe('#3b82f6');
    // estado transitório de hover: nada disso vai pro gráfico guardado
    expect(Object.keys(chart)).not.toContain('readout');

    // com Shift também lê (o Shift não muda nada)
    mover(chart, 8, 8, { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('8');
  });

  test('o valor de f(n) usa a cor de texto do tema (var(--text-0)), não a da curva', () => {
    const chart = criarGrafico();
    mover(chart, 5, 5);
    // sem `fill` do render: a cor vem do CSS (quase branco no tema escuro)
    expect($('.chart-readout-value').getAttribute('fill')).toBeNull();
    const css = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '../../src/styles/canvas.css'), 'utf8');
    const regras = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(([, sel]) =>
      sel.split(',').some((s) => s.trim() === '.chart-readout-value'),
    );
    expect(regras.some(([, , corpo]) => /(^|[\s;])fill:\s*var\(--text-0\)/.test(corpo))).toBe(true);
  });

  test('apertar e soltar o Shift com o mouse parado não muda a leitura', () => {
    const chart = criarGrafico();
    mover(chart, 7, 7);
    expect(leitura().getAttribute('display')).toBe('inline');
    tecla(window, 'Shift', { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('inline');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('7');
  });

  test('não aparece com botão pressionado, fora da plotagem, e some ao sair do canvas', () => {
    const chart = criarGrafico();
    mover(chart, 6, 6, { buttons: 1 });
    expect(leitura().getAttribute('display')).toBe('none');
    const { plot } = chartLayout(chart);
    moverLocal(plot.x - 10, plot.y + 10);
    expect(leitura().getAttribute('display')).toBe('none');
    mover(chart, 6, 6);
    expect(leitura().getAttribute('display')).toBe('inline');
    svg().dispatchEvent(new MouseEvent('pointerleave'));
    expect(leitura().getAttribute('display')).toBe('none');
  });

  test('clicar e arrastar o gráfico esconde a leitura; ela volta no hover seguinte', () => {
    const chart = criarGrafico();
    mover(chart, 6, 6);
    expect(leitura().getAttribute('display')).toBe('inline');
    const { px, py } = chartLayout(chart);
    const { tx, ty } = app.microViewport;
    const ponto = (dx) => ({ clientX: px(6) + tx + dx, clientY: py(6) + ty, bubbles: true });
    svg().dispatchEvent(new MouseEvent('pointerdown', { ...ponto(0), button: 0, buttons: 1 }));
    expect(leitura().getAttribute('display')).toBe('none');
    // arrasto: o mouse anda com o botão apertado e a leitura segue escondida
    window.dispatchEvent(new MouseEvent('pointermove', { ...ponto(30), buttons: 1 }));
    svg().dispatchEvent(new MouseEvent('pointermove', { ...ponto(30), buttons: 1 }));
    expect(leitura().getAttribute('display')).toBe('none');
    window.dispatchEvent(new MouseEvent('pointerup', { ...ponto(30), button: 0 }));
    expect(chart.x).toBe(30); // o gráfico foi movido normalmente
    expect(leitura().getAttribute('display')).toBe('none');
    mover(chart, 6, 6);
    expect(leitura().getAttribute('display')).toBe('inline');
  });

  test('zoom com a roda do mouse parado sobre o gráfico mantém a leitura', () => {
    const chart = criarGrafico();
    mover(chart, 6, 6);
    const { px, py } = chartLayout(chart);
    const { tx, ty } = app.microViewport;
    svg().dispatchEvent(
      new WheelEvent('wheel', { clientX: px(6) + tx, clientY: py(6) + ty, deltaY: -100, bubbles: true, cancelable: true }),
    );
    expect(app.microViewport.scale).toBeGreaterThan(1);
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('6');
  });
});

describe('atalhos e configurações', () => {
  test('N alterna nomes completos e grava a preferência', () => {
    expect(app.microFullNames).toBe(false);
    tecla(document.body, 'n');
    expect(app.microFullNames).toBe(true);
    expect(JSON.parse(localStorage.getItem('algo-visualizer:settings')).fullNames).toBe(true);
  });

  test('Ctrl+H oculta o painel de código', () => {
    tecla(document.body, 'h', { ctrlKey: true });
    expect(app.codePanelHidden).toBe(true);
    tecla(document.body, 'h', { ctrlKey: true });
    expect(app.codePanelHidden).toBe(false);
  });

  test('V/T/R/B trocam a ferramenta do canvas', () => {
    tecla(document.body, 't');
    expect(app.microMode).toBe('text');
    tecla(document.body, 'r');
    expect(app.microMode).toBe('area');
    tecla(document.body, 'v');
    expect(app.microMode).toBe('select');
  });

  test('a barra de ferramentas mostra um ícone SVG em cada botão, Selecionar ativo de início', () => {
    const selecionar = $('.mode-btn[aria-label="Selecionar / Mover"]');
    expect(selecionar).not.toBeNull();
    expect(selecionar.classList.contains('active')).toBe(true);
    expect(selecionar.querySelector('svg')).not.toBeNull();
    expect($$('.mode-toolbar .mode-btn').every((b) => b.querySelector('svg'))).toBe(true);
  });

  test('atalhos de letra não disparam enquanto se digita no editor', () => {
    textarea().focus();
    tecla(textarea(), 'n');
    expect(app.microFullNames).toBe(false);
  });
});

describe('salvar e carregar projeto', () => {
  async function salvar() {
    let blob = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      blob = b;
      return 'blob:teste';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    app._saveProject();
    return JSON.parse(await blob.text());
  }

  test('o arquivo salvo tem código, título e modelo', async () => {
    escreverCodigo(linhas('nums = [1, 2]', 'x = 3'));
    ctrlEnterNaLinha(0);
    ctrlEnterNaLinha(1);
    app.microCanvasTitle.setText('Meu projeto');
    const projeto = await salvar();
    expect(projeto).toMatchObject({ format: 'algo-visualizer-project', version: 1, title: 'Meu projeto', code: 'nums = [1, 2]\nx = 3\n' });
    expect(projeto.micro.arrays.map((a) => a.cells)).toEqual([[1, 2]]);
    expect(projeto.micro.variables.map((v) => [v.name, v.value])).toEqual([['x', 3]]);
  });

  test('carregar num app novo devolve tudo (ida e volta)', async () => {
    escreverCodigo(linhas('nums = [1, 2]', 'a = Node(5)'));
    ctrlEnterNaLinha(0);
    ctrlEnterNaLinha(1);
    app.microCanvasTitle.setText('Ida e volta');
    const projeto = await salvar();

    desmontarApp(app);
    app = await montarApp();
    await app._applyLoadedProject(projeto);
    expect(textarea().value).toBe('nums = [1, 2]\na = Node(5)\n');
    expect(app.microCanvasTitle.text).toBe('Ida e volta');
    expect(app.micro.toJSON()).toEqual(projeto.micro);
  });
});

describe('alinhar e distribuir a seleção', () => {
  const svg = () => $('.micro-canvas');
  const botaoAlinhar = (id) => $(`.align-btn[data-align="${id}"]`);
  /** Ponteiro no ponto (x, y) do MUNDO — sem layout no jsdom, a tela é o
   * mundo deslocado por tx/ty (ver o teste do gráfico). */
  function evento(alvo, tipo, x, y, opts = {}) {
    const { tx, ty } = app.microViewport;
    alvo.dispatchEvent(new MouseEvent(tipo, { clientX: x + tx, clientY: y + ty, button: 0, bubbles: true, ...opts }));
  }
  function clicar(x, y, opts = {}) {
    evento(svg(), 'pointerdown', x, y, opts);
    evento(window, 'pointerup', x, y, opts);
  }
  function arrastar(x0, y0, x1, y1) {
    evento(svg(), 'pointerdown', x0, y0);
    evento(window, 'pointermove', x1, y1);
    evento(window, 'pointerup', x1, y1);
  }
  /** Três nós soltos, em lugares e alturas diferentes. */
  function tresNos() {
    const a = app.micro.addStruct(0, 300, 1);
    const b = app.micro.addStruct(400, 0, 2);
    const c = app.micro.addStruct(200, 150, 3);
    app._renderMicroOnly();
    return [a, b, c];
  }

  test('os botões só aparecem com seleção suficiente: alinhar com 2+, distribuir com 3+', () => {
    const [a, b, c] = tresNos();
    expect($('.align-toolbar')).toBeNull();
    clicar(a.x + 10, a.y + 10);
    expect($('.align-toolbar')).toBeNull();
    clicar(b.x + 10, b.y + 10, { ctrlKey: true });
    expect(botaoAlinhar('left')).not.toBeNull();
    expect(botaoAlinhar('distribute-x')).toBeNull();
    clicar(c.x + 10, c.y + 10, { ctrlKey: true });
    expect(botaoAlinhar('distribute-x')).not.toBeNull();
    clicar(-500, -500); // clique no vazio limpa a seleção
    expect($('.align-toolbar')).toBeNull();
  });

  test('alinhar usa o 1º elemento clicado como referência', () => {
    const [a, b, c] = tresNos();
    clicar(b.x + 10, b.y + 10);
    clicar(a.x + 10, a.y + 10, { ctrlKey: true });
    clicar(c.x + 10, c.y + 10, { ctrlKey: true });
    botaoAlinhar('left').click();
    expect([a.x, b.x, c.x]).toEqual([400, 400, 400]);
    expect([a.y, b.y, c.y]).toEqual([300, 0, 150]);
    botaoAlinhar('bottom').click();
    expect([a.y, b.y, c.y]).toEqual([0, 0, 0]);
  });

  test('seleção em área alinha pelos extremos do grupo', () => {
    const [a, b, c] = tresNos();
    arrastar(-50, -50, 700, 500);
    expect(app._microSelectionIds()).toHaveLength(3);
    botaoAlinhar('left').click();
    expect([a.x, b.x, c.x]).toEqual([0, 0, 0]);
    botaoAlinhar('top').click();
    expect([a.y, b.y, c.y]).toEqual([0, 0, 0]);
  });

  test('distribuir deixa o mesmo espaço entre vizinhos, com os extremos parados', () => {
    const [a, b, c] = tresNos();
    c.x = 50;
    arrastar(-50, -50, 700, 500);
    botaoAlinhar('distribute-x').click();
    expect([a.x, c.x, b.x]).toEqual([0, 200, 400]);
  });

  test('coleções alinham pela caixa COM a aba de arrastar', () => {
    const no = app.micro.addStruct(0, 0, 1);
    const arr = app.micro.addArray(300, 200, { size: 3 });
    app._renderMicroOnly();
    clicar(no.x + 10, no.y + 10);
    app._toggleMicroSelection(arr.id);
    app._renderMicroOnly();
    botaoAlinhar('left').click();
    expect(arr.x + arrayHandleRect(arr).x).toBe(0);
  });

  test('pelo Ctrl+Espaço também, com o comando indisponível sem seleção', () => {
    const [a, b] = tresNos();
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    let input = $('.quick-action-input');
    input.value = 'align left';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect($('.quick-action-item.disabled')).not.toBeNull();
    tecla(input, 'Escape');

    clicar(a.x + 10, a.y + 10);
    clicar(b.x + 10, b.y + 10, { ctrlKey: true });
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    input = $('.quick-action-input');
    input.value = 'align right';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    tecla(input, 'Enter');
    expect(b.x).toBe(0);
  });
});

describe('organizar uma árvore por níveis', () => {
  const svg = () => $('.micro-canvas');
  const botaoArvore = (id) => $(`.tree-layout-btn[data-tree-layout="${id}"]`);
  function clicar(x, y, opts = {}) {
    const { tx, ty } = app.microViewport;
    const ev = (alvo, tipo) =>
      alvo.dispatchEvent(new MouseEvent(tipo, { clientX: x + tx, clientY: y + ty, button: 0, bubbles: true, ...opts }));
    ev(svg(), 'pointerdown');
    ev(window, 'pointerup');
  }
  /** Roda uma BST de 10 nós na Simulação e vai pro último passo; devolve os
   * structs por valor. */
  function montarBst() {
    rodarNaSimulacao(
      linhas(
        'def inserir(r, v):',
        '    if r is None:',
        '        return TreeNode(v)',
        '    if v < r.data:',
        '        r.left = inserir(r.left, v)',
        '    else:',
        '        r.right = inserir(r.right, v)',
        '    return r',
        'raiz = None',
        'for v in [50, 30, 70, 20, 40, 60, 80, 35, 65, 90]:',
        '    raiz = inserir(raiz, v)',
      ),
    );
    botao('.playback-btn', '⏭').click();
    return Object.fromEntries([...app.micro.structs.values()].map((n) => [n.data, n]));
  }

  test('com um TreeNode selecionado aparecem os botões; "Árvore ↕" arranja por níveis com a raiz parada', () => {
    const no = montarBst();
    expect($('.tree-layout-toolbar')).toBeNull();
    const { x, y } = no[50];
    clicar(x + 60, y + 20);
    expect(app._microSelectionIds()).toEqual([no[50].id]);
    expect(botaoArvore('vertical')).not.toBeNull();
    botaoArvore('vertical').click();

    expect([no[50].x, no[50].y]).toEqual([x, y]);
    // níveis alinhados, um abaixo do outro
    expect(new Set([no[30].y, no[70].y]).size).toBe(1);
    expect(new Set([no[20].y, no[40].y, no[60].y, no[80].y]).size).toBe(1);
    expect(new Set([no[35].y, no[65].y, no[90].y]).size).toBe(1);
    expect(y < no[30].y && no[30].y < no[20].y && no[20].y < no[35].y).toBe(true);
    // esquerdo à esquerda, direito à direita, sem sobreposição no nível
    const ordem = [20, 30, 35, 40, 50, 60, 65, 70, 80, 90].map((v) => no[v].x);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    const nivel2 = [20, 40, 60, 80].map((v) => no[v].x);
    for (let i = 1; i < nivel2.length; i++) expect(nivel2[i] - nivel2[i - 1]).toBeGreaterThanOrEqual(STRUCT_W);
    // ponteiros não se movem
    const raiz = [...app.micro.pointers.values()].find((p) => p.label === 'raiz');
    const antes = { x: raiz.x, y: raiz.y };
    botaoArvore('vertical').click();
    expect({ x: raiz.x, y: raiz.y }).toEqual(antes);
  });

  test('"Árvore ↔" pelo Ctrl+Espaço: níveis lado a lado, esquerdo acima do direito', () => {
    const no = montarBst();
    clicar(no[30].x + 60, no[30].y + 20);
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    const input = $('.quick-action-input');
    input.value = 'layout tree horizontal';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    tecla(input, 'Enter');
    // só a subárvore do 30 se mexe; o 30 fica parado
    expect(new Set([no[20].x, no[40].x]).size).toBe(1);
    expect(no[20].x).toBeGreaterThan(no[30].x);
    expect(no[35].x).toBeGreaterThan(no[40].x);
    expect(no[20].y).toBeLessThan(no[30].y);
    expect(no[40].y).toBeGreaterThan(no[30].y);
  });

  test('não aparece pra nó de lista nem com 2 selecionados, e o comando fica indisponível', () => {
    const lista = app.micro.addStruct(0, 0, 1);
    const arvore = app.micro.addStruct(300, 0, 2, 'tree');
    app._renderMicroOnly();
    clicar(lista.x + 60, lista.y + 20);
    expect($('.tree-layout-toolbar')).toBeNull();
    clicar(arvore.x + 60, arvore.y + 20);
    expect($('.tree-layout-toolbar')).not.toBeNull();
    clicar(lista.x + 60, lista.y + 20, { ctrlKey: true });
    expect($('.tree-layout-toolbar')).toBeNull();
    tecla(window, ' ', { code: 'Space', ctrlKey: true });
    const input = $('.quick-action-input');
    input.value = 'layout tree vertical';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect($('.quick-action-item.disabled')).not.toBeNull();
  });
});

describe('ferramenta Ligar nós', () => {
  const svg = () => $('.micro-canvas');
  /** Ponteiro no ponto (x, y) do MUNDO (ver "alinhar e distribuir"). */
  function evento(alvo, tipo, x, y, opts = {}) {
    const { tx, ty } = app.microViewport;
    alvo.dispatchEvent(new MouseEvent(tipo, { clientX: x + tx, clientY: y + ty, button: 0, bubbles: true, ...opts }));
  }
  const meio = (n) => ({ x: n.x + 20, y: n.y + 20 });
  /** Arraste do meio de `de` até o meio de `para` (nós ou pontos soltos). */
  function arrastar(de, para, opts = {}) {
    const a = meio(de);
    const b = meio(para);
    evento(svg(), 'pointerdown', a.x, a.y, opts);
    evento(window, 'pointermove', (a.x + b.x) / 2, (a.y + b.y) / 2, opts);
    evento(window, 'pointermove', b.x, b.y, opts);
    evento(window, 'pointerup', b.x, b.y, opts);
  }
  /** Clique (sem arraste) no ponto do mundo — com a ferramenta, o gesto
   * padrão: um clique na origem e outro no destino. */
  function clicarEm(x, y, opts = {}) {
    evento(svg(), 'pointerdown', x, y, opts);
    evento(window, 'pointerup', x, y, opts);
  }
  /** Mouse andando sobre o canvas sem botão pressionado. */
  const pairar = (x, y) => evento(svg(), 'pointermove', x, y, { buttons: 0 });
  /** Clique na metade esquerda/direita de um nó. */
  const naEsquerda = (n) => ({ x: n.x + 15, y: n.y + 28 });
  const naDireita = (n) => ({ x: n.x + STRUCT_W - 15, y: n.y + 28 });
  function botaoDireito(x, y) {
    const { tx, ty } = app.microViewport;
    const ev = new MouseEvent('contextmenu', { clientX: x + tx, clientY: y + ty, button: 2, bubbles: true, cancelable: true });
    svg().dispatchEvent(ev);
    return ev;
  }
  /** Dois nós de grafo, como GraphNode(v) — com a lista de vizinhos longe. */
  function doisNos() {
    const criar = (x, data) => {
      const s = app.micro.addStruct(x, 0, data, 'graph');
      const arr = app.micro.addArray(x, 400, { kind: 'ref', size: 0, name: `__graph_neighbors_${s.id}` });
      app.micro.setStructNeighborsArray(s.id, arr.id);
      return s;
    };
    const a = criar(0, 1);
    const b = criar(300, 2);
    app._renderMicroOnly();
    return [a, b];
  }
  /** Dois nós do tipo `tipo` ('list' = Node, 'tree' = TreeNode), soltos. */
  function doisStructs(tipo) {
    const a = app.micro.addStruct(0, 0, 1, tipo);
    const b = app.micro.addStruct(300, 0, 2, tipo);
    app._renderMicroOnly();
    return [a, b];
  }
  const vizinhos = (s) => app.micro.arrays.get(s.neighborsArrayId).cells;
  const destaque = () => $('.link-source-shape');
  const destaqueVisivel = () => destaque() && destaque().getAttribute('display') !== 'none';

  test('5/L escolhe a ferramenta, e o botão aparece na barra', () => {
    tecla(document.body, '5');
    expect(app.microMode).toBe('link');
    expect($('.micro-container').dataset.mode).toBe('link');
    tecla(document.body, 'v');
    tecla(document.body, 'l');
    expect(app.microMode).toBe('link');
    expect($$('.mode-btn')).toHaveLength(5);
    expect($('.mode-btn.active').title).toMatch(/\(5 \/ L\)$/);
  });

  test('clicar em A e depois em B liga A→B; repetir desliga', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    clicarEm(meio(a).x, meio(a).y);
    expect(app._microLinkDraft).toMatchObject({ fromId: a.id, field: null, pending: true });
    clicarEm(meio(b).x, meio(b).y);
    expect(vizinhos(a)).toEqual([b.id]);
    expect(vizinhos(b)).toEqual([]);
    expect(app._microLinkDraft).toBeNull();
    expect(app.microMode).toBe('link'); // a ferramenta continua escolhida
    expect({ x: a.x, y: a.y }).toEqual({ x: 0, y: 0 }); // o nó não se move
    clicarEm(meio(a).x, meio(a).y);
    clicarEm(meio(b).x, meio(b).y);
    expect(vizinhos(a)).toEqual([]);
  });

  test('arrastar sem Shift na ferramenta não liga ao soltar — espera o clique no destino', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    arrastar(a, b);
    expect(vizinhos(a)).toEqual([]);
    expect(app._microLinkDraft?.pending).toBe(true);
    clicarEm(meio(b).x, meio(b).y);
    expect(vizinhos(a)).toEqual([b.id]);
  });

  test('Shift + arrastar de A até B na ferramenta liga ao soltar; repetir desliga', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    arrastar(a, b, { shiftKey: true });
    expect(vizinhos(a)).toEqual([b.id]);
    expect(app._microLinkDraft).toBeNull();
    expect({ x: a.x, y: a.y }).toEqual({ x: 0, y: 0 });
    arrastar(a, b, { shiftKey: true });
    expect(vizinhos(a)).toEqual([]);
  });

  test('a seta de rascunho segue o mouse com a ligação pendente e some ao trocar de ferramenta', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    clicarEm(meio(a).x, meio(a).y);
    pairar(b.x + 20, b.y + 20);
    const linha = $('.preview-edge-line');
    expect(linha.getAttribute('display')).toBeNull();
    expect(linha.getAttribute('x2')).toBe(String(b.x + 20));
    expect(linha.classList.contains('invalid')).toBe(false);
    pairar(150, 300);
    expect(linha.classList.contains('invalid')).toBe(true);
    tecla(document.body, 'v');
    expect(linha.getAttribute('display')).toBe('none');
    expect(app._microLinkDraft).toBeNull();
  });

  test('a seta de rascunho acompanha o Shift + arraste', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    evento(svg(), 'pointerdown', a.x + 20, a.y + 20, { shiftKey: true });
    evento(window, 'pointermove', b.x + 20, b.y + 20, { shiftKey: true });
    const linha = $('.preview-edge-line');
    expect(linha.getAttribute('display')).toBeNull();
    expect(linha.getAttribute('x2')).toBe(String(b.x + 20));
    evento(window, 'pointermove', 150, 300, { shiftKey: true });
    expect(linha.classList.contains('invalid')).toBe(true);
    evento(window, 'pointerup', 150, 300, { shiftKey: true });
    expect(linha.getAttribute('display')).toBe('none');
    expect(vizinhos(a)).toEqual([]);
  });

  test('Shift + arrasto no modo Selecionar faz o mesmo, sem mover o nó', () => {
    const [a, b] = doisNos();
    expect(app.microMode).toBe('select');
    arrastar(a, b, { shiftKey: true });
    expect(vizinhos(a)).toEqual([b.id]);
    expect({ x: a.x, y: a.y }).toEqual({ x: 0, y: 0 });
    arrastar(a, b, { shiftKey: true });
    expect(vizinhos(a)).toEqual([]);
    // sem Shift, continua sendo arrastar o nó
    arrastar(a, { x: 100, y: 200 });
    expect({ x: a.x, y: a.y }).toEqual({ x: 100, y: 200 });
    expect(vizinhos(a)).toEqual([]);
  });

  test('soltar no vazio ou no próprio nó não muda nada', () => {
    const [a] = doisNos();
    tecla(document.body, 'l');
    arrastar(a, { x: 150, y: 250 }, { shiftKey: true });
    arrastar(a, { x: a.x + 15, y: a.y + 10 }, { shiftKey: true });
    expect(vizinhos(a)).toEqual([]);
    expect({ x: a.x, y: a.y }).toEqual({ x: 0, y: 0 });
  });

  test('funciona no modo simplificado (Ctrl+A) também', () => {
    const [a, b] = doisNos();
    tecla(document.body, 'a', { ctrlKey: true });
    expect(app.microSimplifiedNodes).toBe(true);
    tecla(document.body, 'l');
    clicarEm(meio(b).x, meio(b).y);
    clicarEm(meio(a).x, meio(a).y);
    expect(vizinhos(b)).toEqual([a.id]);
    expect(vizinhos(a)).toEqual([]);
  });

  test('nó de grafo sem lista de vizinhos ganha uma no primeiro link', () => {
    const [, b] = doisNos();
    const velho = app.micro.addStruct(0, 150, 7, 'graph');
    app._renderMicroOnly();
    tecla(document.body, 'l');
    clicarEm(meio(velho).x, meio(velho).y);
    clicarEm(meio(b).x, meio(b).y);
    expect(velho.neighborsArrayId).not.toBeNull();
    expect(vizinhos(velho)).toEqual([b.id]);
  });

  test('a ligação feita pela ferramenta sobrevive a salvar e carregar', async () => {
    const [a, b] = doisNos();
    tecla(document.body, 'l');
    clicarEm(meio(a).x, meio(a).y);
    clicarEm(meio(b).x, meio(b).y);
    let blob = null;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((bl) => {
      blob = bl;
      return 'blob:teste';
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    app._saveProject();
    const projeto = JSON.parse(await blob.text());

    desmontarApp(app);
    app = await montarApp();
    await app._applyLoadedProject(projeto);
    const a2 = app.micro.structs.get(a.id);
    expect(app.micro.arrays.get(a2.neighborsArrayId).cells).toEqual([b.id]);
    expect(app.micro.arrays.get(app.micro.structs.get(b.id).neighborsArrayId).cells).toEqual([]);
  });

  test('Node: a metade esquerda liga o prev, a direita o next; repetir desliga', () => {
    const [a, b] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(naDireita(a).x, naDireita(a).y);
    expect(app._microLinkDraft).toMatchObject({ fromId: a.id, field: 'next', pending: true });
    clicarEm(meio(b).x, meio(b).y);
    expect(a.next).toBe(b.id);
    expect(a.prev).toBeNull();
    clicarEm(naEsquerda(b).x, naEsquerda(b).y);
    clicarEm(meio(a).x, meio(a).y);
    expect(b.prev).toBe(a.id);
    expect(b.next).toBeNull();
    clicarEm(naDireita(a).x, naDireita(a).y);
    clicarEm(meio(b).x, meio(b).y);
    expect(a.next).toBeNull();
  });

  test('TreeNode: left pela metade esquerda, right pela direita (também no modo simplificado)', () => {
    const [a, b] = doisStructs('tree');
    const c = app.micro.addStruct(0, 200, 3, 'tree');
    tecla(document.body, 'a', { ctrlKey: true });
    tecla(document.body, 'l');
    clicarEm(naEsquerda(a).x, naEsquerda(a).y);
    clicarEm(meio(c).x, meio(c).y);
    clicarEm(naDireita(a).x, naDireita(a).y);
    clicarEm(meio(b).x, meio(b).y);
    expect(a.prev).toBe(c.id); // left (prev físico)
    expect(a.next).toBe(b.id); // right (next físico)
  });

  test('Shift + arrastar de um Node liga pelo ponteiro da metade onde começou', () => {
    const [a, b] = doisStructs('list');
    tecla(document.body, 'l');
    const de = naEsquerda(b);
    evento(svg(), 'pointerdown', de.x, de.y, { shiftKey: true });
    evento(window, 'pointermove', 100, 30, { shiftKey: true });
    evento(window, 'pointermove', a.x + 60, a.y + 30, { shiftKey: true });
    evento(window, 'pointerup', a.x + 60, a.y + 30, { shiftKey: true });
    expect(b.prev).toBe(a.id);
    expect(b.next).toBeNull();
    // no modo Selecionar também
    tecla(document.body, 'v');
    const de2 = naDireita(a);
    evento(svg(), 'pointerdown', de2.x, de2.y, { shiftKey: true });
    evento(window, 'pointermove', 200, 30, { shiftKey: true });
    evento(window, 'pointermove', b.x + 60, b.y + 30, { shiftKey: true });
    evento(window, 'pointerup', b.x + 60, b.y + 30, { shiftKey: true });
    expect(a.next).toBe(b.id);
    expect({ x: a.x, y: a.y }).toEqual({ x: 0, y: 0 });
  });

  test('só liga nós do mesmo tipo', () => {
    const [a] = doisStructs('list');
    const t = app.micro.addStruct(0, 200, 9, 'tree');
    const [g] = doisNos();
    g.x = 600;
    app._renderMicroOnly();
    tecla(document.body, 'l');
    clicarEm(naDireita(a).x, naDireita(a).y);
    clicarEm(meio(t).x, meio(t).y);
    clicarEm(meio(g).x, meio(g).y);
    expect(a.next).toBeNull();
    expect(app._microLinkDraft?.pending).toBe(true); // continua esperando um destino válido
  });

  test('Tab alterna o ponteiro da ligação pendente (prev ↔ next)', () => {
    const [a, b] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(naEsquerda(a).x, naEsquerda(a).y);
    expect(app._microLinkDraft.field).toBe('prev');
    const ev = tecla(svg(), 'Tab');
    expect(ev.defaultPrevented).toBe(true);
    expect(app._microLinkDraft.field).toBe('next');
    expect(destaque().dataset.field).toBe('next');
    expect(document.activeElement).not.toBe(app.codeEditor.textarea); // não pulou pro código
    tecla(svg(), 'Tab');
    expect(app._microLinkDraft.field).toBe('prev');
    tecla(svg(), 'Tab');
    clicarEm(meio(b).x, meio(b).y);
    expect(a.next).toBe(b.id);
    expect(a.prev).toBeNull();
  });

  test('clicar de novo no nó de origem recomeça pela metade clicada', () => {
    const [a, b] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(naEsquerda(a).x, naEsquerda(a).y);
    clicarEm(naDireita(a).x, naDireita(a).y);
    expect(app._microLinkDraft).toMatchObject({ fromId: a.id, field: 'next', pending: true });
    clicarEm(meio(b).x, meio(b).y);
    expect(a.next).toBe(b.id);
  });

  test('o hover destaca a metade do nó sob o mouse', () => {
    const [a, b] = doisStructs('list');
    pairar(naEsquerda(a).x, naEsquerda(a).y);
    expect(destaqueVisivel()).toBeFalsy(); // fora da ferramenta, nada
    tecla(document.body, 'l');
    pairar(naEsquerda(a).x, naEsquerda(a).y);
    expect(destaqueVisivel()).toBe(true);
    expect(destaque().dataset.field).toBe('prev');
    pairar(naDireita(b).x, naDireita(b).y);
    expect(destaque().dataset.field).toBe('next');
    expect(app._microLinkHover).toEqual({ id: b.id, field: 'next' });
    pairar(150, 300);
    expect(destaqueVisivel()).toBe(false);
    // com a ligação pendente, o destaque fica no campo de origem
    clicarEm(naEsquerda(a).x, naEsquerda(a).y);
    pairar(naDireita(b).x, naDireita(b).y);
    expect(destaqueVisivel()).toBe(true);
    expect(destaque().dataset.field).toBe('prev');
    expect(destaque().getAttribute('d')).toMatch(/^M 34 0 /); // célula prev de `a`
  });

  test('clicar em espaço vazio volta pra ferramenta Selecionar', () => {
    const [a] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(150, 300);
    expect(app.microMode).toBe('select');
    // com a ligação pendente também — e ela é descartada
    tecla(document.body, 'l');
    clicarEm(naDireita(a).x, naDireita(a).y);
    clicarEm(150, 300);
    expect(app.microMode).toBe('select');
    expect(app._microLinkDraft).toBeNull();
    expect(a.next).toBeNull();
  });

  test('clicar num elemento que não é nó não troca de ferramenta', () => {
    escreverCodigo('nums = [1, 2, 3]');
    ctrlEnterNaLinha(0);
    const arr = [...app.micro.arrays.values()].find((n) => n.name === 'nums');
    const c = arrayLayout(arr).cells[1];
    tecla(document.body, 'l');
    clicarEm(arr.x + c.x + c.w / 2, arr.y + c.y + c.h / 2);
    expect(app.microMode).toBe('link');
  });

  test('botão direito cancela a ligação pendente e mantém a ferramenta', () => {
    const [a, b] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(naDireita(a).x, naDireita(a).y);
    const ev = botaoDireito(150, 300);
    expect(ev.defaultPrevented).toBe(true);
    expect(app._microLinkDraft).toBeNull();
    expect(app.microMode).toBe('link');
    expect($('.preview-edge-line').getAttribute('display')).toBe('none');
    clicarEm(meio(b).x, meio(b).y); // agora é só o começo de outra ligação
    expect(a.next).toBeNull();
    expect(app._microLinkDraft).toMatchObject({ fromId: b.id, pending: true });
  });

  test('Esc cancela a ligação pendente', () => {
    const [a] = doisStructs('list');
    tecla(document.body, 'l');
    clicarEm(naDireita(a).x, naDireita(a).y);
    tecla(svg(), 'Escape');
    expect(app._microLinkDraft).toBeNull();
    expect(app.microMode).toBe('link');
  });

  test('Shift + arrasto numa célula de lista continua criando o cursor de leitura', () => {
    escreverCodigo('nums = [1, 2, 3]');
    ctrlEnterNaLinha(0);
    const arr = [...app.micro.arrays.values()].find((n) => n.name === 'nums');
    const c = arrayLayout(arr).cells[1];
    const x = arr.x + c.x + c.w / 2;
    const y = arr.y + c.y + c.h / 2;
    evento(svg(), 'pointerdown', x, y, { shiftKey: true });
    evento(window, 'pointermove', x + 30, y + 80, { shiftKey: true });
    evento(window, 'pointerup', x + 30, y + 80, { shiftKey: true });
    const cursor = [...app.micro.pointers.values()].find((p) => p.target?.kind === 'arrayCell');
    expect(cursor?.target).toMatchObject({ arrayId: arr.id, index: 1 });
  });
});

describe('popup de configurações pelo puxador (botão direito)', () => {
  const svg = () => $('.micro-canvas');
  const popup = () => $('.array-settings-popup');
  const nomeNoPopup = () => popup().querySelector('.array-settings-input').value;
  /** Botão direito no ponto (x, y) do MUNDO — sem layout no jsdom, o canvas
   * fica em (0, 0) da janela e a tela é o mundo escalado e deslocado. */
  function botaoDireito(x, y) {
    const { tx, ty, scale } = app.microViewport;
    const ev = new MouseEvent('contextmenu', { clientX: x * scale + tx, clientY: y * scale + ty, button: 2, bubbles: true, cancelable: true });
    svg().dispatchEvent(ev);
    return ev;
  }
  /** Centro (mundo) do puxador de uma coleção. */
  function centroDoPuxador(node, handleOf) {
    const h = handleOf(node);
    return { x: node.x + h.x + h.w / 2, y: node.y + h.y + h.h / 2 };
  }
  /** Cria nums (lista), s (set), d (dict) e m (matriz) pelo Sandbox. */
  function criarColecoes() {
    escreverCodigo(linhas('nums = [1, 2, 3]', 's = {4, 5}', 'd = {"a": 1}', 'm = [[1, 2], [3, 4]]'));
    [0, 1, 2, 3].forEach(ctrlEnterNaLinha);
    const porNome = (map, nome) => [...map.values()].find((n) => n.name === nome);
    return {
      nums: porNome(app.micro.arrays, 'nums'),
      s: porNome(app.micro.arrays, 's'),
      d: porNome(app.micro.dicts, 'd'),
      m: porNome(app.micro.matrices, 'm'),
    };
  }
  const rotuloDe = (node) =>
    [...app.micro.pointers.values()].find(
      (p) => p.labelArrayId === node.id || p.labelDictId === node.id || p.labelMatrixId === node.id,
    );

  test('abre o popup da lista, do set, do dict e da matriz pelo puxador', () => {
    const { nums, s, d, m } = criarColecoes();
    const casos = [
      [nums, arrayHandleRect, 'nums'],
      [s, arrayHandleRect, 's'],
      [d, dictHandleRect, 'd'],
      [m, matrixHandleRect, 'm'],
    ];
    for (const [node, handleOf, nome] of casos) {
      expect(node).toBeTruthy();
      const { x, y } = centroDoPuxador(node, handleOf);
      const ev = botaoDireito(x, y);
      expect(ev.defaultPrevented).toBe(true);
      expect(popup()).not.toBeNull();
      expect(nomeNoPopup()).toBe(nome);
      tecla(popup().querySelector('.array-settings-input'), 'Escape'); // fecha
      expect(popup()).toBeNull();
    }
  });

  test('abrir pelo puxador também seleciona a coleção', () => {
    const { d } = criarColecoes();
    const { x, y } = centroDoPuxador(d, dictHandleRect);
    botaoDireito(x, y);
    expect(app.microSelectedId).toBe(d.id);
    expect(app._microSelectionIds()).toEqual([d.id]);
  });

  test('o ponteiro-rótulo não abre mais o popup — só bloqueia o menu nativo', () => {
    const { nums, d, m } = criarColecoes();
    for (const node of [nums, d, m]) {
      const rotulo = rotuloDe(node);
      expect(rotulo).toBeTruthy();
      const ev = botaoDireito(rotulo.x + 5, rotulo.y + 5);
      expect(ev.defaultPrevented).toBe(true);
      expect(popup()).toBeNull();
    }
  });

  test('um ponteiro por cima do puxador tem prioridade: não abre o popup', () => {
    const { nums } = criarColecoes();
    const { x, y } = centroDoPuxador(nums, arrayHandleRect);
    const rotulo = rotuloDe(nums);
    Object.assign(rotulo, { x: x - 5, y: y - 5 });
    app._renderMicroOnly();
    botaoDireito(x, y);
    expect(popup()).toBeNull();
  });
});

describe('pan com a barra de espaço', () => {
  const svg = () => $('.micro-canvas');
  const container = () => $('.micro-container');
  function evento(alvo, tipo, x, y, opts = {}) {
    alvo.dispatchEvent(new MouseEvent(tipo, { clientX: x, clientY: y, button: 0, bubbles: true, ...opts }));
  }

  test('Espaço pressionado troca o cursor pela mão e o botão esquerdo move o canvas', () => {
    const no = app.micro.addStruct(0, 0, 1);
    app._renderMicroOnly();
    const { tx, ty } = app.microViewport;
    const pos = { x: no.x, y: no.y };

    tecla(window, ' ', { code: 'Space' });
    expect(container().classList.contains('space-pan')).toBe(true);

    // arrasta com o botão esquerdo começando EM CIMA do nó: move o canvas, não o nó
    evento(svg(), 'pointerdown', no.x + tx + 10, no.y + ty + 10);
    expect(container().classList.contains('panning')).toBe(true);
    evento(window, 'pointermove', no.x + tx + 60, no.y + ty + 40);
    evento(window, 'pointerup', no.x + tx + 60, no.y + ty + 40);
    expect(app.microViewport.tx).toBe(tx + 50);
    expect(app.microViewport.ty).toBe(ty + 30);
    expect({ x: no.x, y: no.y }).toEqual(pos);
    expect(container().classList.contains('panning')).toBe(false);

    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true }));
    expect(container().classList.contains('space-pan')).toBe(false);
  });

  test('o botão direito com Espaço não move mais o canvas', () => {
    const { tx, ty } = app.microViewport;
    tecla(window, ' ', { code: 'Space' });
    evento(svg(), 'pointerdown', 100, 100, { button: 2 });
    evento(window, 'pointermove', 200, 200, { button: 2 });
    evento(window, 'pointerup', 200, 200, { button: 2 });
    expect(app.microViewport).toMatchObject({ tx, ty });
  });
});

describe('popup de configurações da lista (botão direito no puxador)', () => {
  const svg = () => $('.micro-canvas');
  const popup = () => $('.array-settings-popup');
  const campo = (rotulo) =>
    [...popup().querySelectorAll('.array-settings-row')].find((r) => r.querySelector('label')?.textContent === rotulo)?.querySelector('input');

  /** Cria a coleção no Sandbox (Ctrl+Enter em cada linha) e devolve o array. */
  function criarNoSandbox(...codigo) {
    escreverCodigo(linhas(...codigo));
    codigo.forEach((_, i) => ctrlEnterNaLinha(i));
    return [...app.micro.arrays.values()].at(-1);
  }
  /** Botão direito no centro do puxador do array (mundo escalado e
   * deslocado por tx/ty, sem layout no jsdom). */
  function botaoDireitoNoPuxador(arr) {
    const h = arrayHandleRect(arr);
    const { tx, ty, scale } = app.microViewport;
    const x = arr.x + h.x + h.w / 2;
    const y = arr.y + h.y + h.h / 2;
    svg().dispatchEvent(new MouseEvent('contextmenu', { clientX: x * scale + tx, clientY: y * scale + ty, button: 2, bubbles: true, cancelable: true }));
  }
  const salvar = () => botao('.array-settings-popup .btn', 'Salvar').click();

  test('lista comum mostra o campo Tamanho e salvar redimensiona', () => {
    const nums = criarNoSandbox('nums = [1, 2]');
    botaoDireitoNoPuxador(nums);
    expect(popup()).toBeTruthy();
    expect(campo('Tamanho').value).toBe('2');
    campo('Tamanho').value = '4';
    salvar();
    expect(nums.cells).toEqual([1, 2, 0, 0]);
  });

  test('set não mostra o campo Tamanho e salvar não mexe nas células', () => {
    const s = criarNoSandbox('s = {3, 1, 2}');
    expect(s.isSet).toBe(true);
    const celulas = [...s.cells];
    const tabela = s.hashTable;
    botaoDireitoNoPuxador(s);
    expect(popup()).toBeTruthy();
    expect(campo('Tamanho')).toBeUndefined();
    campo('Nome').value = 'conj';
    salvar();
    expect(s.name).toBe('conj');
    expect(s.cells).toEqual(celulas);
    expect(s.hashTable).toBe(tabela);
  });

  test('deque com maxlen limita o tamanho ao maxlen', () => {
    const f = criarNoSandbox('from collections import deque', 'f = deque([1, 2], maxlen=3)');
    expect(f).toMatchObject({ isDeque: true, maxlen: 3 });
    botaoDireitoNoPuxador(f);
    expect(campo('Tamanho').max).toBe('3');
    campo('Tamanho').value = '10';
    salvar();
    expect(f.cells).toEqual([1, 2, 0]);
  });
});
