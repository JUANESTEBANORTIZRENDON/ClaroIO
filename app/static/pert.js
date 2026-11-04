import {fmt,pct,esc} from './visuals.js';
import {badge,heading,metric} from './decisions.js';
import {calculateProject,parseDecimal,parsePredecessors,normalizeCode,completionProbability} from './pert-engine.js';
import {aonDiagram,aonLegend,aonSummary,fmtNum} from './pert-diagram.js';
import {pertReferenceCard} from './references.js';

export const PERT_MAX_ROWS=40;
const FIELD_NAMES={codigo:'Código',nombre:'Actividad',predecesoras:'Predecesoras',a:'a (optimista)',m:'m (más probable)',b:'b (pesimista)'};
const arrow=path=>path.map(esc).join(' → ');
const isBlank=value=>String(value??'').trim()==='';

const input=(i,name,value,label,attrs='')=>`<input type="text" data-pert-row="${i}" data-pert-field="${name}" value="${esc(value)}" aria-label="${esc(label)} (fila ${i+1})" aria-describedby="pert-err-${i}" autocomplete="off" ${attrs}>`;

function editorRow(row,i){
 return `<tr data-pert-tr="${i}"><td>${input(i,'codigo',row.codigo,'Código de la actividad','class="pert-code" maxlength="12"')}</td><td>${input(i,'nombre',row.nombre,'Nombre de la actividad','class="pert-name"')}</td><td>${input(i,'predecesoras',row.predecesoras,'Predecesoras separadas por coma','class="pert-preds" placeholder="—"')}</td><td>${input(i,'a',row.a,'Tiempo optimista a','class="numeric" inputmode="decimal"')}</td><td>${input(i,'m',row.m,'Tiempo más probable m','class="numeric" inputmode="decimal"')}</td><td>${input(i,'b',row.b,'Tiempo pesimista b','class="numeric" inputmode="decimal"')}</td><td><button type="button" class="button small" data-pert-action="delete" data-pert-row="${i}" aria-label="Eliminar la actividad de la fila ${i+1}">Eliminar</button></td></tr><tr class="pert-row-error" id="pert-errrow-${i}" hidden><td colspan="7"><div id="pert-err-${i}" aria-live="polite"></div></td></tr>`;
}

export function pertEditor(model){
 return `<table class="pert-table"><thead><tr><th scope="col">Código</th><th scope="col">Actividad</th><th scope="col">Predecesoras <small>(separadas por coma)</small></th><th scope="col">a <small>optimista</small></th><th scope="col">m <small>más probable</small></th><th scope="col">b <small>pesimista</small></th><th scope="col"><span class="screen-reader">Acciones</span></th></tr></thead><tbody>${model.activities.map(editorRow).join('')}</tbody></table>`;
}

export function isPertEdited(model,initial){return JSON.stringify(model.activities)!==JSON.stringify(initial.pert.activities)||model.target!==initial.pert.target;}
export const pertBadge=(model,initial)=>isPertEdited(model,initial)?badge('Escenario editado','edited'):badge('Supuesto académico','assumption');

export function nextPertCode(rows){
 const used=new Set(rows.map(row=>normalizeCode(row.codigo)));
 for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ')if(!used.has(letter))return letter;
 for(let i=1;;i++)if(!used.has('N'+i))return 'N'+i;
}

/** Actividades que declaran a `index` como predecesora (por código normalizado). */
export function pertDependents(model,index){
 const code=normalizeCode(model.activities[index]?.codigo);
 if(!code)return [];
 return model.activities.map((row,i)=>({row,i})).filter(({row,i})=>i!==index&&parsePredecessors(row.predecesoras).includes(code)).map(({row,i})=>({index:i,code:normalizeCode(row.codigo)||`fila ${i+1}`}));
}

export function pertDeleteNotice(model,index,dependents){
 const code=normalizeCode(model.activities[index].codigo)||`fila ${index+1}`,list=dependents.map(d=>esc(d.code)).join(', ');
 return `<div class="pert-notice" role="alert"><p><strong>${esc(code)} es predecesora de ${list}.</strong> Si la eliminas, esas actividades quedarían apuntando a una actividad inexistente. Puedes eliminarla y quitarla de sus predecesoras, o cancelar y corregir las dependencias manualmente.</p><div class="pert-actions"><button type="button" class="button primary small" data-pert-action="confirm-delete" data-pert-row="${index}">Eliminar y quitar de las predecesoras</button><button type="button" class="button small" data-pert-action="cancel-delete">Cancelar</button></div></div>`;
}

