# Algo-Lab

**[Try it online: algo-lab.app](https://algo-lab.app/)** · [Português](README.md)

A data structure and algorithm visualizer that runs entirely in the browser. You write a Python program and follow, step by step, what happens in memory: nodes, pointers, lists, dictionaries and variables drawn on a canvas.

> **Status: beta (version 1.0.0).** See the [limitations](#limitations) below.

## Purpose

Algo-Lab was built as a teaching aid for recording the Coding Interview courses at [Alura](https://www.alura.com.br/) ([part 1](https://www.alura.com.br/curso-online-coding-interviews-parte-1) and [part 2](https://www.alura.com.br/curso-online-coding-interviews-parte-2), in Portuguese). The goal is to make visible what usually stays in the programmer's head: where each pointer points, how a linked list changes with each assignment, how recursion stacks and unstacks calls.

It is developed and maintained by [Jeferson Silva](https://www.linkedin.com/in/jefrsilva/), with AI assistance, and is available as a contribution to the community, for anyone to use and modify, under the GPL v3 or later license.

## What you can do

- **Build the memory model by hand** on the canvas (nodes, pointers, arrays, dictionaries, variables) or **write it as code**: the two stay linked, and whatever the code creates shows up on the canvas under the same name.
- **Sandbox:** run one line at a time and watch the canvas change instantly.
- **Simulation:** run the whole program and move through it with play, step forward and step back, with the current line highlighted and a call panel that follows recursion.
- **Annotate the canvas** with text, areas, arrows, rulers and Big-O complexity charts.
- **Guided tutorials** (☰ → Tutorial) and a keyboard shortcut list (press `?`).

## Running it locally

Don't want to install anything? Use it at [algo-lab.app](https://algo-lab.app/). To run it locally you need [Node.js](https://nodejs.org/) (version in `.node-version`):

```bash
npm install
npm run dev     # http://localhost:5173
npm test        # test suite
npm run build   # outputs dist/
```

There is no backend: everything runs in the browser. The interface and the documentation under `docs/` are in Brazilian Portuguese.

## Limitations

Algo-Lab is a teaching aid, not a complete environment:

- **Python only**, and only a subset of it: no classes, nested functions or `global`, and each statement takes one logical line.
- **It does not replicate Python's behavior 100%.** Known differences are listed in `tests/dsl/bugs-conhecidos.test.js`.
- **It does not visualize every kind of algorithm or data structure**, only those that have a representation in the tool's memory model.
- **Beta:** there may be bugs and the interface may change.

Found a problem or have a suggestion? Open an [issue](../../issues).

## License

Distributed under the [GNU General Public License v3.0 or later](LICENSE). You may use, study, modify and redistribute the tool, provided that any modified versions you distribute are also released under the GPL with the source code available, so improvements flow back to the community.

The JetBrains Mono and Atkinson Hyperlegible Next fonts, bundled with the site, are distributed under the [SIL Open Font License 1.1](https://openfontlicense.org/).
