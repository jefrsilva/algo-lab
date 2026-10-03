import { defineConfig } from 'vitest/config';

// Testes automatizados (ver tests/README.md). Ambiente padrão: Node puro — o
// interpretador, o modelo e a reprodução não tocam no DOM. Arquivos que
// precisam de DOM declaram `// @vitest-environment jsdom` no topo.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
  },
});
