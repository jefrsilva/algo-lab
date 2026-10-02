/**
 * Label HTML flutuante que segue o cursor durante um arraste, indicando a
 * operação prestes a ser realizada (ex.: "Push", "Remover fim"). Posicionado
 * em coordenadas de tela, sobre o container do canvas.
 */
export class DragHintLabel {
  constructor(container) {
    this.container = container;
    this.el = document.createElement('div');
    this.el.className = 'drag-hint-label';
    this.el.style.display = 'none';
    this.container.appendChild(this.el);
  }

  show(screenX, screenY, text, valid = true) {
    this.el.textContent = text;
    this.el.classList.toggle('invalid', !valid);
    this.el.style.left = `${screenX + 16}px`;
    this.el.style.top = `${screenY + 20}px`;
    this.el.style.display = 'block';
  }

  hide() {
    this.el.style.display = 'none';
  }

  destroy() {
    this.el.remove();
  }
}
