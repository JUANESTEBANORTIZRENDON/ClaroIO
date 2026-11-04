import {fmt,esc,clearCharts} from './visuals.js';
import {decisionsPage,renderDecisionResults,badge} from './decisions.js';
import {gamePage,renderGameResults} from './games.js';
import {sourcesPage,contextPage,drawContext} from './references.js';
import {queuePage,renderQueueResults,renderQueueData} from './queues.js';
import {pertPage,renderPertResults,pertDependents,pertDeleteNotice,nextPertCode,pertBadge,PERT_MAX_ROWS} from './pert.js';
import {parsePredecessors,normalizeCode} from './pert-engine.js';

const labels={decisiones:'Teoría de decisiones',juegos:'Teoría de juegos',colas:'Teoría de colas','pert-cpm':'PERT y CPM',fuentes:'Referencias y fuentes',contexto:'Claro y contexto empresarial'};
const key='claro-io-session-v1';
let initial,state,page='decisiones',requestVersion=0,controller,timer,lastDecision,lastQueue,queueContext,queueCsvText,pertPending=null,tourIndex=0,tourActive=false;
const clone=x=>structuredClone(x);
const freshPert=()=>({activities:clone(initial.pert.activities),target:initial.pert.target});
const validPert=p=>Array.isArray(p?.activities)&&p.activities.length<=PERT_MAX_ROWS&&typeof p.target==='string'&&p.activities.every(row=>row&&['codigo','nombre','predecesoras','a','m','b'].every(k=>typeof row[k]==='string'));
const $=id=>document.getElementById(id);
const getPath=(obj,path)=>path.split('.').reduce((a,k)=>a?.[k],obj);
function setPath(obj,path,value){const parts=path.split('.');let target=obj;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value;}
function save(){try{sessionStorage.setItem(key,JSON.stringify(state));}catch{toast('El navegador no permite guardar la sesión. Puedes continuar en esta página.');}}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,3500);}
function loadState(){
 const fresh={version:1,decisions:clone(initial.decisions),games:clone(initial.games),gameKind:'historical',queue:clone(initial.queue),pert:freshPert()};
 try{
  const saved=JSON.parse(sessionStorage.getItem(key));
  if(saved?.version===1&&saved.decisions?.matrix?.length===3&&saved.decisions?.names?.length===3&&saved.decisions?.response?.length===3&&saved.decisions?.counts?.length===3&&saved.decisions?.probabilities?.length===3&&saved.decisions?.base?.length===3&&saved.decisions?.costs?.length===3&&['direct','parameters'].includes(saved.decisions.mode)&&saved.games?.historical?.length===2&&saved.games?.hypothetical?.length===2){
   fresh.decisions=saved.decisions;fresh.games=saved.games;fresh.gameKind=['historical','hypothetical'].includes(saved.gameKind)?saved.gameKind:'historical';
   if(saved.queue)fresh.queue={...fresh.queue,...saved.queue,scenarios:clone(initial.queue.scenarios)};
   if(validPert(saved.pert))fresh.pert={activities:saved.pert.activities,target:saved.pert.target};
  }
 }catch{ /* Corrupt or disabled storage never prevents loading the original case. */ }
 return fresh;
}
function markEdited(){
 if(page==='decisiones'){
  const edited=JSON.stringify(state.decisions)!==JSON.stringify(initial.decisions);
  $('decision-badge').innerHTML=badge(edited?'Escenario editado':'Supuesto académico',edited?'edited':'assumption');
 }else if(page==='juegos'){
  const edited=JSON.stringify(state.games[state.gameKind])!==JSON.stringify(initial.games[state.gameKind]);
  $('game-badge').innerHTML=badge(edited?'Escenario editado':state.gameKind==='historical'?'Dato histórico':'Supuesto didáctico',edited?'edited':state.gameKind==='historical'?'historical':'assumption');
 }
 document.querySelectorAll('[data-path]').forEach(input=>{
  const source=page==='decisiones'?state.decisions:{matrix:state.games[state.gameKind]},original=page==='decisiones'?initial.decisions:{matrix:initial.games[state.gameKind]};
  input.classList.toggle('modified',JSON.stringify(getPath(source,input.dataset.path))!==JSON.stringify(getPath(original,input.dataset.path)));
 });
}
function invalidate(){
 requestVersion++;controller?.abort();clearTimeout(timer);clearCharts();
 const prefix=page==='decisiones'?'decision':'game';
 if(!$(prefix+'-results'))return;
 $(prefix+'-results').hidden=true;
 if(page==='decisiones'){$('bayes-results').hidden=true;$('probability-results')?.setAttribute('hidden','');lastDecision=null;}
 $(prefix+'-summary').innerHTML='<div class="pending">Actualizando el escenario…</div>';
 $(prefix+'-error').hidden=true;$(prefix+'-status').innerHTML='<div class="pending">Recalculando con las entradas actuales…</div>';
 if(page==='decisiones'&&state.decisions.mode==='parameters')document.querySelectorAll('[data-path^="matrix."]').forEach(input=>input.value='');
}
function validateLocal(payload,isDecision){
 const walk=v=>Array.isArray(v)?v.every(walk):typeof v==='number'&&Number.isFinite(v);
 if(isDecision){
  if(payload.names.some(n=>!n.trim()))return 'Escribe un nombre para cada alternativa.';
  if(![payload.base,payload.costs,payload.response,payload.matrix,payload.probabilities,payload.counts,[payload.alpha]].every(walk))return 'Completa todas las entradas con números válidos. Usa coma o punto decimal, sin separadores de miles.';
  if(payload.probabilities.some(p=>p<0||p>1)||Math.abs(payload.probabilities.reduce((a,b)=>a+b,0)-1)>1e-9)return 'Las probabilidades deben estar entre 0 y 1 y sumar exactamente 1 (100 %).';
  if(payload.counts.flat().some(v=>v<0||!Number.isInteger(v)))return 'Los conteos F/D deben ser enteros no negativos.';
  if(payload.counts.some(row=>row.reduce((a,b)=>a+b,0)===0))return 'Cada estado necesita al menos un conteo F o D.';
  if([...payload.costs,...payload.response.flat()].some(v=>v<0||v>100))return 'Los porcentajes de costo y respuesta deben estar entre 0 y 100.';
  if(payload.base.some(v=>v<0))return 'Los ingresos base no pueden ser negativos.';
 }else if(!walk(payload.matrix))return 'Completa las cuatro celdas con números válidos. Usa coma o punto decimal, sin separadores de miles.';
 return null;
}
async function calculate(){
 const isDecision=page==='decisiones';if(!isDecision&&page!=='juegos')return;
 const prefix=isDecision?'decision':'game',version=++requestVersion,payload=isDecision?clone(state.decisions):{matrix:clone(state.games[state.gameKind])};
 // Inactive editors retain their drafts, but never determine the active calculation.
 if(isDecision&&payload.mode==='parameters')payload.matrix=clone(initial.decisions.matrix);
 if(isDecision&&payload.mode==='direct')for(const field of ['base','costs','response'])payload[field]=clone(initial.decisions[field]);
 const localError=validateLocal(payload,isDecision);
 if(localError){showError(prefix,localError);return;}
 controller=new AbortController();
 try{
  const response=await fetch(`/api/${isDecision?'decisions':'game'}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const data=await response.json();if(version!==requestVersion)return;
  if(!response.ok){const message=Array.isArray(data.detail)?data.detail.map(e=>`${e.field}: ${e.message}`).join(' · '):data.detail;throw new Error(`Revisa las entradas. ${message||'No se pudo calcular.'}`);}
  clearCharts();$(prefix+'-status').innerHTML='';$(prefix+'-error').hidden=true;$(prefix+'-results').hidden=false;
  if(isDecision){
   lastDecision=data;$('probability-results').hidden=false;$('bayes-results').hidden=false;renderDecisionResults(data,state.decisions);
   if(state.decisions.mode==='parameters')document.querySelectorAll('[data-path^="matrix."]').forEach(input=>{const [,i,j]=input.dataset.path.split('.');input.value=fmt(data.matrix[i][j]);input.title=`Valor con precisión completa: ${data.matrix[i][j]}`;});
  }else renderGameResults(data,state.gameKind);
  markEdited();if(tourActive)updateTour(false);
 }catch(error){if(error.name!=='AbortError'&&version===requestVersion)showError(prefix,error instanceof TypeError?'No se pudo contactar al servidor. Los resultados se ocultan hasta recuperar el cálculo.':error.message);}
}
function showError(prefix,message){$(prefix+'-status').innerHTML='';$(prefix+'-error').textContent=message;$(prefix+'-error').hidden=false;$(prefix+'-results').hidden=true;$(prefix+'-summary').innerHTML='<div class="pending">Resultado pendiente de entradas válidas.</div>';if(prefix==='decision'){$('bayes-results').hidden=true;$('probability-results')?.setAttribute('hidden','');}clearCharts();}
async function calculateQueue(){
 const version=++requestVersion,payload={arrival_rate_per_hour:Number(state.queue.arrival_rate_per_hour),average_service_minutes:Number(state.queue.average_service_minutes),servers:Number(state.queue.servers),threshold_seconds:Number(state.queue.threshold_seconds),arrival_evidence:state.queue.mode==='public'&&queueContext?'calculated_from_crc':'estimated'};
 const numeric=Object.values(payload).filter(v=>typeof v==='number'),valid=numeric.every(Number.isFinite)&&payload.arrival_rate_per_hour>0&&payload.average_service_minutes>0&&Number.isInteger(payload.servers)&&payload.servers>0&&payload.threshold_seconds>=0;
 if(!valid){$('queue-error').textContent='Revisa las entradas: λ y servicio deben ser positivos, c debe ser entero positivo y el umbral no puede ser negativo.';$('queue-error').hidden=false;$('queue-results').innerHTML='';return;}
 controller=new AbortController();$('queue-error').hidden=true;$('queue-status').innerHTML='<div class="pending">Calculando M/M/c…</div>';
 try{
  const response=await fetch('/api/queues/mmc/calculate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
  const data=await response.json();if(version!==requestVersion)return;
  if(!response.ok)throw new Error(Array.isArray(data.detail)?data.detail.map(e=>e.message).join(' · '):data.detail);
  lastQueue=data;$('queue-status').innerHTML='';$('queue-error').hidden=true;clearCharts();renderQueueResults(data);if(tourActive)updateTour(false);
 }catch(error){if(error.name!=='AbortError'&&version===requestVersion){lastQueue=null;clearCharts();$('queue-status').innerHTML='';$('queue-error').textContent=error.message;$('queue-error').hidden=false;$('queue-results').innerHTML='<div class="pending">No hay métricas estacionarias para mostrar.</div>';$('queue-export').disabled=true;}}
}
async function parseQueueCsv(existingText=null){
 const file=$('queue-csv')?.files?.[0];if(!existingText&&!file){toast('Selecciona primero un archivo CSV.');return;}
 const button=$('queue-parse');button.disabled=true;$('queue-status').innerHTML='<div class="pending">Validando y agregando el CSV…</div>';
 try{
  const csv_text=existingText??await file.text();queueCsvText=csv_text;
  const response=await fetch('/api/queues/context/parse',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({csv_text,hours_per_day:Number(state.queue.hours_per_day)})});
  const data=await response.json();if(!response.ok)throw new Error(Array.isArray(data.detail)?data.detail.map(e=>e.message).join(' · '):data.detail);
  queueContext=data;state.queue.arrival_rate_per_hour=data.quantiles.p50;save();renderPage(false);toast('CSV procesado: la demanda base ahora usa P50.');
 }catch(error){$('queue-status').innerHTML='';$('queue-error').textContent=error.message;$('queue-error').hidden=false;button.disabled=false;}
}
function exportQueue(){
 if(!lastQueue)return;
 const payload={generated_at:new Date().toISOString(),scope:{provider_id:800153993,service_id:2,channel_id:2,period:'2022-01 a 2025-12',typologies:'Todas'},mode:state.queue.mode,calibration:queueContext,run:lastQueue,sources:initial.queue_sources};
 const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='claro-mmc-resumen.json';link.click();URL.revokeObjectURL(url);
}
function renderPage(scroll=true){
 controller?.abort();requestVersion++;clearTimeout(timer);clearCharts();lastDecision=null;
 document.querySelectorAll('[data-page]').forEach(button=>{button.classList.toggle('active',button.dataset.page===page);button.setAttribute('aria-current',button.dataset.page===page?'page':'false');});
 $('breadcrumb').textContent=labels[page];document.title=`${labels[page]} · Claro laboratorio IO`;
 $('main').innerHTML=page==='decisiones'?decisionsPage(state.decisions,initial):page==='juegos'?gamePage(state.games[state.gameKind],state.gameKind,initial):page==='colas'?queuePage(state.queue,initial,queueContext):page==='pert-cpm'?pertPage(state.pert,initial):page==='fuentes'?sourcesPage(initial):contextPage(initial);
 if(page==='decisiones'||page==='juegos'){markEdited();invalidate();calculate();}else if(page==='colas'){if(queueContext)renderQueueData(queueContext);calculateQueue();}else if(page==='pert-cpm'){pertPending=null;refreshPert();}else if(page==='contexto')drawContext(initial);
 if(scroll)window.scrollTo({top:0,behavior:'instant'});
 if(tourActive){tourIndex=0;updateTour();}
}
function refreshPert(){
 const result=renderPertResults(state.pert,initial.pert.unit);
 const badgeHost=$('pert-badge');if(badgeHost)badgeHost.innerHTML=pertBadge(state.pert,initial);
 if(tourActive)updateTour(false);
 return result;
}
function onPertInput(input){
 const field=input.dataset.pertField;
 if(field==='target')state.pert.target=input.value;else{const row=state.pert.activities[Number(input.dataset.pertRow)];if(!row)return;row[field]=input.value;}
 if(pertPending&&(field==='codigo'||field==='predecesoras')){pertPending=null;$('pert-notice').innerHTML='';}
 save();clearTimeout(timer);timer=setTimeout(refreshPert,180);
}
function focusPertAfterDelete(index){
 const rows=state.pert.activities,target=rows.length?document.querySelector(`[data-pert-row="${Math.min(index,rows.length-1)}"][data-pert-field="codigo"]`):document.querySelector('[data-pert-action="add"]');target?.focus();
}
function onPertAction(button){
 const action=button.dataset.pertAction,index=Number(button.dataset.pertRow),rows=state.pert.activities,notice=$('pert-notice');
 if(action==='calculate'){
  clearTimeout(timer);const result=refreshPert();
  if(result.ok){toast(`Proyecto calculado: ${new Intl.NumberFormat('es-CO',{maximumFractionDigits:2}).format(result.duration)} ${initial.pert.unit}.`);$('p-results').scrollIntoView({behavior:'smooth',block:'start'});}
  else{toast('Corrige los errores indicados para calcular el proyecto.');$('pert-error').scrollIntoView({behavior:'smooth',block:'center'});}
  return;
 }
 if(action==='add'){
  if(rows.length>=PERT_MAX_ROWS){toast(`El ejercicio admite hasta ${PERT_MAX_ROWS} actividades.`);return;}
  rows.push({codigo:nextPertCode(rows),nombre:'Nueva actividad',predecesoras:'',a:'1',m:'2',b:'3'});save();renderPage(false);
  document.querySelector(`[data-pert-row="${rows.length-1}"][data-pert-field="codigo"]`)?.focus();return;
 }
 if(action==='delete'){
  const dependents=pertDependents(state.pert,index);
  if(dependents.length){pertPending={index};notice.innerHTML=pertDeleteNotice(state.pert,index,dependents);notice.querySelector('[data-pert-action="cancel-delete"]')?.focus();return;}
  rows.splice(index,1);pertPending=null;save();renderPage(false);toast('Actividad eliminada.');focusPertAfterDelete(index);return;
 }
 if(action==='confirm-delete'){
  if(!pertPending||pertPending.index!==index||!rows[index])return;
  const code=normalizeCode(rows[index].codigo),touched=pertDependents(state.pert,index);
  for(const {index:i} of touched)rows[i].predecesoras=parsePredecessors(rows[i].predecesoras).filter(c=>c!==code).join(', ');
  rows.splice(index,1);pertPending=null;save();renderPage(false);
  toast(`${code} eliminada y quitada de las predecesoras de ${touched.map(t=>t.code).join(', ')}.`);focusPertAfterDelete(index);return;
 }
 if(action==='cancel-delete'){pertPending=null;notice.innerHTML='';return;}
 if(action==='example'||action==='reset'){
  state.pert=freshPert();pertPending=null;save();renderPage(false);
  toast(action==='example'?'Se cargó el ejemplo de Claro (módulo PERT y CPM).':'Se restauraron los valores originales de PERT y CPM.');
  document.querySelector(`[data-pert-action="${action}"]`)?.focus();
 }
}
function navigate(next){if(!labels[next])return;page=next;renderPage();}
document.addEventListener('input',event=>{
 const pertInput=event.target.closest('[data-pert-field]');if(pertInput){onPertInput(pertInput);return;}
 const queueInput=event.target.closest('[data-queue-path]');if(queueInput){state.queue[queueInput.dataset.queuePath]=Number(queueInput.value);save();controller?.abort();clearTimeout(timer);timer=setTimeout(()=>queueInput.dataset.queuePath==='hours_per_day'&&queueCsvText?parseQueueCsv(queueCsvText):calculateQueue(),180);return;}
 const input=event.target;if(!input.matches('[data-path]'))return;
 const isDecision=page==='decisiones',source=isDecision?state.decisions:{matrix:state.games[state.gameKind]};
 let value=input.value;
 if(!input.dataset.text){const normalized=value.trim().replace(',','.');value=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)?Number(normalized):null;}
 setPath(source,input.dataset.path,value);if(input.dataset.path==='alpha')$('alpha-output').textContent=fmt(value);
 save();markEdited();invalidate();timer=setTimeout(calculate,180);
});
document.addEventListener('click',event=>{
 const pertAction=event.target.closest('[data-pert-action]');if(pertAction){onPertAction(pertAction);return;}
 const nav=event.target.closest('[data-page]');if(nav){const target=nav.dataset.page;if(location.hash==='#'+target)navigate(target);else location.hash=target;return;}
 const mode=event.target.closest('[data-mode]');if(mode){state.decisions.mode=mode.dataset.mode;save();renderPage(false);return;}
 const game=event.target.closest('[data-game]');if(game){state.gameKind=game.dataset.game;save();renderPage(false);return;}
 const queueMode=event.target.closest('[data-queue-mode]');if(queueMode){state.queue.mode=queueMode.dataset.queueMode;save();renderPage(false);return;}
 const queueScenario=event.target.closest('[data-queue-scenario]');if(queueScenario){const i=Number(queueScenario.dataset.queueScenario),scenario=queueContext?[{arrival_rate_per_hour:queueContext.quantiles.p25},{arrival_rate_per_hour:queueContext.quantiles.p50},{arrival_rate_per_hour:queueContext.quantiles.p75}][i]:initial.queue.scenarios[i];if(scenario){state.queue.arrival_rate_per_hour=scenario.arrival_rate_per_hour;if(scenario.average_service_minutes)state.queue.average_service_minutes=scenario.average_service_minutes;if(scenario.servers)state.queue.servers=scenario.servers;save();renderPage(false);}return;}
 if(event.target.closest('#queue-parse')){parseQueueCsv();return;}
 if(event.target.closest('#queue-export')){exportQueue();return;}
 const reset=event.target.closest('[data-reset]');if(reset){const which=reset.dataset.reset;if(which==='decisions')state.decisions=clone(initial.decisions);else state.games[which]=clone(initial.games[which]);save();renderPage(false);toast('Se restauraron los valores originales de este bloque.');return;}
 if(event.target.closest('#counts-priors')){
  const counts=state.decisions.counts;if(counts.flat().some(v=>!Number.isInteger(v)||v<0)||counts.some(row=>row.reduce((a,b)=>a+b,0)===0)){toast('Primero introduce conteos enteros válidos por estado.');return;}
  const total=counts.flat().reduce((a,b)=>a+b,0);state.decisions.probabilities=counts.map(row=>row.reduce((a,b)=>a+b,0)/total);save();renderPage(false);toast('Las previas ahora corresponden a los conteos actuales.');
 }
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(labels[next])navigate(next);});

const tourSteps={
 decisiones:[['d-context','El problema','Claro elige entre tres alternativas; la demanda es incierta.'],['d-matrix','De ingresos a pagos','Distingue el ingreso observado de los porcentajes supuestos. Puedes editar mientras expones.'],['d-criteria','No hay un criterio universal','Compara el criterio optimista (Maximax), el pesimista (Maximin) y mínimo arrepentimiento máximo (Savage). El taller adopta este último.'],['d-risk','Ahora conocemos probabilidades','Explica el valor esperado, el arrepentimiento y el límite de información perfecta.'],['d-counts','Una señal del pasado','F/D describe el crecimiento previo. Cambia los conteos para experimentar.'],['d-bayes','Actualiza y decide de nuevo','Bayes produce decisiones condicionadas y el valor de la señal.'],['d-history','Cierra con evidencia','Consulta los trimestres y las limitaciones de los supuestos.']],
 juegos:[['g-context','Dos jugadores, un índice','Claro maximiza y Tigo minimiza. La unidad es miles de líneas relativas.'],['g-matrix','Distingue ambos escenarios','La matriz histórica y la hipotética conservan entradas independientes.'],['g-equilibrium','Encuentra el punto de silla','Busca el mínimo de fila que también es máximo de columna; revisa la dominancia.'],['g-mixed','Puras o mixtas según la matriz','Si no hay punto de silla, la mezcla iguala las opciones del rival.'],['g-history','Vuelve a los trimestres','Las etiquetas provienen de promedios móviles propios, no de campañas identificadas.']],
 colas:[['q-scope','Un grupo fijo','El modelo no mezcla operadores, servicios ni canales.'],['q-input','Entradas trazables','Distingue parámetros estimados de datos CRC agregados y resultados calculados.'],['q-results','Erlang C','Revisa utilización, espera y nivel de servicio junto con cada sustitución.'],['q-sensitivity','Sensibilidad','Compara c=2…5 sin convertir el resultado en una recomendación económica.'],['q-trace','Supuestos y fuentes','Cierra con límites, catálogo compartido y exportación.']],
 'pert-cpm':[['p-scope','Un ejercicio académico','Las actividades y duraciones son supuestos para estudiar PERT y CPM; la unidad son semanas.'],['p-input','Tres tiempos por actividad','Edita a, m y b y las predecesoras; el proyecto se recalcula y los errores se señalan junto a la fila.'],['p-results','Duración y ruta crítica','TE = (a + 4m + b) / 6; recorrido hacia adelante y hacia atrás; holgura cero marca las actividades críticas.'],['p-network','Red AON','Cada nodo muestra ES | EF, la actividad y LS | LF; las flechas rojas forman la ruta crítica.'],['p-explain','Procedimiento y fuentes','Repasa las fórmulas y la trazabilidad del ejercicio.']],
 fuentes:[['s-process','La cadena de evidencia','Distingue dato, clasificación, supuesto y resultado.'],['s-sources','Fuentes descargables','Cada archivo explica campos, transformación, periodo y resultado.'],['s-precision','Redondear solo al presentar','Compara Excel y reconstrucción sin ocultar diferencias.'],['s-limits','Alcance de los resultados','Son ejercicios dentro de muestra; no prueban causalidad ni predicción externa.']],
 contexto:[['c-company','El operador y sus registros','Abonados son suscripciones, no personas únicas.'],['c-market','Dos preguntas de investigación','Demanda y competencia se representan con modelos distintos.'],['c-boundaries','Qué se puede afirmar','Expón el resultado junto con sus supuestos y límites.']]
};
function updateTour(scroll=true){
 document.querySelectorAll('.tour-focus').forEach(el=>el.classList.remove('tour-focus'));
 $('tour').hidden=!tourActive;$('tour-toggle').setAttribute('aria-pressed',String(tourActive));if(!tourActive)return;
 const steps=tourSteps[page],step=steps[tourIndex];$('tour-count').textContent=`${String(tourIndex+1).padStart(2,'0')} / ${String(steps.length).padStart(2,'0')}`;$('tour-title').textContent=step[1];$('tour-copy').textContent=step[2];$('tour-prev').disabled=tourIndex===0;$('tour-next').textContent=tourIndex===steps.length-1?'Finalizar ✓':'Siguiente →';
 const target=$(step[0]);if(target){target.classList.add('tour-focus');if(scroll)target.scrollIntoView({behavior:'smooth',block:'start'});}
}
$('tour-toggle').addEventListener('click',()=>{tourActive=!tourActive;tourIndex=0;updateTour();});
$('tour-close').addEventListener('click',()=>{tourActive=false;updateTour();});
$('tour-prev').addEventListener('click',()=>{if(tourIndex>0)tourIndex--;updateTour();});
$('tour-next').addEventListener('click',()=>{if(tourIndex===tourSteps[page].length-1)tourActive=false;else tourIndex++;updateTour();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&tourActive){tourActive=false;updateTour();}});
async function start(){
 try{const response=await fetch('/api/initial');if(!response.ok)throw new Error('No se pudieron cargar los datos iniciales.');initial=await response.json();state=loadState();page=labels[location.hash.slice(1)]?location.hash.slice(1):'decisiones';renderPage();}
 catch(error){$('main').innerHTML=`<div class="error" role="alert">No se pudo abrir el laboratorio. ${esc(error.message)}</div><button class="button" id="retry">Volver a intentar</button>`;$('retry').onclick=start;}
}
start();
