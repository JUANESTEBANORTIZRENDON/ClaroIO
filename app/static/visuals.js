export const fmt = (value, digits = 2) => value == null ? 'No aplica' : new Intl.NumberFormat('es-CO', {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(value);
export const pct = (value, digits=2) => value == null ? 'No aplica' : `${fmt(value*100,digits)} %`;
export const esc = value => String(value).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const colors = ['#d9272e','#4779be','#a2acb9'];
export const states = ['Bajo','Medio','Alto'];
let charts=[];
export function clearCharts(){charts.forEach(c=>c.destroy());charts=[];}
export function chart(id, type, labels, datasets, yTitle, extra={}) {
 const el=document.getElementById(id); if(!el)return;
 if(!window.Chart){el.parentElement.innerHTML='<p class="empty-chart">Gráfico no disponible. Los valores exactos están en las tablas.</p>';return;}
 Chart.defaults.font.family='Inter, Segoe UI, Arial, sans-serif';Chart.defaults.font.size=10;Chart.defaults.color='#868d97';
 charts.push(new Chart(el,{type,data:{labels,datasets},options:{responsive:true,maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},plugins:{legend:{position:'bottom',labels:{usePointStyle:true,pointStyle:'circle',boxWidth:6,padding:19,font:{size:9}}},tooltip:{callbacks:{label:c=>`${c.dataset.label}: ${fmt(c.parsed.y ?? c.parsed,3)}`}}},scales:{x:{grid:{display:false},border:{display:false},ticks:{font:{size:9}}},y:{beginAtZero:true,title:{display:true,text:yTitle,font:{size:9}},border:{display:false},grid:{color:'#eff1f4'},ticks:{callback:v=>fmt(v,1)}}},...extra}}));
}
const short = value => value.length > 25 ? value.slice(0,24)+'…' : value;
function line(x1,y1,x2,y2,best=false){return `<path class="connector ${best?'best-line':''}" d="M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}"/>`;}
function node(x,y,w,h,title,subtitle,best=false){return `<g><rect class="node ${best?'chosen':''}" x="${x}" y="${y-h/2}" width="${w}" height="${h}" rx="7"/><text class="node-title" x="${x+12}" y="${y-3}">${esc(title)}</text><text x="${x+12}" y="${y+14}">${esc(subtitle)}</text></g>`;}
export function uncertaintyTree(result, model){
 const rootY=235, strategyY=[85,235,385], parts=[];
 parts.push(node(8,rootY,145,58,'Claro decide','Sin probabilidades'));
 model.names.forEach((name,i)=>{
  const y=strategyY[i], selected=result.criteria.savage.winners.includes(i);
  parts.push(line(153,rootY,235,y,selected));
  parts.push(node(235,y,235,54,`d${i+1} · ${short(name)}`,selected?'Elegida por mínimo arrepentimiento máximo':'Alternativa',selected));
  states.forEach((state,j)=>{
   const stateY=y+(j-1)*42;
   parts.push(line(470,y,575,stateY,selected));
   parts.push(node(575,stateY,270,35,state,`Pago: ${fmt(result.matrix[i][j],3)} mM COP`,false));
  });
 });
 return `<div class="tree-scroll compact-tree"><svg class="decision-tree" viewBox="0 0 865 470" role="img" aria-label="Árbol de decisión bajo incertidumbre con tres alternativas, estados y pagos dinámicos"><title>Árbol bajo incertidumbre. La alternativa resaltada cambia según el mínimo arrepentimiento máximo (Savage).</title>${parts.join('')}</svg></div><div class="tree-legend"><span>Rama y alternativa elegida por mínimo arrepentimiento máximo (Savage)</span><span>Los estados no tienen probabilidades asignadas</span></div>`;
}

export function signalDecisionTree(result, model){
 const rootY=220, signalY=[105,335], parts=[];
 parts.push(node(8,rootY,145,58,'Observar señal','Histórica F / D'));
 result.signals.forEach((signal,index)=>{
  const y=signalY[index], winner=signal.winners?.[0], hasChoice=winner!==undefined;
  parts.push(line(153,rootY,235,y,hasChoice));
  parts.push(node(235,y,190,54,`Señal ${signal.name}`,`P(${signal.name}) = ${pct(signal.probability)}`));
  if(!hasChoice){
   parts.push(line(425,y,545,y));
   parts.push(node(545,y,285,52,'Decisión no definida','Señal imposible: P = 0'));
   return;
  }
  parts.push(line(425,y,545,y,true));
  parts.push(node(545,y,285,54,`d${winner+1} · ${short(model.names[winner])}`,`VE | ${signal.name} = ${fmt(signal.expected[winner],3)} mM COP`,true));
 });
 return `<div class="tree-scroll compact-tree"><svg class="decision-tree" viewBox="0 0 850 440" role="img" aria-label="Árbol simplificado con señal histórica F y D y la mejor alternativa condicionada"><title>Árbol con señal histórica. Las ramas rojas muestran la mejor decisión después de cada señal.</title>${parts.join('')}</svg></div><div class="tree-legend"><span>Decisión con mayor valor esperado condicionado</span><span>La tabla Bayes contiene los estados posteriores</span></div>`;
}
export function heatmap(result){
 const flat=result.matrix.flat(),min=Math.min(...flat),max=Math.max(...flat);
 return `<div class="heatmap"><div>Claro ↓ / Tigo →</div><div>Respuesta<br>intensiva</div><div>Respuesta<br>selectiva</div>${result.matrix.map((row,i)=>`<div>Captación<br>${i===0?'expansiva':'focalizada'}</div>${row.map((v,j)=>{
 const intensity=max===min?.15:.05+.32*(v-min)/(max-min),saddle=result.saddles.some(([r,c])=>r===i&&c===j),rowMin=v===result.row_min[i],colMax=v===result.col_max[j];
 return `<div class="heatcell ${saddle?'saddle':''}" style="background:rgba(217,39,46,${intensity})">${fmt(v)}<small>${saddle?'◎ Punto de silla':'Pago de Claro'}</small></div>`;
 }).join('')}`).join('')}</div><p class="legend-caption">Mayor intensidad = mayor pago de Claro. Los puntos de silla tienen borde y etiqueta.</p>`;
}
