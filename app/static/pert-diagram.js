// Diagrama de red AON (actividad en el nodo) para PERT/CPM, dibujado como SVG dinámico.
// `layoutAon` es una función pura (sin DOM) y determinista; `aonDiagram` solo serializa su resultado.
import { esc } from './visuals.js';
import { MAX_CRITICAL_PATHS } from './pert-engine.js';

const START_ID = '__aon_inicio__';
const END_ID = '__aon_fin__';
const NODE_W = 150, NODE_H = 86, BAND = 24;        // nodo de actividad: bandas ES|EF y LS|LF de 24 px
const TERM_W = 88, TERM_H = 44;                      // nodos INICIO / FIN
const DUMMY_H = 10;                                  // carril reservado para aristas que saltan columnas
const GAP_X = 72, GAP_Y = 24, GAP_DUMMY = 14, MARGIN = 20;
const ARROW_INSET = 4;                               // la línea termina antes del borde; la punta del marcador llega al borde
const SWEEPS = 24, RELAX_ITERATIONS = 12;

const numberFormat = new Intl.NumberFormat('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
/** Formatea números con coma decimal; normaliza -0 y valores casi nulos a 0. */
export function fmtNum(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '—';
  const x = Math.abs(value) < 1e-9 ? 0 : value;
  return numberFormat.format(x === 0 ? 0 : x);
}

// ---------- Texto: estimación de ancho para truncar sin recortar ----------
function textWidth(text, size, bold = false) {
  let units = 0;
  for (const ch of String(text)) {
    if (/[iljtfI.,;:'|!()[\] ]/.test(ch)) units += 0.32;
    else if (/[mwMW@%]/.test(ch)) units += 0.92;
    else if (/[A-Z0-9]/.test(ch)) units += 0.7;
    else units += 0.58;
  }
  return units * size * (bold ? 1.07 : 1);
}
function truncate(text, size, maxWidth, bold = false) {
  const chars = [...String(text)];
  if (textWidth(chars.join(''), size, bold) <= maxWidth) return chars.join('');
  while (chars.length && textWidth(`${chars.join('')}…`, size, bold) > maxWidth) chars.pop();
  return `${chars.join('').trimEnd()}…`;
}

// ---------- Layout ----------
/** Regresión isotónica (PAV) con pesos iguales: la secuencia más cercana a `values` que no decrece. */
function isotonic(values) {
  const blocks = [];
  for (const value of values) {
    blocks.push({ sum: value, n: 1 });
    while (blocks.length > 1) {
      const b = blocks[blocks.length - 1], a = blocks[blocks.length - 2];
      if (a.sum / a.n <= b.sum / b.n) break;
      a.sum += b.sum; a.n += b.n; blocks.pop();
    }
  }
  return blocks.flatMap(block => Array(block.n).fill(block.sum / block.n));
}

const emptyLayout = () => ({ nodes: [], edges: [], width: 0, height: 0 });

/**
 * Calcula posiciones. Devuelve {nodes, edges, width, height}. Solo los nodos reales (INICIO, actividades, FIN) aparecen
 * en `nodes`; los virtuales reservan carril y solo se reflejan en los puntos de `edges[].points`.
 */
export function layoutAon(result) {
  if (!result?.ok || !Array.isArray(result.activities) || !result.activities.length) return emptyLayout();
  const activities = result.activities;
  const byCode = new Map(activities.map((activity, index) => [activity.codigo, { activity, fila: activity.fila ?? index }]));
  const order = Array.isArray(result.order) && result.order.length === activities.length ? result.order : activities.map(a => a.codigo);

  // Niveles por orden topológico (nunca por el orden de filas).
  const level = new Map();
  for (const code of order) {
    const preds = byCode.get(code).activity.predecesoras ?? [];
    level.set(code, preds.length ? 1 + Math.max(...preds.map(p => level.get(p) ?? 0)) : 1);
  }
  const endLevel = Math.max(...level.values()) + 1;
  const criticalSet = new Set((result.criticalEdges ?? []).map(([from, to]) => `${from}\u0000${to}`));

  // Elementos de columna: reales y virtuales.
  const items = new Map();
  const addItem = item => { items.set(item.id, item); return item; };
  addItem({ id: START_ID, kind: 'start', level: 0, h: TERM_H, rank: -1, real: true });
  addItem({ id: END_ID, kind: 'end', level: endLevel, h: TERM_H, rank: 0, real: true });
  for (const code of order) {
    const { activity, fila } = byCode.get(code);
    addItem({ id: code, kind: 'activity', level: level.get(code), h: NODE_H, rank: fila, real: true, activity });
  }

  // Aristas lógicas (con cadena de virtuales si saltan niveles).
  const rawEdges = [];
  const pushEdge = (from, to, critical, rank) => {
    const chain = [from];
    for (let lv = items.get(from).level + 1; lv < items.get(to).level; lv++) {
      const id = `~${from}>${to}@${lv}`;
      addItem({ id, kind: 'dummy', level: lv, h: DUMMY_H, rank: rank + 0.5, real: false });
      chain.push(id);
    }
    chain.push(to);
    rawEdges.push({ from, to, critical, chain });
  };
  for (const code of order) {
    const { activity, fila } = byCode.get(code);
    const preds = activity.predecesoras ?? [];
    if (!preds.length) pushEdge(START_ID, code, !!activity.esCritica, fila);
    for (const pred of preds) pushEdge(pred, code, criticalSet.has(`${pred}\u0000${code}`), byCode.get(pred).fila);
    if (!(activity.sucesoras ?? []).length) pushEdge(code, END_ID, !!activity.esCritica, fila);
  }

  // Columnas, adyacencia y segmentos entre columnas consecutivas.
  const columns = Array.from({ length: endLevel + 1 }, () => []);
  const itemList = [...items.values()];
  itemList.sort((a, b) => a.rank - b.rank);                       // estable: desempata por orden de inserción
  for (const item of itemList) columns[item.level].push(item.id);
  const up = new Map(itemList.map(item => [item.id, []]));
  const down = new Map(itemList.map(item => [item.id, []]));
  const segments = Array.from({ length: endLevel }, () => []);
  for (const edge of rawEdges) {
    for (let i = 0; i + 1 < edge.chain.length; i++) {
      const u = edge.chain[i], v = edge.chain[i + 1];
      down.get(u).push(v); up.get(v).push(u);
      segments[items.get(u).level].push([u, v]);
    }
  }

  // Reducción de cruces: baricentro con pasadas ida/vuelta, conservando el mejor orden.
  const pos = new Map();
  const reindex = column => column.forEach((id, i) => pos.set(id, i));
  columns.forEach(reindex);
  const crossings = () => {
    let total = 0;
    for (const segs of segments) {
      for (let i = 0; i < segs.length; i++) {
        for (let j = i + 1; j < segs.length; j++) {
          if ((pos.get(segs[i][0]) - pos.get(segs[j][0])) * (pos.get(segs[i][1]) - pos.get(segs[j][1])) < 0) total++;
        }
      }
    }
    return total;
  };
  let best = columns.map(column => [...column]);
  let bestCrossings = crossings();
  for (let pass = 0; pass < SWEEPS && bestCrossings > 0; pass++) {
    const forward = pass % 2 === 0;
    const neighbours = forward ? up : down;
    const levels = forward ? columns.keys() : [...columns.keys()].reverse();
    for (const lv of levels) {
      if (forward ? lv === 0 : lv === endLevel) continue;
      const keyed = columns[lv].map((id, i) => {
        const near = neighbours.get(id);
        return { id, i, b: near.length ? near.reduce((sum, n) => sum + pos.get(n), 0) / near.length : i };
      });
      keyed.sort((x, y) => x.b - y.b || x.i - y.i);
      columns[lv] = keyed.map(k => k.id);
      reindex(columns[lv]);
    }
    const count = crossings();
    if (count < bestCrossings) { bestCrossings = count; best = columns.map(column => [...column]); }
  }
  best.forEach((column, lv) => { columns[lv] = column; reindex(column); });

  // Ancho de cada columna (suficiente para los números más largos).
  const colWidth = columns.map((column, lv) => {
    if (lv === 0 || lv === endLevel) return TERM_W;
    let half = 0;
    for (const id of column) {
      const a = items.get(id).activity;
      if (!a) continue;
      for (const value of [a.es, a.ef, a.ls, a.lf]) half = Math.max(half, textWidth(fmtNum(value), 12.5, true) + 18);
    }
    return Math.max(NODE_W, Math.ceil(half) * 2);
  });
  const colX = [];
  colWidth.reduce((x, w, lv) => { colX[lv] = x; return x + w + GAP_X; }, MARGIN);

  // Coordenadas verticales: apilado centrado y relajación hacia el centro de los vecinos respetando separaciones (PAV).
  const centre = new Map();
  const spacing = column => column.slice(1).map((id, i) => {
    const prev = items.get(column[i]), cur = items.get(id);
    return prev.h / 2 + cur.h / 2 + (prev.real && cur.real ? GAP_Y : GAP_DUMMY);
  });
  for (const column of columns) {
    const gaps = spacing(column);
    const offsets = [0];
    gaps.forEach(g => offsets.push(offsets[offsets.length - 1] + g));
    const mid = offsets[offsets.length - 1] / 2;
    column.forEach((id, i) => centre.set(id, offsets[i] - mid));
  }
  for (let iteration = 0; iteration < RELAX_ITERATIONS; iteration++) {
    const levels = iteration % 2 === 0 ? [...columns.keys()] : [...columns.keys()].reverse();
    for (const lv of levels) {
      const column = columns[lv];
      if (column.length < 1) continue;
      const gaps = spacing(column);
      const offsets = [0];
      gaps.forEach(g => offsets.push(offsets[offsets.length - 1] + g));
      const wanted = column.map((id, i) => {
        const near = [...up.get(id), ...down.get(id)];
        const d = near.length ? near.reduce((sum, n) => sum + centre.get(n), 0) / near.length : centre.get(id);
        return d - offsets[i];
      });
      isotonic(wanted).forEach((z, i) => centre.set(column[i], z + offsets[i]));
    }
  }
  let top = Infinity, bottom = -Infinity;
  for (const [id, c] of centre) {
    centre.set(id, Math.round(c));
    top = Math.min(top, Math.round(c) - items.get(id).h / 2);
    bottom = Math.max(bottom, Math.round(c) + items.get(id).h / 2);
  }
  const shift = MARGIN - top;
  for (const [id, c] of centre) centre.set(id, c + shift);
  const height = bottom - top + 2 * MARGIN;
  const width = colX[endLevel] + colWidth[endLevel] + MARGIN;

  // Nodos reales.
  const nodes = [];
  for (const item of items.values()) {
    if (!item.real) continue;
    const w = colWidth[item.level];
    nodes.push({
      id: item.id, kind: item.kind,
      code: item.kind === 'start' ? 'INICIO' : item.kind === 'end' ? 'FIN' : item.id,
      x: colX[item.level], y: centre.get(item.id) - item.h / 2, width: w, height: item.h,
      level: item.level, critical: item.kind === 'activity' && !!item.activity.esCritica, activity: item.activity ?? null,
    });
  }
  nodes.sort((a, b) => a.level - b.level || a.y - b.y || (a.id < b.id ? -1 : 1));

  // Aristas con sus puntos guía.
  const edges = rawEdges.map(edge => {
    const first = items.get(edge.from), last = items.get(edge.to);
    const points = [[colX[first.level] + colWidth[first.level], centre.get(edge.from)]];
    for (const id of edge.chain.slice(1, -1)) {
      const lv = items.get(id).level, y = centre.get(id);
      points.push([colX[lv], y], [colX[lv] + colWidth[lv], y]);
    }
    points.push([colX[last.level], centre.get(edge.to)]);
    return { from: edge.from, to: edge.to, critical: edge.critical, points };
  });
  return { nodes, edges, width, height };
}

/**
 * Tramos cúbicos [p0, c1, c2, p1] con tangente horizontal en cada punto guía. `trimEnd` acorta el último punto
 * para que la punta del marcador (no el trazo) toque el borde del nodo destino.
 */
export function edgeSegments(points, trimEnd = 0) {
  const pts = points.map(p => [...p]);
  if (trimEnd) pts[pts.length - 1][0] -= trimEnd;
  const segments = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1], mx = (ax + bx) / 2;
    segments.push([[ax, ay], [mx, ay], [mx, by], [bx, by]]);
  }
  return segments;
}

const r1 = value => Math.round(value * 10) / 10;
function edgePath(points) {
  const segments = edgeSegments(points, ARROW_INSET);
  const [start] = segments[0];
  return `M${r1(start[0])} ${r1(start[1])}${segments.map(([, c1, c2, p]) => ` C${r1(c1[0])} ${r1(c1[1])} ${r1(c2[0])} ${r1(c2[1])} ${r1(p[0])} ${r1(p[1])}`).join('')}`;
}

// ---------- Texto de resumen ----------
/** Resumen en texto plano (también sirve de descripción accesible del SVG). */
export function aonSummary(result, unit = 'semanas') {
  if (!result?.ok) return 'No hay resultados de red para describir.';
  const text = path => path.join(' → ');
  const parts = [`Duración esperada: ${fmtNum(result.duration)} ${unit}.`];
  parts.push(`Ruta crítica principal: ${text(result.mainPath ?? [])}.`);
  const extra = (result.criticalPaths ?? []).slice(1);
  if (extra.length) {
    const shown = extra.slice(0, 10).map(text).join('; ');
    const more = extra.length > 10 ? `; y ${extra.length - 10} más` : '';
    const count = `${result.pathsTruncated ? 'al menos ' : ''}${extra.length}`;
    parts.push(extra.length === 1 && !result.pathsTruncated
      ? `Existe 1 ruta crítica adicional: ${shown}.`
      : `Existen ${count} rutas críticas adicionales: ${shown}${more}.`);
  }
  if (result.pathsTruncated) parts.push(`Hay muchas rutas críticas: se muestran solo las primeras ${MAX_CRITICAL_PATHS}.`);
  return parts.join(' ');
}

// ---------- SVG ----------
const STYLE = `
.aon-svg{font-family:Inter,"Segoe UI",Arial,sans-serif}
.aon-svg text{fill:#19354d;font-size:12px}
.aon-box{fill:#e3f0fd;stroke:#4779be;stroke-width:1.75}
.aon-sep{stroke:#8fb0d6;stroke-width:1}
.aon-time{font-size:12.5px;font-weight:600}
.aon-code{font-size:13px;font-weight:700}
.aon-name{font-size:10.5px;fill:#33566f}
.aon-name-empty{font-style:italic}
.aon-flag{font-size:12px;font-weight:700}
.aon-flag-critical{fill:#c1161c}
.aon-flag-slack{font-weight:600;fill:#33566f}
.aon-critical .aon-box{fill:#ffe6e8;stroke:#e60000;stroke-width:3}
.aon-critical .aon-sep{stroke:#e8a0a4}
.aon-term-box{fill:#164a73;stroke:#164a73;stroke-width:1.5}
.aon-svg .aon-term-text{fill:#fff;font-size:12px;font-weight:700;letter-spacing:.04em}
.aon-edge{fill:none;stroke:#777;stroke-width:1.4;stroke-linecap:round}
.aon-edge-critical{fill:none;stroke:#e60000;stroke-width:3;stroke-linecap:round}
`;

function activityNode(node) {
  const { x, y, width: w, height: h, activity: a } = node;
  const r = 7, cx = x + w / 2;
  const suffix = node.critical ? ' · Crítica' : ` · H=${fmtNum(a.holgura)}`;
  const maxText = w - 16;
  const code = truncate(node.code, 13, Math.max(24, maxText - textWidth(suffix, 12, true)), true);
  const name = String(a.nombre ?? '').trim();
  const tip = `${node.code}${name ? ` — ${name}` : ''}\nES=${fmtNum(a.es)}  EF=${fmtNum(a.ef)}  LS=${fmtNum(a.ls)}  LF=${fmtNum(a.lf)}\n${node.critical ? 'Actividad crítica (holgura 0)' : `Holgura H=${fmtNum(a.holgura)}`}`;
  return `<g class="aon-node${node.critical ? ' aon-critical' : ''}" data-code="${esc(node.code)}"><title>${esc(tip)}</title>`
    + `<rect class="aon-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}"/>`
    + `<line class="aon-sep" x1="${x}" y1="${y + BAND}" x2="${x + w}" y2="${y + BAND}"/>`
    + `<line class="aon-sep" x1="${x}" y1="${y + h - BAND}" x2="${x + w}" y2="${y + h - BAND}"/>`
    + `<line class="aon-sep" x1="${cx}" y1="${y}" x2="${cx}" y2="${y + BAND}"/><line class="aon-sep" x1="${cx}" y1="${y + h - BAND}" x2="${cx}" y2="${y + h}"/>`
    + `<rect class="aon-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="none"/>`
    + `<text class="aon-time" x="${x + w / 4}" y="${y + 17}" text-anchor="middle">${fmtNum(a.es)}</text>`
    + `<text class="aon-time" x="${x + 3 * w / 4}" y="${y + 17}" text-anchor="middle">${fmtNum(a.ef)}</text>`
    + `<text class="aon-code" x="${cx}" y="${y + BAND + 16}" text-anchor="middle">${esc(code)}`
    + `<tspan class="aon-flag ${node.critical ? 'aon-flag-critical' : 'aon-flag-slack'}">${esc(suffix)}</tspan></text>`
    + `<text class="aon-name${name ? '' : ' aon-name-empty'}" x="${cx}" y="${y + BAND + 31}" text-anchor="middle">${esc(name ? truncate(name, 10.5, maxText) : '(sin nombre)')}</text>`
    + `<text class="aon-time" x="${x + w / 4}" y="${y + h - BAND + 17}" text-anchor="middle">${fmtNum(a.ls)}</text>`
    + `<text class="aon-time" x="${x + 3 * w / 4}" y="${y + h - BAND + 17}" text-anchor="middle">${fmtNum(a.lf)}</text></g>`;
}

function terminalNode(node) {
  const { x, y, width: w, height: h } = node;
  return `<g class="aon-node aon-terminal" data-code="${node.kind}"><title>${node.kind === 'start' ? 'INICIO del proyecto' : 'FIN del proyecto'}</title>`
    + `<rect class="aon-term-box" x="${x}" y="${y}" width="${w}" height="${h}" rx="${h / 2}"/>`
    + `<text class="aon-term-text" x="${x + w / 2}" y="${y + h / 2 + 4.5}" text-anchor="middle">${node.code}</text></g>`;
}

/** HTML con el diagrama AON. Acepta el resultado de `calculateProject` con ok:true; devuelve '' en otro caso. */
export function aonDiagram(result, unit = 'semanas') {
  const layout = layoutAon(result);
  if (!layout.nodes.length) return '';
  const { nodes, edges, width, height } = layout;
  const label = new Map(nodes.map(node => [node.id, node.code]));
  const edgeSvg = edge => {
    const critical = edge.critical;
    return `<path class="${critical ? 'aon-edge-critical' : 'aon-edge'}" d="${edgePath(edge.points)}" marker-end="url(#${critical ? 'aon-arrow-critical' : 'aon-arrow'})"><title>${esc(label.get(edge.from))} → ${esc(label.get(edge.to))}</title></path>`;
  };
  const marker = (id, color) => `<marker id="${id}" viewBox="0 0 14 12" markerUnits="userSpaceOnUse" markerWidth="14" markerHeight="12" refX="10" refY="6" orient="auto"><path d="M0 0L14 6L0 12Z" fill="${color}"/></marker>`;
  return `<div class="aon-scroll"><svg class="aon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="aon-title aon-desc" style="min-width:${width}px;width:100%;height:auto">`
    + `<title id="aon-title">Diagrama de red AON del proyecto</title><desc id="aon-desc">${esc(aonSummary(result, unit))}</desc>`
    + `<style>${STYLE}</style><defs>${marker('aon-arrow', '#777')}${marker('aon-arrow-critical', '#e60000')}</defs>`
    + `<g class="aon-edges">${edges.filter(e => !e.critical).map(edgeSvg).join('')}${edges.filter(e => e.critical).map(edgeSvg).join('')}</g>`
    + `<g class="aon-nodes">${nodes.map(node => node.kind === 'activity' ? activityNode(node) : terminalNode(node)).join('')}</g>`
    + `</svg></div>`;
}

// ---------- Leyenda ----------
const FONT = 'font-family="Inter,\'Segoe UI\',Arial,sans-serif" style="flex:none"';
function legendNode({ critical, flag }) {
  const stroke = critical ? '#e60000' : '#4779be', fill = critical ? '#ffe6e8' : '#e3f0fd';
  const flagText = critical ? 'Crítica' : 'H=2';
  const flagColor = critical ? '#c1161c' : '#33566f';
  return `<svg width="132" height="72" viewBox="0 0 132 72" aria-hidden="true" focusable="false" ${FONT}>`
    + `<rect x="2" y="2" width="128" height="68" rx="7" fill="${fill}" stroke="${stroke}" stroke-width="${critical ? 2.5 : 1.5}"/>`
    + `<g stroke="${critical ? '#e8a0a4' : '#8fb0d6'}"><line x1="2" y1="20" x2="130" y2="20"/><line x1="2" y1="52" x2="130" y2="52"/><line x1="66" y1="2" x2="66" y2="20"/><line x1="66" y1="52" x2="66" y2="70"/></g>`
    + `<g font-size="11" font-weight="600" fill="#19354d" text-anchor="middle"><text x="34" y="15">ES</text><text x="98" y="15">EF</text><text x="34" y="65">LS</text><text x="98" y="65">LF</text></g>`
    + `<text x="66" y="40" text-anchor="middle" font-size="11.5" fill="#19354d"><tspan font-weight="700">${flag}</tspan><tspan font-weight="700" fill="${flagColor}"> · ${flagText}</tspan></text></svg>`;
}

/** Leyenda en HTML sencillo; los estilos de `aon-legend` y `aon-legend-item` están en la hoja de estilos de la aplicación. */
export function aonLegend() {
  const arrow = `<svg width="132" height="72" viewBox="0 0 132 72" aria-hidden="true" focusable="false" ${FONT}>`
    + `<rect x="2" y="22" width="34" height="28" rx="6" fill="#e3f0fd" stroke="#4779be" stroke-width="1.5"/><text x="19" y="41" text-anchor="middle" font-size="12" font-weight="700" fill="#19354d">A</text>`
    + `<path d="M36 36H88" stroke="#777" stroke-width="1.6" fill="none"/><path d="M86 30L98 36L86 42Z" fill="#777"/>`
    + `<rect x="96" y="22" width="34" height="28" rx="6" fill="#e3f0fd" stroke="#4779be" stroke-width="1.5"/><text x="113" y="41" text-anchor="middle" font-size="12" font-weight="700" fill="#19354d">B</text></svg>`;
  const terminals = `<svg width="132" height="72" viewBox="0 0 132 72" aria-hidden="true" focusable="false" ${FONT}>`
    + `<rect x="2" y="26" width="48" height="22" rx="11" fill="#164a73"/><text x="26" y="41" text-anchor="middle" font-size="9.5" font-weight="700" fill="#fff">INICIO</text>`
    + `<rect x="82" y="26" width="48" height="22" rx="11" fill="#164a73"/><text x="106" y="41" text-anchor="middle" font-size="10.5" font-weight="700" fill="#fff">FIN</text>`
    + `<path d="M50 37H70" stroke="#777" stroke-width="1.6" fill="none"/><path d="M68 32L80 37L68 42Z" fill="#777"/></svg>`;
  const item = (graphic, title, text) => `<li class="aon-legend-item">${graphic}<span><strong>${title}</strong> ${text}</span></li>`;
  return `<ul class="aon-legend" aria-label="Cómo leer el diagrama">`
    + item(legendNode({ critical: false, flag: 'Actividad' }), 'Estructura del nodo:', 'arriba, ES (Inicio temprano) | EF (Fin temprano); al centro, la actividad; abajo, LS (Inicio tardío) | LF (Fin tardío).')
    + item(legendNode({ critical: true, flag: 'C' }), '<span style="color:#c1161c">Ruta crítica (Holgura = 0):</span>', 'nodos con borde rojo grueso, etiqueta «Crítica» y flechas rojas gruesas.')
    + item(legendNode({ critical: false, flag: 'B' }), '<span style="color:#555">Ruta no crítica (Holgura &gt; 0):</span>', 'nodos con borde azul y la holgura H en la etiqueta; flechas grises finas.')
    + item(arrow, 'Flecha:', 'la actividad A debe terminar antes de que empiece B.')
    + item(terminals, 'INICIO y FIN:', 'nodos de cierre de la red; no son actividades ni consumen tiempo.')
    + `</ul>`;
}
