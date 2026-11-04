// Pruebas del motor PERT/CPM (node:test, sin dependencias). Ejecutar: node --test tests/js
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  EPSILON, calculateProject, completionProbability, expectedTime, normalCdf, normalizeCode,
  parseDecimal, parsePredecessors, projectVariance, validateActivities, variance,
} from '../../app/static/pert-engine.js';

const initial = JSON.parse(readFileSync(fileURLToPath(new URL('../../data/initial.json', import.meta.url)), 'utf8'));

/** Convierte las filas de texto de la interfaz al formato numérico del motor. */
const prepare = rows => rows.map(row => ({ ...row, a: parseDecimal(row.a), m: parseDecimal(row.m), b: parseDecimal(row.b) }));
const claro = () => prepare(initial.pert.activities);
const act = (codigo, predecesoras, a, m = a, b = m) => ({ codigo, nombre: `Actividad ${codigo}`, predecesoras, a, m, b });
const get = (result, code) => result.activities.find(activity => activity.codigo === code);
const near = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-9, `${message ?? ''} esperado ${expected}, obtenido ${actual}`);

test('caso Claro: duración, ruta crítica y tabla completa', () => {
  const result = calculateProject(claro());
  assert.equal(result.ok, true);
  near(result.duration, 23);
  assert.deepEqual(result.mainPath, ['A', 'C', 'D', 'E', 'F', 'I', 'J']);
  assert.deepEqual(result.criticalPaths, [['A', 'C', 'D', 'E', 'F', 'I', 'J']]);
  assert.equal(result.extraPaths, 0);
  const expected = {
    A: [2, 0, 2, 0, 2, 0, true], B: [3, 2, 5, 6, 9, 4, false], C: [4, 2, 6, 2, 6, 0, true],
    D: [3, 6, 9, 6, 9, 0, true], E: [5, 9, 14, 9, 14, 0, true], F: [3, 14, 17, 14, 17, 0, true],
    G: [2, 14, 16, 15, 17, 1, false], H: [1, 14, 15, 16, 17, 2, false], I: [4, 17, 21, 17, 21, 0, true],
    J: [2, 21, 23, 21, 23, 0, true],
  };
  for (const [code, [te, es, ef, ls, lf, holgura, critica]] of Object.entries(expected)) {
    const activity = get(result, code);
    near(activity.te, te, `${code} TE`); near(activity.es, es, `${code} ES`); near(activity.ef, ef, `${code} EF`);
    near(activity.ls, ls, `${code} LS`); near(activity.lf, lf, `${code} LF`);
    near(activity.holgura, holgura, `${code} holgura`); near(activity.holguraFin, holgura, `${code} LF-EF`);
    assert.equal(activity.esCritica, critica, `${code} crítica`);
  }
  assert.deepEqual(result.criticalCodes, ['A', 'C', 'D', 'E', 'F', 'I', 'J']);
  assert.equal(result.criticalEdges.length, 6);
});

test('el ejemplo precargado de la aplicación tiene los datos académicos esperados', () => {
  assert.equal(initial.pert.unit, 'semanas');
  assert.deepEqual(initial.pert.activities.map(a => a.codigo), [...'ABCDEFGHIJ']);
  assert.deepEqual(parsePredecessors(initial.pert.activities[4].predecesoras), ['B', 'D']);
});

test('fórmulas PERT: tiempo esperado y varianza', () => {
  near(expectedTime(1, 2, 3), 2);
  near(expectedTime(1, 3, 5), 3);
  near(expectedTime(1, 2, 6), 2.5);
  near(variance(1, 5), (4 / 6) ** 2);
});

test('actividad con dos predecesoras toma el mayor EF', () => {
  const result = calculateProject([act('A', [], 3), act('B', [], 5), act('C', ['A', 'B'], 2)]);
  near(get(result, 'C').es, 5);
  near(result.duration, 7);
  near(get(result, 'A').holgura, 2);
  assert.equal(get(result, 'B').esCritica, true);
});

test('varias actividades iniciales comienzan en cero', () => {
  const result = calculateProject([act('A', [], 4), act('B', [], 2), act('C', ['A', 'B'], 1)]);
  assert.equal(get(result, 'A').es, 0);
  assert.equal(get(result, 'B').es, 0);
  assert.deepEqual(result.mainPath, ['A', 'C']);
});

test('varias actividades finales: la duración es el mayor EF y las finales cierran en D', () => {
  const result = calculateProject([act('A', [], 2), act('B', ['A'], 3), act('C', ['A'], 6), act('D', ['A'], 1)]);
  near(result.duration, 8);
  assert.equal(get(result, 'B').lf, 8);
  near(get(result, 'B').holgura, 3);
  near(get(result, 'D').holgura, 5);
  assert.deepEqual(result.mainPath, ['A', 'C']);
});