export function pertPage(model,initial){
 const p=initial.pert;
 return `<div class="eyebrow">MODELO 04 · CLARO COLOMBIA</div><div class="hero"><div><h1>PERT y CPM</h1><p class="pert-subtitle">Programación del proyecto PQR</p><p>Estima la duración de cada actividad con tres tiempos, calcula los recorridos hacia adelante y hacia atrás, las holguras y las rutas críticas, y visualiza la red de actividades.</p></div><div class="period"><strong>${esc(p.unit)}</strong><span>Unidad temporal del ejemplo</span></div></div>
 <div class="steps"><a href="#p-scope"><b>01</b> Alcance</a><a href="#p-input"><b>02</b> Actividades PERT</a><a href="#p-results"><b>03</b> Resultados CPM</a><a href="#p-network"><b>04</b> Red AON</a><a href="#p-explain"><b>05</b> Explicación y fuentes</a></div>
 <section id="p-scope" class="section">${heading('01','Alcance académico',esc(p.project),badge('Supuesto académico','assumption'))}<div class="info-note"><strong>Ejercicio académico.</strong> Este módulo presenta un ejercicio académico de programación de proyectos aplicado al contexto general de Claro Laboratorio IO. Las actividades, dependencias y duraciones son supuestos creados para estudiar PERT y CPM. No representan un proyecto oficial ni decisiones reales de Claro Colombia.</div>
 <div class="two-col"><div class="card"><h3>Qué hace cada técnica</h3><ul class="list-clean"><li><strong>PERT</strong> usa tres estimaciones (optimista, más probable y pesimista) para modelar la incertidumbre del tiempo de cada actividad.</li><li><strong>CPM</strong> usa la red de actividades para determinar la duración del proyecto, las holguras y su ruta crítica.</li><li>El diagrama es <strong>AON</strong> (<em>activity on node</em>): cada actividad aparece dentro de un nodo y las flechas indican precedencia.</li></ul></div><div class="card"><h3>Convenciones del ejemplo</h3><ul class="list-clean"><li>La unidad del ejemplo son <strong>${esc(p.unit)}</strong>; todas las actividades deben usar la misma unidad temporal en una ejecución.</li><li>Los cálculos se hacen en tu navegador con precisión completa; el redondeo ocurre solo al mostrar.</li><li>Las referencias a FCFS o Bayes son nombres de actividades del proyecto: no modifican las fórmulas de PERT y CPM ni se mezclan con las de teoría de colas.</li></ul></div></div></section>
 <section id="p-input" class="section">${heading('02','Actividades PERT','Edita códigos, predecesoras y los tiempos a, m y b; el proyecto se recalcula automáticamente.',`<span id="pert-badge">${pertBadge(model,initial)}</span>`)}<div class="card"><div class="card-head"><h3>Tabla de actividades <small>· ${esc(p.unit)}</small></h3><button type="button" class="button small" data-pert-action="example">Cargar ejemplo Claro</button></div><div class="table-wrap pert-editor" id="pert-editor">${pertEditor(model)}</div><div id="pert-notice" role="status"></div><p class="subtle">Predecesoras: códigos separados por coma (por ejemplo, B, D); déjalas vacías si la actividad puede iniciar en el tiempo 0. Los códigos se convierten a mayúsculas. Acepta punto o coma decimal. Debe cumplirse a ≤ m ≤ b.</p><div class="form-foot"><div class="pert-actions"><button type="button" class="button" data-pert-action="add">+ Agregar actividad</button><button type="button" class="button" data-pert-action="reset">Restaurar valores</button></div><button type="button" class="button primary" data-pert-action="calculate">Calcular proyecto</button></div></div></section>
 <section id="p-results" class="section">${heading('03','Resultados CPM','Recorrido hacia adelante, recorrido hacia atrás, holguras y ruta crítica.',badge('Calculado','calculated'))}<div id="pert-error" class="error" role="alert" hidden></div><div id="pert-results"><div class="pending">Calculando el proyecto…</div></div>
 <div class="card spaced"><div class="card-head"><h3>Probabilidad de terminar a tiempo <small>· opcional</small></h3></div><label class="input-label pert-target">Plazo objetivo (${esc(p.unit)})<input class="numeric" type="text" inputmode="decimal" data-pert-field="target" value="${esc(model.target)}" aria-describedby="pert-probability" autocomplete="off" placeholder="p. ej. 25"></label><div id="pert-probability" role="status" aria-live="polite"></div></div></section>
 <section id="p-network" class="section">${heading('04','Red AON','Diagrama dinámico: se redibuja con cada cambio de datos.',badge('Calculado','calculated'))}<div id="pert-network"><div class="pending">Calculando el proyecto…</div></div></section>
 <section id="p-explain" class="section">${heading('05','Explicación y fuentes','Procedimiento paso a paso y trazabilidad del ejercicio.')}${explanation()}<h3 class="spaced">Fuentes y trazabilidad</h3><div class="reference-grid">${p.sources.map(pertReferenceCard).join('')}</div><p class="subtle spaced">Ejercicio académico · No representa decisiones oficiales de los operadores.</p></section>`;
}

