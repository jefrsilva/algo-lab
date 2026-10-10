// MicroModel: CRUD dos elementos, consistência de referências ao apagar e
// serialização (salvar/carregar projeto).
import { beforeEach, describe, expect, test } from 'vitest';
import { ARRAY_CELL_H, MAX_ARRAY_SIZE, MAX_DICT_SIZE, MicroModel } from '../../src/core/micro/MicroModel.js';
import { makeTuple } from '../../src/interpreter/pytuple.js';

let m;
beforeEach(() => {
  m = new MicroModel();
});

describe('structs e ponteiros', () => {
  test('addStruct normaliza o tipo', () => {
    expect(m.addStruct(0, 0, 1).type).toBe('list');
    expect(m.addStruct(0, 0, 1, 'tree').type).toBe('tree');
    expect(m.addStruct(0, 0, 1, 'graph').type).toBe('graph');
    expect(m.addStruct(0, 0, 1, 'slist').type).toBe('slist');
    expect(m.addStruct(0, 0, 1, 'outro').type).toBe('list');
    expect(m.addStruct(0, 0, 1, 'qualquer').type).toBe('list');
  });

  test('setField só aceita next/prev e alvo existente', () => {
    const a = m.addStruct(0, 0, 1);
    const b = m.addStruct(0, 0, 2);
    m.setField(a.id, 'next', b.id);
    m.setField(a.id, 'data', b.id);
    m.setField(a.id, 'prev', 'struct-inexistente');
    expect(a).toMatchObject({ next: b.id, prev: null, data: 1 });
  });

  test('setPointerTarget valida o alvo', () => {
    const p = m.addPointer(0, 0, 'p');
    const s = m.addStruct(0, 0, 1);
    const arr = m.addArray(0, 0, { size: 3 });
    m.setPointerTarget(p.id, { kind: 'struct', id: s.id });
    expect(p.target).toEqual({ kind: 'struct', id: s.id });
    m.setPointerTarget(p.id, { kind: 'arrayCell', arrayId: arr.id, index: 2 });
    expect(p.target).toEqual({ kind: 'arrayCell', arrayId: arr.id, index: 2 });
    m.setPointerTarget(p.id, { kind: 'arrayCell', arrayId: arr.id, index: 3 });
    expect(p.target).toBeNull();
    m.setPointerTarget(p.id, { kind: 'struct', id: 'nada' });
    expect(p.target).toBeNull();
    m.setPointerTarget(p.id, { kind: 'desconhecido' });
    expect(p.target).toBeNull();
  });

  test('apagar um struct solta tudo que apontava pra ele', () => {
    const a = m.addStruct(0, 0, 1);
    const b = m.addStruct(0, 0, 2);
    m.setField(a.id, 'next', b.id);
    const p = m.addPointer(0, 0, 'p');
    m.setPointerTarget(p.id, { kind: 'struct', id: b.id });
    const arr = m.addArray(0, 0, { kind: 'ref', size: 2 });
    m.setArrayCellRef(arr.id, 0, b.id);
    const d = m.addDict(0, 0);
    m.setDictCellRef(d.id, 'k', b.id);

    m.removeStruct(b.id);

    expect(m.structs.has(b.id)).toBe(false);
    expect(a.next).toBeNull();
    expect(p.target).toBeNull();
    expect(arr.cells).toEqual([null, null]);
    expect(d.cells[0]).toEqual({ key: 'k', kind: 'ref', value: null });
  });

  test('struct de grafo leva junto o array de vizinhos', () => {
    const g = m.addStruct(0, 0, 1, 'graph');
    const viz = m.addArray(0, 0, { kind: 'ref', size: 0 });
    m.setStructNeighborsArray(g.id, viz.id);
    m.removeStruct(g.id);
    expect(m.arrays.has(viz.id)).toBe(false);
  });
});