test('proyecto con una sola actividad', () => {
  const result = calculateProject([act('X', [], 1, 2, 3)]);
  near(result.duration, 2);
  assert.deepEqual(result.mainPath, ['X']);
  assert.equal(get(result, 'X').esCritica, true);
  assert.equal(result.extraPaths, 0);
});

test('predecesora inexistente bloquea el cálculo y apunta al campo', () => {
  const result = calculateProject([act('A', [], 1), act('B', ['Z'], 1)]);
  assert.equal(result.ok, false);
  assert.equal(result.activities, undefined);
  assert.deepEqual(result.errors.map(e => [e.row, e.field]), [[1, 'predecesoras']]);
  assert.match(result.errors[0].message, /Z no existe/);
});

test('una actividad no puede depender de sí misma', () => {
  const result = calculateProject([act('A', ['A'], 1)]);
  assert.equal(result.ok, false);
  assert.match(result.errors[0].message, /sí misma/);
});

test('dependencia cíclica se detecta y se describe', () => {
  const result = calculateProject([act('A', ['C'], 1), act('B', ['A'], 1), act('C', ['B'], 1), act('D', [], 1)]);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].row, null);
  assert.match(result.errors[0].message, /(A → B → C → A|B → C → A → B|C → A → B → C)/);
});

test('un ciclo aguas arriba de actividades válidas no produce resultados parciales', () => {
  const result = calculateProject([act('A', ['B'], 1), act('B', ['A'], 1), act('C', ['B'], 1)]);
  assert.equal(result.ok, false);
  assert.equal(result.activities, undefined);
});

test('códigos duplicados se marcan en todas sus filas; comparación sin mayúsculas ni espacios', () => {
  const result = calculateProject([act('A', [], 1), act(' a ', [], 1), act('B', [], 1)]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.filter(e => e.field === 'codigo').map(e => e.row), [0, 1]);
});

test('código vacío', () => {
  const result = calculateProject([act('', [], 1), act('   ', [], 1)]);
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map(e => [e.row, e.field]), [[0, 'codigo'], [1, 'codigo']]);
});

test('valores negativos o no numéricos identifican el campo', () => {
  const negative = validateActivities([act('A', [], -1, 2, 3)]);
  assert.deepEqual(negative.errors.map(e => [e.row, e.field]), [[0, 'a']]);
  const text = validateActivities([{ codigo: 'A', predecesoras: [], a: 1, m: parseDecimal('abc'), b: 3 }]);
  assert.deepEqual(text.errors.map(e => e.field), ['m']);
  const infinite = validateActivities([act('A', [], 1, 2, Infinity)]);
  assert.deepEqual(infinite.errors.map(e => e.field), ['b']);
});

test('incumplimiento de a ≤ m ≤ b señala el campo incorrecto', () => {
  assert.deepEqual(validateActivities([act('A', [], 5, 2, 9)]).errors.map(e => e.field), ['m']);
  assert.deepEqual(validateActivities([act('A', [], 1, 5, 3)]).errors.map(e => e.field), ['b']);
  assert.equal(validateActivities([act('A', [], 2, 2, 2)]).valid, true);
});

test('predecesoras repetidas se rechazan', () => {
  const result = validateActivities([act('A', [], 1), act('B', ['A', 'a'], 1)]);
  assert.equal(result.valid, false);
  assert.match(result.errors[0].message, /repetida/);
});

test('una lista vacía no es calculable', () => {
  assert.equal(calculateProject([]).ok, false);
  assert.equal(calculateProject(undefined).ok, false);
});

test('un solo error en cualquier fila bloquea todo el cálculo', () => {
  const rows = claro();
  rows[6].m = -3;
  const result = calculateProject(rows);
  assert.equal(result.ok, false);
  assert.equal(result.activities, undefined);
  assert.equal(result.duration, undefined);
});

test('tiempos decimales', () => {
  const result = calculateProject([act('A', [], 0.5, 1.5, 2.5), act('B', ['A'], 1.2, 2.4, 3.9)]);
  near(get(result, 'A').te, 1.5);
  near(get(result, 'B').te, (1.2 + 9.6 + 3.9) / 6);
  near(result.duration, 1.5 + (1.2 + 9.6 + 3.9) / 6);
});

