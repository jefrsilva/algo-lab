#!/usr/bin/env node
// Roda um programa da DSL sem navegador (Node puro), pelo mesmo caminho da
// Simulação: parseProgram → MicroProgramRunner#run → MicroRuntimeAdapter →
// MicroModel. Imprime a saída do console (print + avisos ⚠) do último passo,
// o número de passos e, com --model, o estado final do modelo em JSON.
// Serve pra verificar mudanças na linguagem rápido; não substitui testar a
// interface (render, gestos, reprodução) no navegador.
//
// Linhas são mostradas a partir de 1, como no editor.
//
// Uso:
//   node scripts/run-dsl.mjs arquivo.py [--model] [--steps]
//   echo 'print(1 + 2)' | node scripts/run-dsl.mjs - [--model] [--steps]
import { readFileSync } from 'node:fs';
import { MicroModel } from '../src/core/micro/MicroModel.js';
import { MicroRuntimeAdapter } from '../src/app/MicroRuntimeAdapter.js';
import { MicroProgramRunner } from '../src/app/MicroProgramRunner.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('uso: node scripts/run-dsl.mjs <arquivo|-> [--model] [--steps]');
  process.exit(2);
}
const source = readFileSync(file === '-' ? 0 : file, 'utf8');

const micro = new MicroModel();
let slot = 0;
const env = new MicroRuntimeAdapter(micro, {
  // posições não importam aqui — só espalha pra não empilhar tudo em (0,0)
  createPosition: () => ({ x: 40 + (slot % 6) * 160, y: 40 + Math.floor(slot++ / 6) * 120 }),
});
const runner = new MicroProgramRunner(micro);
runner.run(source, env);

if (runner.error) {
  const { message, at } = runner.error;
  console.log(`ERRO DE SINTAXE${at != null ? ` (linha ${at + 1})` : ''}: ${message}`);
  process.exit(1);
}

const steps = runner.steps;
if (args.includes('--steps')) {
  steps.forEach((s, i) => console.log(`#${i} linha ${s.line != null ? s.line + 1 : '?'} ${s.kind ?? ''}`));
  console.log('---');
}
const last = steps[steps.length - 1];
for (const line of last?.output ?? []) console.log(line);
console.log(`--- ${steps.length} passo(s)`);
if (args.includes('--model') && last) {
  runner.goToStep(steps.length - 1);
  console.log(JSON.stringify(micro.toJSON(), null, 2));
}
