// Pruebas del diagrama de red AON (node:test, sin dependencias). Ejecutar: node --test "tests/js/*.test.mjs"
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { calculateProject, parseDecimal } from '../../app/static/pert-engine.js';
import { aonDiagram, aonLegend, aonSummary, edgeSegments, fmtNum, layoutAon } from '../../app/static/pert-diagram.js';

const initial = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/initial.json', import.meta.url)), 'utf8'));
const prepare = rows => rows.map(row => ({ ...row, a: parseDecimal(row.a), m: parseDecimal(row.m), b: parseDecimal(row.b) }));
const act = (codigo, predecesoras, te, nombre) => ({ codigo, nombre: nombre ?? `Actividad ${codigo}`, predecesoras, a: te, m: te, b: te });
const claro = () => calculateProject(prepare(initial.pert.activities));

/** Grafos de prueba con la forma de las filas del motor. */
const graphs = {
  claro: () => prepare(initial.pert.activities),
  una: () => [act('A', '', 3)],
  inicialesYFinales: () => [act('A', '', 2), act('B', '', 4), act('C', 'A', 3), act('D', 'B', 1), act('E', 'B', 5)],
  dosRutasCriticas: () => [act('A', '', 2), act('B', 'A', 4), act('C', 'A', 4), act('D', 'B, C', 3), act('E', 'A', 1)],
  ramasParalelas: () => [act('A', '', 3), act('B', '', 3), act('C', 'A', 4), act('D', 'B', 4), act('E', 'A, B', 2),
    act('F', 'C, D', 3), act('G', 'E', 6), act('H', 'F, G', 2), act('I', 'A', 1), act('J', '', 2, ''), act('K', 'J', 1)],
  saltos: () => [act('A', '', 1), act('B', 'A', 1), act('C', 'B', 1), act('D', 'C', 1), act('E', 'A', 1), act('F', 'A, D', 1), act('G', 'E', 1)],
};

/** DAG pseudoaleatorio determinista con n actividades. */
function randomGraph(n, seed = 7) {
  let state = seed;
  const rnd = () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648;
  const rows = [];
  for (let i = 0; i < n; i++) {
    const preds = [];
    for (let j = 0; j < i; j++) if (rnd() < 3 / Math.max(i, 3) && i - j < 9) preds.push(`T${j}`);
    rows.push(act(`T${i}`, preds.join(', '), 1 + Math.floor(rnd() * 6)));
  }
  return rows;
}
const allCases = () => [...Object.values(graphs).map(build => calculateProject(build())), calculateProject(randomGraph(30)), calculateProject(randomGraph(30, 99))];

const byId = layout => new Map(layout.nodes.map(node => [node.id, node]));
const intersectsInterior = (p, n, eps = 0.01) => p[0] > n.x + eps && p[0] < n.x + n.width - eps && p[1] > n.y + eps && p[1] < n.y + n.height - eps;
const edgeKey = ([from, to]) => `${from}>${to}`;

test('ejemplo de Claro: niveles por predecesoras', () => {
  const layout = layoutAon(claro());
  const nodes = byId(layout);
  const levels = Object.fromEntries(layout.nodes.map(n => [n.code, n.level]));
  assert.deepEqual(levels, { INICIO: 0, A: 1, B: 2, C: 2, D: 3, E: 4, F: 5, G: 5, H: 5, I: 6, J: 7, FIN: 8 });
  assert.equal(nodes.get('A').kind, 'activity');
  assert.equal([...nodes.values()].filter(n => n.kind === 'start').length, 1);
  assert.equal([...nodes.values()].filter(n => n.kind === 'end').length, 1);
  assert.equal(layout.nodes.length, 12);
});

test('los niveles no dependen del orden de las filas', () => {
  const rows = graphs.ramasParalelas();
  const levelsOf = list => Object.fromEntries(layoutAon(calculateProject(list)).nodes.map(n => [n.code, n.level]));
  assert.deepEqual(levelsOf([...rows].reverse()), levelsOf(rows));
  const claroRows = graphs.claro();
  assert.deepEqual(levelsOf([...claroRows].reverse()), levelsOf(claroRows));
});