test('holgura cercana a cero por punto flotante se trata como cero', () => {
  // 1,1 + 2,2 = 3,3000000000000003 ≠ 3,3: la rama A→B y la actividad D son igual de largas, pero la resta deja ~4e-16.
  const result = calculateProject([act('A', [], 1.1), act('B', ['A'], 2.2), act('D', [], 3.3), act('E', ['B', 'D'], 1)]);
  assert.ok(1.1 + 2.2 !== 3.3, 'precondición: la suma flotante no es exacta');
  const drift = Math.abs(get(result, 'B').ef - get(result, 'D').ef);
  assert.ok(drift > 0 && drift < EPSILON, `precondición: las ramas difieren solo por redondeo (${drift})`);
  for (const activity of result.activities) assert.ok(activity.holgura === 0 || activity.holgura > EPSILON, `${activity.codigo}: ${activity.holgura}`);
  assert.equal(get(result, 'D').holgura, 0);
  assert.equal(get(result, 'D').esCritica, true);
  assert.equal(Object.is(get(result, 'D').holgura, -0), false);
  assert.equal(result.criticalPaths.length, 2);

  const chain = calculateProject([act('A', [], 0.1), act('B', ['A'], 0.2), act('C', [], 0.3), act('D', ['B', 'C'], 0.1)]);
  assert.equal(get(chain, 'C').holgura, 0);
  assert.equal(get(chain, 'C').esCritica, true);
  assert.equal(chain.extraPaths, 1);
});

test('dos rutas críticas con la misma duración', () => {
  const result = calculateProject([act('A', [], 1), act('B', ['A'], 3), act('C', ['A'], 3), act('D', ['B', 'C'], 2)]);
  near(result.duration, 6);
  assert.deepEqual(result.criticalPaths, [['A', 'B', 'D'], ['A', 'C', 'D']]);
  assert.deepEqual(result.mainPath, ['A', 'B', 'D']);
  assert.equal(result.extraPaths, 1);
  assert.equal(result.criticalEdges.length, 4);
});

test('actividades críticas sin conexión temporal directa no forman arista crítica', () => {
  // A (crítica) y C (crítica) tienen precedencia pero C espera a B; A→C no es una conexión crítica.
  const result = calculateProject([act('A', [], 2), act('B', [], 5), act('C', ['A', 'B'], 1)]);
  assert.equal(get(result, 'A').esCritica, false);
  assert.deepEqual(result.criticalEdges, [['B', 'C']]);
  // Dos iniciales críticas con distinta cola: solo la que alimenta el máximo EF une la ruta.
  const tie = calculateProject([act('A', [], 3), act('B', [], 3), act('C', ['A', 'B'], 1)]);
  assert.deepEqual(tie.criticalPaths, [['A', 'C'], ['B', 'C']]);
});

test('el orden de las filas no altera el resultado', () => {
  const rows = claro();
  const base = calculateProject(rows);
  const shuffled = [rows[9], rows[4], rows[0], rows[7], rows[2], rows[8], rows[1], rows[5], rows[3], rows[6]];
  const other = calculateProject(shuffled);
  assert.equal(other.ok, true);
  near(other.duration, base.duration);
  for (const activity of base.activities) {
    const twin = get(other, activity.codigo);
    for (const field of ['te', 'es', 'ef', 'ls', 'lf', 'holgura']) near(twin[field], activity[field], `${activity.codigo}.${field}`);
    assert.equal(twin.esCritica, activity.esCritica);
  }
  assert.deepEqual(other.mainPath, base.mainPath);
  assert.deepEqual(other.activities.map(a => a.codigo), shuffled.map(a => a.codigo), 'se conserva el orden de entrada');
});

test('el cálculo no muta la entrada', () => {
  const rows = claro();
  const copy = structuredClone(rows);
  calculateProject(rows);
  assert.deepEqual(rows, copy);
});

test('normalización de códigos y predecesoras', () => {
  assert.equal(normalizeCode('  ab '), 'AB');
  assert.deepEqual(parsePredecessors(' b , d;F '), ['B', 'D', 'F']);
  assert.deepEqual(parsePredecessors('—'), []);
  assert.deepEqual(parsePredecessors(''), []);
  assert.deepEqual(parsePredecessors('a, A'), ['A', 'A']);
  const result = calculateProject([act(' a ', '', 1), act('b', ' a ', 2)]);
  assert.deepEqual(result.mainPath, ['A', 'B']);
});

test('lectura de decimales con punto o coma', () => {
  assert.equal(parseDecimal('2,5'), 2.5);
  assert.equal(parseDecimal(' 2.5 '), 2.5);
  assert.equal(parseDecimal('.5'), 0.5);
  assert.ok(Number.isNaN(parseDecimal('')));
  assert.ok(Number.isNaN(parseDecimal('1,2,3')));
  assert.ok(Number.isNaN(parseDecimal('1e3')));
  assert.ok(Number.isNaN(parseDecimal('abc')));
});

