import pkg from '../../package.json';

/** Nome e versão do app. A versão mora só no package.json (fonte única) —
 * pra lançar uma nova, é lá que se muda (e aparece em ☰ → Sobre o Algo-Lab). */
export const APP_NAME = 'Algo-Lab';
export const APP_VERSION = pkg.version;