function explanation(){
 return `<div class="pert-explain">
 <details class="card" open><summary>PERT: tres estimaciones por actividad</summary><p>PERT utiliza tres estimaciones de tiempo para representar la incertidumbre de una actividad: optimista (a), más probable (m) y pesimista (b). Con ellas se calcula el tiempo esperado:</p><div class="formula">TE = (a + 4m + b) / 6</div><p>El tiempo más probable se multiplica por cuatro porque recibe una ponderación mayor: se considera el valor más representativo de la actividad, mientras que a y b marcan los extremos. Si quieres estimar la variabilidad, la varianza de cada actividad es σ² = ((b − a) / 6)².</p></details>
 <details class="card"><summary>CPM: la red y la ruta crítica</summary><p>CPM analiza la red de actividades y permite identificar el camino de mayor duración, denominado ruta crítica. Su duración es la duración mínima posible del proyecto: cualquier retraso en una actividad de esa ruta retrasa el proyecto completo. Puede haber más de una ruta crítica cuando varias secuencias tienen la misma duración.</p></details>
 <details class="card"><summary>Recorrido hacia adelante: ES y EF</summary><ul class="list-clean"><li>Se calculan el inicio temprano (ES) y el fin temprano (EF) de cada actividad, en orden topológico.</li><li>Una actividad sin predecesoras comienza en ES = 0.</li><li>Si una actividad tiene varias predecesoras, toma el mayor EF: debe esperar a que finalicen todas.</li></ul><div class="formula">ES = máx(EF de las predecesoras)   ·   EF = ES + TE   ·   Duración = máx(EF)</div></details>
 <details class="card"><summary>Recorrido hacia atrás: LS y LF</summary><ul class="list-clean"><li>Se calculan el fin tardío (LF) y el inicio tardío (LS), desde el final hacia el inicio.</li><li>Una actividad final termina como máximo en la duración del proyecto.</li><li>Si una actividad tiene varias sucesoras, toma el menor LS: así se protege la fecha final del proyecto.</li></ul><div class="formula">LF = mín(LS de las sucesoras)   ·   LS = LF − TE</div></details>
 <details class="card"><summary>Holgura y actividades críticas</summary><p>La holgura es el margen que puede retrasarse una actividad sin retrasar el proyecto:</p><div class="formula">H = LS − ES   y también   H = LF − EF</div><p>Una actividad con holgura cero es crítica. Como los cálculos usan decimales, la comparación con cero se hace con una tolerancia de 1e-9, no con igualdad exacta. Una conexión se resalta como crítica solo cuando ambas actividades son críticas y la primera termina exactamente cuando empieza la segunda.</p></details>
 <details class="card"><summary>Probabilidad PERT (aproximación normal)</summary><ul class="list-clean"><li>Se suman las varianzas de las actividades de la ruta crítica; si hay varias, se usa la de mayor varianza (criterio prudente).</li><li>Se supone que la duración del proyecto se distribuye de forma aproximadamente normal con media igual a la duración esperada y desviación σ = √(Σσ²).</li><li>P(T ≤ plazo) = Φ((plazo − duración) / σ). Supone actividades independientes y no considera que otra ruta casi crítica pueda alargarse; por eso es una estimación orientativa, no una certeza.</li></ul></details></div>`;
}

