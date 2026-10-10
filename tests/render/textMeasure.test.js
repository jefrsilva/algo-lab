// O texto corrido das labels usa o mesmo peso no CSS e na medição de largura —
// se divergirem, as caixas das labels ficam apertadas ou sobrando.
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { LABEL_BASE_WEIGHT, measureText } from '../../src/render/textMeasure.js';

describe('peso do texto das labels', () => {
  test('.label-text em canvas.css usa LABEL_BASE_WEIGHT', () => {
    const css = readFileSync(new URL('../../src/styles/canvas.css', import.meta.url), 'utf8');
    const bloco = css.match(/\.label-text \{[\s\S]*?\n\}/)[0];
    expect(bloco).toMatch(new RegExp(`font-weight:\s*${LABEL_BASE_WEIGHT}\b`));
  });

  test('negrito é mais largo que o texto normal na estimativa sem canvas', () => {
    expect(measureText('abc', { size: 10, bold: true })).toBeGreaterThan(measureText('abc', { size: 10 }));
  });
});