test('ningún par de nodos reales se solapa y todo cabe en el lienzo', () => {
  for (const result of allCases()) {
    const { nodes, width, height } = layoutAon(result);
    for (const n of nodes) {
      assert.ok(n.x >= 0 && n.y >= 0 && n.x + n.width <= width && n.y + n.height <= height, `${n.id} fuera del lienzo`);
    }
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i], b = nodes[j];
        const disjoint = a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y;
        assert.ok(disjoint, `${a.id} y ${b.id} se solapan`);
      }
    }
  }
});

test('las flechas no atraviesan nodos ajenos y unen borde derecho con borde izquierdo', () => {
  for (const result of allCases()) {
    const layout = layoutAon(result);
    const nodes = byId(layout);
    for (const edge of layout.edges) {
      const from = nodes.get(edge.from), to = nodes.get(edge.to);
      assert.ok(from && to, `arista ${edge.from}>${edge.to} sin nodos`);
      assert.deepEqual(edge.points[0], [from.x + from.width, from.y + from.height / 2]);
      assert.deepEqual(edge.points.at(-1), [to.x, to.y + to.height / 2]);
      for (const [a, c1, c2, b] of edgeSegments(edge.points)) {
        for (let k = 0; k <= 40; k++) {
          const t = k / 40, u = 1 - t;
          const p = [0, 1].map(d => u ** 3 * a[d] + 3 * u * u * t * c1[d] + 3 * u * t * t * c2[d] + t ** 3 * b[d]);
          for (const node of layout.nodes) {
            if (node.id === edge.from || node.id === edge.to) continue;
            assert.ok(!intersectsInterior(p, node), `la arista ${edge.from}>${edge.to} atraviesa ${node.id}`);
          }
        }
      }
    }
  }
});

test('aristas: una por dependencia más cierres INICIO/FIN, sin duplicados', () => {
  for (const result of allCases()) {
    const layout = layoutAon(result);
    const expected = new Set();
    for (const a of result.activities) {
      if (!a.predecesoras.length) expected.add('__start__>' + a.codigo);
      if (!a.sucesoras.length) expected.add(a.codigo + '>__end__');
      a.predecesoras.forEach(p => expected.add(`${p}>${a.codigo}`));
    }
    const nodes = byId(layout);
    const kindName = id => nodes.get(id).kind === 'start' ? '__start__' : nodes.get(id).kind === 'end' ? '__end__' : id;
    const actual = layout.edges.map(e => `${kindName(e.from)}>${kindName(e.to)}`);
    assert.equal(new Set(actual).size, actual.length);
    assert.deepEqual(new Set(actual), expected);
  }
});

test('aristas rojas == criticalEdges más cierres de actividades críticas', () => {
  for (const result of allCases()) {
    const layout = layoutAon(result);
    const nodes = byId(layout);
    const redInternal = layout.edges.filter(e => e.critical && nodes.get(e.from).kind === 'activity' && nodes.get(e.to).kind === 'activity').map(e => `${e.from}>${e.to}`).sort();
    assert.deepEqual(redInternal, result.criticalEdges.map(edgeKey).sort());
    for (const e of layout.edges) {
      if (nodes.get(e.from).kind === 'start') assert.equal(e.critical, nodes.get(e.to).critical);
      if (nodes.get(e.to).kind === 'end') assert.equal(e.critical, nodes.get(e.from).critical);
    }
  }
  // Dos críticas sin conexión temporal directa no se unen en rojo: A (0-2) y C (3-7) son críticas pero B (2-3) las separa en el tiempo.
  const result = calculateProject([act('A', '', 2), act('B', 'A', 1), act('C', 'A, B', 4)]);
  const layout = layoutAon(result);
  const direct = layout.edges.find(e => e.from === 'A' && e.to === 'C');
  assert.equal(result.criticalEdges.some(([f, t]) => f === 'A' && t === 'C'), false);
  assert.equal(direct.critical, false);
});

