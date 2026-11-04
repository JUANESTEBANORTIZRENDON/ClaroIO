// Motor PERT/CPM: funciones puras, sin DOM ni estado. Los valores se calculan con precisión completa;
// el redondeo ocurre solo al presentar los resultados.
export const EPSILON = 1e-9;
export const MAX_CRITICAL_PATHS = 500;

const clean = value => Math.abs(value) < EPSILON ? 0 : value;
const close = (x, y) => Math.abs(x - y) < EPSILON;

export const normalizeCode = value => String(value ?? '').trim().toUpperCase();

/** Convierte "b, D" o "B;d" en ['B','D']. Conserva repetidos para que la validación los informe. */
export function parsePredecessors(text) {
  if (Array.isArray(text)) return text.map(normalizeCode).filter(Boolean);
  return String(text ?? '').split(/[,;]/).map(normalizeCode).filter(code => code && !/^[-–—]+$/.test(code));
}

/** Acepta punto o coma decimal (igual que la matriz de decisiones). Devuelve NaN si el texto no es un número. */
export function parseDecimal(value) {
  if (typeof value === 'number') return value;
  const text = String(value ?? '').trim().replace(',', '.');
  return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(text) ? Number(text) : NaN;
}

export const expectedTime = (a, m, b) => (a + 4 * m + b) / 6;
export const variance = (a, b) => ((b - a) / 6) ** 2;

const FIELD_LABEL = { a: 'a (optimista)', m: 'm (más probable)', b: 'b (pesimista)' };

/**
 * Valida las actividades sin calcular nada. Devuelve {valid, errors}; cada error indica la fila (índice, o null
 * si afecta a toda la red), el campo y un mensaje comprensible.
 */