describe('vizinhos de nó de grafo (toggleStructNeighbor)', () => {
  /** Nó de grafo com a lista de vizinhos, como GraphNode(v) cria. */
  function noGrafo(data) {
    const s = m.addStruct(0, 0, data, 'graph');
    const arr = m.addArray(0, 100, { kind: 'ref', size: 0, name: `__graph_neighbors_${s.id}` });
    m.setStructNeighborsArray(s.id, arr.id);
    return s;
  }
  const vizinhos = (s) => m.arrays.get(s.neighborsArrayId).cells;

  test('liga A→B no fim da lista e, de novo, desliga — sem tocar em B→A', () => {
    const a = noGrafo(1);
    const b = noGrafo(2);
    const c = noGrafo(3);
    expect(m.toggleStructNeighbor(a.id, c.id)).toBe('added');
    expect(m.toggleStructNeighbor(a.id, b.id)).toBe('added');
    expect(vizinhos(a)).toEqual([c.id, b.id]);
    expect(vizinhos(b)).toEqual([]);
    expect(m.toggleStructNeighbor(b.id, a.id)).toBe('added');
    expect(m.toggleStructNeighbor(a.id, b.id)).toBe('removed');
    expect(vizinhos(a)).toEqual([c.id]);
    expect(vizinhos(b)).toEqual([a.id]);
  });

  test('desligar tira todas as ocorrências e desloca os cursores da lista', () => {
    const a = noGrafo(1);
    const b = noGrafo(2);
    const c = noGrafo(3);
    const arrId = a.neighborsArrayId;
    [b.id, c.id, b.id].forEach((id, i) => m.insertArrayCell(arrId, i, id));
    const p = m.addPointer(0, 0, 'p');
    m.setPointerTarget(p.id, { kind: 'arrayCell', arrayId: arrId, index: 1 });
    expect(m.toggleStructNeighbor(a.id, b.id)).toBe('removed');
    expect(vizinhos(a)).toEqual([c.id]);
    expect(p.target).toEqual({ kind: 'arrayCell', arrayId: arrId, index: 0 });
  });

  test('autolaço, origem que não é de grafo e alvo inexistente não fazem nada', () => {
    const a = noGrafo(1);
    const lista = m.addStruct(0, 0, 9);
    expect(m.toggleStructNeighbor(a.id, a.id)).toBeNull();
    expect(m.toggleStructNeighbor(lista.id, a.id)).toBeNull();
    expect(m.toggleStructNeighbor(a.id, 'struct-inexistente')).toBeNull();
    expect(vizinhos(a)).toEqual([]);
    expect(lista).toMatchObject({ next: null, prev: null, neighborsArrayId: null });
  });

  test('nó de grafo sem lista de vizinhos (projeto antigo) ganha uma no primeiro link', () => {
    const a = m.addStruct(0, 0, 1, 'graph');
    const b = noGrafo(2);
    const antes = m.arrays.size;
    expect(m.toggleStructNeighbor(a.id, b.id, { x: 40, y: 200 })).toBe('added');
    expect(m.arrays.size).toBe(antes + 1);
    expect(m.arrays.get(a.neighborsArrayId)).toMatchObject({
      kind: 'ref',
      x: 40,
      y: 200,
      name: `__graph_neighbors_${a.id}`,
      cells: [b.id],
    });
  });

  test('a lista de vizinhos respeita MAX_ARRAY_SIZE', () => {
    const a = noGrafo(0);
    const outros = Array.from({ length: MAX_ARRAY_SIZE + 1 }, (_, i) => noGrafo(i + 1));
    outros.slice(0, MAX_ARRAY_SIZE).forEach((o) => m.toggleStructNeighbor(a.id, o.id));
    expect(vizinhos(a)).toHaveLength(MAX_ARRAY_SIZE);
    expect(m.toggleStructNeighbor(a.id, outros[MAX_ARRAY_SIZE].id)).toBeNull();
    expect(vizinhos(a)).toHaveLength(MAX_ARRAY_SIZE);
    // desligar continua valendo com a lista cheia
    expect(m.toggleStructNeighbor(a.id, outros[0].id)).toBe('removed');
  });
});

