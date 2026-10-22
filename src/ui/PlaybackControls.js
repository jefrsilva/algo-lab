/**
 * Ícones da barra de reprodução. Um triângulo só = andar UM passo (barra do
 * lado do triângulo = passo; pra trás ◀|, pra frente |▶ ... ▶|), dois
 * triângulos + barra = pular pro primeiro/último passo, e o play/pause é o
 * botão de destaque (preenchido na cor de destaque) — assim nenhum dos
 * botões de passo se confunde com o play, que é só o triângulo.
 */
const ICONS = {
  primeiro: '<rect x="1.5" y="3" width="1.8" height="10"/><path d="M8.5 3v10L4 8zM14.5 3v10L10 8z"/>',
  anterior: '<rect x="3" y="3" width="1.8" height="10"/><path d="M13 3v10L6 8z"/>',
  play: '<path d="M4 2.5v11l9.5-5.5z"/>',
  pause: '<rect x="3.5" y="2.5" width="3" height="11"/><rect x="9.5" y="2.5" width="3" height="11"/>',
  proximo: '<path d="M3 3v10l7-5z"/><rect x="11.2" y="3" width="1.8" height="10"/>',
  ultimo: '<path d="M1.5 3v10L6 8zM7.5 3v10L12 8z"/><rect x="12.7" y="3" width="1.8" height="10"/>',
};

/**
 * Barra de reprodução: passo a passo, play/pause automático e velocidade.
 */
export class PlaybackControls {
  constructor(container, actions) {
    this.container = container;
    this.actions = actions;
  }

  render({ stepIndex, totalSteps, playing, speed }) {
    this.container.innerHTML = '';
    if (totalSteps === 0) {
      const p = document.createElement('p');
      p.className = 'muted-text';
      p.textContent = 'Execute um algoritmo para habilitar a reprodução.';
      this.container.appendChild(p);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'playback-controls';

    // `acao` identifica o botão (data-acao) e `title` é o texto que o descreve
    const mkBtn = (acao, title, onClick, disabled = false) => {
      const btn = document.createElement('button');
      btn.innerHTML = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor">${ICONS[acao === 'play' && playing ? 'pause' : acao]}</svg>`;
      btn.className = 'btn playback-btn' + (acao === 'play' ? ' playback-btn-play' : '');
      btn.dataset.acao = acao;
      btn.disabled = disabled;
      btn.title = title;
      btn.setAttribute('aria-label', title);
      btn.addEventListener('click', onClick);
      return btn;
    };

    wrap.appendChild(mkBtn('primeiro', 'Ir ao primeiro passo', () => this.actions.goToStep(0), stepIndex <= 0));
    wrap.appendChild(mkBtn('anterior', 'Passo anterior (Ctrl+,)', () => this.actions.goToStep(stepIndex - 1), stepIndex <= 0));
    wrap.appendChild(
      mkBtn('play', playing ? 'Pausar' : 'Reproduzir automaticamente', () => this.actions.togglePlay(), stepIndex >= totalSteps - 1 && !playing)
    );
    wrap.appendChild(mkBtn('proximo', 'Próximo passo (Ctrl+.)', () => this.actions.goToStep(stepIndex + 1), stepIndex >= totalSteps - 1));
    wrap.appendChild(mkBtn('ultimo', 'Ir ao último passo', () => this.actions.goToStep(totalSteps - 1), stepIndex >= totalSteps - 1));

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = 0;
    slider.max = Math.max(0, totalSteps - 1);
    slider.value = Math.max(0, stepIndex);
    slider.className = 'step-slider';
    slider.addEventListener('input', () => this.actions.goToStep(Number(slider.value)));
    wrap.appendChild(slider);

    const counter = document.createElement('span');
    counter.className = 'step-counter';
    counter.textContent = `${Math.max(0, stepIndex) + 1} / ${totalSteps}`;
    wrap.appendChild(counter);

    const speedLabel = document.createElement('label');
    speedLabel.className = 'speed-label';
    speedLabel.textContent = 'Velocidade';
    const speedSlider = document.createElement('input');
    speedSlider.type = 'range';
    speedSlider.min = '0.5';
    speedSlider.max = '3';
    speedSlider.step = '0.25';
    speedSlider.value = String(speed);
    speedSlider.addEventListener('input', () => this.actions.setSpeed(Number(speedSlider.value)));
    speedLabel.appendChild(speedSlider);
    wrap.appendChild(speedLabel);

    this.container.appendChild(wrap);
  }
}
