// Smoke test no navegador: abre o app (dev server já rodando), cola um
// programa no editor, roda na Simulação, avança até o último passo e tira um
// screenshot. Imprime erros do console do navegador e o texto do console do
// app. Uso (com `npm run dev` em outro terminal):
//
//   node .claude/skills/verificar-mudanca/smoke.mjs programa.py [saida.png] [--url http://localhost:5173]
//
// Precisa do pacote `playwright` acessível (global ou instalado à parte —
// NÃO adicione ao package.json do projeto). Se houver um Chromium em
// /opt/pw-browsers, ele é usado.
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const require = createRequire(import.meta.url);
function loadPlaywright() {
  try { return require('playwright'); } catch {}
  const globalRoot = execSync('npm root -g').toString().trim();
  return require(`${globalRoot}/playwright`);
}
const { chromium } = loadPlaywright();

const args = process.argv.slice(2);
const urlIdx = args.indexOf('--url');
const url = urlIdx >= 0 ? args.splice(urlIdx, 2)[1] : 'http://localhost:5173';
const [file, shot = 'smoke.png'] = args;
if (!file) {
  console.error('uso: node smoke.mjs <programa.py> [saida.png] [--url URL]');
  process.exit(2);
}
const source = readFileSync(file, 'utf8');

const exe = '/opt/pw-browsers/chromium'; // executável (ou link) do ambiente de nuvem, se existir
const browser = await chromium.launch(existsSync(exe) ? { executablePath: exe } : {});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  // 404 de recurso vira console.error genérico, sem URL — reportado abaixo
  if (m.type() === 'error' && !m.text().startsWith('Failed to load resource')) errors.push(`console.error: ${m.text()}`);
});
page.on('response', (r) => {
  if (r.status() >= 400 && !r.url().endsWith('/favicon.ico')) errors.push(`HTTP ${r.status()}: ${r.url()}`);
});

await page.goto(url);
await page.click('.code-editor-mode-btn:has-text("Simulação")');
await page.fill('.code-editor-textarea', source);
await page.click('.code-editor-run-btn');
await page.waitForTimeout(300);
// ⏭ = último passo (desabilitado se já estiver no fim ou se não houver passos)
const last = page.locator('.playback-btn:has-text("⏭")');
if (await last.count() && await last.isEnabled()) await last.click();
await page.waitForTimeout(200);
const counter = await page.locator('.step-counter').allTextContents();

const runError = await page.locator('.micro-run-error').allTextContents();
const consoleText = await page.locator('.micro-console .console-body').allInnerTexts();
await page.screenshot({ path: shot });
await browser.close();

if (counter.length) console.log('passo:', counter.join(' '));
if (runError.length) console.log('ERRO NA EXECUÇÃO:', runError.join('\n'));
console.log('--- console do app');
console.log(consoleText.join('\n').trim());
console.log('--- erros do navegador:', errors.length ? `\n${errors.join('\n')}` : 'nenhum');
console.log(`--- screenshot: ${shot}`);