describe('arrays', () => {
  test('tamanho é limitado a MAX_ARRAY_SIZE e 0 é válido', () => {
    expect(m.addArray(0, 0, { size: 100 }).cells).toHaveLength(MAX_ARRAY_SIZE);
    expect(m.addArray(0, 0, { size: 0 }).cells).toEqual([]);
    expect(m.addArray(0, 0, { kind: 'ref', size: 2 }).cells).toEqual([null, null]);
  });

  test('set/deque guardam as marcas', () => {
    expect(m.addArray(0, 0, { isSet: true })).toMatchObject({ isSet: true });
    expect(m.addArray(0, 0, { isDeque: true, maxlen: 3 })).toMatchObject({ isDeque: true, maxlen: 3 });
    expect(m.addArray(0, 0, {}).isSet).toBeUndefined();
  });

  test('resizeArray encolhe soltando cursores de células que sumiram', () => {
    const arr = m.addArray(0, 0, { size: 4 });
    const p = m.addPointer(0, 0, 'p');
    m.setPointerTarget(p.id, { kind: 'arrayCell', arrayId: arr.id, index: 3 });
    m.resizeArray(arr.id, 2);
    expect(arr.cells).toEqual([0, 0]);
    expect(p.target).toBeNull();
    m.growArray(arr.id);
    expect(arr.cells).toEqual([0, 0, 0]);
    m.shrinkArray(arr.id);
    expect(arr.cells).toHaveLength(2);
  });

  test('removeArrayCell/insertArrayCell deslocam os cursores', () => {
    const arr = m.addArray(0, 0, { size: 0 });
    [10, 20, 30].forEach((v, i) => m.insertArrayCell(arr.id, i, v));
    const [p0, p1, p2] = [0, 1, 2].map((i) => {
      const p = m.addPointer(0, 0, `p${i}`);
      m.setPointerTarget(p.id, { kind: 'arrayCell', arrayId: arr.id, index: i });
      return p;
    });
    m.removeArrayCell(arr.id, 1);
    expect(arr.cells).toEqual([10, 30]);
    expect(p0.target.index).toBe(0);
    expect(p1.target).toBeNull();
    expect(p2.target.index).toBe(1);

    expect(m.insertArrayCell(arr.id, 0, 5)).toBe(true);
    expect(arr.cells).toEqual([5, 10, 30]);
    expect(p0.target.index).toBe(1);
    expect(p2.target.index).toBe(2);
    expect(m.insertArrayCell(arr.id, 9, 1)).toBe(false);
  });

  test('lista de listas (kind:"arrayref") guarda ids de arrays, e apagar uma lista de dentro deixa None', () => {
    const outer = m.addArray(0, 0, { kind: 'arrayref', size: 2 });
    const a = m.addArray(0, 0, { size: 1 });
    const b = m.addArray(0, 0, { size: 2 });
    expect(outer.cells).toEqual([null, null]);
    m.setArrayCellArrayRef(outer.id, 0, a.id);
    m.setArrayCellArrayRef(outer.id, 1, 'array-que-nao-existe');
    expect(outer.cells).toEqual([a.id, null]);
    expect(m.insertArrayCell(outer.id, 1, b.id)).toBe(true);
    expect(m.insertArrayCell(outer.id, 0, 'array-que-nao-existe')).toBe(false);
    m.growArray(outer.id);
    expect(outer.cells).toEqual([a.id, b.id, null, null]);
    m.removeArray(a.id);
    expect(outer.cells).toEqual([null, b.id, null, null]);
    // célula de valor não vira referência a array (nem o contrário)
    m.setArrayCellArrayRef(b.id, 0, outer.id);
    expect(b.cells).toEqual([0, 0]);
  });

  test('insertArrayCell respeita o tamanho máximo', () => {
    const arr = m.addArray(0, 0, { size: MAX_ARRAY_SIZE });
    expect(m.insertArrayCell(arr.id, 0, 1)).toBe(false);
    expect(arr.cells).toHaveLength(MAX_ARRAY_SIZE);
  });

  test('setArrayCellValue só vale em array de valores', () => {
    const vals = m.addArray(0, 0, { size: 2 });
    const refs = m.addArray(0, 0, { kind: 'ref', size: 2 });
    m.setArrayCellValue(vals.id, 1, 7);
    m.setArrayCellValue(refs.id, 1, 7);
    expect(vals.cells).toEqual([0, 7]);
    expect(refs.cells).toEqual([null, null]);
  });

  test('ponteiro-rótulo: liga, renomeia junto e some com o array', () => {
    const arr = m.addArray(0, 0, { name: 'nums' });
    const rot = m.addPointer(0, 0, 'nums');
    m.linkArrayLabelPointer(arr.id, rot.id);
    expect(rot).toMatchObject({ isArrayLabel: true, labelArrayId: arr.id, target: { kind: 'array', id: arr.id } });
    m.renameArray(arr.id, 'xs');
    expect(rot.label).toBe('xs');
    m.removeArray(arr.id);
    expect(m.pointers.has(rot.id)).toBe(false);
  });

  test('apagar o rótulo desliga o array dele', () => {
    const arr = m.addArray(0, 0, { name: 'nums' });
    const rot = m.addPointer(0, 0, 'nums');
    m.linkArrayLabelPointer(arr.id, rot.id);
    m.removePointer(rot.id);
    expect(arr.labelPointerId).toBeNull();
  });

  test('alternar orientação', () => {
    const arr = m.addArray(0, 0, {});
    m.toggleArrayOrientation(arr.id);
    expect(arr.orientation).toBe('vertical');
    m.setArrayOrientation(arr.id, 'diagonal');
    expect(arr.orientation).toBe('vertical');
  });

  test('nós como círculos: vale pra lista/set/deque, não pra lista de listas, e vai pro projeto salvo', () => {
    const fila = m.addArray(0, 0, { kind: 'ref', size: 0 });
    m.setArrayNodeCircles(fila.id, true);
    expect(fila.nodeCircles).toBe(true);
    const listas = m.addArray(0, 0, { kind: 'arrayref', size: 0 });
    m.setArrayNodeCircles(listas.id, true);
    expect(listas.nodeCircles).toBeUndefined();
    const m2 = new MicroModel();
    m2.loadFrom(JSON.parse(JSON.stringify(m.toJSON())));
    expect(m2.arrays.get(fila.id).nodeCircles).toBe(true);
    m.setArrayNodeCircles(fila.id, false);
    expect(fila.nodeCircles).toBeUndefined();
  });

  test('orientação pilha: só lista/deque, não set', () => {
    const arr = m.addArray(0, 0, {});
    m.setArrayOrientation(arr.id, 'stack');
    expect(arr.orientation).toBe('stack');
    const s = m.addArray(0, 0, { isSet: true });
    m.setArrayOrientation(s.id, 'stack');
    expect(s.orientation).toBe('horizontal');
  });

  test('pilha cresce pra cima: a base fica parada', () => {
    const arr = m.addArray(0, 100, { orientation: 'stack', size: 2 });
    const base = () => arr.y + ARRAY_CELL_H * Math.max(1, arr.cells.length);
    expect(base()).toBe(100 + 2 * ARRAY_CELL_H);
    const passos = [
      () => m.growArray(arr.id),
      () => m.insertArrayCell(arr.id, 0, 7),
      () => m.removeArrayCell(arr.id, 1),
      () => m.shrinkArray(arr.id),
      () => m.resizeArray(arr.id, 6),
      () => m.setArrayContents(arr.id, 'value', []),
      () => m.setArrayContents(arr.id, 'value', [1, 2, 3]),
    ];
    passos.forEach((passo) => {
      passo();
      expect(base()).toBe(100 + 2 * ARRAY_CELL_H);
    });
    expect(arr.y).toBe(100 - ARRAY_CELL_H);
  });

  test('o rótulo acima da pilha sobe e desce com o topo; em outro lugar, fica', () => {
    const arr = m.addArray(0, 100, { orientation: 'stack', size: 1 });
    const rot = m.addPointer(0, 50, 'arr');
    m.linkArrayLabelPointer(arr.id, rot.id);
    m.growArray(arr.id);
    expect(rot.y).toBe(50 - ARRAY_CELL_H);
    m.shrinkArray(arr.id);
    expect(rot.y).toBe(50);
    rot.y = 200; // abaixo da base
    m.growArray(arr.id);
    expect(rot.y).toBe(200);
  });

  test('lista vertical/horizontal continua crescendo pra baixo/direita', () => {
    const v = m.addArray(0, 100, { orientation: 'vertical', size: 2 });
    m.growArray(v.id);
    m.removeArrayCell(v.id, 0);
    expect(v.y).toBe(100);
  });

  test('a pilha sobrevive a salvar e carregar', () => {
    const arr = m.addArray(0, 0, { orientation: 'stack' });
    const outro = new MicroModel();
    outro.loadFrom(m.toJSON());
    expect(outro.arrays.get(arr.id).orientation).toBe('stack');
    outro.loadFrom({ arrays: [{ id: 'a1', isSet: true, orientation: 'stack' }] });
    expect(outro.arrays.get('a1').orientation).toBe('horizontal');
  });
});