test('probabilidad PERT con aproximación normal', () => {
  const result = calculateProject(claro());
  const { variance: v, sigma, path } = projectVariance(result);
  near(v, 7 / 9);
  near(sigma, Math.sqrt(7 / 9));
  assert.deepEqual(path, result.mainPath);
  near(completionProbability(result, 23).probability, 0.5, 'plazo igual a la media');
  const z1 = completionProbability(result, 23 + sigma);
  assert.ok(Math.abs(z1.probability - 0.8413447) < 1e-6);
  near(z1.z, 1);
  assert.ok(completionProbability(result, 20).probability < 0.001);
  assert.ok(Math.abs(normalCdf(1.96) - 0.9750021) < 1e-6);
  assert.ok(Math.abs(normalCdf(-1.96) - 0.0249979) < 1e-6);
});

test('probabilidad con varianza cero es determinista', () => {
  const result = calculateProject([act('A', [], 2, 2, 2)]);
  assert.equal(completionProbability(result, 2).probability, 1);
  assert.equal(completionProbability(result, 1.5).probability, 0);
});

test('con varias rutas críticas se usa la de mayor varianza', () => {
  const result = calculateProject([act('A', [], 1), act('B', ['A'], 2, 3, 4), act('C', ['A'], 1, 3, 5), act('D', ['B', 'C'], 1)]);
  assert.equal(result.criticalPaths.length, 2);
  const { variance: v, path } = projectVariance(result);
  assert.deepEqual(path, ['A', 'C', 'D']);
  near(v, (4 / 6) ** 2);
});

test('regresión: tolerancia relativa con magnitudes grandes conserva la ruta crítica', () => {
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let trial = 0; trial < 200; trial++) {
    const rows = Array.from({ length: 8 }, (_, i) => {
      const a = rand() * 1e6, m = a + rand() * 1e6, b = m + rand() * 1e6;
      return act(`T${i}`, i ? [`T${i - 1}`] : [], a, m, b);
    });
    const result = calculateProject(rows);
    assert.equal(result.ok, true);
    assert.equal(result.criticalPaths.length, 1, `intento ${trial}`);
    assert.doesNotThrow(() => completionProbability(result, result.duration));
  }
});

test('regresión: más de 500 rutas críticas no sesga la varianza ni el truncamiento se oculta', () => {
  const rows = Array.from({ length: 500 }, (_, i) => act(`P${i}`, [], 5));
  rows.push(act('Z', [], 0, 5, 10));
  const result = calculateProject(rows);
  assert.equal(result.pathsTruncated, true);
  assert.equal(result.criticalPaths.length, 500);
  near(projectVariance(result).variance, (10 / 6) ** 2);
  assert.deepEqual(projectVariance(result).path, ['Z']);
  near(completionProbability(result, 5).probability, 0.5);
});

test('regresión: cadena larga no desborda la pila', () => {
  const rows = Array.from({ length: 12000 }, (_, i) => act(`N${i}`, i ? [`N${i - 1}`] : [], 1));
  const result = calculateProject(rows);
  assert.equal(result.ok, true);
  near(result.duration, 12000);
  assert.equal(result.mainPath.length, 12000);
});

test('regresión: códigos reservados como separador y valores enormes se bloquean', () => {
  for (const codigo of ['-', '—', 'A,B', ';']) {
    const result = calculateProject([act(codigo, [], 1)]);
    assert.equal(result.ok, false, codigo);
    assert.equal(result.errors[0].field, 'codigo');
  }
  const huge = validateActivities([act('A', [], 1e308)]);
  assert.deepEqual(huge.errors.map(e => e.field), ['a', 'm', 'b']);
  assert.match(huge.errors[0].message, /demasiado grande/);
});

test('regresión: códigos equivalentes en Unicode o con caracteres de ancho cero se tratan como duplicados', () => {
  assert.equal(normalizeCode('é'), normalizeCode('é'));
  assert.equal(normalizeCode('A​'), 'A');
  const result = validateActivities([act('é', [], 1), act('é', [], 1)]);
  assert.deepEqual(result.errors.filter(e => e.field === 'codigo').map(e => e.row), [0, 1]);
});

test('el error de ciclo informa las filas implicadas', () => {
  const result = validateActivities([act('A', ['C'], 1), act('B', ['A'], 1), act('C', ['B'], 1), act('D', [], 1)]);
  assert.deepEqual(result.errors[0].rows.sort(), [0, 1, 2]);
});