export function validateActivities(activities) {
  const errors = [];
  const add = (row, field, message) => errors.push({ row, field, message });
  if (!Array.isArray(activities) || activities.length === 0) {
    add(null, null, 'Agrega al menos una actividad para calcular el proyecto.');
    return { valid: false, errors };
  }
  const rows = activities.map(activity => ({
    codigo: normalizeCode(activity?.codigo),
    predecesoras: parsePredecessors(activity?.predecesoras ?? []),
    a: activity?.a, m: activity?.m, b: activity?.b,
  }));
  const counts = new Map();
  rows.forEach(row => row.codigo && counts.set(row.codigo, (counts.get(row.codigo) ?? 0) + 1));

  rows.forEach((row, index) => {
    if (!row.codigo) add(index, 'codigo', 'El código no puede estar vacío.');
    else if (counts.get(row.codigo) > 1) add(index, 'codigo', `El código ${row.codigo} está repetido; cada actividad necesita uno único.`);

    const numericOk = {};
    for (const field of ['a', 'm', 'b']) {
      const value = row[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) add(index, field, `${FIELD_LABEL[field]} debe ser un número finito.`);
      else if (value < 0) add(index, field, `${FIELD_LABEL[field]} no puede ser negativo.`);
      else numericOk[field] = true;
    }
    if (numericOk.a && numericOk.m && row.a > row.m) add(index, 'm', `Se requiere a ≤ m: el tiempo más probable (${row.m}) no puede ser menor que el optimista (${row.a}).`);
    if (numericOk.m && numericOk.b && row.m > row.b) add(index, 'b', `Se requiere m ≤ b: el tiempo pesimista (${row.b}) no puede ser menor que el más probable (${row.m}).`);

    const seen = new Set();
    for (const predecessor of row.predecesoras) {
      if (predecessor === row.codigo) add(index, 'predecesoras', `${row.codigo} no puede depender de sí misma.`);
      else if (!counts.has(predecessor)) add(index, 'predecesoras', `La predecesora ${predecessor} no existe en la lista de actividades.`);
      if (seen.has(predecessor)) add(index, 'predecesoras', `La predecesora ${predecessor} está repetida.`);
      seen.add(predecessor);
    }
  });

  if (!errors.length) {
    const { cycle } = topologicalOrder(rows);
    if (cycle) add(null, 'predecesoras', `Existe una dependencia cíclica: ${cycle.join(' → ')}. Una actividad no puede depender, directa o indirectamente, de sí misma.`);
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Algoritmo de Kahn. Recibe filas con {codigo, predecesoras} ya normalizadas y válidas en referencias.
 * Devuelve {order, successors, cycle}; `cycle` es null o una lista cerrada de códigos (A → B → A).
 */
export function topologicalOrder(rows) {
  const codes = rows.map(row => row.codigo);
  const index = new Map(codes.map((code, i) => [code, i]));
  const successors = new Map(codes.map(code => [code, []]));
  const indegree = new Map(codes.map(code => [code, 0]));
  for (const row of rows) {
    for (const predecessor of row.predecesoras) {
      if (!successors.has(predecessor)) continue;
      successors.get(predecessor).push(row.codigo);
      indegree.set(row.codigo, indegree.get(row.codigo) + 1);
    }
  }
  for (const list of successors.values()) list.sort((x, y) => index.get(x) - index.get(y));

  const queue = codes.filter(code => indegree.get(code) === 0);
  const order = [];
  for (let head = 0; head < queue.length; head++) {
    const code = queue[head];
    order.push(code);
    for (const next of successors.get(code)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (order.length === codes.length) return { order, successors, cycle: null };

  // Quedaron actividades sin procesar: todas tienen una predecesora sin procesar. Se retrocede hasta repetir un código.
  const pending = new Set(codes.filter(code => !order.includes(code)));
  const byCode = new Map(rows.map(row => [row.codigo, row]));
  const trail = [];
  let current = codes.find(code => pending.has(code));
  while (!trail.includes(current)) {
    trail.push(current);
    current = byCode.get(current).predecesoras.find(code => pending.has(code));
  }
  const loop = trail.slice(trail.indexOf(current)).reverse();
  return { order, successors, cycle: [...loop, loop[0]] };
}

/** Todas las rutas críticas continuas (DFS ordenado por fila). Devuelve {paths, truncated}. */
function enumerateCriticalPaths(byCode, criticalEdges, rowOrder) {
  const next = new Map();
  for (const [from, to] of criticalEdges) (next.get(from) ?? next.set(from, []).get(from)).push(to);
  for (const list of next.values()) list.sort((x, y) => rowOrder.get(x) - rowOrder.get(y));
  const starts = [...byCode.values()].filter(a => a.esCritica && a.predecesoras.length === 0).map(a => a.codigo);
  const paths = [];
  let truncated = false;
  const walk = trail => {
    if (paths.length >= MAX_CRITICAL_PATHS) { truncated = true; return; }
    const successors = next.get(trail.at(-1)) ?? [];
    if (!successors.length) { paths.push([...trail]); return; }
    for (const code of successors) walk([...trail, code]);
  };
  for (const start of starts) walk([start]);
  return { paths, truncated };
}

/**
 * Calcula el proyecto completo. Si hay errores devuelve {ok:false, errors} sin resultados parciales.
 * `activities` conserva el orden de entrada; el cálculo no depende de él.
 */
export function calculateProject(input) {
  const validation = validateActivities(input);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const activities = input.map((activity, index) => {
    const a = activity.a, m = activity.m, b = activity.b;
    return {
      codigo: normalizeCode(activity.codigo), nombre: String(activity.nombre ?? '').trim(),
      predecesoras: parsePredecessors(activity.predecesoras ?? []), a, m, b,
      te: expectedTime(a, m, b), varianza: variance(a, b), fila: index,
    };
  });
  const byCode = new Map(activities.map(activity => [activity.codigo, activity]));
  const rowOrder = new Map(activities.map(activity => [activity.codigo, activity.fila]));
  const { order, successors } = topologicalOrder(activities);

  for (const code of order) {                       // recorrido hacia adelante
    const activity = byCode.get(code);
    activity.es = activity.predecesoras.length ? Math.max(...activity.predecesoras.map(p => byCode.get(p).ef)) : 0;
    activity.ef = activity.es + activity.te;
  }
  const duration = Math.max(...activities.map(activity => activity.ef));

  for (const code of [...order].reverse()) {        // recorrido hacia atrás
    const activity = byCode.get(code);
    const following = successors.get(code);
    activity.sucesoras = [...following];
    activity.lf = following.length ? Math.min(...following.map(s => byCode.get(s).ls)) : duration;
    activity.ls = activity.lf - activity.te;
    activity.holgura = clean(activity.ls - activity.es);
    activity.holguraFin = clean(activity.lf - activity.ef);
    activity.esCritica = activity.holgura === 0;
  }

  const criticalEdges = [];
  for (const activity of activities) {
    if (!activity.esCritica) continue;
    for (const successor of activity.sucesoras) {
      const target = byCode.get(successor);
      if (target.esCritica && close(activity.ef, target.es)) criticalEdges.push([activity.codigo, successor]);
    }
  }
  const { paths, truncated } = enumerateCriticalPaths(byCode, criticalEdges, rowOrder);
  return {
    ok: true, duration, order, activities, criticalEdges,
    criticalCodes: activities.filter(activity => activity.esCritica).map(activity => activity.codigo),
    criticalPaths: paths, mainPath: paths[0] ?? [], extraPaths: Math.max(0, paths.length - 1), pathsTruncated: truncated,
  };
}

/** Función de distribución normal estándar (Abramowitz y Stegun 7.1.26, error < 1,5e-7). */
export function normalCdf(z) {
  const x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.3275911 * x);
  const poly = ((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592;
  const erf = 1 - poly * t * Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + erf) : 0.5 * (1 - erf);
}

/** Varianza de cada ruta crítica y la de mayor varianza (criterio prudente cuando existen varias). */
export function projectVariance(result) {
  const byCode = new Map(result.activities.map(activity => [activity.codigo, activity]));
  const perPath = result.criticalPaths.map(path => ({ path, variance: path.reduce((sum, code) => sum + byCode.get(code).varianza, 0) }));
  const governing = perPath.reduce((best, item) => item.variance > best.variance + EPSILON ? item : best, perPath[0]);
  return { perPath, variance: governing.variance, sigma: Math.sqrt(governing.variance), path: governing.path };
}

/** P(T ≤ plazo) con aproximación normal sobre la ruta crítica de mayor varianza. */
export function completionProbability(result, deadline) {
  const { variance: v, sigma, path } = projectVariance(result);
  if (sigma < EPSILON) return { probability: deadline >= result.duration - EPSILON ? 1 : 0, z: null, sigma, variance: v, path };
  const z = (deadline - result.duration) / sigma;
  return { probability: normalCdf(z), z, sigma, variance: v, path };
}
