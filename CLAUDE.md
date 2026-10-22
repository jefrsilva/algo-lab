# CLAUDE.md

Guidance for Claude Code (claude.ai/code) in this repository.

## What this is

**Algo-Lab** (formerly "Visualizador de Estruturas de Dados & Algoritmos") — a browser-based, vanilla-JS (no framework) tool for visualizing pointer/memory-model programs written in a small Python-like DSL. No backend; everything runs client-side. Code comments and UI strings are in Portuguese (pt-BR); match that when editing existing files.

## Language (always pt-BR)

Everything written for this repository is in **Brazilian Portuguese**, even if the conversation is in English: commit messages (title and body), merge messages, PR titles/descriptions, GitHub comments and issues, code comments, UI strings, error/warning messages, test names, docs and project skills. Only identifiers, commands, paths and required trailers (`Co-Authored-By:`, the Claude Code attribution line) stay as they are. This file stays in English. Exception: `README.en.md` is the English version of `README.md` — keep both in sync.

## Commands

```bash
npm run dev       # Vite dev server, http://localhost:5173 (.claude/launch.json config: algo-visualizer)
npm run build     # production build to dist/
npm test          # Vitest suite in tests/ (run once); npm run test:watch
node scripts/run-dsl.mjs <arquivo.py|->   # run a DSL program headlessly (--steps lists steps, --model dumps the final MicroModel)
```

- Run `npm test` before committing and **add a test with every change** (where each kind goes: [tests/README.md](tests/README.md)). No linter or type checker. CI (`.github/workflows/testes.yml`) runs `npm test` + `npm run build` on `main` and PRs.
- DSL programs whose output must match real Python live in `tests/dsl/casos.js`; known DSL-vs-Python gaps are pinned in `tests/dsl/bugs-conhecidos.test.js` with `test.fails` — fixing one makes it fail, so flip it to `test`.
- jsdom does no layout: drawing/geometry changes still need a look in the browser (`npm run dev` or the Playwright smoke test).

## Deploy

Cloudflare Pages via Git integration (build `npm run build`, output `dist`, Node pinned by `.node-version`). Served from the domain root, so `vite.config.js` has no `base`; set it if it ever moves to a subpath.

## Architecture (essentials)

Full onboarding reference (pt-BR) — per-file responsibilities, end-to-end flows, recipes, pitfalls — is [docs/ARQUITETURA.md](docs/ARQUITETURA.md). **Read the relevant section before changing a feature and keep it in sync when architecture changes.** Details of individual features (sets, deques, grids, tuples, windows, charts, link tool, tree layout, etc.) live there, not here.

- `src/main.js` → `new App(root)` ([src/app/App.js](src/app/App.js)). `App` builds the whole DOM by hand (`document.createElement`) and owns all top-level state. It is intentionally monolithic and large: grep for the method you need instead of reading it all; Portuguese comments explain *why*.
- **Micro mode is the only mode** (memory model: structs, pointers, arrays, dicts, variables on an SVG canvas, hand-built and/or driven by DSL code; recursion shown as a call tree). Many identifiers keep the `micro` prefix from the removed "macro" mode.
- **DSL pipeline** (`src/interpreter/`): `lexer.js` (one line) → `parser.js` (`parseStatement`, one line → one AST node, shapes in `ast.js`) → `blockParser.js` (`parseProgram`, indentation → program, top-level `def`s into `functions`) → `interpreter.js` (`runProgram`, a **generator** yielding one step per meaningful action — powers step playback) → `evaluator.js` (`evaluate`/`assign` semantics). Python-flavored: no classes, no nested `def`, no `global`; one statement per logical line.
- `evaluator.js`/`interpreter.js` are **model-agnostic**: they use a duck-typed `Environment` (`resolveName`, `assignName`, `getAttr`, `setAttr`…), never `MicroModel` directly. The concrete one is [MicroRuntimeAdapter.js](src/app/MicroRuntimeAdapter.js) (owns `frameStack` for recursion and `touched` cells). A new builtin/operator/statement usually needs `evaluator.js`/`interpreter.js` **and** `MicroRuntimeAdapter`.
- **Running a program**: `CodeEditor` source → `parseProgram` → `runProgram` on `MicroRuntimeAdapter` → mutates `MicroModel` → [MicroProgramRunner.js](src/app/MicroProgramRunner.js) takes a full **snapshot after every step** (stepping back restores one) → [MicroCanvasView.js](src/render/MicroCanvasView.js) renders. Snapshots share immutable data (e.g. a set's `hashTable`): always replace, never mutate.
- **Rendering** (`src/render/`): hand-rolled SVG, a dumb renderer over already-positioned world coordinates; no interaction logic (that is in `App.js`). `MicroCanvasView.js` also holds the geometry/layout constants, port and hit-target functions.
- **UI widgets** (`src/ui/`): small single-purpose classes wired by `App.js` (no base class): `CodeEditor`, `CallTree`, `PlaybackControls`, popups, toolbars, `QuickActionPalette` (Ctrl+Space; commands in `App#_openQuickActions`), `SettingsDialog`, etc.
- **Core** (`src/core/`): `micro/MicroModel.js` (data model: `structs`, `pointers`, `arrays`, `dicts`, `matrices`, `variables` Maps; CRUD that keeps references consistent; structs/arrays/dicts are the shared heap, `frameId` only scopes names) and `id.js` (`nextId(prefix)`, the only id generator).
- **Settings**: all user preferences live in one localStorage object in [src/app/settings.js](src/app/settings.js), applied through `App#_applySetting` — add new preferences there, not as ad-hoc localStorage keys or menu toggles.
- **Canvas-only annotations** (labels, areas, charts, arrows/rulers) live in `App` state outside `MicroModel`/snapshots; model elements go through MicroModel, MicroProgramRunner, MicroRuntimeAdapter, evaluator, MicroCanvasView and App.

## Project skills

`.claude/skills/` (pt-BR) hold the recurring-task recipes from section 8 of `docs/ARQUITETURA.md`: `novo-builtin-dsl`, `nova-sintaxe-dsl`, `novo-elemento-modelo`, `novo-elemento-anotacao`, `nova-ferramenta`, `nova-quick-action`, `nova-configuracao`, `novo-popup`, `novo-campo-projeto`, `verificar-mudanca`, `sincronizar-docs`, `triar-issues`. Use them, and when a recipe changes, update the matching skill too.
