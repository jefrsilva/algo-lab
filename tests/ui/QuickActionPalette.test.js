// @vitest-environment jsdom
// Paleta de ações rápidas (Ctrl+Espaço): casamento abreviado dos comandos e
// o comportamento da caixa (lista compacta, fantasma cinza, Enter/Esc).
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { QuickActionPalette, matchCommands } from '../../src/ui/QuickActionPalette.js';

const cmd = (name, aliases = [], extra = {}) => ({ name, aliases, description: name, run: vi.fn(), ...extra });
const COMANDOS = [
  cmd('new pointer', ['new ptr']),
  cmd('new variable', ['new var']),
  cmd('new node'),
  cmd('new tree node'),
  cmd('new array', ['new list']),
  cmd('new area'),
];
const nomes = (q) => matchCommands(q, COMANDOS).map((m) => m.command.name);

describe('matchCommands', () => {
  test('campo vazio lista tudo na ordem original', () => {
    expect(nomes('')).toEqual(COMANDOS.map((c) => c.name));
  });

  test('palavra a palavra: "n p" → new pointer', () => {
    expect(nomes('n p')[0]).toBe('new pointer');
  });

  test('começo do nome', () => {
    expect(nomes('new po')).toEqual(['new pointer']);
  });

  test('pulando palavras: "n n" casa new node antes de new tree node', () => {
    expect(nomes('n n')).toEqual(['new node', 'new tree node']);
  });

  test('iniciais: "ntn" → new tree node', () => {
    expect(nomes('ntn')).toEqual(['new tree node']);
  });

  test('empate desempata pela ordem da lista: "n a" é new array antes de new area', () => {
    expect(nomes('n a')).toEqual(['new array', 'new area']);
  });

  test('apelido casa e é devolvido como o nome que casou', () => {
    const [m] = matchCommands('new li', COMANDOS);
    expect(m.command.name).toBe('new array');
    expect(m.name).toBe('new list');
  });

  test('ignora maiúsculas e espaços repetidos', () => {
    expect(nomes('  NEW   Var ')).toEqual(['new variable']);
  });

  test('nada casa', () => {
    expect(nomes('xyz')).toEqual([]);
  });
});

describe('QuickActionPalette', () => {
  let container;
  let palette;
  const digitar = (texto) => {
    palette.input.value = texto;
    palette.input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const itens = () => [...container.querySelectorAll('.quick-action-item-name')].map((e) => e.textContent);
  const tecla = (key) => palette.input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    palette = new QuickActionPalette(container);
    COMANDOS.forEach((c) => c.run.mockClear());
  });

  test('modo normal: nada com o campo vazio, no máximo 3 depois de digitar', () => {
    palette.open(COMANDOS);
    expect(palette.isOpen).toBe(true);
    expect(itens()).toEqual([]);
    digitar('n');
    expect(itens()).toHaveLength(3);
  });

  test('modo showAll (menu ☰) lista tudo', () => {
    palette.open(COMANDOS, { showAll: true });
    expect(itens()).toEqual(COMANDOS.map((c) => c.name));
  });

  test('fantasma cinza completa o nome ou mostra o comando à direita', () => {
    palette.open(COMANDOS);
    digitar('new po');
    expect(palette.ghostRest.textContent).toBe('inter');
    digitar('n p');
    expect(palette.ghostRest.textContent).toBe('  → new pointer');
  });

  test('Enter executa o comando em destaque e fecha', () => {
    palette.open(COMANDOS);
    digitar('n p');
    tecla('Enter');
    expect(COMANDOS[0].run).toHaveBeenCalledTimes(1);
    expect(palette.isOpen).toBe(false);
  });

  test('↓ troca o destaque antes do Enter', () => {
    palette.open(COMANDOS);
    digitar('n n');
    tecla('ArrowDown');
    tecla('Enter');
    expect(COMANDOS[3].run).toHaveBeenCalledTimes(1);
  });

  test('Esc fecha sem executar', () => {
    palette.open(COMANDOS);
    digitar('n p');
    tecla('Escape');
    expect(palette.isOpen).toBe(false);
    expect(COMANDOS[0].run).not.toHaveBeenCalled();
  });

  test('comando desabilitado aparece com o motivo e não executa', () => {
    const bloqueado = cmd('new sliding window', [], { disabled: 'selecione 2 cursores' });
    palette.open([bloqueado]);
    digitar('n s w');
    expect(container.querySelector('.quick-action-item.disabled .quick-action-item-desc').textContent).toBe('selecione 2 cursores');
    tecla('Enter');
    expect(bloqueado.run).not.toHaveBeenCalled();
  });
});
