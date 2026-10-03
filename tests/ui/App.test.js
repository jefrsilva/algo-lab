// @vitest-environment jsdom
// Teste de integração da interface: monta o App inteiro no jsdom e usa os
// mesmos controles que a pessoa usa (editor, Sandbox/Simulação, ▶ Rodar,
// barra de reprodução, console, Ctrl+Espaço, atalhos, salvar/carregar).
// Não confere desenho/posição (o jsdom não faz layout) — pra isso há o
// smoke test com Playwright da skill verificar-mudanca.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { linhas } from '../helpers/runDsl.js';

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