function paintRowErrors(result,model){
 document.querySelectorAll('.pert-row-error').forEach(row=>{row.hidden=true;});
 document.querySelectorAll('[data-pert-field][aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
 document.querySelectorAll('[id^="pert-err-"]').forEach(el=>{el.textContent='';});
 if(result.ok)return;
 for(const error of result.errors){
  if(error.row==null){for(const row of error.rows??[])document.querySelector(`[data-pert-row="${row}"][data-pert-field="${error.field}"]`)?.setAttribute('aria-invalid','true');continue;}
  const holder=document.getElementById(`pert-err-${error.row}`);if(!holder)continue;
  document.getElementById(`pert-errrow-${error.row}`).hidden=false;
  const line=document.createElement('p');line.textContent=error.message;holder.append(line);
  if(error.field)document.querySelector(`[data-pert-row="${error.row}"][data-pert-field="${error.field}"]`)?.setAttribute('aria-invalid','true');
 }
}

function errorSummary(result,model){
 const items=result.errors.map(error=>{
  const where=error.row==null?'Red de actividades':`Fila ${error.row+1}${normalizeCode(model.activities[error.row]?.codigo)?` (${esc(normalizeCode(model.activities[error.row].codigo))})`:''}`;
  return `<li><strong>${where}${error.field&&error.row!=null?` · ${FIELD_NAMES[error.field]}`:''}:</strong> ${esc(error.message)}</li>`;
 }).join('');
 return `<strong>No se calculó el proyecto.</strong> Corrige ${result.errors.length===1?'el siguiente error':`los ${result.errors.length} errores siguientes`}; no se muestran resultados parciales.<ul class="list-clean">${items}</ul>`;
}

export function evaluatePert(model){
 return calculateProject(model.activities.map(row=>({codigo:row.codigo,nombre:row.nombre,predecesoras:row.predecesoras,a:parseDecimal(row.a),m:parseDecimal(row.m),b:parseDecimal(row.b)})));
}

const full=value=>`title="Valor con precisión completa: ${value}"`;

function resultsMarkup(result,unit){
 const critical=result.criticalCodes.length,extras=result.extraPaths,noMargin=result.activities.filter(a=>!a.esCritica);
 const rows=result.activities.map(a=>`<tr class="${a.esCritica?'critical':''}"><th scope="row">${esc(a.codigo)}</th><td class="wrap">${esc(a.nombre)}</td><td ${full(a.te)}>${fmtNum(a.te)}</td><td ${full(a.es)}>${fmtNum(a.es)}</td><td ${full(a.ef)}>${fmtNum(a.ef)}</td><td ${full(a.ls)}>${fmtNum(a.ls)}</td><td ${full(a.lf)}>${fmtNum(a.lf)}</td><td ${full(a.holgura)}>${fmtNum(a.holgura)}</td><td class="wrap">${a.esCritica?'<span class="pert-chip">Sí · Crítica</span>':'No'}</td></tr>`).join('');
 const pathList=result.criticalPaths.slice(1).map(path=>`<li>${arrow(path)}</li>`).join('');
 const margin=noMargin.length?noMargin.map(a=>`${esc(a.codigo)} (${fmtNum(a.holgura)} ${esc(a.holgura===1?unit.replace(/s$/,''):unit)})`).join(', '):'ninguna: todas las actividades son críticas';
 return `<div class="metric-grid">${metric('Duración esperada',`${fmtNum(result.duration)} ${esc(unit)}`,'Máximo EF de la red','red')}${metric('Actividades',String(result.activities.length),'En la red')}${metric('Actividades críticas',String(critical),'Holgura igual a cero','blue')}${metric('Rutas críticas',String(result.criticalPaths.length),extras?`${extras} adicional${extras===1?'':'es'}`:'Ruta única')}</div>
 <div class="card pert-path-card"><h3>Ruta crítica principal</h3><p class="pert-path" ${full(result.duration)}>${arrow(result.mainPath)}</p><p>Duración esperada: <strong>${fmtNum(result.duration)} ${esc(unit)}</strong>.${extras?` ${extras===1?'Existe':'Existen'} <strong>${extras}</strong> ruta${extras===1?'':'s'} crítica${extras===1?'':'s'} adicional${extras===1?'':'es'} con la misma duración${result.pathsTruncated?' (se muestran solo las primeras encontradas)':''}:`:' No hay otras rutas críticas.'}</p>${extras?`<ul class="list-clean pert-path-list">${pathList}</ul>`:''}</div>
 <div class="card spaced"><h3>Tiempos, holguras y estado crítico</h3><div class="table-wrap"><table class="data-table pert-results-table"><thead><tr><th scope="col">Act.</th><th scope="col">Actividad</th><th scope="col">TE</th><th scope="col">ES</th><th scope="col">EF</th><th scope="col">LS</th><th scope="col">LF</th><th scope="col">Holgura</th><th scope="col">Crítica</th></tr></thead><tbody>${rows}</tbody></table></div><p class="subtle">Tiempos en ${esc(unit)}. Se muestran con hasta dos decimales; los cálculos conservan la precisión completa (pasa el cursor sobre un valor para verla). Las filas críticas se marcan en rojo y con la etiqueta “Crítica”.</p></div>
 <div class="two-col spaced"><div class="card"><h3>Lectura de los resultados</h3><dl class="pert-qa"><dt>¿Cuánto dura el proyecto?</dt><dd>${fmtNum(result.duration)} ${esc(unit)}, el mayor fin temprano (EF) entre todas las actividades.</dd><dt>¿Cuál es la ruta crítica?</dt><dd>${arrow(result.mainPath)}${extras?`, y ${extras} más con la misma duración`:''}.</dd><dt>¿Qué significa una holgura de cero?</dt><dd>Que la actividad no tiene margen: su inicio temprano coincide con el tardío, así que no puede moverse sin mover el final del proyecto.</dd></dl></div><div class="card"><h3>Márgenes y riesgo</h3><dl class="pert-qa"><dt>¿Qué actividades tienen margen?</dt><dd>${margin}.</dd><dt>¿Qué pasa si se retrasa una actividad crítica?</dt><dd>Cada ${esc(unit.replace(/s$/,''))} de retraso en una actividad crítica retrasa el proyecto en la misma cantidad, porque no hay holgura que lo absorba (suponiendo que el resto no cambia). Una actividad no crítica puede retrasarse hasta agotar su holgura sin afectar la fecha final.</dd></dl></div></div>`;
}

function probabilityMarkup(result,model,unit){
 if(isBlank(model.target))return 'Introduce un plazo objetivo para estimar la probabilidad de terminar a tiempo.';
 const target=parseDecimal(model.target);
 if(!Number.isFinite(target)||target<0)return '<span class="negative">El plazo objetivo debe ser un número no negativo.</span>';
 const r=completionProbability(result,target),p=r.probability;
 const shown=p>=0.9999&&r.z!==null?'> 99,99 %':p<=0.0001&&r.z!==null?'< 0,01 %':pct(p);
 const detail=r.z===null?`La varianza de la ruta crítica es cero: el resultado es determinista (${p===1?'se cumple':'no se cumple'} el plazo).`:`σ² = ${fmt(r.variance,4)} · σ = ${fmt(r.sigma,4)} ${esc(unit)} · Z = ${fmt(r.z,4)}`;
 return `<p class="pert-prob">P(T ≤ ${fmtNum(target)} ${esc(unit)}) ≈ <strong>${shown}</strong></p><p class="subtle">${detail}. Ruta usada: ${arrow(r.path)}. Aproximación normal con actividades independientes: es una estimación, no una certeza.</p>`;
}

/** Calcula con el modelo actual y pinta errores, resultados, probabilidad y diagrama. Devuelve el resultado del motor. */
export function renderPertResults(model,unit='semanas'){
 const result=evaluatePert(model);
 paintRowErrors(result,model);
 const error=document.getElementById('pert-error'),out=document.getElementById('pert-results'),net=document.getElementById('pert-network'),prob=document.getElementById('pert-probability');
 if(!out)return result;
 if(!result.ok){
  error.innerHTML=errorSummary(result,model);error.hidden=false;
  out.innerHTML='<div class="pending">Resultado pendiente de actividades válidas.</div>';
  net.innerHTML='<div class="pending">El diagrama se mostrará cuando la tabla de actividades sea válida.</div>';
  prob.textContent='Disponible cuando el cálculo sea válido.';
  return result;
 }
 error.hidden=true;error.textContent='';
 out.innerHTML=resultsMarkup(result,unit);
 prob.innerHTML=probabilityMarkup(result,model,unit);
 net.innerHTML=`${aonLegend()}${aonDiagram(result)}<p class="pert-textual"><strong>Resumen textual del diagrama.</strong> ${esc(aonSummary(result,unit))}</p>`;
 return result;
}
