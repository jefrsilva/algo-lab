// Fontes embarcadas (sem depender do que está instalado no sistema do aluno):
// Atkinson Hyperlegible Next na interface (desenhada pra legibilidade) e
// JetBrains Mono no código e no canvas (distingue 0/O e 1/l/I).
import '@fontsource/atkinson-hyperlegible-next/400.css';
import '@fontsource/atkinson-hyperlegible-next/600.css';
import '@fontsource/atkinson-hyperlegible-next/700.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/600.css';
import '@fontsource/jetbrains-mono/700.css';

import { App } from './app/App.js';
import { getSavedTheme } from './app/theme.js';

// antes de montar a UI, pra não piscar o tema escuro ao abrir no claro
document.documentElement.dataset.theme = getSavedTheme();

const root = document.getElementById('app');
new App(root);