describe('dicts', () => {
  test('uma célula por chave; escrever de novo atualiza', () => {
    const d = m.addDict(0, 0, { name: 'd' });
    m.setDictCellValue(d.id, 'a', 1);
    m.setDictCellValue(d.id, 'b', 2);
    m.setDictCellValue(d.id, 'a', 3);
    expect(d.cells).toEqual([
      { key: 'a', kind: 'value', value: 3 },
      { key: 'b', kind: 'value', value: 2 },
    ]);
  });

  test('chave tupla funciona por identidade (tuplas internadas)', () => {
    const d = m.addDict(0, 0);
    m.setDictCellValue(d.id, makeTuple([0, 1]), 'x');
    m.setDictCellValue(d.id, makeTuple([0, 1]), 'y');
    expect(d.cells).toHaveLength(1);
    expect(d.cells[0].value).toBe('y');
  });

  test('limite de chaves', () => {
    const d = m.addDict(0, 0);
    for (let i = 0; i < MAX_DICT_SIZE + 5; i += 1) m.setDictCellValue(d.id, i, i);
    expect(d.cells).toHaveLength(MAX_DICT_SIZE);
  });

  test('apagar o array referenciado por uma célula zera a célula', () => {
    const d = m.addDict(0, 0);
    const arr = m.addArray(0, 0, {});
    m.setDictCellArrayRef(d.id, 'k', arr.id);
    m.removeArray(arr.id);
    expect(d.cells[0]).toEqual({ key: 'k', kind: 'arrayref', value: null });
  });

  test('removeDict solta cursores e rótulo', () => {
    const d = m.addDict(0, 0, { name: 'd' });
    m.setDictCellValue(d.id, 'a', 1);
    const rot = m.addPointer(0, 0, 'd');
    m.linkDictLabelPointer(d.id, rot.id);
    const p = m.addPointer(0, 0, 'p');
    m.setPointerTarget(p.id, { kind: 'dictCell', dictId: d.id, key: 'a' });
    expect(p.target).not.toBeNull();
    m.removeDict(d.id);
    expect(m.pointers.has(rot.id)).toBe(false);
    expect(p.target).toBeNull();
  });
});

