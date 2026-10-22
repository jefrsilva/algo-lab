// @vitest-environment jsdom
// Barra de reprodução: cada botão tem ícone SVG, nome acessível e ação própria.
import { describe, expect, test, vi } from 'vitest';
import { PlaybackControls } from '../../src/ui/PlaybackControls.js';

function montar(estado) {
  const host = document.createElement('div');
  const actions = { goToStep: vi.fn(), togglePlay: vi.fn(), setSpeed: vi.fn() };
  new PlaybackControls(host, actions).render({ speed: 1, playing: false, ...estado });
  const btn = (acao) => host.querySelector(`.playback-btn[data-acao="${acao}"]`);
  return { host, actions, btn };
}

describe('PlaybackControls', () => {
  test('cinco botões distintos, com ícone, título e só o play em destaque', () => {
    const { host, btn } = montar({ stepIndex: 2, totalSteps: 5 });
    const acoes = [...host.querySelectorAll('.playback-btn')].map((b) => b.dataset.acao);
    expect(acoes).toEqual(['primeiro', 'anterior', 'play', 'proximo', 'ultimo']);
    host.querySelectorAll('.playback-btn').forEach((b) => {
      expect(b.querySelector('svg')).not.toBeNull();
      expect(b.title).not.toBe('');
      expect(b.textContent).toBe('');
    });
    expect(host.querySelectorAll('.playback-btn-play')).toHaveLength(1);
    expect(btn('anterior').title).toContain('anterior');
    expect(btn('proximo').title).toContain('Próximo');
  });

  test('cada botão chama a sua ação', () => {
    const { actions, btn } = montar({ stepIndex: 2, totalSteps: 5 });
    btn('primeiro').click();
    btn('anterior').click();
    btn('proximo').click();
    btn('ultimo').click();
    btn('play').click();
    expect(actions.goToStep.mock.calls).toEqual([[0], [1], [3], [4]]);
    expect(actions.togglePlay).toHaveBeenCalledTimes(1);
  });

  test('durante o play o botão vira pausa, e nas pontas os de passo ficam desabilitados', () => {
    const { btn } = montar({ stepIndex: 0, totalSteps: 3, playing: true });
    expect(btn('play').title).toBe('Pausar');
    expect(btn('primeiro').disabled).toBe(true);
    expect(btn('anterior').disabled).toBe(true);
    expect(btn('proximo').disabled).toBe(false);
  });
});
