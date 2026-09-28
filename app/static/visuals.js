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
export function decisionTree(result, model, withSignal=false){
 let elements=[], height=withSignal?800:470;
 const rootY=height/2;
 elements.push(node(5,rootY,130,56,withSignal?'Observar señal':'Claro decide',withSignal?`VE = ${fmt(result.signal_value)}`:`VE = ${fmt(Math.max(...result.expected))}`,true));
 if(!withSignal){
  model.names.forEach((name,i)=>{
   const y=85+i*150, best=result.winners.includes(i);
   elements.push(line(135,rootY,215,y,best),node(215,y,230,52,`d${i+1} · ${short(name)}`,`VE = ${fmt(result.expected[i],3)} mM COP`,best));
   states.forEach((s,j)=>{const sy=y+(j-1)*44;elements.push(line(445,y,570,sy,best),node(570,sy,290,38,`${s} · P = ${pct(model.probabilities[j])}`,`Pago: ${fmt(result.matrix[i][j],3)} mM COP`,false));});
  });
 }else{
  result.signals.forEach((signal,s)=>{
   const y=200+s*390;
   elements.push(line(135,rootY,165,y),node(165,y,130,54,`Señal ${signal.name}`,`P = ${pct(signal.probability)}`));
   if(!signal.posterior){elements.push(node(330,y,350,50,'Señal imposible','P = 0; posterior y decisión no definidos.'));return;}
   model.names.forEach((name,i)=>{
    const dy=y+(i-1)*120,best=signal.winners.includes(i);
    elements.push(line(295,y,340,dy,best),node(340,dy,235,48,`d${i+1} · ${short(name)}`,`VE | ${signal.name} = ${fmt(signal.expected[i],3)}`,best));
    states.forEach((st,j)=>{const sy=dy+(j-1)*36;elements.push(line(575,dy,650,sy,best),node(650,sy,265,32,`${st} · ${pct(signal.posterior[j])}`,`${fmt(result.matrix[i][j],3)} mM COP`));});
   });
  });
 }
 return `<div class="tree-scroll"><svg class="decision-tree" viewBox="0 0 ${withSignal?940:890} ${height}" role="img" aria-label="Árbol ${withSignal?'con señal F y D y todas las alternativas':'sin información adicional'}, probabilidades y pagos actuales"><title>Árbol de decisión dinámico. Las ramas rojas y nodos resaltados señalan las decisiones óptimas.</title>${elements.join('')}</svg></div><div class="tree-legend"><span>Decisión óptima: borde y rama resaltados</span><span>Pagos en mM COP</span></div>`;
}

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
