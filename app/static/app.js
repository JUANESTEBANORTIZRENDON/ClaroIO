import {fmt,esc,clearCharts} from './visuals.js';
import {decisionsPage,renderDecisionResults,badge} from './decisions.js';
import {gamePage,renderGameResults} from './games.js';
import {sourcesPage,contextPage,drawContext} from './references.js';

const labels={decisiones:'Teoría de decisiones',juegos:'Teoría de juegos',fuentes:'Referencias y fuentes',contexto:'Claro y contexto empresarial'};
const key='claro-io-session-v1';
let initial,state,page='decisiones',requestVersion=0,controller,timer,lastDecision,tourIndex=0,tourActive=false;
const clone=x=>structuredClone(x);
const $=id=>document.getElementById(id);
const getPath=(obj,path)=>path.split('.').reduce((a,k)=>a?.[k],obj);
function setPath(obj,path,value){const parts=path.split('.');let target=obj;for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=value;}
function save(){try{sessionStorage.setItem(key,JSON.stringify(state));}catch{toast('El navegador no permite guardar la sesión. Puedes continuar en esta página.');}}
function toast(text){$('toast').textContent=text;$('toast').hidden=false;setTimeout(()=>$('toast').hidden=true,3500);}
function loadState(){
 const fresh={version:1,decisions:clone(initial.decisions),games:clone(initial.games),gameKind:'historical'};
 try{
  const saved=JSON.parse(sessionStorage.getItem(key));
  if(saved?.version===1&&saved.decisions?.matrix?.length===3&&saved.decisions?.names?.length===3&&saved.decisions?.response?.length===3&&saved.decisions?.counts?.length===3&&saved.decisions?.probabilities?.length===3&&saved.decisions?.base?.length===3&&saved.decisions?.costs?.length===3&&['direct','parameters'].includes(saved.decisions.mode)&&saved.games?.historical?.length===2&&saved.games?.hypothetical?.length===2){
   fresh.decisions=saved.decisions;fresh.games=saved.games;fresh.gameKind=['historical','hypothetical'].includes(saved.gameKind)?saved.gameKind:'historical';
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
function renderPage(scroll=true){
 controller?.abort();requestVersion++;clearTimeout(timer);clearCharts();lastDecision=null;
 document.querySelectorAll('[data-page]').forEach(button=>{button.classList.toggle('active',button.dataset.page===page);button.setAttribute('aria-current',button.dataset.page===page?'page':'false');});
 $('breadcrumb').textContent=labels[page];document.title=`${labels[page]} · Claro laboratorio IO`;
 $('main').innerHTML=page==='decisiones'?decisionsPage(state.decisions,initial):page==='juegos'?gamePage(state.games[state.gameKind],state.gameKind,initial):page==='fuentes'?sourcesPage(initial):contextPage(initial);
 if(page==='decisiones'||page==='juegos'){markEdited();invalidate();calculate();}else if(page==='contexto')drawContext(initial);
 if(scroll)window.scrollTo({top:0,behavior:'instant'});
 if(tourActive){tourIndex=0;updateTour();}
}
function navigate(next){if(!labels[next])return;page=next;renderPage();}
document.addEventListener('input',event=>{
 const input=event.target;if(!input.matches('[data-path]'))return;
 const isDecision=page==='decisiones',source=isDecision?state.decisions:{matrix:state.games[state.gameKind]};
 let value=input.value;
 if(!input.dataset.text){const normalized=value.trim().replace(',','.');value=/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(normalized)?Number(normalized):null;}
 setPath(source,input.dataset.path,value);if(input.dataset.path==='alpha')$('alpha-output').textContent=fmt(value);
 save();markEdited();invalidate();timer=setTimeout(calculate,180);
});
document.addEventListener('click',event=>{
 const nav=event.target.closest('[data-page]');if(nav){const target=nav.dataset.page;if(location.hash==='#'+target)navigate(target);else location.hash=target;return;}
 const mode=event.target.closest('[data-mode]');if(mode){state.decisions.mode=mode.dataset.mode;save();renderPage(false);return;}
 const game=event.target.closest('[data-game]');if(game){state.gameKind=game.dataset.game;save();renderPage(false);return;}
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
