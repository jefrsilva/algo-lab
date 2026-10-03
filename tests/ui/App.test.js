// @vitest-environment jsdom
// Teste de integração da interface: monta o App inteiro no jsdom e usa os
// mesmos controles que a pessoa usa (editor, Sandbox/Simulação, ▶ Rodar,
// barra de reprodução, console, Ctrl+Espaço, atalhos, salvar/carregar).
// Não confere desenho/posição (o jsdom não faz layout) — pra isso há o
// smoke test com Playwright da skill verificar-mudanca.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { linhas } from '../helpers/runDsl.js';
import { arrayHandleRect, chartLayout } from '../../src/render/MicroCanvasView.js';

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

describe('gráfico Big-O: leitura com Shift + mouse', () => {
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
  /** Mouse sobre (n, f) do gráfico, com ou sem Shift. */
  function mover(chart, n, v, opts = {}) {
    const { px, py } = chartLayout(chart);
    moverLocal(px(n), py(v), opts);
  }

  test('Shift + mouse sobre a plotagem mostra n, f(n) e o ponto na curva; sem Shift some', () => {
    const chart = criarGrafico();
    mover(chart, 5.2, 2, { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('5');
    expect($('.chart-readout-value').textContent).toBe('5');
    expect($('.chart-readout-dot').getAttribute('fill')).toBe('#3b82f6');
    // estado transitório de hover: nada disso vai pro gráfico guardado
    expect(Object.keys(chart)).not.toContain('readout');

    mover(chart, 5.2, 2);
    expect(leitura().getAttribute('display')).toBe('none');
  });

  test('apertar e soltar o Shift com o mouse parado mostra e esconde a leitura', () => {
    const chart = criarGrafico();
    mover(chart, 7, 7);
    expect(leitura().getAttribute('display')).toBe('none');
    tecla(window, 'Shift', { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('inline');
    expect($('.chart-readout-n').textContent).toBe('7');
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Shift', bubbles: true }));
    expect(leitura().getAttribute('display')).toBe('none');
  });

  test('não aparece com botão pressionado, fora da plotagem, e some ao sair do canvas', () => {
    const chart = criarGrafico();
    mover(chart, 6, 6, { shiftKey: true, buttons: 1 });
    expect(leitura().getAttribute('display')).toBe('none');
    const { plot } = chartLayout(chart);
    moverLocal(plot.x - 10, plot.y + 10, { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('none');
    mover(chart, 6, 6, { shiftKey: true });
    expect(leitura().getAttribute('display')).toBe('inline');
    svg().dispatchEvent(new MouseEvent('pointerleave'));
    expect(leitura().getAttribute('display')).toBe('none');
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

describe('popup de configurações da lista (botão direito no rótulo)', () => {
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
  /** Botão direito no meio do ponteiro-rótulo do array (mundo = tela
   * deslocada por tx/ty, sem layout no jsdom). */
  function botaoDireitoNoRotulo(arr) {
    const p = app.micro.pointers.get(arr.labelPointerId);
    const { tx, ty } = app.microViewport;
    svg().dispatchEvent(new MouseEvent('contextmenu', { clientX: p.x + 5 + tx, clientY: p.y + 5 + ty, button: 2, bubbles: true, cancelable: true }));
  }
  const salvar = () => botao('.array-settings-popup .btn', 'Salvar').click();

  test('lista comum mostra o campo Tamanho e salvar redimensiona', () => {
    const nums = criarNoSandbox('nums = [1, 2]');
    botaoDireitoNoRotulo(nums);
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
    botaoDireitoNoRotulo(s);
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
    botaoDireitoNoRotulo(f);
    expect(campo('Tamanho').max).toBe('3');
    campo('Tamanho').value = '10';
    salvar();
    expect(f.cells).toEqual([1, 2, 0]);
  });
});
