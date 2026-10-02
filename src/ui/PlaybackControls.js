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

    const mkBtn = (label, onClick, disabled = false, title = null) => {
      const btn = document.createElement('button');
      btn.textContent = label;
      btn.className = 'btn playback-btn';
      btn.disabled = disabled;
      if (title) btn.title = title;
      btn.addEventListener('click', onClick);
      return btn;
    };

    wrap.appendChild(mkBtn('⏮', () => this.actions.goToStep(0), stepIndex <= 0));
    wrap.appendChild(mkBtn('◀', () => this.actions.goToStep(stepIndex - 1), stepIndex <= 0, 'Passo anterior (Ctrl+,)'));
    wrap.appendChild(
      mkBtn(playing ? '⏸' : '▶', () => this.actions.togglePlay(), stepIndex >= totalSteps - 1 && !playing)
    );
    wrap.appendChild(mkBtn('▶|', () => this.actions.goToStep(stepIndex + 1), stepIndex >= totalSteps - 1, 'Próximo passo (Ctrl+.)'));
    wrap.appendChild(mkBtn('⏭', () => this.actions.goToStep(totalSteps - 1), stepIndex >= totalSteps - 1));

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
