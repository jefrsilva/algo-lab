// @vitest-environment jsdom
// Os programas e o que os cenários guiados (src/ui/tutorials.js) mandam fazer
// precisam funcionar de verdade: aqui cada um é executado pela interface.
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { desmontarApp, montarApp, tecla } from '../helpers/dom.js';
import { TUTORIALS } from '../../src/ui/tutorials.js';

let app;
const $ = (sel) => document.querySelector(sel);
const botao = (sel, texto) => [...document.querySelectorAll(sel)].find((b) => b.textContent.trim() === texto);
const textarea = () => $('.code-editor-textarea');
const codigoDe = (id, indice) => TUTORIALS.find((t) => t.id === id).steps.flatMap((s) => s.body).filter((b) => b.code)[indice].code;

function escrever(codigo) {
  textarea().value = codigo;
  textarea().dispatchEvent(new Event('input', { bubbles: true }));
}

function ctrlEnterNaLinha(idx) {
  const ta = textarea();
  const inicio = ta.value.split('\n').slice(0, idx).reduce((n, l) => n + l.length + 1, 0);
  ta.focus();
  ta.setSelectionRange(inicio, inicio);
  tecla(ta, 'Enter', { ctrlKey: true });
}

beforeEach(async () => {
  app = await montarApp();
});

afterEach(() => {
  desmontarApp(app);
  vi.restoreAllMocks();
});

describe('cenários guiados', () => {
  test('cenário 1: a soma da lista dá 14 na Simulação', () => {
    botao('.code-editor-mode-btn', 'Simulação').click();
    escrever(codigoDe('somar-lista', 0));
    $('.code-editor-run-btn').click();
    $('.playback-btn[data-acao="ultimo"]').click();
    expect($('.micro-console .console-body').textContent).toContain('14');
    expect([...app.micro.variables.values()].find((v) => v.name === 'total').value).toBe(14);
    expect([...app.micro.arrays.values()].find((a) => a.name === 'nums').cells).toHaveLength(5);
  });

  test('cenário 2: lista de 2 nós feita no canvas ganha um 3º nó no início pelo Sandbox', () => {
    const n1 = app.micro.addStruct(0, 0, 10);
    const n2 = app.micro.addStruct(200, 0, 20);
    app.micro.setField(n1.id, 'next', n2.id);
    app.micro.setField(n2.id, 'prev', n1.id);
    const head = app.micro.addPointer(0, -100, 'head');
    app.micro.setPointerTarget(head.id, { kind: 'struct', id: n1.id });

    escrever(codigoDe('lista-ligada', 0));
    for (let i = 0; i < 3; i++) ctrlEnterNaLinha(i);

    const novo = [...app.micro.structs.values()].find((s) => s.data === 5);
    expect(novo).toBeDefined();
    expect(novo.next).toBe(n1.id);
    expect(app.micro.pointers.get(head.id).target).toEqual({ kind: 'struct', id: novo.id });
  });

  test('cenário 3: posição ajustada num passo vale dali em diante e entra no projeto salvo', () => {
    botao('.code-editor-mode-btn', 'Simulação').click();
    escrever(codigoDe('simulacao-posicoes', 0));
    $('.code-editor-run-btn').click();

    const posicaoDeB = () => {
      const b = [...app.micro.pointers.values()].find((p) => p.label === 'b');
      const s = app.micro.structs.get(b.target.id);
      return { x: s.x, y: s.y };
    };
    app.microRunner.goToStep(1); // b criado
    const original = posicaoDeB();
    const b = [...app.micro.pointers.values()].find((p) => p.label === 'b');
    app.microRunner.updatePosition(b.target.id, 500, 300); // "arrasta" b no passo 2

    app.microRunner.goToStep(0);
    app.microRunner.goToStep(1);
    expect(posicaoDeB()).toEqual({ x: 500, y: 300 });
    app.microRunner.goToStep(4);
    expect(posicaoDeB()).toEqual({ x: 500, y: 300 });
    expect(original).not.toEqual({ x: 500, y: 300 });

    // o que o "Salvar projeto" grava: um quadro-chave no passo 2 (índice 1)
    expect(app.microRunner.exportStepLayout()).toEqual([['struct#1', [{ step: 1, x: 500, y: 300 }]]]);
  });

  test('cenário 4: o painel de chamadas mostra a árvore, os retornos e o escopo de cada chamada', () => {
    botao('.code-editor-mode-btn', 'Simulação').click();
    escrever(codigoDe('recursao', 0));
    $('.code-editor-run-btn').click();
    $('.playback-btn[data-acao="ultimo"]').click();

    const nos = () => [...document.querySelectorAll('.call-tree-node')].map((n) => n.textContent);
    expect(nos()).toEqual(['global (topo)', 'fib(3) → 2', 'fib(2) → 1', 'fib(1) → 1', 'fib(0) → 0', 'fib(1) → 1']);
    expect($('.micro-console .console-body').textContent).toContain('2');

    // recuo = quem chamou quem: fib(2) e o 2º fib(1) são filhos de fib(3)
    const recuo = [...document.querySelectorAll('.call-tree-node')].map((n) => parseInt(n.style.paddingLeft, 10));
    expect(recuo[2]).toBe(recuo[5]);
    expect(recuo[3]).toBeGreaterThan(recuo[2]);

    // balão com o escopo de uma chamada que já retornou
    const fib2 = [...document.querySelectorAll('.call-tree-node')].find((n) => n.textContent.startsWith('fib(2)'));
    fib2.dispatchEvent(new MouseEvent('mouseenter'));
    expect($('.call-tree-tip').textContent).toContain('n = 2');
  });
});