test('en el SVG hay tantas flechas rojas como aristas críticas, dibujadas después de las demás', () => {
  const result = claro();
  const layout = layoutAon(result);
  const html = aonDiagram(result);
  const red = (html.match(/class="aon-edge-critical"/g) ?? []).length;
  assert.equal(red, layout.edges.filter(e => e.critical).length);
  assert.equal(red, result.criticalEdges.length + 2);          // + INICIO→A y J→FIN
  assert.ok(html.lastIndexOf('class="aon-edge"') < html.indexOf('class="aon-edge-critical"'));
});

test('dos rutas críticas: ambas ramas en rojo y resumen con la adicional', () => {
  const result = calculateProject(graphs.dosRutasCriticas());
  assert.equal(result.criticalPaths.length, 2);
  const layout = layoutAon(result);
  const red = layout.edges.filter(e => e.critical).map(e => `${e.from}>${e.to}`);
  for (const pair of ['A>B', 'A>C', 'B>D', 'C>D']) assert.ok(red.includes(pair), pair);
  assert.match(aonSummary(result), /Existe 1 ruta crítica adicional: A → C → D\./);
});

test('SVG: viewBox, título, descripción, marcadores y atributos de accesibilidad', () => {
  const result = claro();
  const layout = layoutAon(result);
  const html = aonDiagram(result);
  assert.ok(html.startsWith('<div class="aon-scroll"'));
  assert.ok(html.includes(`viewBox="0 0 ${layout.width} ${layout.height}"`));
  assert.ok(html.includes('role="img"') && html.includes('aria-labelledby="aon-title aon-desc"'));
  assert.ok(html.includes('<title id="aon-title">') && html.includes('<desc id="aon-desc">'));
  assert.ok(html.includes(`style="min-width:${layout.width}px;width:100%;height:auto"`));
  assert.equal((html.match(/<marker /g) ?? []).length, 2);
  assert.equal((html.match(/markerUnits="userSpaceOnUse"/g) ?? []).length, 2);
  assert.ok(html.includes('url(#aon-arrow)') && html.includes('url(#aon-arrow-critical)'));
  assert.ok(html.includes('Duración esperada: 23 semanas.'));
  // Criticidad no solo por color: etiqueta de texto y holgura.
  assert.ok(html.includes(' · Crítica') && html.includes(' · H=4'));
  // Marcadores bien formados: cada nodo de actividad tiene su <title> con el nombre completo.
  assert.ok(html.includes('Integración del motor Bayes'));
});