describe('matrizes e variáveis', () => {
  test('resizeMatrix preserva o que cabe e solta cursores fora', () => {
    const mat = m.addMatrix(0, 0, {
      cells: [
        [1, 2],
        [3, 4],
      ],
    });
    const p = m.addPointer(0, 0, 'p');
    m.setPointerTarget(p.id, { kind: 'matrixCell', matrixId: mat.id, row: 1, col: 1 });
    m.resizeMatrix(mat.id, 1, 3);
    expect(mat.cells).toEqual([[1, 2, 0]]);
    expect(p.target).toBeNull();
    m.resizeMatrix(mat.id, 0, 0);
    expect(mat.cells).toEqual([[1]]);
  });

  test('setMatrixCellValue ignora fora dos limites', () => {
    const mat = m.addMatrix(0, 0, { cells: [[0]] });
    m.setMatrixCellValue(mat.id, 0, 0, 9);
    m.setMatrixCellValue(mat.id, 1, 0, 9);
    expect(mat.cells).toEqual([[9]]);
  });

  test('variáveis', () => {
    const v = m.addVariable(0, 0, 'x', 1);
    m.setVariableValue(v.id, 2);
    m.renameVariable(v.id, 'y');
    expect(v).toMatchObject({ name: 'y', value: 2, frameId: 'global' });
    m.removeVariable(v.id);
    expect(m.variables.size).toBe(0);
  });

  test('clear esvazia tudo', () => {
    m.addStruct(0, 0);
    m.addArray(0, 0, {});
    m.addVariable(0, 0);
    m.clear();
    expect([m.structs, m.pointers, m.arrays, m.dicts, m.variables, m.matrices].every((x) => x.size === 0)).toBe(true);
  });
});

