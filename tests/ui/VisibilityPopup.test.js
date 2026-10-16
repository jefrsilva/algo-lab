// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest';
import { VisibilityPopup } from '../../src/ui/VisibilityPopup.js';

function abre(itens) {
  const estado = new Map(itens.map((i) => [i.key, i.hidden]));
  const onChange = vi.fn((keys, hidden) => keys.forEach((k) => estado.set(k, hidden)));
  const onReset = vi.fn(() => estado.forEach((_, k) => estado.set(k, false)));
  const popup = new VisibilityPopup(document.body);
  popup.open(100, 100, {
    getItems: () => itens.map((i) => ({ ...i, hidden: estado.get(i.key) })),
    onChange,
    onReset,
  });
  return { popup, estado, onChange, onReset };
}
const ITENS = [
  { key: 'head', kind: 'ponteiro', hidden: false },
  { key: 'tail', kind: 'ponteiro', hidden: false },
  { key: 'total', kind: 'variável', hidden: true },
];
const nomes = (popup) => [...popup.el.querySelectorAll('.visibility-name')].map((e) => e.textContent);
const digita = (popup, texto) => {
  popup.search.value = texto;
  popup.search.dispatchEvent(new Event('input'));
};
const clica = (el) => {
  el.checked = !el.checked;
  el.dispatchEvent(new Event('change'));
};

afterEach(() => document.body.replaceChildren());

describe('VisibilityPopup', () => {
  test('lista tudo e filtra enquanto digita', () => {
    const { popup } = abre(ITENS);
    expect(nomes(popup)).toEqual(['head', 'tail', 'total']);
    digita(popup, 'ta');
    expect(nomes(popup)).toEqual(['tail', 'total']);
    digita(popup, 'zzz');
    expect(popup.el.querySelector('.visibility-empty')).toBeTruthy();
  });

  test('toggle de uma linha muda só aquele identificador', () => {
    const { popup, onChange } = abre(ITENS);
    clica(popup.el.querySelectorAll('.visibility-row .visibility-toggle')[0]);
    expect(onChange).toHaveBeenCalledWith(['head'], true);
  });

  test('toggle geral age nos filtrados', () => {
    const { popup, onChange } = abre(ITENS);
    digita(popup, 'ta');
    clica(popup.master); // havia um visível e um oculto (indeterminado) -> marca = mostrar
    expect(onChange).toHaveBeenCalledWith(['tail', 'total'], false);
  });

  test('selecionar filtrados restringe o toggle geral à seleção', () => {
    const { popup, onChange } = abre(ITENS);
    digita(popup, 'ta');
    clica(popup.selectAll);
    expect(popup.selectAll.checked).toBe(true);
    popup.el.querySelectorAll('.visibility-row input')[0].click(); // desmarca "tail"
    clica(popup.master);
    expect(onChange).toHaveBeenCalledWith(['total'], false);
  });

  test('Resetar torna tudo visível', () => {
    const { popup, estado, onReset } = abre(ITENS);
    popup.el.querySelector('.visibility-bulk .btn').click();
    expect(onReset).toHaveBeenCalled();
    expect([...estado.values()].every((h) => h === false)).toBe(true);
    expect([...popup.el.querySelectorAll('.visibility-row .visibility-toggle')].every((t) => t.checked)).toBe(true);
  });
});