test('texto de usuario escapado en nombres y códigos', () => {
  const evil = '<img src=x onerror=alert(1)> & "q" \'s\'';
  const result = calculateProject([act('A', '', 2, evil), act('B<', 'A', 1, '<script>alert(2)</script>')]);
  const html = aonDiagram(result);
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('<script'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&quot;q&quot;'));
  // El resultado sigue siendo un único <svg> bien delimitado.
  assert.equal((html.match(/<svg/g) ?? []).length, 1);
  assert.equal((html.match(/<\/svg>/g) ?? []).length, 1);
});

test('nombre vacío y nombre largo no rompen el nodo', () => {
  const longName = 'Nombre extraordinariamente largo '.repeat(8);
  const result = calculateProject([act('A', '', 2, ''), act('B', 'A', 1, longName)]);
  const html = aonDiagram(result);
  assert.ok(html.includes('(sin nombre)'));
  assert.ok(html.includes('…'));
  assert.ok(html.includes(longName.trim()));                    // el nombre completo queda en el <title> del nodo
});

test('una sola actividad', () => {
  const result = calculateProject(graphs.una());
  const layout = layoutAon(result);
  assert.deepEqual(layout.nodes.map(n => n.code), ['INICIO', 'A', 'FIN']);
  assert.equal(layout.edges.length, 2);
  assert.ok(layout.edges.every(e => e.critical));
  assert.match(aonSummary(result), /^Duración esperada: 3 semanas\. Ruta crítica principal: A\.$/);
});

test('es determinista: mismo resultado, mismo SVG', () => {
  for (const build of [graphs.claro, graphs.ramasParalelas, () => randomGraph(30)]) {
    const first = aonDiagram(calculateProject(build()));
    const second = aonDiagram(calculateProject(build()));
    assert.equal(first, second);
    assert.deepEqual(layoutAon(calculateProject(build())), layoutAon(calculateProject(build())));
  }
});

test('reordenar las filas conserva niveles y aristas críticas', () => {
  const shapes = layout => ({
    levels: Object.fromEntries(layout.nodes.map(n => [n.code, n.level])),
    red: layout.edges.filter(e => e.critical).map(e => `${e.from}>${e.to}`).sort(),
  });
  for (const build of [graphs.claro, graphs.ramasParalelas, graphs.dosRutasCriticas, () => randomGraph(30)]) {
    const rows = build();
    const shuffled = rows.map((row, i) => [row, (i * 7 + 3) % rows.length]).sort((a, b) => a[1] - b[1]).map(([row]) => row);
    const reversed = [...rows].reverse();
    for (const variant of [shuffled, reversed]) {
      assert.deepEqual(shapes(layoutAon(calculateProject(variant))), shapes(layoutAon(calculateProject(rows))));
    }
  }
});

test('30 y 120 actividades se calculan con rapidez', () => {
  for (const n of [30, 120]) {
    const result = calculateProject(randomGraph(n, 3));
    const started = performance.now();
    const layout = layoutAon(result);
    assert.equal(layout.nodes.length, n + 2);
    assert.ok(performance.now() - started < 3000, `layout de ${n} actividades demasiado lento`);
  }
});

test('entrada inválida o sin cálculo devuelve diseño vacío y HTML vacío', () => {
  const bad = calculateProject([act('A', 'Z', 1)]);
  assert.equal(bad.ok, false);
  assert.deepEqual(layoutAon(bad), { nodes: [], edges: [], width: 0, height: 0 });
  assert.equal(aonDiagram(bad), '');
  assert.deepEqual(layoutAon(null), { nodes: [], edges: [], width: 0, height: 0 });
});

test('resumen: ruta principal, adicionales y truncamiento', () => {
  assert.equal(aonSummary(claro()), 'Duración esperada: 23 semanas. Ruta crítica principal: A → C → D → E → F → I → J.');
  assert.equal(aonSummary(claro(), 'días'), 'Duración esperada: 23 días. Ruta crítica principal: A → C → D → E → F → I → J.');
  const many = calculateProject([act('A', '', 1), act('B', 'A', 1), act('C', 'A', 1), act('D', 'A', 1), act('E', 'B, C, D', 1)]);
  assert.match(aonSummary(many), /Existen 2 rutas críticas adicionales: A → C → E; A → D → E\./);
  const truncated = aonSummary({ ...many, pathsTruncated: true });
  assert.match(truncated, /se muestran solo las primeras/);
  assert.ok(!/[<>]/.test(aonSummary(many)));
});

test('fmtNum: coma decimal, sin -0 ni ruido numérico', () => {
  assert.equal(fmtNum(23), '23');
  assert.equal(fmtNum(2.5), '2,5');
  assert.equal(fmtNum(2.3333333), '2,33');
  assert.equal(fmtNum(-0), '0');
  assert.equal(fmtNum(1e-12), '0');
  assert.equal(fmtNum(-1e-12), '0');
  assert.equal(fmtNum(Number.NaN), '—');
});

test('leyenda: lista accesible con los elementos explicados', () => {
  const html = aonLegend();
  assert.ok(html.startsWith('<ul class="aon-legend"'));
  assert.equal((html.match(/<li class="aon-legend-item"/g) ?? []).length, 5);
  for (const text of ['ES (Inicio temprano)', 'LF (Fin tardío)', 'Ruta crítica (Holgura = 0)', 'Ruta no crítica (Holgura &gt; 0)', 'Flecha', 'INICIO', 'FIN']) assert.ok(html.includes(text), text);
});