describe('toJSON / loadFrom', () => {
  function montarModelo() {
    const a = m.addStruct(10, 20, 1);
    const b = m.addStruct(30, 40, 'b', 'tree');
    m.setField(a.id, 'next', b.id);
    const p = m.addPointer(5, 5, 'p');
    m.setPointerTarget(p.id, { kind: 'struct', id: a.id });
    const arr = m.addArray(0, 100, { name: 'nums', size: 2, orientation: 'vertical' });
    m.setArrayCellValue(arr.id, 0, makeTuple([1, 2]));
    const rot = m.addPointer(0, 80, 'nums');
    m.linkArrayLabelPointer(arr.id, rot.id);
    const d = m.addDict(200, 0, { name: 'd' });
    m.setDictCellValue(d.id, makeTuple([0, 0]), makeTuple(['a']));
    m.addVariable(1, 2, 'pos', makeTuple([3, 4]), 'frame-x');
    m.addMatrix(300, 0, { name: 'mat', cells: [[1, 2]] });
    return { a, b, p, arr, d };
  }

  test('ida e volta por JSON preserva ids, ligações e tuplas', () => {
    const { a, b, p, arr, d } = montarModelo();
    const json = JSON.parse(JSON.stringify(m.toJSON()));
    const outro = new MicroModel();
    outro.loadFrom(json);
    expect(outro.toJSON()).toEqual(m.toJSON());
    expect(outro.structs.get(a.id).next).toBe(b.id);
    expect(outro.pointers.get(p.id).target).toEqual({ kind: 'struct', id: a.id });
    expect(outro.arrays.get(arr.id).cells[0]).toBe(makeTuple([1, 2]));
    expect(outro.dicts.get(d.id).cells[0].key).toBe(makeTuple([0, 0]));
    expect([...outro.variables.values()][0]).toMatchObject({ value: makeTuple([3, 4]), frameId: 'frame-x' });
  });

  test('ida e volta de uma lista de listas preserva o tipo, as ligações e a grade', () => {
    const outer = m.addArray(0, 0, { kind: 'arrayref', size: 2, name: 'res', orientation: 'grid' });
    const dentro = m.addArray(0, 60, { size: 1, name: 'res[0]' });
    m.setArrayCellArrayRef(outer.id, 0, dentro.id);
    const outro = new MicroModel();
    outro.loadFrom(JSON.parse(JSON.stringify(m.toJSON())));
    expect(outro.arrays.get(outer.id)).toMatchObject({ kind: 'arrayref', cells: [dentro.id, null], orientation: 'grid' });
    // grade só vale pra lista de listas
    outro.loadFrom({ arrays: [{ id: 'a1', kind: 'value', orientation: 'grid', cells: [1] }] });
    expect(outro.arrays.get('a1').orientation).toBe('horizontal');
  });

  test('a orientação "grade" só pega numa lista de listas', () => {
    const lista = m.addArray(0, 0, { size: 2 });
    const listas = m.addArray(0, 0, { kind: 'arrayref', size: 2 });
    m.setArrayOrientation(lista.id, 'grid');
    m.setArrayOrientation(listas.id, 'grid');
    expect([lista.orientation, listas.orientation]).toEqual(['horizontal', 'grid']);
  });

  test('cursores de leitura não são salvos', () => {
    const arr = m.addArray(0, 0, { size: 2 });
    const c = m.addPointer(0, 0, 'nums[i]');
    m.setPointerTarget(c.id, { kind: 'arrayCell', arrayId: arr.id, index: 0 });
    c.readCursorKey = 'nums[i]';
    expect(m.toJSON().pointers).toEqual([]);
  });

  test('carregar substitui o conteúdo atual', () => {
    m.addStruct(0, 0, 'velho');
    m.loadFrom({ structs: [{ id: 's1', data: 'novo' }] });
    expect([...m.structs.keys()]).toEqual(['s1']);
  });

  test('arquivo incompleto ou editado à mão vira valores neutros', () => {
    m.loadFrom({
      structs: [{ id: 's1', type: 'estranho' }],
      pointers: [{ id: 'p1', label: 'p' }],
      arrays: [{ id: 'a1', kind: '???', orientation: 'torta', isDeque: true, maxlen: -3 }],
      matrices: [{ id: 'm1', cells: [[1, 2, 3], [4], 'lixo'] }],
      variables: [{ id: 'v1', name: 'x', value: 1 }],
    });
    expect(m.structs.get('s1')).toMatchObject({ x: 0, y: 0, type: 'list', next: null, prev: null });
    expect(m.pointers.get('p1')).toMatchObject({ target: null, frameId: 'global' });
    expect(m.arrays.get('a1')).toMatchObject({ kind: 'value', orientation: 'horizontal', cells: [], isDeque: true, maxlen: null });
    expect(m.matrices.get('m1').cells).toEqual([
      [1, 2, 3],
      [4, 0, 0],
    ]);
    expect(m.variables.get('v1').frameId).toBe('global');
  });

  test('loadFrom sem argumento deixa o modelo vazio', () => {
    m.addStruct(0, 0);
    m.loadFrom();
    expect(m.structs.size).toBe(0);
  });
});
