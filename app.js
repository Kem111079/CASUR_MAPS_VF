
const GEOJSON_URL = './data/poligonos_casur.geojson';
const META_URL = './data/metadata.json';
const CASUR_APP_VERSION = 'V21.3';
const METRICAS_URL = './data/metricas_lote.json';
const HISTORICO_URL = './historico.html';
let map, polygonsLayer, polygonsHaloLayer, labelsLayer, selectedLayer, DATA, META, METRICAS, INITIAL_BOUNDS;
let activeBaseMapName = 'Mapa claro';
let polygonVisualPreference = 'auto';
let deferredInstallPrompt = null;
let representativeLabels = [];
let selectedKey = '';
let selectedProps = null;
let measurementLayer, measureMode = null, measurePoints = [], measureLine = null, measurePolygon = null, measureLabels = [];
let measureToolbarHidden = false;

// V5.1 · GPS inteligente silencioso: perfiles para campo/vehículo y UX no invasiva.
const GPS_PROFILES = {
  preciso: { label:'Preciso', radiusM:25, autoAccM:10, tieM:8, stableReadings:2, speedWarnMps:2.5 },
  campo: { label:'Campo', radiusM:50, autoAccM:22, tieM:12, stableReadings:3, speedWarnMps:4.0 },
  vehiculo: { label:'Vehículo/Campo', radiusM:75, autoAccM:30, tieM:18, stableReadings:3, speedWarnMps:5.5 }
};
let gpsCandidateCache = [];
let lastAutoCandidateKey = '';
let autoCandidateCount = 0;
let lastGpsFix = null;

const $ = (id) => document.getElementById(id);
const fmt = v => (v === null || v === undefined || v === '' || Number.isNaN(v)) ? '—' : String(v);
const nf = new Intl.NumberFormat('es-NI', {maximumFractionDigits:2});

window.__CASUR_APP_SCRIPT_LOADED = true;
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', init, {once:true});
} else {
  init();
}

async function init(){
  setupInstallFlow();
  registerServiceWorker();
  try{
    const [geo, meta, metricas] = await Promise.all([
      fetch(GEOJSON_URL).then(r=>{ if(!r.ok) throw new Error('No se pudo cargar GeoJSON'); return r.json(); }),
      fetch(META_URL).then(r=>r.ok?r.json():null).catch(()=>null),
      fetch(METRICAS_URL).then(r=>r.ok?r.json():null).catch(()=>null)
    ]);
    DATA = geo; META = meta || {}; METRICAS = metricas || {lotes:{}};
    precomputeBboxes();
    initMap();
    populatePanels();
    bindUi();
    hideLoader();
  }catch(err){
    console.error(err);
    $('loaderText').textContent = 'No se pudo cargar el mapa: ' + err.message + '. Verifique que el ZIP esté descomprimido completo y que se abra desde localhost/HTTPS.';
  }
}

function hideLoader(){ setTimeout(()=>{ const l=$('loader'); if(l) l.style.display='none'; }, 250); }

// V13 · Corrección crítica de campo: pre-computar bboxes para que featureContainsPoint() pueda confirmar "dentro de un lote".
function precomputeBboxes(){
  if(!DATA || !Array.isArray(DATA.features)) return;
  let computed=0, available=0;
  DATA.features.forEach(f=>{
    if(!f) return;
    if(Array.isArray(f.bbox) && f.bbox.length>=4){ available++; return; }
    const g=f.geometry; if(!g || !g.coordinates) return;
    let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
    const scan=(c)=>{
      if(!Array.isArray(c)) return;
      if(typeof c[0]==='number' && typeof c[1]==='number'){
        if(c[0]<x0) x0=c[0]; if(c[1]<y0) y0=c[1];
        if(c[0]>x1) x1=c[0]; if(c[1]>y1) y1=c[1];
      }else c.forEach(scan);
    };
    scan(g.coordinates);
    if(x0<Infinity){ f.bbox=[x0,y0,x1,y1]; computed++; available++; }
  });
  console.info(`[CASUR V21.3] Bboxes disponibles: ${available}/${DATA.features.length} · calculados en carga: ${computed}`);
}

function initMap(){
  map = L.map('map', { zoomControl:true, preferCanvas:true });
  map.createPane('casurHaloPane');
  map.getPane('casurHaloPane').style.zIndex = 395;
  map.getPane('casurHaloPane').style.pointerEvents = 'none';
  map.createPane('casurPolygonPane');
  map.getPane('casurPolygonPane').style.zIndex = 410;
  const osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom:22, attribution:'© OpenStreetMap' });
  const sat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom:22, attribution:'Tiles © Esri' });
  const blank = L.tileLayer('', { attribution:'' });
  osm.addTo(map);

  polygonsHaloLayer = L.geoJSON(DATA, {
    pane:'casurHaloPane',
    interactive:false,
    style: haloStyle
  });

  polygonsLayer = L.geoJSON(DATA, {
    pane:'casurPolygonPane',
    style: (feature)=> typeof smartStyle === 'function' ? smartStyle(feature) : baseStyle(feature),
    onEachFeature: (feature, layer)=>{
      feature._casurLayer = layer;
      layer.on('click', (e)=>{ if(measureMode){ if(e) L.DomEvent.stopPropagation(e); addMeasurePoint(e.latlng); return; } selectFeature(feature, layer, false); });
      layer.on('mouseover', ()=>{ if(layer !== selectedLayer) layer.setStyle(hoverStyle()); });
      layer.on('mouseout', ()=>{ if(layer !== selectedLayer) layer.setStyle(smartStyle(layer.feature)); });
    }
  }).addTo(map);
  labelsLayer = L.layerGroup().addTo(map);
  buildRepresentativeLabels();
  map.on('zoomend moveend', updateLabels);
  INITIAL_BOUNDS = polygonsLayer.getBounds();
  if (INITIAL_BOUNDS.isValid()) map.fitBounds(INITIAL_BOUNDS, {padding:[20,20]});
  updateLabels();
  measurementLayer = L.layerGroup().addTo(map);
  map.on('click', handleMeasurementMapClick);
  const casurLayerControl = L.control.layers({'Mapa claro':osm,'Satélite':sat,'Sin mapa base':blank},{'Polígonos CASUR':polygonsLayer,'Etiquetas CodLote':labelsLayer},{collapsed:true}).addTo(map);
  ensureLayerControlUsable();
  map.on('baselayerchange', (e)=>{ activeBaseMapName = e.name || 'Mapa claro'; updatePolygonVisualMode(); });
  map.on('overlayadd', (e)=>{ if(e.layer===polygonsLayer) updatePolygonVisualMode(); });
  map.on('overlayremove', (e)=>{ if(e.layer===polygonsLayer && polygonsHaloLayer && map.hasLayer(polygonsHaloLayer)) map.removeLayer(polygonsHaloLayer); });
  addLegend();
  updatePolygonVisualMode();
  map.on('dragstart',()=>{ following=false; updateFollowUi?.(); });
  map.on('zoomend moveend', ()=>{ if(typeof applyMapRotation === 'function') requestAnimationFrame(()=>applyMapRotation(lastHeadingDeg)); });
}


function ensureLayerControlUsable(){
  // V21.1 · El selector de capas debe estar activo desde el inicio y por encima de cualquier overlay.
  setTimeout(()=>{
    try{
      const ctrls = document.querySelectorAll('.leaflet-control-layers, .leaflet-top.leaflet-right, .leaflet-control-container');
      ctrls.forEach(el=>{
        el.style.pointerEvents = 'auto';
        el.style.zIndex = '1600';
      });
      const layers = document.querySelector('.leaflet-control-layers');
      if(layers){
        layers.style.display = 'block';
        layers.style.visibility = 'visible';
      }
      if(map) map.invalidateSize({animate:false});
    }catch(err){ console.warn('[CASUR V21.1] No se pudo reforzar selector de capas', err); }
  }, 180);
}

function baseRawStyle(feature){ return { color:'#002f5f', weight:.75, opacity:.72, fillColor:colorForFinca(feature.properties.Codfinca), fillOpacity:.28 }; }
function baseStyle(feature){ return applyVisualPolygonStyle(baseRawStyle(feature), feature, 'base'); }
function hoverStyle(){ return applyVisualPolygonStyle({ color:'#f4c542', weight:3, opacity:1, fillOpacity:.42 }, null, 'hover'); }
function selectedStyle(){ return applyVisualPolygonStyle({ color:'#f4c542', weight:4, opacity:1, fillColor:'#f4c542', fillOpacity:.45 }, null, 'selected'); }
function colorForFinca(v){
  const palette=['#c9a227','#1f7a4d','#0d5d91','#6b7280','#a16207','#0f766e','#475569','#854d0e','#0369a1','#365314'];
  const s=String(v||'0'); let h=0; for(let i=0;i<s.length;i++) h=(h*31+s.charCodeAt(i))>>>0; return palette[h%palette.length];
}

// V20 · Estilo adaptativo para vista satélite y alto contraste.
function getEffectivePolygonVisualMode(){
  const pref = polygonVisualPreference || $('polygonVisualMode')?.value || 'auto';
  if(pref === 'normal' || pref === 'satellite' || pref === 'highContrast') return pref;
  if(/sat[ée]lite|imagery|esri/i.test(activeBaseMapName||'')) return 'satellite';
  if(/sin mapa/i.test(activeBaseMapName||'')) return 'highContrast';
  return 'normal';
}
function bindVisualModeUi(){
  const sel=$('polygonVisualMode');
  if(!sel) return;
  polygonVisualPreference = sel.value || 'auto';
  sel.addEventListener('change', ()=>{ polygonVisualPreference = sel.value || 'auto'; updatePolygonVisualMode(); });
  updatePolygonVisualMode();
}
function applyVisualPolygonStyle(style, feature, kind='base'){
  const mode = getEffectivePolygonVisualMode();
  const st = Object.assign({}, style);
  if(mode === 'satellite') {
    st.weight = Math.max(Number(st.weight)||0, kind==='selected'?4.5:2.6);
    st.opacity = 1;
    st.fillOpacity = kind==='selected' ? Math.max(st.fillOpacity||0, .36) : Math.min(Math.max(st.fillOpacity||0, .14), .38);
  } else if(mode === 'highContrast') {
    st.weight = Math.max(Number(st.weight)||0, kind==='selected'?5:3.2);
    st.opacity = 1;
    st.fillOpacity = kind==='selected' ? Math.max(st.fillOpacity||0, .42) : Math.min(Math.max(st.fillOpacity||0, .18), .46);
  }
  return st;
}
function haloStyle(){
  const mode = getEffectivePolygonVisualMode();
  if(mode === 'satellite') return { color:'#ffffff', weight:6, opacity:.92, fillOpacity:0, interactive:false };
  if(mode === 'highContrast') return { color:'#0b1020', weight:7, opacity:.88, fillOpacity:0, interactive:false };
  return { color:'#ffffff', weight:0, opacity:0, fillOpacity:0, interactive:false };
}
function updatePolygonVisualMode(){
  const mode = getEffectivePolygonVisualMode();
  document.body.classList.toggle('map-visual-satellite', mode === 'satellite');
  document.body.classList.toggle('map-visual-highcontrast', mode === 'highContrast');
  const hint=$('polygonVisualHint');
  if(hint){
    hint.textContent = mode === 'satellite' ? 'Modo satélite activo: borde con halo blanco, línea más gruesa y etiquetas de alto contraste.' : mode === 'highContrast' ? 'Modo alto contraste activo: borde reforzado para máxima visibilidad en campo.' : 'Modo normal activo: estilo limpio para mapa claro.';
  }
  if(polygonsHaloLayer){
    polygonsHaloLayer.eachLayer(l=>l.setStyle(haloStyle(l.feature)));
    const needHalo = mode !== 'normal' && map && polygonsLayer && map.hasLayer(polygonsLayer);
    if(needHalo && !map.hasLayer(polygonsHaloLayer)) polygonsHaloLayer.addTo(map);
    if(!needHalo && map.hasLayer(polygonsHaloLayer)) map.removeLayer(polygonsHaloLayer);
  }
  if(polygonsLayer){
    polygonsLayer.eachLayer(layer=>{
      if(layer===selectedLayer) layer.setStyle(selectedStyle());
      else layer.setStyle(smartStyle(layer.feature));
    });
  }
  updateLabels?.();
}
function addLegend(){
  const legend = L.control({position:'bottomleft'});
  legend.onAdd = function(){
    const div = L.DomUtil.create('div','legend');
    div.innerHTML = '<b>CASUR Maps</b><div class="line"><span class="swatch"></span><span>Polígonos del shape</span></div><div class="line"><span class="swatch" style="background:#0057ff"></span><span>Mi ubicación GPS</span></div><div class="line"><span class="swatch" style="background:#f4c542"></span><span>Lote activo / confirmado</span></div><div class="line label-line"><span class="codlote-label">353A</span><span>Etiqueta CodLote</span></div>';
    return div;
  };
  legend.addTo(map);
}

function normalizeCode(v){ return String(v ?? '').trim(); }
function displayCode(v){ return normalizeCode(v).toUpperCase(); }
function getCodLote(p){ return normalizeCode(p.CodSuerte || (p.Codfinca && p.Suerte ? String(p.Codfinca)+String(p.Suerte) : '') || p.LLAVE_LOTE || p.LLAVE_TABL || p.ID_POLY); }
function getFeatureKey(p){ return getCodLote(p) || normalizeCode(p.ID_POLY); }
function getTablon(p){ return normalizeCode(p.Tablon || p.LLAVE_TABL || ''); }
function urlFor(module,p){
  const codlote=getCodLote(p), codfinca=normalizeCode(p.Codfinca), suerte=normalizeCode(p.Suerte), llave=normalizeCode(p.LLAVE_TABL || p.LLAVE_LOTE || '');
  const params = new URLSearchParams({from:'map', modulo:module, codlote, codfinca, suerte, llave});
  return HISTORICO_URL + '?' + params.toString();
}
function openModule(module){
  if(!selectedLayer){ alert('Seleccione primero un polígono.'); return; }
  location.href = urlFor(module, selectedLayer.feature.properties);
}
window.openModule = openModule;
window.zoomSelected = zoomSelected;
window.useGpsCandidate = useGpsCandidate;
window.centerGps = centerGps;
window.setHeadingMode = setHeadingMode;

function populatePanels(){
  const fincas = [...new Set(DATA.features.map(f=>f.properties.Codfinca).filter(v=>v!==null && v!==undefined && v!==''))].sort((a,b)=>String(a).localeCompare(String(b),'es',{numeric:true}));
  if($('polyCount')) $('polyCount').textContent = nf.format(DATA.features.length);
  if($('fincaCount')) $('fincaCount').textContent = nf.format(fincas.length);
  if($('fieldCount')) $('fieldCount').textContent = (META.campos_publicados || Object.keys(DATA.features[0]?.properties || {})).length;
  if($('crsInfo') && META.crs_publicacion) $('crsInfo').textContent = META.crs_publicacion;
  const sel = $('fincaFilter');
  fincas.forEach(v=>{ const opt=document.createElement('option'); opt.value=v; opt.textContent='Codfinca ' + v; sel.appendChild(opt); });
  updateFieldPanel();
}

function bindUi(){
  $('fincaFilter').addEventListener('change', applyFilters);
  $('btnSearch').addEventListener('click', searchFeature);
  $('searchBox').addEventListener('keydown', e=>{ if(e.key==='Enter') searchFeature(); });
  $('btnReset').addEventListener('click', resetView);
  $('btnLocate').addEventListener('click', ()=>{ following=true; closePanel(true); startLocation(); });
  $('btnFollow').addEventListener('click', ()=>{ following=true; closePanel(true); if(userMarker) map.setView(userMarker.getLatLng(), Math.max(map.getZoom(),17)); });
  $('btnStop').addEventListener('click', stopLocation);
  $('btnNorthUp')?.addEventListener('click', ()=>setHeadingMode('north'));
  $('btnCourseUp')?.addEventListener('click', ()=>setHeadingMode('course'));
  $('mobileToggle').addEventListener('click', togglePanel);
  $('panelCloseBtn')?.addEventListener('click', ()=>closePanel(true));
  $('btnPanelFloating')?.addEventListener('click', togglePanel);
  $('btnGpsFloating')?.addEventListener('click', ()=>{ following=true; closePanel(true); startLocation(); });
  $('installPwaBtn').addEventListener('click', installPwa);
  $('installPwaToast').addEventListener('click', installPwa);
  $('closeToast').addEventListener('click', ()=>$('installToast').style.display='none');
  $('sheetCloseBtn')?.addEventListener('click', ()=>hideSelectionSheet(true));
  $('gpsStatusAction')?.addEventListener('click', openGpsStatusDetails);
  $('gpsStatusHide')?.addEventListener('click', hideGpsStatusTemporary);
  $('gpsMode')?.addEventListener('change', ()=>{ resetGpsDecisionState(); updateGpsModeHint(); });
  $('gpsBehavior')?.addEventListener('change', ()=>{ resetGpsDecisionState(); updateGpsModeHint(); publishBehaviorChange(); });
  $('obsSave')?.addEventListener('click', saveObservation);
  $('obsCancel')?.addEventListener('click', closeObservationForm);
  $('obsExport')?.addEventListener('click', exportObservationsCsv);
  $('obsClear')?.addEventListener('click', clearObservations);
  updateGpsModeHint();
  renderObservationSummary?.();
  bindSmartLayerUi?.();
  bindVisualModeUi?.();
  bindMeasurementUi?.();
  bindRouteUi?.();
  setupPanelAccordions?.();
  bindPanelAutoCloseUx?.();
  ensureLayerControlUsable?.();
}

function refreshMapSize(){
  if(map){
    setTimeout(()=>map.invalidateSize({animate:false}), 80);
    setTimeout(()=>map.invalidateSize({animate:false}), 280);
  }
}
function closePanel(refresh=false){
  document.body.classList.remove('sidebar-open');
  document.body.classList.remove('sidebar-autoclose-ready');
  const bd=$('sidebarBackdrop'); if(bd) bd.setAttribute('aria-hidden','true');
  if(refresh) refreshMapSize();
}
function openPanel(){
  document.body.classList.add('sidebar-open');
  document.body.classList.add('sidebar-autoclose-ready');
  const bd=$('sidebarBackdrop'); if(bd) bd.setAttribute('aria-hidden','false');
}
function togglePanel(){
  document.body.classList.toggle('sidebar-open');
  document.body.classList.toggle('sidebar-autoclose-ready', document.body.classList.contains('sidebar-open'));
  const bd=$('sidebarBackdrop'); if(bd) bd.setAttribute('aria-hidden', document.body.classList.contains('sidebar-open') ? 'false' : 'true');
  refreshMapSize();
}

function kv(k,v){ return `<div class="kv"><span>${escapeHtml(k)}</span><span>${escapeHtml(fmt(v))}</span></div>`; }
function escapeHtml(s){ return String(s ?? '—').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function formatHa(v){ const n=Number(v); return Number.isFinite(n) ? nf.format(n)+' ha' : '—'; }
function formatMetric(v,suffix=''){ const n=Number(v); return Number.isFinite(n) ? nf.format(n)+suffix : '—'; }
function parseISODate(s){
  if(!s) return null;
  const parts=String(s).slice(0,10).split('-').map(Number);
  if(parts.length<3 || !parts[0] || !parts[1] || !parts[2]) return null;
  const d=new Date(parts[0], parts[1]-1, parts[2]);
  return Number.isNaN(d.getTime()) ? null : d;
}
function todayLocal(){ const d=new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function ageMonthsFromDate(iso){
  const base=parseISODate(iso);
  if(!base) return null;
  const diff=todayLocal().getTime()-base.getTime();
  if(diff < 0) return 0;
  return diff/86400000/30.4375;
}
function edadActualMetric(m){
  const dynamic=ageMonthsFromDate(m && (m.fecha_ultimo_corte || m.fecha_base_edad || m.fUltCte || m.fBase || m.fecha_siembra || m.fSiembra));
  if(Number.isFinite(dynamic)) return dynamic;
  const fallback=Number(m && m.edad_actual);
  return Number.isFinite(fallback) ? fallback : null;
}

function ageDaysFromDate(iso){
  const base=parseISODate(iso);
  if(!base) return null;
  const diff=todayLocal().getTime()-base.getTime();
  return diff < 0 ? 0 : Math.round(diff/86400000);
}
function edadActualDays(m){
  return ageDaysFromDate(m && (m.fecha_ultimo_corte || m.fecha_base_edad || m.fUltCte || m.fBase || m.fecha_siembra || m.fSiembra));
}
function agroStatusFor(m){
  const tch = Number(m && m.tch_ultima_zafra);
  const edad = edadActualMetric(m);
  if(!m || Object.keys(m).length===0) return {cls:'muted', label:'Sin dato histórico', detail:'Abra cronológico o histórico para validar el lote.'};
  if(Number.isFinite(tch) && tch < 55) return {cls:'bad', label:'Prioridad alta', detail:'TCH última zafra bajo; requiere revisión productiva.'};
  if(Number.isFinite(edad) && edad >= 12) return {cls:'warn', label:'Edad alta', detail:'Validar manejo/cosecha según programación.'};
  if(Number.isFinite(tch) && tch < 70) return {cls:'warn', label:'Revisar productividad', detail:'TCH última zafra por debajo del rango esperado.'};
  return {cls:'good', label:'Lectura normal', detail:'Sin alerta crítica con los datos disponibles.'};
}
function quickHistoryHtml(m){
  if(!m || Object.keys(m).length===0) return '<div class="quick-history muted">Sin métricas históricas para este CodLote.</div>';
  const dias = edadActualDays(m);
  const corte = m.fecha_ultimo_corte || m.fecha_base_edad || '—';
  const zafra = m.ultima_zafra_label || m.ultima_zafra || '—';
  const zona = m.zona || '—';
  const riego = m.riego || '—';
  const diasTxt = Number.isFinite(dias) ? `${nf.format(dias)} días desde último corte` : 'sin fecha de corte';
  return `<details class="quick-history"><summary>Histórico rápido</summary><div class="quick-history-grid"><span>Última zafra</span><b>${escapeHtml(zafra)}</b><span>Último corte</span><b>${escapeHtml(corte)}</b><span>Edad calendario</span><b>${escapeHtml(diasTxt)}</b><span>Zona / Riego</span><b>${escapeHtml(zona)} · ${escapeHtml(riego)}</b></div></details>`;
}



// V21.3 · UX móvil: cerrar panel con overlay real + respaldo sobre mapa.
// Esta versión usa un elemento DOM real (#sidebarBackdrop), no solo pseudo-elemento CSS.
// Es más confiable en iPhone/Android porque el toque fuera del panel tiene un target real.
let panelAutoCloseBound = false;
function bindPanelAutoCloseUx(){
  if(panelAutoCloseBound) return;
  panelAutoCloseBound = true;
  const backdrop = $('sidebarBackdrop');
  if(backdrop){
    backdrop.addEventListener('pointerdown', (e)=>{
      if(panelAutoCloseBlocked()) return;
      e.preventDefault();
      e.stopPropagation();
      closePanel(true);
    }, {passive:false});
    backdrop.addEventListener('click', (e)=>{
      if(panelAutoCloseBlocked()) return;
      e.preventDefault();
      e.stopPropagation();
      closePanel(true);
    });
  }
  // Respaldo: si por alguna razón el overlay no captura, cualquier toque fuera del panel en móvil lo cierra.
  document.addEventListener('pointerdown', handlePanelOutsidePointer, true);
  document.addEventListener('touchstart', handlePanelOutsidePointer, true);
  document.addEventListener('keydown', (e)=>{
    if(e.key === 'Escape' && document.body.classList.contains('sidebar-open') && !panelAutoCloseBlocked()) closePanel(true);
  });
  // Respaldo Leaflet: al tocar el mapa, si el panel sigue abierto, se cierra.
  try{
    if(map){
      map.on('mousedown touchstart click', ()=>{
        if(window.innerWidth <= 860 && document.body.classList.contains('sidebar-open') && !panelAutoCloseBlocked()) closePanel(true);
      });
    }
  }catch(_){ }
}
function panelAutoCloseBlocked(){
  // No cerrar si se está midiendo; el usuario necesita limpiar/deshacer sin perder control.
  if(typeof measureMode !== 'undefined' && measureMode) return true;
  const visible = (id)=>{ const el=$(id); return !!el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden'; };
  if(visible('obsModal') || visible('quickFichaModal') || visible('installToast')) return true;
  return false;
}
function handlePanelOutsidePointer(e){
  if(!document.body.classList.contains('sidebar-open')) return;
  if(window.innerWidth > 860) return;
  if(panelAutoCloseBlocked()) return;
  const t = e.target;
  if(!t) return;
  // Si el toque ocurre dentro del panel, no cerrar.
  if(t.closest?.('#sidebar')) return;
  // Botones que abren o controlan panel no deben provocar cierre inmediato accidental.
  if(t.closest?.('#mobileToggle,#btnPanelFloating,#panelCloseBtn,.mobile-actions,.topbar')) return;
  // Controles flotantes y modales no se cierran por autoclose.
  if(t.closest?.('.leaflet-control,.selection-sheet,.gps-status-bar,.measure-floating-toolbar,.install-toast,.obs-modal,.quick-ficha-modal')) return;
  closePanel(true);
}

// V20.4 · Medición manual de campo: longitud y área sin interferir con selección de lotes.
function bindMeasurementUi(){
  $('btnMeasureDistance')?.addEventListener('click', ()=>toggleMeasureMode('distance'));
  $('btnMeasureArea')?.addEventListener('click', ()=>toggleMeasureMode('area'));
  $('btnMeasureUndo')?.addEventListener('click', undoMeasurePoint);
  $('btnMeasureClear')?.addEventListener('click', ()=>clearMeasurement(false));
  $('btnMeasureFloatUndo')?.addEventListener('click', undoMeasurePoint);
  $('btnMeasureFloatClear')?.addEventListener('click', ()=>clearMeasurement(false));
  $('btnMeasureFloatFinish')?.addEventListener('click', finishMeasurement);
  $('btnMeasureFloatClose')?.addEventListener('click', closeMeasurementToolbar);
  $('measureDistanceUnit')?.addEventListener('change', ()=>{ drawMeasurement(); updateMeasureUi(); });
  $('measureAreaUnit')?.addEventListener('change', ()=>{ drawMeasurement(); updateMeasureUi(); });
  updateMeasureUi();
}
function toggleMeasureMode(mode){
  if(measureMode === mode){ measureMode = null; }
  else { measureMode = mode; measureToolbarHidden = false; clearMeasurement(false); }
  updateMeasureUi();
}
function setMeasureMode(mode){ measureMode = mode; updateMeasureUi(); }
function handleMeasurementMapClick(e){
  if(!measureMode || !e || !e.latlng) return;
  addMeasurePoint(e.latlng);
}
function addMeasurePoint(latlng){
  if(!measureMode || !latlng) return;
  measurePoints.push(L.latLng(latlng.lat, latlng.lng));
  drawMeasurement();
}
function undoMeasurePoint(){
  if(!measurePoints.length) return;
  measurePoints.pop();
  drawMeasurement();
}
function clearMeasurement(resetMode=false){
  measurePoints = [];
  if(measurementLayer) measurementLayer.clearLayers();
  measureLine = null; measurePolygon = null; measureLabels = [];
  if(resetMode) measureMode = null;
  updateMeasureUi();
}
function finishMeasurement(){
  measureMode = null;
  measureToolbarHidden = false;
  updateMeasureUi();
}
function closeMeasurementToolbar(){
  measureMode = null;
  measureToolbarHidden = true;
  updateMeasureUi();
}
function measurementStyle(){
  const mode = getEffectivePolygonVisualMode?.() || 'normal';
  if(mode === 'satellite') return {line:'#00e5ff', halo:'#07111f', fill:'#00e5ff', point:'#f4c542'};
  if(mode === 'highContrast') return {line:'#f4c542', halo:'#07111f', fill:'#f4c542', point:'#00e5ff'};
  return {line:'#005baa', halo:'#ffffff', fill:'#005baa', point:'#005baa'};
}
function drawMeasurement(){
  if(!measurementLayer) return;
  measurementLayer.clearLayers();
  const st = measurementStyle();
  measureLabels = [];
  measurePoints.forEach((pt, i)=>{
    L.circleMarker(pt, {radius:6, color:'#ffffff', weight:2.5, fillColor:st.point, fillOpacity:1, interactive:false}).addTo(measurementLayer);
    L.marker(pt, {interactive:false, icon:L.divIcon({className:'measure-point-label', html:String(i+1), iconSize:null})}).addTo(measurementLayer);
  });
  if(measurePoints.length >= 2){
    L.polyline(measurePoints, {color:st.halo, weight:8, opacity:.82, interactive:false}).addTo(measurementLayer);
    measureLine = L.polyline(measurePoints, {color:st.line, weight:3.5, opacity:1, dashArray: measureMode==='area' ? '8 5' : null, interactive:false}).addTo(measurementLayer);
  }
  if(measureMode === 'area' && measurePoints.length >= 3){
    measurePolygon = L.polygon(measurePoints, {color:st.line, weight:3, opacity:1, fillColor:st.fill, fillOpacity:.16, interactive:false}).addTo(measurementLayer);
  }
  addMeasurementResultLabel(st);
  updateMeasureUi();
}
function addMeasurementResultLabel(st){
  if(!measurePoints.length || !measurementLayer) return;
  const last = measurePoints[measurePoints.length-1];
  const html = measureMode === 'area' && measurePoints.length >= 3 ? measureAreaSummary(true) : measureDistanceSummary(true);
  if(!html) return;
  L.marker(last, {interactive:false, icon:L.divIcon({className:'measure-distance-label', html, iconSize:null, iconAnchor:[-8, 28]})}).addTo(measurementLayer);
}
function haversineMeters(a,b){
  const R=6371008.8;
  const rad=Math.PI/180;
  const dLat=(b.lat-a.lat)*rad, dLon=(b.lng-a.lng)*rad;
  const lat1=a.lat*rad, lat2=b.lat*rad;
  const s=Math.sin(dLat/2)**2 + Math.cos(lat1)*Math.cos(lat2)*Math.sin(dLon/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(s)));
}
function totalMeasureDistance(){
  let d=0;
  for(let i=1;i<measurePoints.length;i++) d += haversineMeters(measurePoints[i-1], measurePoints[i]);
  return d;
}
function measurePerimeter(){
  let d=totalMeasureDistance();
  if(measureMode==='area' && measurePoints.length>=3) d += haversineMeters(measurePoints[measurePoints.length-1], measurePoints[0]);
  return d;
}
function polygonAreaM2(points){
  if(!points || points.length<3) return 0;
  const meanLat = points.reduce((s,p)=>s+p.lat,0)/points.length * Math.PI/180;
  const mPerDegLat = 111132.92 - 559.82*Math.cos(2*meanLat) + 1.175*Math.cos(4*meanLat);
  const mPerDegLon = 111412.84*Math.cos(meanLat) - 93.5*Math.cos(3*meanLat);
  const lat0 = points[0].lat, lon0 = points[0].lng;
  const xy = points.map(p=>({x:(p.lng-lon0)*mPerDegLon, y:(p.lat-lat0)*mPerDegLat}));
  let sum=0;
  for(let i=0;i<xy.length;i++){
    const j=(i+1)%xy.length;
    sum += xy[i].x*xy[j].y - xy[j].x*xy[i].y;
  }
  return Math.abs(sum)/2;
}
function preferredDistanceUnit(){ return $('measureDistanceUnit')?.value || 'auto'; }
function preferredAreaUnit(){ return $('measureAreaUnit')?.value || 'auto'; }
function distanceValues(m){
  if(!Number.isFinite(m)) return {m:'—', km:'—', auto:'—'};
  return {m:`${nf.format(m)} m`, km:`${nf.format(m/1000)} km`, auto:m < 1000 ? `${nf.format(m)} m` : `${nf.format(m/1000)} km`};
}
function areaValues(m2){
  if(!Number.isFinite(m2)) return {m2:'—',ha:'—',mz:'—',auto:'—'};
  const ha=m2/10000;
  const mz=ha/0.704225;
  return {m2:`${nf.format(m2)} m²`, ha:`${nf.format(ha)} ha`, mz:`${nf.format(mz)} mz`, auto:m2 < 10000 ? `${nf.format(m2)} m²` : `${nf.format(ha)} ha`};
}
function formatDistance(m){
  const vals=distanceValues(m);
  return vals.auto;
}
function formatDistanceAll(m, unit=preferredDistanceUnit()){
  const vals=distanceValues(m);
  const main=vals[unit] || vals.auto;
  return `<span class="measure-main-value">${main}</span><span class="measure-alt-values">${vals.m} · ${vals.km}</span>`;
}
function formatArea(m2){
  const vals=areaValues(m2);
  return vals.auto;
}
function formatAreaAll(m2, unit=preferredAreaUnit()){
  const vals=areaValues(m2);
  const main=vals[unit] || vals.auto;
  return `<span class="measure-main-value">${main}</span><span class="measure-alt-values">${vals.m2} · ${vals.ha} · ${vals.mz}</span>`;
}
function measureDistanceSummary(short=false){
  if(measurePoints.length < 2) return '';
  const d=totalMeasureDistance();
  if(short) return distanceValues(d).auto;
  return `<b>Distancia total</b>${formatDistanceAll(d)}<small>Puntos: ${measurePoints.length}</small>`;
}
function measureAreaSummary(short=false){
  if(measurePoints.length < 3) return measureDistanceSummary(short);
  const area=polygonAreaM2(measurePoints);
  const per=measurePerimeter();
  if(short) return areaValues(area).auto;
  return `<b>Área medida</b>${formatAreaAll(area)}<b>Perímetro</b>${formatDistanceAll(per)}<small>Puntos: ${measurePoints.length}</small>`;
}
function currentMeasureHtml(){
  if(!measureMode && !measurePoints.length) return 'Active medición y toque el mapa para agregar puntos.';
  if(measureMode==='distance') return measurePoints.length>=2 ? measureDistanceSummary(false) : `Puntos: ${measurePoints.length}. Agregue al menos 2 puntos para calcular distancia.`;
  if(measureMode==='area') return measurePoints.length>=3 ? measureAreaSummary(false) : `Puntos: ${measurePoints.length}. Agregue al menos 3 puntos para calcular área.`;
  return measurePoints.length>=3 ? measureAreaSummary(false) : (measurePoints.length>=2 ? measureDistanceSummary(false) : 'Medición finalizada.');
}
function updateMeasureUi(){
  document.body.classList.toggle('measure-active', !!measureMode);
  $('btnMeasureDistance')?.classList.toggle('active', measureMode==='distance');
  $('btnMeasureArea')?.classList.toggle('active', measureMode==='area');
  const label=$('measureModeLabel');
  if(label){
    label.classList.remove('active-distance','active-area');
    if(measureMode==='distance'){ label.classList.add('active-distance'); label.textContent='Medición de longitud activa · toque el mapa para agregar puntos.'; }
    else if(measureMode==='area'){ label.classList.add('active-area'); label.textContent='Medición de área activa · toque el mapa para formar un polígono.'; }
    else label.textContent=measurePoints.length ? 'Medición finalizada. Puede limpiar o iniciar otra medición.' : 'Medición detenida.';
  }
  const html=currentMeasureHtml();
  const res=$('measureResult');
  if(res) res.innerHTML=html;
  const toolbar=$('measureFloatingToolbar');
  const showToolbar = !!toolbar && !measureToolbarHidden && (!!measureMode || measurePoints.length>0);
  if(toolbar) toolbar.classList.toggle('hidden', !showToolbar);
  const title=$('measureFloatTitle');
  const sub=$('measureFloatSub');
  if(title) title.textContent = measureMode==='area' ? 'Medición de área' : measureMode==='distance' ? 'Medición de longitud' : 'Medición finalizada';
  if(sub) sub.textContent = measureMode ? 'Toque el mapa para agregar puntos. Use deshacer o limpiar si necesita corregir.' : 'La geometría queda visible hasta limpiar o iniciar otra medición.';
  const fres=$('measureFloatResult');
  if(fres) fres.innerHTML=html;
}


// V21.1 · Panel más limpio: módulos colapsables con breve ayuda de uso.
function setupPanelAccordions(){
  const help = {
    'Buscar / filtrar':'Busque por CodLote exacto; si tiene varios tablones, se centra todo el lote.',
    'GPS de campo':'Active ubicación, seleccione UX y el modo de uso según vehículo o campo.',
    'Navegación PRO':'Bloquee el lote correcto y centre GPS/lote cuando trabaje en bordes o caminos.',
    'Visita de campo':'Inicie una visita para dejar trazabilidad de lotes, puntos GPS y observaciones.',
    'Reporte de visita':'Genere reportes HTML imprimibles para respaldo técnico o ejecutivo.',
    'Modo recorrido':'Registre ruta, distancia y lotes visitados durante el desplazamiento.',
    'Capas inteligentes':'Active capas de TCH, edad, variedad y estilo de polígonos según mapa base.',
    'Medición de campo':'Mida longitud o área tocando puntos en el mapa; use la barra flotante para corregir.',
    'Bitácora de campo':'Registre observaciones, severidad, nota y fotos asociadas al CodLote.',
    'Actualización de datos':'Use el flujo Excel → JSON para actualizar métricas sin tocar código.',
    'PWA / instalación':'Instale o verifique la app como acceso directo/PWA.',
    'Lote seleccionado':'Muestra la tarjeta del lote activo o seleccionado.'
  };
  document.querySelectorAll('.sidebar > section.section').forEach(sec=>{
    if(sec.dataset.accordionReady==='1' || sec.classList.contains('field-panel-section')) return;
    const h2=sec.querySelector(':scope > h2');
    if(!h2) return;
    const title=h2.textContent.trim();
    const children=[...sec.childNodes].filter(n=>n!==h2);
    const body=document.createElement('div');
    body.className='section-body';
    children.forEach(n=>body.appendChild(n));
    const row=document.createElement('button');
    row.type='button';
    row.className='section-toggle-row';
    row.setAttribute('aria-expanded','false');
    row.innerHTML=`<span><b>${escapeHtml(title)}</b><small>${escapeHtml(help[title]||'Abra este módulo para usar sus funciones de campo.')}</small></span><i>＋</i>`;
    h2.replaceWith(row);
    sec.appendChild(body);
    sec.classList.add('collapsible-section');
    const openByDefault = ['Buscar / filtrar','GPS de campo','Capas inteligentes','Medición de campo'].includes(title);
    if(openByDefault) sec.classList.add('open');
    row.setAttribute('aria-expanded', openByDefault ? 'true':'false');
    row.querySelector('i').textContent = openByDefault ? '−':'＋';
    row.addEventListener('click', ()=>{
      const open=sec.classList.toggle('open');
      row.setAttribute('aria-expanded', open ? 'true':'false');
      row.querySelector('i').textContent = open ? '−':'＋';
      refreshMapSize?.();
    });
    sec.dataset.accordionReady='1';
  });
}

// V6 · Bitácora de campo local: observaciones por CodLote con GPS, categoría, nota y exportación CSV.
function extraFeatureActions(p){
  return `<div class="extra-actions"><button type="button" class="obs-btn" onclick="openObservationFormFromProps('${escapeHtml(getCodLote(p))}')">＋ Registrar observación</button></div>`;
}
function obsKey(){ return 'casur_maps_observaciones_v6'; }
function getObservations(){ try{return JSON.parse(localStorage.getItem(obsKey())||'[]');}catch(e){return [];} }
function setObservations(arr){ localStorage.setItem(obsKey(), JSON.stringify(arr||[])); renderObservationSummary(); }
function openObservationFormFromProps(cod){
  const p = selectedProps && displayCode(getCodLote(selectedProps))===displayCode(cod) ? selectedProps : {CodSuerte:cod};
  openObservationForm(p);
}
function openObservationForm(p){
  const modal=$('obsModal'); if(!modal) return;
  const cod=displayCode(getCodLote(p)); const m=metricasFor(p);
  $('obsCodLote').textContent='CodLote '+cod;
  $('obsProductor').textContent=m.hacienda_productor || 'Sin dato histórico';
  $('obsCategory').value='Seguimiento'; $('obsSeverity').value='Media'; $('obsNote').value='';
  modal.dataset.codlote=cod; modal.dataset.tablon=getTablon(p)||''; modal.classList.remove('hidden');
}
function closeObservationForm(){ $('obsModal')?.classList.add('hidden'); }
function saveObservation(){
  const modal=$('obsModal'); if(!modal) return;
  const cod=modal.dataset.codlote || ''; if(!cod){ alert('Seleccione primero un lote.'); return; }
  const arr=getObservations();
  const m=((METRICAS||{}).lotes||{})[cod] || {};
  arr.push({
    id:'OBS-'+Date.now(), fecha_hora:new Date().toISOString(), codlote:cod,
    hacienda_productor:m.hacienda_productor||'', tablon:modal.dataset.tablon||'',
    categoria:$('obsCategory').value, severidad:$('obsSeverity').value, nota:$('obsNote').value.trim(),
    lat:lastGpsFix?lastGpsFix.lat:'', lng:lastGpsFix?lastGpsFix.lng:'', precision_m:lastGpsFix?Math.round(lastGpsFix.acc||0):'',
    usuario:'CASUR Maps'
  });
  setObservations(arr); closeObservationForm(); alert('Observación guardada en este dispositivo.');
}
function renderObservationSummary(){
  const el=$('obsSummary'); if(!el) return;
  const arr=getObservations();
  const last=arr[arr.length-1];
  el.innerHTML = arr.length ? `<b>${arr.length}</b> observaciones locales<br><small>Última: ${escapeHtml(last.codlote)} · ${escapeHtml(last.categoria)} · ${new Date(last.fecha_hora).toLocaleString('es-NI')}</small>` : 'Sin observaciones guardadas en este dispositivo.';
}
function exportObservationsCsv(){
  const arr=getObservations(); if(!arr.length){ alert('No hay observaciones para exportar.'); return; }
  const headers=['id','fecha_hora','codlote','hacienda_productor','tablon','categoria','severidad','nota','lat','lng','precision_m','usuario'];
  const rows=[headers.join(',')].concat(arr.map(o=>headers.map(h=>'"'+String(o[h]??'').replace(/"/g,'""')+'"').join(',')));
  downloadText('bitacora_campo_casur_maps.csv', rows.join('\n'), 'text/csv;charset=utf-8');
}
function clearObservations(){ if(confirm('¿Borrar observaciones locales de este dispositivo?')) setObservations([]); }
function downloadText(filename, text, mime='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type:mime}); const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click();
  setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 500);
}


function metricasFor(p){
  const cod=displayCode(getCodLote(p));
  return ((METRICAS||{}).lotes||{})[cod] || ((METRICAS||{}).lotes||{})[normalizeCode(getCodLote(p))] || {};
}
function metricIcon(type){
  const icons={
    area:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M10 14 24 7l15 8-4 24-19 3-9-14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M18 16c5 3 9 7 12 16" fill="none" stroke="currentColor" stroke-width="2" stroke-dasharray="3 4"/></svg>',
    cane:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 40V9M24 40V6M34 40V12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M14 18c-5-4-7-8-7-8 6 0 9 3 10 7M24 17c-5-4-7-8-7-8 6 0 9 3 10 7M34 22c5-4 7-8 7-8-6 0-9 3-10 7M20 40h19" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    age:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M24 39V24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M23 24c-9-1-13-6-14-14 9 0 14 4 15 14Zm2 0c9-1 13-6 14-14-9 0-14 4-15 14Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M10 40c8-4 20-4 28 0" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    variety:'<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M9 24 24 8h12l4 4v12L24 40Z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><circle cx="32" cy="16" r="3" fill="currentColor"/><path d="M19 30c6-10 10-10 15-10M21 29c6 0 9 2 11 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
  };
  return icons[type]||icons.area;
}
function mini(label,value,type,note=''){ return `<div class="field-mini metric-${escapeHtml(type||'area')}"><div class="metric-icon">${metricIcon(type)}</div><div><span>${escapeHtml(label)}</span><b>${escapeHtml(fmt(value))}</b>${note?`<small class="metric-note">${escapeHtml(note)}</small>`:''}</div></div>`; }
function cleanSelectedHtml(p, compact=false){
  const cod=getCodLote(p), codView=displayCode(cod), m=metricasFor(p);
  const crono=urlFor('crono',p), hist=urlFor('historico',p);
  const areaShape = p.Area_Ha!==undefined ? formatHa(p.Area_Ha) : '—';
  const totalRaw = Number.isFinite(Number(m.area_shape_total_ha)) ? m.area_shape_total_ha : m.area_total_ha;
  const areaTotal = Number.isFinite(Number(totalRaw)) ? formatHa(totalRaw) : areaShape;
  const hacienda = m.hacienda_productor || 'Sin dato histórico';
  const tablon = getTablon(p) || '—';
  const tch = Number.isFinite(Number(m.tch_ultima_zafra)) ? formatMetric(m.tch_ultima_zafra,' t/ha') : '—';
  const edadValor = edadActualMetric(m);
  const diasEdad = edadActualDays(m);
  const edad = Number.isFinite(edadValor) ? formatMetric(edadValor,' meses') : '—';
  const edadNote = Number.isFinite(diasEdad) ? `${nf.format(diasEdad)} días` : '';
  const variedad = m.variedad || '—';
  const status = agroStatusFor(m);
  return `<div class="field-card-kicker">Polígono CASUR seleccionado</div>
    <div class="field-card-title"><span>CodLote ${escapeHtml(codView)}</span> <em>(${escapeHtml(areaTotal)})</em></div>
    <div class="field-card-owner">${escapeHtml(hacienda)}</div>
    <div class="field-card-sub">Tablón ${escapeHtml(tablon)}</div>
    <div class="agro-status ${escapeHtml(status.cls)}"><b>${escapeHtml(status.label)}</b><span>${escapeHtml(status.detail)}</span></div>
    <div class="field-grid field-grid-final">
      ${mini('Área shape',areaShape,'area')}${mini('TCH última zafra',tch,'cane')}${mini('Edad actual',edad,'age',edadNote)}${mini('Variedad',variedad,'variety')}
    </div>
    ${compact ? '' : coordsHtmlForSelected()}
    ${quickHistoryHtml(m)}
    ${extraFeatureActions(p)}
    <div class="field-actions">
      <a class="go-crono" href="${escapeHtml(crono)}">▣ Cronológico</a>
      <a class="go-hist" href="${escapeHtml(hist)}">▥ Histórico</a>
      <button class="go-zoom" onclick="zoomSelected()" type="button">⌕ Acercar</button>
      <button class="share-hallazgo-btn" onclick="openHallazgoModal()" type="button">🟢 Compartir hallazgo</button>
    </div>`;
}
function updateSelectionSheet(p){
  const sheet=$('selectionSheet'), content=$('sheetContent');
  if(!sheet||!content) return;
  content.innerHTML = cleanSelectedHtml(p,false);
  sheet.classList.remove('collapsed');
}
function hideSelectionSheet(suppressAuto=false){ const sheet=$('selectionSheet'); if(sheet) sheet.classList.add('collapsed'); if(suppressAuto) gpsSheetSuppressUntil = Date.now() + 60000; }

function selectFeature(feature, layer, zoom, fromGps=false){
  if(!feature || !layer) return;
  if(map && !map.hasLayer(layer)) layer.addTo(map);
  const p=feature.properties || {};
  selectedProps = p;
  const key=getFeatureKey(p);
  if(selectedLayer && selectedLayer !== layer) selectedLayer.setStyle(smartStyle(selectedLayer.feature));
  selectedLayer = layer; selectedKey = key;
  selectedLayer.setStyle(selectedStyle()); selectedLayer.bringToFront();
  $('selectedInfo').innerHTML = cleanSelectedHtml(p,true);
  if(!fromGps) updateSelectionSheet(p);
  if(zoom) map.fitBounds(layer.getBounds(), {padding:[35,35], maxZoom:19});
  updateFieldPanel(p);
  if(window.innerWidth <= 860) closePanel(true);
}
function zoomSelected(){ if(selectedLayer) map.fitBounds(selectedLayer.getBounds(), {padding:[35,35], maxZoom:19}); }

function buildRepresentativeLabels(){
  representativeLabels=[];
  const best=new Map();
  polygonsLayer.eachLayer(layer=>{
    const p=layer.feature?.properties || {};
    const key=getCodLote(p);
    if(!key) return;
    const area=Number(p.Area_Ha)||0;
    const current=best.get(key);
    if(!current || area > current.area) best.set(key,{key,area,layer});
  });
  best.forEach(item=>{
    const center=item.layer.getBounds().getCenter();
    representativeLabels.push({key:item.key, center});
  });
}
// V19 · Debounce updateLabels: evita recalcular etiquetas en cada evento continuo de zoom/pan
let _v19LabelTimer = null;
function updateLabels(){
  if(_v19LabelTimer) clearTimeout(_v19LabelTimer);
  _v19LabelTimer = setTimeout(()=>{
    if(!labelsLayer || !map) return;
    labelsLayer.clearLayers();
    if(map.getZoom() < 16) return;
    const bounds=map.getBounds().pad(0.08);
    representativeLabels.forEach(item=>{
      if(!bounds.contains(item.center)) return;
      L.marker(item.center,{interactive:false,icon:L.divIcon({className:'codlote-label',html:escapeHtml(displayCode(item.key))})}).addTo(labelsLayer);
    });
  }, 120);
}

function featureMatchesFilter(feature){ const f=$('fincaFilter').value; return !f || String(feature.properties.Codfinca) === String(f); }
function applyFilters(){
  const bounds=[];
  polygonsLayer.eachLayer(layer=>{
    const show=featureMatchesFilter(layer.feature);
    if(show){ if(!map.hasLayer(layer)) layer.addTo(map); bounds.push(layer.getBounds()); }
    else { if(map.hasLayer(layer)) map.removeLayer(layer); }
  });
  if(bounds.length){ let b=bounds[0]; for(let i=1;i<bounds.length;i++) b.extend(bounds[i]); map.fitBounds(b,{padding:[24,24]}); }
  updateLabels();
}
function codSearchNorm(v){ return String(v ?? '').trim().toUpperCase().replace(/[^A-Z0-9]/g,''); }
function layerCodSearchKeys(p){
  return [getCodLote(p), p?.CodSuerte, p?.LLAVE_LOTE].map(codSearchNorm).filter(Boolean);
}
function layersByCodLoteExact(q){
  const hits=[];
  polygonsLayer.eachLayer(layer=>{
    const p=layer.feature?.properties || {};
    const keys=layerCodSearchKeys(p);
    if(keys.includes(q)) hits.push(layer);
  });
  return hits;
}
function layersByCodLotePartial(q){
  const groups=new Map();
  polygonsLayer.eachLayer(layer=>{
    const p=layer.feature?.properties || {};
    const cod=codSearchNorm(getCodLote(p));
    if(cod && cod.includes(q)){
      if(!groups.has(cod)) groups.set(cod, []);
      groups.get(cod).push(layer);
    }
  });
  return groups;
}
function bestLayerByArea(layers){
  return layers.slice().sort((a,b)=>Number(b.feature?.properties?.Area_Ha||0)-Number(a.feature?.properties?.Area_Ha||0))[0];
}
function fitAndSelectCodLote(layers, queryLabel){
  if(!layers || !layers.length) return;
  // La búsqueda por CodLote no depende de filtro de finca; el lote encontrado se muestra aunque otro filtro esté activo.
  const best=bestLayerByArea(layers);
  let bounds=null;
  layers.forEach(layer=>{
    if(!map.hasLayer(layer)) layer.addTo(map);
    const lb=layer.getBounds();
    bounds = bounds ? bounds.extend(lb) : lb;
  });
  selectFeature(best.feature, best, false);
  if(bounds && bounds.isValid()) map.fitBounds(bounds, {padding:[38,38], maxZoom:18});
  const cod=displayCode(getCodLote(best.feature.properties));
  const msg = layers.length>1 ? `<div class="search-note"><b>CodLote ${escapeHtml(cod)}</b><br>${layers.length} polígonos/tablones encontrados. Se centró el conjunto del lote.</div>` : `<div class="search-note"><b>CodLote ${escapeHtml(cod)}</b><br>Coincidencia exacta encontrada.</div>`;
  const box=$('selectedInfo');
  if(box) box.insertAdjacentHTML('afterbegin', msg);
}
function searchFeature(){
  const raw=$('searchBox').value.trim();
  const q=codSearchNorm(raw);
  if(!q) return;
  const exact=layersByCodLoteExact(q);
  if(exact.length){ fitAndSelectCodLote(exact, raw); return; }
  const partial=layersByCodLotePartial(q);
  if(partial.size===1){
    const [cod,layers]=partial.entries().next().value;
    fitAndSelectCodLote(layers, cod);
    return;
  }
  if(partial.size>1){
    const options=[...partial.entries()].slice(0,12).map(([cod,layers])=>`${cod} (${layers.length})`).join(' · ');
    alert('Encontré varios CodLote parecidos. Escriba el CodLote completo. Opciones: ' + options + (partial.size>12?' ...':''));
    return;
  }
  alert('No encontré CodLote para: ' + raw + '. Revise que el código esté completo.');
}
function resetView(){
  $('searchBox').value=''; $('fincaFilter').value='';
  polygonsLayer.eachLayer(layer=>{ if(!map.hasLayer(layer)) layer.addTo(map); layer.setStyle(smartStyle(layer.feature)); });
  selectedLayer=null; selectedKey=''; $('selectedInfo').innerHTML='Seleccione un polígono para abrir Cronológico o Histórico.';
  const sc=$('sheetContent'); if(sc) sc.innerHTML='<div class="sheet-empty">Toque un polígono para ver CodLote, finca y accesos a Cronológico / Histórico.</div>';
  hideSelectionSheet();
  map.fitBounds(INITIAL_BOUNDS,{padding:[20,20]});
  updateLabels();
  updateFieldPanel();
}

// GPS live tracking · V5.1 UX silencioso
let watchId=null,userMarker=null,accuracyCircle=null,following=true;
let lastGpsHtml='', lastGpsTitle='GPS activo', lastGpsSub='Calculando ubicación...', gpsSheetSuppressUntil=0, gpsBarHiddenUntil=0;

function setStatus(txt,on=false){ $('statusText').textContent=txt; $('gpsDot').classList.toggle('on',on); }
function getGpsProfile(){ return GPS_PROFILES[$('gpsMode')?.value] || GPS_PROFILES.vehiculo; }
function getGpsBehavior(){ return $('gpsBehavior')?.value || 'silencioso'; }
function gpsProfileText(p){ return `${p.label} · radio ${p.radiusM} m · confirma ${p.stableReadings} lecturas`; }
function gpsBehaviorText(){
  const b=getGpsBehavior();
  if(b==='preciso') return 'UX Preciso: abre panel cuando hay decisión GPS.';
  if(b==='asistido') return 'UX Asistido: sugiere solo cuando hay alta confianza o te detenés.';
  return 'UX Silencioso: calcula en segundo plano y no tapa el mapa.';
}
function updateGpsModeHint(){
  const el=$('gpsModeHint');
  if(el) el.textContent=gpsBehaviorText() + ' · ' + gpsProfileText(getGpsProfile());
}
function resetGpsDecisionState(){ lastAutoCandidateKey=''; autoCandidateCount=0; gpsCandidateCache=[]; }
function publishBehaviorChange(){
  const html=`<div class="gps-decision medium"><b>${escapeHtml(gpsBehaviorText())}</b><br>${escapeHtml(gpsProfileText(getGpsProfile()))}</div>`;
  $('gpsInfo').innerHTML=html;
  updateGpsStatusBar('GPS ' + behaviorShortLabel(), gpsProfileText(getGpsProfile()), 'Ver', html, 'medium', false);
}
function behaviorShortLabel(){ const b=getGpsBehavior(); return b==='preciso'?'Preciso':(b==='asistido'?'Asistido':'Silencioso'); }
function shouldAutoOpenGpsSheet(kind,movingFast=false){
  if(Date.now() < gpsSheetSuppressUntil) return false;
  const b=getGpsBehavior();
  if(b==='preciso') return true;
  if(b==='asistido') return kind==='high' && !movingFast;
  return false;
}
function startLocation(){
  closePanel(true);
  if(!navigator.geolocation){ $('gpsInfo').textContent='Este navegador no soporta geolocalización.'; return; }
  if(location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'){
    $('gpsInfo').innerHTML='El GPS puede bloquearse porque no estás en HTTPS o localhost. Para celular publique la carpeta en HTTPS.';
  }
  if(watchId !== null) navigator.geolocation.clearWatch(watchId);
  resetGpsDecisionState();
  setStatus('solicitando permiso GPS...',false);
  updateGpsStatusBar('Solicitando GPS', 'Permita ubicación para detectar lotes en modo ' + behaviorShortLabel(), 'Ver', $('gpsInfo').innerHTML || '', 'medium', false);
  watchId = navigator.geolocation.watchPosition(onPosition,onLocationError,{enableHighAccuracy:true,maximumAge:1000,timeout:18000});
}
function stopLocation(){
  if(watchId!==null) navigator.geolocation.clearWatch(watchId);
  watchId=null; resetGpsDecisionState();
  setStatus('seguimiento detenido',false);
  $('gpsInfo').textContent='Seguimiento GPS detenido.';
  hideGpsStatusBar();
}
function onPosition(pos){
  const lat=pos.coords.latitude,lng=pos.coords.longitude,acc=Math.round(pos.coords.accuracy||0),ll=[lat,lng];
  const speed=getSpeedFromPosition(pos,lat,lng);
  if(lastGpsFix) lastGpsFix.acc=acc;
  const heading=updateHeadingFromPosition(pos,lat,lng,speed);
  if(!userMarker){
    userMarker=L.marker(ll,{icon:gpsArrowIcon(heading),interactive:false,zIndexOffset:1000}).addTo(map).bindPopup('Mi ubicación actual');
    accuracyCircle=L.circle(ll,{radius:acc,color:'#0057ff',weight:1,fillOpacity:.08}).addTo(map);
  }else{ userMarker.setLatLng(ll); userMarker.setIcon(gpsArrowIcon(heading)); accuracyCircle.setLatLng(ll); accuracyCircle.setRadius(acc); }
  applyMapRotation(heading);
  if(following) map.setView(ll, Math.max(map.getZoom(),17), {animate:true});
  renderSmartGpsDecision(lng,lat,acc,speed,heading);
  updateFieldPanel();
}
function onLocationError(err){
  setStatus('GPS no disponible o permiso denegado',false);
  const msg='No pude activar el GPS: ' + err.message + '. Revise permisos del navegador y abra desde HTTPS o localhost.';
  $('gpsInfo').textContent=msg;
  updateGpsStatusBar('GPS no disponible', msg, 'Ver', `<div class="gps-decision low"><b>GPS no disponible</b><br>${escapeHtml(msg)}</div>`, 'low', false);
}

function centerGps(){ if(userMarker){ following=true; map.setView(userMarker.getLatLng(), Math.max(map.getZoom(),17), {animate:true}); closePanel(true); } }
function getSpeedFromPosition(pos,lat,lng){
  const now=pos.timestamp || Date.now();
  let speed=Number(pos.coords.speed);
  if(!Number.isFinite(speed) && lastGpsFix){
    const dt=Math.max((now-lastGpsFix.t)/1000,0.5);
    speed=haversineM(lastGpsFix.lng,lastGpsFix.lat,lng,lat)/dt;
  }
  lastGpsFix={lat,lng,t:now};
  return Number.isFinite(speed) ? speed : null;
}
function precisionLabel(acc){ if(acc<=10) return {txt:'Alta',cls:'good'}; if(acc<=25) return {txt:'Media',cls:'warn'}; return {txt:'Baja',cls:'bad'}; }
function speedLabel(speed){ if(speed===null || speed===undefined) return '—'; return `${(speed*3.6).toFixed(1)} km/h`; }
function metersText(v){ return v===0 ? 'dentro' : `${Math.round(v)} m`; }
function gpsMetaHtml(lat,lng,acc,speed,profile,heading=null){
  const pr=precisionLabel(acc);
  const rum=Number.isFinite(heading)?headingCardinal(heading):'—';
  return `<div class="gps-meta-grid">
    <div><span>Precisión</span><b class="${pr.cls}">${pr.txt} · ${acc} m</b></div>
    <div><span>Velocidad</span><b>${escapeHtml(speedLabel(speed))}</b></div>
    <div><span>Rumbo</span><b>${escapeHtml(rum)}</b></div>
    <div><span>Modo</span><b>${escapeHtml(profile.label)}</b></div>
    <div><span>GPS</span><b>${lat.toFixed(5)}, ${lng.toFixed(5)}</b></div>
  </div>`;
}
function renderSmartGpsDecision(lng,lat,acc,speed,heading=null){
  const profile=getGpsProfile();
  const movingFast=(speed!==null && speed>profile.speedWarnMps);
  const candidates=findNearbyFeatures(lng,lat,Math.max(profile.radiusM, Math.min(120, acc + profile.tieM)));
  const inside=candidates.filter(c=>c.inside);
  const meta=gpsMetaHtml(lat,lng,acc,speed,profile,heading);
  trackRouteCandidates?.(lng,lat,acc,speed,candidates);
  const movingTxt=movingFast ? ' · en movimiento' : '';

  if(inside.length===1){
    const c=inside[0];
    const nearbyOthers=candidates.filter(o=>o.key!==c.key && o.distanceM <= Math.max(profile.tieM, Math.min(45, acc + 3))).slice(0,3);
    const canAuto=acc<=profile.autoAccM && !movingFast && nearbyOthers.length===0;
    if(canAuto){
      if(c.key===lastAutoCandidateKey) autoCandidateCount++; else { lastAutoCandidateKey=c.key; autoCandidateCount=1; }
      if(autoCandidateCount>=profile.stableReadings){
        setStatus('GPS V5.1 · CodLote ' + displayCode(c.key) + ' · confianza alta',true);
        const html=`${meta}<div class="gps-decision high"><b>Confianza alta</b><br>Estás dentro de <b>CodLote ${escapeHtml(displayCode(c.key))}</b>. Lecturas estables: ${autoCandidateCount}/${profile.stableReadings}.</div>${candidateActionsHtml(c,0,true)}`;
        $('gpsInfo').innerHTML=html;
        if(c.feature._casurLayer && selectedKey !== getFeatureKey(c.p)) selectFeature(c.feature, c.feature._casurLayer, false, true);
        publishGpsUi(html,'Dentro de CodLote ' + displayCode(c.key),`Confianza alta · precisión ${acc} m${movingTxt}`,'Consultar','high',shouldAutoOpenGpsSheet('high',movingFast));
        return;
      }
      setStatus('GPS V5.1 · confirmando lote ' + displayCode(c.key),true);
      const html=`${meta}<div class="gps-decision medium"><b>Confirmando lote</b><br>Posible <b>CodLote ${escapeHtml(displayCode(c.key))}</b>. Lectura ${autoCandidateCount}/${profile.stableReadings}; espere 2–3 segundos para fijarlo.</div>${candidateActionsHtml(c,0,true)}`;
      publishGpsUi(html,'Confirmando ' + displayCode(c.key),`Lectura ${autoCandidateCount}/${profile.stableReadings} · precisión ${acc} m`,'Ver','medium',false);
      return;
    }
    const reason = movingFast ? 'Vas en movimiento; evito cambiar de lote automáticamente.' : 'La precisión GPS o los lotes cercanos requieren confirmación.';
    setStatus('GPS V5.1 · lote probable · confirmar',true);
    showCandidateList('Lote probable', reason, [c,...nearbyOthers], meta, 'medium', 'Lote probable ' + displayCode(c.key), 'Ver');
    return;
  }

  if(inside.length>1){
    resetGpsDecisionState();
    setStatus('GPS V5.1 · zona de transición entre lotes',true);
    showCandidateList('Zona de transición', 'El punto GPS cae en una zona compartida o borde. Seleccione manualmente el lote correcto.', inside.slice(0,4), meta, 'warn', inside.length + ' lotes posibles', 'Ver lotes');
    return;
  }

  if(candidates.length){
    resetGpsDecisionState();
    const nearest=candidates[0];
    const tied=candidates.filter(c=>c.distanceM <= nearest.distanceM + profile.tieM).slice(0,4);
    const title = tied.length>1 ? 'Varios lotes cercanos' : 'Cerca de un lote';
    const msg = tied.length>1
      ? 'Estás cerca de varios polígonos, típico de caminos o cuatro esquinas. Seleccione el lote a consultar.'
      : `No estás dentro del polígono, pero el lote más cercano está a ${metersText(nearest.distanceM)}.`;
    setStatus(tied.length>1 ? 'GPS V5.1 · varios lotes cercanos' : 'GPS V5.1 · lote cercano',true);
    showCandidateList(title, msg, tied, meta, tied.length>1?'warn':'medium', tied.length>1 ? `${tied.length} lotes cercanos` : `Cerca de ${displayCode(nearest.key)}`, tied.length>1?'Ver lotes':'Ver');
    return;
  }

  resetGpsDecisionState();
  setStatus('GPS V5.1 · fuera de polígonos cargados',true);
  const html=`${meta}<div class="gps-decision low"><b>Fuera de lote</b><br>No se detectan polígonos CASUR dentro del radio ${profile.radiusM} m. Revise precisión GPS o acerque el mapa.</div><div class="field-actions one"><button class="go-zoom" onclick="centerGps()" type="button">Centrar GPS</button></div>`;
  publishGpsUi(html,'Fuera de polígonos',`Sin lotes dentro de ${profile.radiusM} m · precisión ${acc} m`,'Ver','low',shouldAutoOpenGpsSheet('outside',movingFast));
}
function showCandidateList(title,message,candidates,meta,level,barTitle,actionLabel){
  gpsCandidateCache=candidates.slice(0,6);
  const html=`${meta}<div class="gps-decision ${level}"><b>${escapeHtml(title)}</b><br>${escapeHtml(message)}</div><div class="candidate-list">${gpsCandidateCache.map((c,i)=>candidateRowHtml(c,i)).join('')}</div>`;
  publishGpsUi(html,barTitle || title, gpsCandidateCache.map(c=>displayCode(c.key)).slice(0,4).join(' · '), actionLabel || 'Ver', level, shouldAutoOpenGpsSheet(level==='warn'?'candidates':'probable', false));
}
function publishGpsUi(html,barTitle,barSub,actionLabel,level,autoOpen){
  lastGpsHtml=html; lastGpsTitle=barTitle || 'GPS activo'; lastGpsSub=barSub || '';
  $('gpsInfo').innerHTML=html;
  updateGpsStatusBar(lastGpsTitle,lastGpsSub,actionLabel || 'Ver',html,level,autoOpen);
}
function updateGpsStatusBar(title,sub,actionLabel,html,level,autoOpen){
  const bar=$('gpsStatusBar'); if(!bar) return;
  lastGpsHtml=html || lastGpsHtml; lastGpsTitle=title || lastGpsTitle; lastGpsSub=sub || lastGpsSub;
  $('gpsStatusMain').textContent=lastGpsTitle;
  $('gpsStatusSub').textContent=lastGpsSub;
  $('gpsStatusAction').textContent=actionLabel || 'Ver';
  bar.classList.remove('good','medium','warn','low','hidden');
  bar.classList.add(level || 'medium');
  if(Date.now() < gpsBarHiddenUntil) bar.classList.add('hidden');
  if(autoOpen && Date.now() >= gpsSheetSuppressUntil) updateGpsSheet(lastGpsHtml);
}
function hideGpsStatusBar(){ const bar=$('gpsStatusBar'); if(bar) bar.classList.add('hidden'); }
function hideGpsStatusTemporary(){ gpsBarHiddenUntil=Date.now()+30000; hideGpsStatusBar(); }
function openGpsStatusDetails(){ if(lastGpsHtml) updateGpsSheet(lastGpsHtml); }
function candidateRowHtml(c,i){
  const p=c.p;
  return `<div class="candidate-row">
    <div><b>CodLote ${escapeHtml(displayCode(c.key))}</b><span>Finca ${escapeHtml(p.Codfinca||'—')} · Suerte ${escapeHtml(p.Suerte||'—')} · Tablón ${escapeHtml(getTablon(p)||'—')} · ${escapeHtml(metersText(c.distanceM))}</span></div>
    <button type="button" onclick="useGpsCandidate(${i})">Usar</button>
  </div>${candidateActionsHtml(c,i,false)}`;
}
function candidateActionsHtml(c,i,compact){
  const p=c.p, crono=urlFor('crono',p), hist=urlFor('historico',p);
  return `<div class="gps-inside-actions ${compact?'compact':''}"><a href="${escapeHtml(crono)}">Cronológico</a><a href="${escapeHtml(hist)}">Histórico</a>${compact?'':'<button type="button" onclick="useGpsCandidate('+i+',true)">Acercar</button>'}</div>`;
}
function updateGpsSheet(html){
  const sheet=$('selectionSheet'), content=$('sheetContent');
  if(!sheet||!content) return;
  content.innerHTML=`<div class="field-card-kicker">GPS silencioso V5.1</div>${html}`;
  sheet.classList.remove('collapsed');
}
function useGpsCandidate(idx,zoom=false){
  const c=gpsCandidateCache[idx];
  if(!c) return;
  resetGpsDecisionState();
  setStatus('lote confirmado manualmente · ' + displayCode(c.key),true);
  if(c.feature._casurLayer) selectFeature(c.feature,c.feature._casurLayer,!!zoom,true);
  updateSelectionSheet(c.p);
}

function pointInRing(x,y,ring){ let inside=false; for(let i=0,j=ring.length-1;i<ring.length;j=i++){ const xi=ring[i][0],yi=ring[i][1],xj=ring[j][0],yj=ring[j][1]; const intersect=((yi>y)!==(yj>y)) && (x < (xj-xi)*(y-yi)/((yj-yi)||1e-12)+xi); if(intersect) inside=!inside; } return inside; }
function pointInPolygonCoords(x,y,coords){ if(!coords || !coords.length) return false; if(!pointInRing(x,y,coords[0])) return false; for(let i=1;i<coords.length;i++) if(pointInRing(x,y,coords[i])) return false; return true; }
function bboxContains(b,x,y){ return b && x>=b[0] && y>=b[1] && x<=b[2] && y<=b[3]; }
function featureContainsPoint(f,x,y){
  const b=f.bbox || f.geometry?.bbox; if(!bboxContains(b,x,y)) return false;
  const geom=f.geometry; if(!geom) return false;
  if(geom.type==='Polygon') return pointInPolygonCoords(x,y,geom.coordinates);
  if(geom.type==='MultiPolygon') return geom.coordinates.some(poly=>pointInPolygonCoords(x,y,poly));
  return false;
}
function findContainingFeature(x,y){
  for(const f of DATA.features){ if(featureContainsPoint(f,x,y)) return f; }
  return null;
}
function findNearbyFeatures(x,y,radiusM){
  const out=[]; const max=Math.max(5,radiusM||50);
  for(const f of DATA.features){
    const b=f.bbox || f.geometry?.bbox;
    if(!bboxIntersectsRadius(b,x,y,max)) continue;
    const inside=featureContainsPoint(f,x,y);
    const dist=inside ? 0 : featureDistanceM(f,x,y,max);
    if(dist<=max){
      const p=f.properties || {};
      out.push({feature:f,p,key:getFeatureKey(p),distanceM:dist,inside});
    }
  }
  out.sort((a,b)=>a.distanceM-b.distanceM || String(a.key).localeCompare(String(b.key),'es',{numeric:true}));
  return out;
}
function bboxIntersectsRadius(b,x,y,radiusM){
  if(!b) return true;
  const latRad=y*Math.PI/180;
  const dLat=radiusM/110574;
  const dLon=radiusM/(111320*Math.max(0.15,Math.cos(latRad)));
  return !(b[0] > x+dLon || b[2] < x-dLon || b[1] > y+dLat || b[3] < y-dLat);
}
function featureDistanceM(f,x,y,earlyStopM){
  const geom=f.geometry; if(!geom) return Infinity;
  let best=Infinity;
  const scanRing=(ring)=>{
    for(let i=0;i<ring.length-1;i++){
      const d=pointToSegmentDistanceM(x,y,ring[i][0],ring[i][1],ring[i+1][0],ring[i+1][1]);
      if(d<best) best=d;
      if(best<=2) return;
    }
  };
  if(geom.type==='Polygon') geom.coordinates.forEach(scanRing);
  else if(geom.type==='MultiPolygon') geom.coordinates.forEach(poly=>poly.forEach(scanRing));
  return best;
}
function pointToSegmentDistanceM(px,py,ax,ay,bx,by){
  const refLat=py*Math.PI/180;
  const mx=111320*Math.max(0.15,Math.cos(refLat)), my=110574;
  const pX=px*mx,pY=py*my,aX=ax*mx,aY=ay*my,bX=bx*mx,bY=by*my;
  const vx=bX-aX,vy=bY-aY,wx=pX-aX,wy=pY-aY;
  const c1=vx*vx+vy*vy;
  let t=c1 ? (wx*vx+wy*vy)/c1 : 0; t=Math.max(0,Math.min(1,t));
  const dx=pX-(aX+t*vx),dy=pY-(aY+t*vy);
  return Math.sqrt(dx*dx+dy*dy);
}
function haversineM(lon1,lat1,lon2,lat2){
  const R=6371000, toRad=Math.PI/180;
  const dLat=(lat2-lat1)*toRad, dLon=(lon2-lon1)*toRad;
  const a=Math.sin(dLat/2)**2 + Math.cos(lat1*toRad)*Math.cos(lat2*toRad)*Math.sin(dLon/2)**2;
  return 2*R*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function bearingDeg(lon1,lat1,lon2,lat2){
  const toRad=Math.PI/180, toDeg=180/Math.PI;
  const φ1=lat1*toRad, φ2=lat2*toRad, Δλ=(lon2-lon1)*toRad;
  const y=Math.sin(Δλ)*Math.cos(φ2);
  const x=Math.cos(φ1)*Math.sin(φ2)-Math.sin(φ1)*Math.cos(φ2)*Math.cos(Δλ);
  return (Math.atan2(y,x)*toDeg+360)%360;
}
function headingCardinal(deg){
  if(!Number.isFinite(deg)) return '—';
  const dirs=['N','NE','E','SE','S','SO','O','NO'];
  return `${Math.round(deg)}° ${dirs[Math.round(deg/45)%8]}`;
}
let lastHeadingFix=null, lastHeadingDeg=null, headingMode='north';
function smoothHeading(prev,next,alpha=.25){
  if(!Number.isFinite(prev)) return next;
  let diff=((next-prev+540)%360)-180;
  return (prev + diff*alpha + 360)%360;
}
function updateHeadingFromPosition(pos,lat,lng,speed){
  let h=Number(pos?.coords?.heading);
  if(!Number.isFinite(h) || h<0){
    if(lastHeadingFix){
      const d=haversineM(lastHeadingFix.lng,lastHeadingFix.lat,lng,lat);
      if(d>=2.5) h=bearingDeg(lastHeadingFix.lng,lastHeadingFix.lat,lng,lat);
    }
  }
  if(Number.isFinite(h)) lastHeadingDeg=smoothHeading(lastHeadingDeg,h,(speed&&speed>1.5)?.35:.20);
  lastHeadingFix={lat,lng,t:Date.now()};
  return lastHeadingDeg;
}
function gpsArrowIcon(heading){
  const h=Number.isFinite(heading)?heading:0;
  const cls=Number.isFinite(heading)?'':' no-heading';
  return L.divIcon({className:'gps-arrow-icon',html:`<div class="gps-arrow${cls}" style="transform:rotate(${h}deg)"><span></span></div>`,iconSize:[34,34],iconAnchor:[17,17]});
}
function setHeadingMode(mode){
  headingMode=mode==='course'?'course':'north';
  $('btnNorthUp')?.classList.toggle('active',headingMode==='north');
  $('btnCourseUp')?.classList.toggle('active',headingMode==='course');
  applyMapRotation(lastHeadingDeg);
  updateFieldPanel();
}
function applyMapRotation(heading){
  const mapEl=$('map'); if(!mapEl) return;
  const rot=(headingMode==='course' && following && Number.isFinite(heading)) ? -heading : 0;
  mapEl.style.setProperty('--casur-map-rotation', rot.toFixed(1)+'deg');
  mapEl.classList.toggle('map-rotating', Math.abs(rot)>0.1);
}
function updateFollowUi(){ applyMapRotation(lastHeadingDeg); updateFieldPanel(); }
function featureCentroid(f){
  if(!f || !f.geometry) return bboxCenter(f);
  let best=null, bestArea=0;
  const centroidRing=(ring)=>{
    let a=0,cx=0,cy=0;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const x0=ring[j][0], y0=ring[j][1], x1=ring[i][0], y1=ring[i][1];
      const cross=x0*y1-x1*y0; a+=cross; cx+=(x0+x1)*cross; cy+=(y0+y1)*cross;
    }
    a*=0.5;
    if(Math.abs(a)<1e-12) return null;
    return {lat:cy/(6*a), lng:cx/(6*a), area:Math.abs(a)};
  };
  const consider=(poly)=>{ const c=centroidRing(poly && poly[0]); if(c && c.area>bestArea){ best=c; bestArea=c.area; } };
  if(f.geometry.type==='Polygon') consider(f.geometry.coordinates);
  else if(f.geometry.type==='MultiPolygon') f.geometry.coordinates.forEach(consider);
  if(best) return [best.lat,best.lng];
  return bboxCenter(f);
}
function bboxCenter(f){ const b=f && (f.bbox || f.geometry?.bbox); return b&&b.length>=4 ? [(b[1]+b[3])/2,(b[0]+b[2])/2] : null; }
function coordsHtmlForSelected(){
  const f=selectedLayer && selectedLayer.feature ? selectedLayer.feature : null;
  const c=featureCentroid(f); if(!c) return '';
  const lat=Number(c[0]), lng=Number(c[1]); if(!Number.isFinite(lat)||!Number.isFinite(lng)) return '';
  return `<div class="card-coords"><span class="coord-lbl">Centroide GPS</span><span class="coord-val">${lat.toFixed(6)}, ${lng.toFixed(6)}</span><button id="btnCopiarCoords" class="coord-copy-btn" onclick="copiarCoordenadas(${lat},${lng})" type="button">📍 Copiar</button></div>`;
}
function copiarCoordenadas(lat,lng){
  const txt=`${Number(lat).toFixed(6)},${Number(lng).toFixed(6)}`;
  const btn=document.getElementById('btnCopiarCoords');
  const ok=()=>{ if(btn){ const old=btn.textContent; btn.textContent='✓ Copiado'; btn.classList.add('copied'); setTimeout(()=>{btn.textContent=old; btn.classList.remove('copied');},1600); } };
  if(navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(txt).then(ok).catch(()=>prompt('Copie estas coordenadas:',txt));
  else prompt('Copie estas coordenadas:',txt);
}
window.copiarCoordenadas=copiarCoordenadas;
function selectedMetricSummary(p){
  if(!p) return null;
  const m=metricasFor(p), status=agroStatusFor(m);
  const cod=displayCode(getCodLote(p));
  const totalRaw=Number.isFinite(Number(m.area_shape_total_ha)) ? m.area_shape_total_ha : m.area_total_ha;
  const areaTotal=Number.isFinite(Number(totalRaw)) ? formatHa(totalRaw) : (p.Area_Ha!==undefined?formatHa(p.Area_Ha):'—');
  const hac=m.hacienda_productor || 'Sin dato histórico';
  const tab=getTablon(p)||'—';
  const tch=Number.isFinite(Number(m.tch_ultima_zafra)) ? formatMetric(m.tch_ultima_zafra,' t/ha') : '—';
  const edad=edadActualMetric(m); const edadTxt=Number.isFinite(edad)?formatMetric(edad,' meses'):'—';
  const variedad=m.variedad || '—';
  return {cod,areaTotal,hac,tab,tch,edadTxt,variedad,status};
}
function updateFieldPanel(p=selectedProps){
  const gps=$('fieldGpsPanel'), lot=$('fieldLotPanel'), agro=$('fieldAgroPanel'), visit=$('fieldVisitPanel');
  if(gps){
    const acc=lastGpsFix&&Number.isFinite(Number(lastGpsFix.acc))?Math.round(lastGpsFix.acc):null;
    const h=Number.isFinite(lastHeadingDeg)?headingCardinal(lastHeadingDeg):'—';
    const mode=headingMode==='course'?'Rumbo arriba':'Norte arriba';
    gps.innerHTML=`<span>GPS / navegación</span><b>${watchId?'GPS activo':'GPS sin activar'}</b><small>${acc?`Precisión ${acc} m · `:''}Rumbo ${escapeHtml(h)} · ${escapeHtml(mode)}${following?' · siguiéndome':' · explorando mapa'}</small>`;
  }
  const sm=selectedMetricSummary(p);
  if(lot){
    lot.innerHTML=sm?`<span>Lote actual / seleccionado</span><b>CODLOTE ${escapeHtml(sm.cod)} (${escapeHtml(sm.areaTotal)})</b><small>${escapeHtml(sm.hac)} · Tablón ${escapeHtml(sm.tab)}</small>`:`<span>Lote actual / seleccionado</span><b>Sin lote seleccionado</b><small>Toque un polígono o active GPS para detectar CodLote.</small>`;
  }
  if(agro){
    agro.innerHTML=sm?`<span>Lectura agronómica</span><b>${escapeHtml(sm.status.label)}</b><small>TCH ${escapeHtml(sm.tch)} · Edad ${escapeHtml(sm.edadTxt)} · Variedad ${escapeHtml(sm.variedad)}</small>`:`<span>Lectura agronómica</span><b>Sin datos</b><small>TCH, edad, variedad y semáforo aparecerán al seleccionar un lote.</small>`;
    agro.className='field-panel-card agro-card ' + (sm?sm.status.cls:'');
  }
  if(visit){
    const lots=Object.keys(routeVisited||{});
    const rv=routeActive?'Recorrido activo':'Recorrido detenido';
    const rdur=routeStartTime?fmtDur(Date.now()-routeStartTime.getTime()):'0s';
    visit.innerHTML=`<span>Visita / recorrido</span><b>${escapeHtml(rv)}</b><small>${escapeHtml(rdur)} · ${escapeHtml(fmtDist(routeDistanceM||0))} · ${lots.length} lotes · ${routePoints.length} pts</small>`;
  }
}

function setupInstallFlow(){
  window.addEventListener('beforeinstallprompt', (e)=>{ e.preventDefault(); deferredInstallPrompt=e; $('installPwaBtn').disabled=false; $('installToast').style.display='block'; });
  window.addEventListener('appinstalled', ()=>{ deferredInstallPrompt=null; $('installToast').style.display='none'; $('installPwaBtn').textContent='App instalada'; $('installPwaBtn').disabled=true; });
}
async function installPwa(){
  if(deferredInstallPrompt){
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice.catch(()=>null);
    deferredInstallPrompt=null; $('installToast').style.display='none';
  }else{
    alert('Para instalar: abra esta PWA desde HTTPS o localhost. En Chrome/Edge use menú ⋮ → Instalar app / Agregar a pantalla de inicio. En iPhone use Compartir → Agregar a pantalla de inicio.');
  }
}
function registerServiceWorker(){
  if('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')){
    navigator.serviceWorker.register('./service-worker.js').catch(err=>console.warn('SW no registrado',err));
  }
}


// V7 · Capas inteligentes: alternar etiquetas y resaltar lotes por TCH, edad o variedad.
function bindSmartLayerUi(){
  ['layerLabels','layerTchUnder40','layerTchUnder50','layerTchOver70','layerAgeUnder3','layerAge4to6','layerAgeOver6','layerVariety'].forEach(id=>$(id)?.addEventListener('change', applySmartLayers));
  $('layerVarietyValue')?.addEventListener('change', applySmartLayers);
  populateVarietyOptions();
}
function populateVarietyOptions(){
  const sel=$('layerVarietyValue'); if(!sel || sel.dataset.ready) return;
  const vals=[...new Set(Object.values(((METRICAS||{}).lotes||{})).map(x=>x.variedad).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'es',{numeric:true}));
  vals.forEach(v=>{const o=document.createElement('option'); o.value=v; o.textContent=v; sel.appendChild(o);});
  sel.dataset.ready='1';
}
function applySmartLayers(){
  if(!polygonsLayer) return;
  const showLabels=$('layerLabels')?.checked!==false;
  if(labelsLayer){ if(showLabels && !map.hasLayer(labelsLayer)) labelsLayer.addTo(map); if(!showLabels && map.hasLayer(labelsLayer)) map.removeLayer(labelsLayer); }
  polygonsLayer.eachLayer(layer=>{ if(layer!==selectedLayer) layer.setStyle(smartStyle(layer.feature)); });
  if(polygonsHaloLayer) polygonsHaloLayer.eachLayer(layer=>layer.setStyle(haloStyle(layer.feature)));
  updatePolygonVisualMode?.();
  updateLayerSummary();
}
function rendimientoLayerStyle(st, clase){
  const mode = getEffectivePolygonVisualMode?.() || 'normal';
  const satelliteLike = mode === 'satellite' || mode === 'highContrast';
  const out = Object.assign({}, st);
  // V20.2 · Simbología por rendimiento diferenciada para satélite:
  // no depende solo del color; combina color + patrón de línea + grosor + halo general.
  if(clase === 'tchCritico'){
    out.fillColor = '#ef233c';
    out.color = '#ff1744';
    out.fillOpacity = satelliteLike ? .42 : .68;
    out.weight = satelliteLike ? 4.2 : 2.6;
    out.opacity = 1;
    out.dashArray = null;       // crítico = línea sólida
  } else if(clase === 'tchBajo'){
    out.fillColor = '#ffb000';
    out.color = '#ff7a00';
    out.fillOpacity = satelliteLike ? .38 : .62;
    out.weight = satelliteLike ? 3.8 : 2.4;
    out.opacity = 1;
    out.dashArray = satelliteLike ? '10 5' : '8 4'; // bajo = línea discontinua
  } else if(clase === 'tchAlto'){
    // En satélite se evita verde puro porque se pierde con la vegetación.
    out.fillColor = satelliteLike ? '#00e5ff' : '#0b7f3a';
    out.color = satelliteLike ? '#00bcd4' : '#075e2d';
    out.fillOpacity = satelliteLike ? .34 : .58;
    out.weight = satelliteLike ? 3.6 : 2.4;
    out.opacity = 1;
    out.dashArray = satelliteLike ? '2 6' : null; // alto rendimiento = trazo punteado/cian en satélite
  }
  out.lineCap = 'round';
  out.lineJoin = 'round';
  return out;
}
function smartStyle(feature){
  let st=baseRawStyle(feature); const p=feature?.properties||{}; const m=metricasFor(p);
  const under40=$('layerTchUnder40')?.checked; const under50=$('layerTchUnder50')?.checked; const over70=$('layerTchOver70')?.checked;
  const ageUnder3=$('layerAgeUnder3')?.checked; const age4to6=$('layerAge4to6')?.checked; const ageOver6=$('layerAgeOver6')?.checked; const byVar=$('layerVariety')?.checked;
  const tch=Number(m.tch_ultima_zafra); const edad=edadActualMetric(m); const varVal=$('layerVarietyValue')?.value;
  if(byVar && varVal){ st.fillOpacity=(m.variedad===varVal)?0.62:0.12; st.fillColor=(m.variedad===varVal)?'#005baa':'#94a3b8'; st.color=(m.variedad===varVal)?'#002f5f':'#cbd5e1'; st.dashArray=null; }
  // Edad mantiene prioridad visual secundaria; rendimiento se aplica al final para que sus rangos sean claros si están activados.
  if(ageUnder3 && Number.isFinite(edad) && edad<3){ st.fillColor='#38bdf8'; st.fillOpacity=.46; st.color='#0369a1'; st.dashArray=null; }
  if(age4to6 && Number.isFinite(edad) && edad>=4 && edad<=6){ st.fillColor='#f4c542'; st.fillOpacity=.54; st.color='#8a5a00'; st.dashArray=null; }
  if(ageOver6 && Number.isFinite(edad) && edad>6){ st.fillColor='#b7791f'; st.fillOpacity=.60; st.color='#7c4a03'; st.dashArray=null; }
  // Rendimiento mutuamente diferenciable: <40 crítico, 40-50 bajo, >70 alto.
  if(over70 && Number.isFinite(tch) && tch>70){ st = rendimientoLayerStyle(st, 'tchAlto'); }
  if(under50 && Number.isFinite(tch) && tch<50 && !(under40 && tch<40)){ st = rendimientoLayerStyle(st, 'tchBajo'); }
  if(under40 && Number.isFinite(tch) && tch<40){ st = rendimientoLayerStyle(st, 'tchCritico'); }
  return applyVisualPolygonStyle(st, feature, 'smart');
}
function updateLayerSummary(){
  const el=$('layerSummary'); if(!el) return;
  let u40=0, u50=0, o70=0, ageU3=0, age46=0, ageO6=0, varCnt=0; const v=$('layerVarietyValue')?.value;
  polygonsLayer?.eachLayer(layer=>{const m=metricasFor(layer.feature?.properties||{}); const tch=Number(m.tch_ultima_zafra); const edad=edadActualMetric(m); if(Number.isFinite(tch)&&tch<40) u40++; if(Number.isFinite(tch)&&tch<50) u50++; if(Number.isFinite(tch)&&tch>70) o70++; if(Number.isFinite(edad)&&edad<3) ageU3++; if(Number.isFinite(edad)&&edad>=4&&edad<=6) age46++; if(Number.isFinite(edad)&&edad>6) ageO6++; if(v&&m.variedad===v) varCnt++;});
  const mode = getEffectivePolygonVisualMode?.() || 'normal';
  const rendNote = (mode==='satellite' || mode==='highContrast') ? '<br><span class="rend-legend"><i class="rend-swatch crit"></i>&lt;40 sólido rojo · <i class="rend-swatch low"></i>40–50 naranja discontinuo · <i class="rend-swatch high"></i>&gt;70 cian punteado</span>' : '<br><span class="rend-legend"><i class="rend-swatch crit"></i>&lt;40 rojo · <i class="rend-swatch low"></i>40–50 naranja · <i class="rend-swatch high normal"></i>&gt;70 verde</span>';
  el.innerHTML=`TCH &lt; 40: <b>${u40}</b> · TCH &lt; 50: <b>${u50}</b> · TCH &gt; 70: <b>${o70}</b> · Edad &lt; 3 meses: <b>${ageU3}</b> · Edad 4–6 meses: <b>${age46}</b> · Edad &gt; 6 meses: <b>${ageO6}</b> · Variedad: <b>${varCnt}</b>${rendNote}`;
}



// V13 · Modo recorrido validado en campo: throttle 1.5 s, distancia haversine, duración, zoom al recorrido y CSV con resumen.
let routeActive=false, routePoints=[], routeLine=null, routeStartTime=null, routeVisited={};
let routeDistanceM=0, _lastRouteLng=null, _lastRouteLat=null, _lastRouteTms=0;
function bindRouteUi(){
  if(!window.__casurRouteTicker){ window.__casurRouteTicker=setInterval(()=>{ if(routeActive){ renderRouteSummary(); updateFieldPanel(); } }, 1000); }
  $('btnStartRoute')?.addEventListener('click', startRoute);
  $('btnStopRoute')?.addEventListener('click', stopRoute);
  $('btnExportRoute')?.addEventListener('click', exportRouteCsv);
  $('btnClearRoute')?.addEventListener('click', clearRoute);
  $('btnZoomRoute')?.addEventListener('click', zoomToRoute);
  renderRouteSummary();
}
function startRoute(){ routeActive=true; routeStartTime=routeStartTime||new Date(); if(!watchId) startLocation(); renderRouteSummary(); updateFieldPanel(); }
function stopRoute(){ routeActive=false; renderRouteSummary(); updateFieldPanel(); }
function clearRoute(){
  if(!routePoints.length || confirm('¿Limpiar recorrido actual?')){
    routePoints=[]; routeVisited={}; routeStartTime=null;
    routeDistanceM=0; _lastRouteLng=null; _lastRouteLat=null; _lastRouteTms=0;
    if(routeLine){ routeLine.remove(); routeLine=null; }
    renderRouteSummary(); updateFieldPanel();
  }
}
function zoomToRoute(){
  if(!routePoints.length){ alert('No hay puntos de recorrido para encuadrar.'); return; }
  map.fitBounds(L.latLngBounds(routePoints.map(p=>[p.lat,p.lng])),{padding:[30,30]});
}
function trackRouteCandidates(lng,lat,acc,speed,candidates){
  if(!routeActive) return;
  const now=Date.now();
  if(now-_lastRouteTms<1500) return;
  _lastRouteTms=now;
  const key=(candidates.find(c=>c.inside)||candidates[0]||{}).key || '';
  if(_lastRouteLng!==null) routeDistanceM += haversineM(_lastRouteLng,_lastRouteLat,lng,lat);
  _lastRouteLng=lng; _lastRouteLat=lat;
  routePoints.push({t:new Date(now).toISOString(),lat,lng,acc:Math.round(acc||0),speed_mps:speed??'',codlote:key?displayCode(key):''});
  if(key) routeVisited[displayCode(key)]=true;
  if(map){
    const latlngs=routePoints.map(p=>[p.lat,p.lng]);
    if(!routeLine) routeLine=L.polyline(latlngs,{color:'#005baa',weight:4,opacity:.85}).addTo(map); else routeLine.setLatLngs(latlngs);
  }
  renderRouteSummary(); updateFieldPanel();
}
function fmtDur(ms){ const s=Math.floor(ms/1000), h=Math.floor(s/3600), m=Math.floor((s%3600)/60), ss=s%60; return h?`${h}h ${m}m`:(m?`${m}m ${ss}s`:`${ss}s`); }
function fmtDist(m){ return m>=1000?`${(m/1000).toFixed(2)} km`:`${Math.round(m)} m`; }
function renderRouteSummary(){
  const el=$('routeSummary'); if(!el) return;
  const visited=Object.keys(routeVisited);
  const status=routeActive?'🔴 Activo':'⬛ Detenido';
  const dur=routeStartTime?` · ${fmtDur(Date.now()-routeStartTime.getTime())}`:'';
  const dist=routeDistanceM>0?` · ${fmtDist(routeDistanceM)}`:'';
  el.innerHTML=`<b>${status}</b>${dur}${dist} · ${routePoints.length} pts` + `<br><small>${visited.length} lotes${visited.length?': '+visited.slice(0,5).join(' · ')+(visited.length>5?'…':''):' visitados'}</small>`;
}
function exportRouteCsv(){
  if(!routePoints.length){ alert('No hay recorrido para exportar.'); return; }
  const visited=Object.keys(routeVisited);
  const dur=routeStartTime?fmtDur(Date.now()-routeStartTime.getTime()):'—';
  const resumen=`# CASUR Maps V19.3 · Recorrido · Inicio: ${routeStartTime?.toLocaleString('es-NI')||'—'} · Duración: ${dur} · Distancia: ${fmtDist(routeDistanceM)} · Puntos GPS: ${routePoints.length} · Lotes visitados: ${visited.length}` + (visited.length?` · Lotes: ${visited.join('; ')}`:'');
  const headers=['t','lat','lng','acc','speed_mps','codlote'];
  const rows=[resumen,headers.join(',')].concat(routePoints.map(p=>headers.map(h=>'"'+String(p[h]??'').replace(/"/g,'""')+'"').join(',')));
  downloadText(`recorrido_casur_${new Date().toISOString().slice(0,10)}.csv`, rows.join('\n'), 'text/csv;charset=utf-8');
}

// V9 · Ficha rápida offline por lote: no sale del mapa y usa metricas_lote.json + observaciones locales.
function metricNumberValue(m, keys){
  for(const k of keys){ const v=Number(m && m[k]); if(Number.isFinite(v)) return v; }
  return null;
}
function metricTextValue(m, keys, fallback='—'){
  for(const k of keys){ const v=m && m[k]; if(v!==undefined && v!==null && String(v).trim()!=='') return String(v); }
  return fallback;
}
function trendFromMetrics(m){
  const explicit=metricTextValue(m,['tendencia_productiva','tendencia'],'');
  if(explicit) return explicit;
  const ult=metricNumberValue(m,['tch_ultima_zafra','TCH_Ultima_Zafra']);
  const prom=metricNumberValue(m,['tch_promedio_historico','tch_promedio','TCH_Promedio']);
  if(!Number.isFinite(ult) || !Number.isFinite(prom)) return 'Sin datos';
  const diff=ult-prom;
  if(diff>=5) return 'Mejora';
  if(diff<=-5) return 'Baja';
  return 'Estable';
}
function qv(label,value){ return `<div class="qkpi"><span>${escapeHtml(label)}</span><b>${escapeHtml(fmt(value))}</b></div>`; }
function openQuickFichaFromSelected(){
  if(!selectedProps){ alert('Seleccione primero un polígono.'); return; }
  openQuickFichaForProps(selectedProps);
}
function closeQuickFicha(){ $('quickFichaModal')?.classList.add('hidden'); }
function openQuickFichaForProps(p){
  const modal=$('quickFichaModal'), content=$('quickFichaContent');
  if(!modal || !content) return;
  content.innerHTML=renderQuickFichaHtml(p);
  modal.classList.remove('hidden');
}
function renderQuickFichaHtml(p){
  const cod=displayCode(getCodLote(p));
  const m=metricasFor(p);
  const totalRaw=Number.isFinite(Number(m.area_shape_total_ha)) ? m.area_shape_total_ha : m.area_total_ha;
  const areaTotal=Number.isFinite(Number(totalRaw)) ? formatHa(totalRaw) : formatHa(p.Area_Ha);
  const areaShape=p.Area_Ha!==undefined ? formatHa(p.Area_Ha) : '—';
  const hacienda=metricTextValue(m,['hacienda_productor','Hacienda_Productor'],'Sin dato histórico');
  const tablon=getTablon(p)||metricTextValue(m,['tablon_default','Tablon'],'—');
  const tchUlt=metricNumberValue(m,['tch_ultima_zafra','TCH_Ultima_Zafra']);
  const tchProm=metricNumberValue(m,['tch_promedio_historico','tch_promedio','TCH_Promedio']);
  const mejor=metricNumberValue(m,['mejor_zafra','Mejor_Zafra','tch_mejor_zafra']);
  const peor=metricNumberValue(m,['peor_zafra','Peor_Zafra','tch_peor_zafra']);
  const edadMes=edadActualMetric(m), edadDias=edadActualDays(m);
  const fechaCorte=metricTextValue(m,['fecha_ultimo_corte','fecha_base_edad','Fecha_Ultimo_Corte'],'—');
  const variedad=metricTextValue(m,['variedad','Variedad'],'—');
  const zona=metricTextValue(m,['zona','Zona'],'—');
  const status=agroStatusFor(m);
  const obs=getObservations().filter(o=>displayCode(o.codlote)===cod).slice(-5).reverse();
  const obsHtml=obs.length?`<div class="quick-obs-list">${obs.map(o=>`<div class="quick-obs-item"><b>${escapeHtml(o.categoria)} · ${escapeHtml(o.severidad)}</b><small>${escapeHtml(new Date(o.fecha_hora).toLocaleString('es-NI'))}</small><div>${escapeHtml(o.nota||'Sin nota')}</div></div>`).join('')}</div>`:'<div class="quick-ficha-empty">Sin observaciones locales para este CodLote.</div>';
  return `<div class="quick-ficha-head"><small>Ficha rápida offline</small><h2>CODLOTE ${escapeHtml(cod)} (${escapeHtml(areaTotal)})</h2><p>${escapeHtml(hacienda)}<br>Tablón ${escapeHtml(tablon)}</p><span class="quick-ficha-status ${escapeHtml(status.cls)}">${escapeHtml(status.label)}</span></div>
  <div class="quick-ficha-kpis">
    ${qv('Área total CODLOTE',areaTotal)}${qv('Área Shape',areaShape)}${qv('TCH última zafra',Number.isFinite(tchUlt)?formatMetric(tchUlt,' t/ha'):'—')}${qv('TCH promedio',Number.isFinite(tchProm)?formatMetric(tchProm,' t/ha'):'—')}
    ${qv('Mejor zafra',Number.isFinite(mejor)?formatMetric(mejor,' t/ha'):'—')}${qv('Peor zafra',Number.isFinite(peor)?formatMetric(peor,' t/ha'):'—')}${qv('Tendencia',trendFromMetrics(m))}${qv('Edad actual',Number.isFinite(edadMes)?formatMetric(edadMes,' meses'):'—')}
    ${qv('Días desde corte',Number.isFinite(edadDias)?nf.format(edadDias)+' días':'—')}${qv('Último corte',fechaCorte)}${qv('Variedad',variedad)}${qv('Zona',zona)}
  </div>
  <div class="quick-ficha-section"><h3>Observaciones locales</h3>${obsHtml}</div>
  <div class="quick-ficha-actions"><a class="crono" href="${escapeHtml(urlFor('crono',p))}">Cronológico completo</a><a class="hist" href="${escapeHtml(urlFor('historico',p))}">Histórico completo</a><button class="obs" onclick="openObservationForm(selectedProps); closeQuickFicha();" type="button">Registrar observación</button><button class="close" onclick="closeQuickFicha()" type="button">Cerrar</button></div>`;
}
const casurExtraActionsBeforeV9 = extraFeatureActions;
extraFeatureActions = function(p){
  return `<div class="extra-actions quick-ficha-row"><button type="button" class="quick-ficha-btn" onclick="openQuickFichaForProps(selectedProps||{})">▤ Ficha rápida offline</button></div>` + casurExtraActionsBeforeV9(p);
};
const casurBindUiBeforeV9 = bindUi;
bindUi = function(){ casurBindUiBeforeV9(); $('quickFichaClose')?.addEventListener('click', closeQuickFicha); };
window.openQuickFichaFromSelected=openQuickFichaFromSelected;
window.openQuickFichaForProps=openQuickFichaForProps;
window.closeQuickFicha=closeQuickFicha;


// V10 · Visita de campo: trazabilidad local acumulada, sin molestar el mapa.
const VISIT_KEY='casur_maps_visitas_v10';
const VISIT_ACTIVE_KEY='casur_maps_visita_activa_v10';
let currentVisit=null;
function getVisits(){try{return JSON.parse(localStorage.getItem(VISIT_KEY)||'[]');}catch(e){return [];}}
function setVisits(arr){localStorage.setItem(VISIT_KEY,JSON.stringify(arr||[])); renderVisitSummary();}
function loadActiveVisit(){
  // V13.1 · FIX crítico: cargar la visita activa NO debe volver a llamar renderVisitSummary(),
  // porque renderVisitSummary() puede necesitar leer currentVisit. La llamada circular provocaba
  // 'Maximum call stack size exceeded' al iniciar la app cuando no había visita activa.
  try{ currentVisit=JSON.parse(localStorage.getItem(VISIT_ACTIVE_KEY)||'null'); }catch(e){ currentVisit=null; }
  return currentVisit;
}
function saveActiveVisit(){ if(currentVisit) localStorage.setItem(VISIT_ACTIVE_KEY,JSON.stringify(currentVisit)); else localStorage.removeItem(VISIT_ACTIVE_KEY); renderVisitSummary();}
function startFieldVisit(){
  if(currentVisit && currentVisit.active){ alert('Ya hay una visita activa. Finalícela antes de iniciar otra.'); return; }
  currentVisit={id:'VIS-'+Date.now(),active:true,start:new Date().toISOString(),end:null,points:[],lots:{},obsStartCount:getObservations().length};
  saveActiveVisit(); if(!watchId) startLocation(); alert('Visita de campo iniciada.');
}
function finishFieldVisit(){
  if(!currentVisit || !currentVisit.active){ alert('No hay visita activa.'); return; }
  currentVisit.active=false; currentVisit.end=new Date().toISOString();
  currentVisit.distance_m=Math.round(distanceForVisit(currentVisit.points));
  currentVisit.avg_acc=avgVisitAcc(currentVisit.points);
  const visits=getVisits(); visits.push(currentVisit); setVisits(visits); currentVisit=null; saveActiveVisit(); alert('Visita guardada en este dispositivo.');
}
function trackVisitCandidates(lng,lat,acc,speed,candidates){
  if(!currentVisit || !currentVisit.active) return;
  const now=new Date(); const key=(candidates.find(c=>c.inside)||candidates[0]||{}).key || '';
  const cod=key?displayCode(key):'';
  currentVisit.points.push({t:now.toISOString(),lat,lng,acc:Math.round(acc||0),speed_mps:speed??'',codlote:cod});
  if(cod) currentVisit.lots[cod]=(currentVisit.lots[cod]||0)+1;
  if(currentVisit.points.length%3===0) saveActiveVisit(); else renderVisitSummary();
}
function distanceForVisit(points){let d=0; for(let i=1;i<(points||[]).length;i++){d+=haversineM(points[i-1].lng,points[i-1].lat,points[i].lng,points[i].lat);} return d;}
function avgVisitAcc(points){const vals=(points||[]).map(p=>Number(p.acc)).filter(Number.isFinite); return vals.length?Math.round(vals.reduce((a,b)=>a+b,0)/vals.length):'';}
function fmtDuration(ms){ if(!Number.isFinite(ms)||ms<0) return '—'; const m=Math.round(ms/60000); const h=Math.floor(m/60), mm=m%60; return h?`${h}h ${mm}min`:`${mm}min`; }
function visitDuration(v){const a=new Date(v.start).getTime(), b=new Date(v.end||new Date()).getTime(); return fmtDuration(b-a);}
function renderVisitSummary(){
  const el=$('visitSummary'); if(!el) return;
  // V13.1 · No llamar loadActiveVisit() desde aquí para evitar recursión.
  const visits=getVisits();
  if(currentVisit && currentVisit.active){ const lots=Object.keys(currentVisit.lots||{}); el.innerHTML=`<b>Visita activa</b> · ${visitDuration(currentVisit)}<small>${currentVisit.points.length} puntos GPS · ${lots.length} lotes · ${lots.slice(0,4).join(' · ')}</small>`; updateFieldPanel(); return; }
  const last=visits[visits.length-1];
  el.innerHTML=last?`<b>${visits.length}</b> visitas guardadas<small>Última: ${new Date(last.start).toLocaleString('es-NI')} · ${visitDuration(last)} · ${Object.keys(last.lots||{}).length} lotes · ${Math.round((last.distance_m||0)/100)/10} km</small>`:'Sin visita activa.'; updateFieldPanel();
}
function exportVisitsCsv(){
  const visits=getVisits(); if(!visits.length){ alert('No hay visitas guardadas para exportar.'); return; }
  const headers=['id','inicio','fin','duracion','puntos_gps','lotes_visitados','distancia_m','precision_promedio_m','observaciones_desde_inicio'];
  const rows=[headers.join(',')].concat(visits.map(v=>[v.id,v.start,v.end||'',visitDuration(v),(v.points||[]).length,Object.keys(v.lots||{}).join('|'),v.distance_m||0,v.avg_acc||'',Math.max(0,getObservations().length-(v.obsStartCount||0))].map(x=>'"'+String(x??'').replace(/"/g,'""')+'"').join(',')));
  downloadText('visitas_campo_casur_maps.csv',rows.join('\n'),'text/csv;charset=utf-8');
}
function clearVisits(){ if(confirm('¿Borrar visitas locales guardadas en este dispositivo?')){ setVisits([]); currentVisit=null; saveActiveVisit(); } }
function bindVisitUi(){
  $('btnStartVisit')?.addEventListener('click',startFieldVisit);
  $('btnFinishVisit')?.addEventListener('click',finishFieldVisit);
  $('btnExportVisits')?.addEventListener('click',exportVisitsCsv);
  $('btnClearVisits')?.addEventListener('click',clearVisits);
  loadActiveVisit();
  renderVisitSummary();
}
const casurBindUiBeforeV10=bindUi; bindUi=function(){casurBindUiBeforeV10(); bindVisitUi();};
const casurTrackRouteBeforeV10=trackRouteCandidates; trackRouteCandidates=function(lng,lat,acc,speed,candidates){ casurTrackRouteBeforeV10(lng,lat,acc,speed,candidates); trackVisitCandidates(lng,lat,acc,speed,candidates); };
window.startFieldVisit=startFieldVisit; window.finishFieldVisit=finishFieldVisit;


// V11 · Reporte de visita HTML descargable/imprimible.
function latestVisit(){ const visits=getVisits(); return visits[visits.length-1] || null; }
function visitObservations(v){
  if(!v) return [];
  const start=new Date(v.start).getTime(), end=new Date(v.end||new Date()).getTime();
  return getObservations().filter(o=>{const t=new Date(o.fecha_hora).getTime(); return t>=start && t<=end;});
}
function codMeta(cod){ return ((METRICAS||{}).lotes||{})[displayCode(cod)] || ((METRICAS||{}).lotes||{})[cod] || {}; }
function buildVisitReportHtml(v){
  const obs=visitObservations(v), lots=Object.keys(v.lots||{});
  const byLot={}; obs.forEach(o=>{const c=displayCode(o.codlote||'SIN'); (byLot[c]=byLot[c]||[]).push(o);});
  const rowsLots=lots.map(c=>{const m=codMeta(c); return `<tr><td><b>${escapeHtml(c)}</b></td><td>${escapeHtml(m.hacienda_productor||'—')}</td><td>${escapeHtml(m.variedad||'—')}</td><td>${Number.isFinite(Number(m.tch_ultima_zafra))?formatMetric(m.tch_ultima_zafra,' t/ha'):'—'}</td><td>${(v.lots||{})[c]}</td></tr>`;}).join('');
  const rowsObs=obs.map(o=>`<tr><td>${escapeHtml(new Date(o.fecha_hora).toLocaleString('es-NI'))}</td><td>${escapeHtml(o.codlote)}</td><td>${escapeHtml(o.hacienda_productor||'—')}</td><td>${escapeHtml(o.categoria)}</td><td>${escapeHtml(o.severidad)}</td><td>${escapeHtml(o.nota||'—')}</td><td>${escapeHtml(o.lat||'')}, ${escapeHtml(o.lng||'')}</td></tr>`).join('');
  const nextSteps=obs.length?'<ul>'+Object.keys(byLot).slice(0,6).map(c=>`<li>Dar seguimiento al CODLOTE ${escapeHtml(c)} por observaciones registradas.</li>`).join('')+'</ul>':'<p>No se registraron observaciones. Mantener seguimiento según prioridad agronómica.</p>';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte de visita CASUR Maps</title><style>@page{size:letter;margin:12mm}body{font-family:Segoe UI,Roboto,Arial,sans-serif;color:#17212b;margin:0;background:#f6faf7}.top{height:6px;background:linear-gradient(90deg,#0b7f3a 0 42%,#005baa 42% 78%,#f4c542 78%)}main{max-width:980px;margin:auto;padding:18px}.hero{background:linear-gradient(135deg,#07381d,#0b7f3a 60%,#005baa);color:white;border-radius:22px;padding:20px;margin-bottom:14px}h1{margin:0;font-size:28px}.hero p{margin:6px 0 0;color:rgba(255,255,255,.85);font-weight:700}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi{background:white;border:1px solid #dbe5dd;border-radius:16px;padding:12px}.kpi span{display:block;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase}.kpi b{display:block;margin-top:5px;font-size:20px;color:#0b6031}.card{background:white;border:1px solid #dbe5dd;border-radius:18px;padding:14px;margin-top:12px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0b7f3a;color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}.footer{text-align:center;color:#64748b;font-size:11px;margin-top:18px}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}main{padding:10px}}@media print{body{background:white}.card,.kpi{box-shadow:none}}</style></head><body><div class="top"></div><main><section class="hero"><h1>Reporte de visita CASUR Maps</h1><p>Departamento de Negocios de Caña · Consulta generada ${escapeHtml(new Date().toLocaleString('es-NI'))}</p></section><section class="grid"><div class="kpi"><span>Fecha inicio</span><b>${escapeHtml(new Date(v.start).toLocaleString('es-NI'))}</b></div><div class="kpi"><span>Duración</span><b>${escapeHtml(visitDuration(v))}</b></div><div class="kpi"><span>Lotes visitados</span><b>${lots.length}</b></div><div class="kpi"><span>Observaciones</span><b>${obs.length}</b></div></section><section class="card"><h2>Resumen operativo</h2><p><b>Distancia aproximada:</b> ${escapeHtml(Math.round((v.distance_m||0)/100)/10)} km · <b>Puntos GPS:</b> ${(v.points||[]).length} · <b>Precisión promedio:</b> ${escapeHtml(v.avg_acc||'—')} m.</p></section><section class="card"><h2>Lotes visitados</h2><table><thead><tr><th>CODLOTE</th><th>Hacienda/Productor</th><th>Variedad</th><th>TCH última zafra</th><th>Lecturas GPS</th></tr></thead><tbody>${rowsLots||'<tr><td colspan="5">Sin lotes registrados.</td></tr>'}</tbody></table></section><section class="card"><h2>Observaciones registradas</h2><table><thead><tr><th>Hora</th><th>CODLOTE</th><th>Hacienda/Productor</th><th>Categoría</th><th>Severidad</th><th>Nota</th><th>Coordenadas</th></tr></thead><tbody>${rowsObs||'<tr><td colspan="7">Sin observaciones en la visita.</td></tr>'}</tbody></table></section><section class="card"><h2>Próximos pasos sugeridos</h2>${nextSteps}</section><div class="footer">Documento generado localmente por CASUR Maps · PWA de campo</div></main></body></html>`;
}
function generateVisitReport(download=true){
  const v=latestVisit(); if(!v){ alert('No hay visita guardada. Inicie y finalice una visita primero.'); return; }
  const html=buildVisitReportHtml(v); const name='reporte_visita_casur_maps_'+(v.id||Date.now())+'.html';
  if(download) downloadText(name,html,'text/html;charset=utf-8'); else { const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); } }
  const el=$('reportSummary'); if(el) el.innerHTML=`Último reporte: <b>${escapeHtml(v.id)}</b> · ${escapeHtml(visitDuration(v))} · ${Object.keys(v.lots||{}).length} lotes.`;
}
function bindReportUi(){ $('btnGenerateReport')?.addEventListener('click',()=>generateVisitReport(true)); $('btnPreviewReport')?.addEventListener('click',()=>generateVisitReport(false)); }
const casurBindUiBeforeV11=bindUi; bindUi=function(){casurBindUiBeforeV11(); bindReportUi();};
window.generateVisitReport=generateVisitReport;


// V14 · Navegación PRO y bloqueo de lote.
const LOCK_KEY_V14 = 'casur_maps_lote_bloqueado_v14';
let lockedLot = null;
function getLockedLot(){
  if(lockedLot) return lockedLot;
  try{ lockedLot = JSON.parse(localStorage.getItem(LOCK_KEY_V14)||'null'); }catch(e){ lockedLot=null; }
  return lockedLot;
}
function isLotLocked(){ const l=getLockedLot(); return !!(l && l.codlote); }
function lockedLotKey(){ const l=getLockedLot(); return l ? displayCode(l.codlote) : ''; }
function lockCurrentLot(){
  if(!selectedProps){ alert('Seleccione o detecte un lote antes de bloquear.'); return; }
  const cod=displayCode(getCodLote(selectedProps));
  const m=metricasFor(selectedProps);
  lockedLot={codlote:cod, hacienda_productor:m.hacienda_productor||'', tablon:getTablon(selectedProps)||'', ts:new Date().toISOString(), props:selectedProps};
  localStorage.setItem(LOCK_KEY_V14, JSON.stringify(lockedLot));
  updateLockLotUi(); updateFieldPanel(selectedProps);
  setStatus('Lote bloqueado · '+cod,true);
}
function unlockLot(){
  lockedLot=null; localStorage.removeItem(LOCK_KEY_V14);
  updateLockLotUi(); updateFieldPanel(selectedProps);
  setStatus('Lote desbloqueado', !!lastGpsFix);
}
function updateLockLotUi(){
  const el=$('lockLotStatus'); if(!el) return;
  const l=getLockedLot();
  if(l && l.codlote){
    el.classList.add('locked');
    el.innerHTML=`<b>🔒 Lote bloqueado:</b> CODLOTE ${escapeHtml(displayCode(l.codlote))}<br><small>${escapeHtml(l.hacienda_productor||'Sin productor')} · Tablón ${escapeHtml(l.tablon||'—')}</small>`;
  }else{
    el.classList.remove('locked');
    el.innerHTML='Sin lote bloqueado. Si está en camino, borde o cuatro esquinas, seleccione el lote correcto y bloquéelo.';
  }
}
function centerSelectedLot(){ if(selectedLayer){ map.fitBounds(selectedLayer.getBounds(), {padding:[30,30], maxZoom:19}); } else alert('Seleccione primero un lote.'); }
function updateGpsDiagnosticFromPos(pos){
  if(!pos || !pos.coords) return;
  const c=pos.coords, acc=Math.round(c.accuracy||0), speed=c.speed ?? null;
  const q=precisionLabel(acc);
  const diag=$('gpsDiagnosticPanel');
  if(diag){
    const h=Number.isFinite(lastHeadingDeg)?`${Math.round(lastHeadingDeg)}° (${headingCardinal(lastHeadingDeg)})`:'—';
    diag.innerHTML=`<b>Diagnóstico GPS</b><br>Precisión: <b>${acc} m</b> · calidad <b>${q.txt}</b><br>Velocidad: <b>${speedLabel(speed)}</b> · Rumbo: <b>${h}</b><br>Orientación: <b>${headingMode==='course'?'Rumbo arriba':'Norte arriba'}</b> · Seguimiento: <b>${following?'activo':'manual'}</b>`;
  }
  const alertEl=$('gpsPrecisionAlert'); if(alertEl){ alertEl.classList.toggle('hidden', acc<=30); }
}
const casurSelectBeforeV14 = selectFeature;
selectFeature = function(feature, layer, zoom, fromGps=false){
  const newKey=displayCode(getCodLote(feature?.properties||{}));
  const locked=lockedLotKey();
  if(fromGps && locked && newKey && newKey!==locked){
    setStatus('Lote bloqueado · manteniendo '+locked,true);
    updateGpsStatusBar('Lote bloqueado '+locked, 'GPS detectó '+newKey+' pero no se cambia automáticamente.', 'Ver', lastGpsHtml || '', 'warn', false);
    updateLockLotUi();
    return;
  }
  return casurSelectBeforeV14(feature, layer, zoom, fromGps);
};
const casurSmoothHeadingBeforeV14 = smoothHeading;
smoothHeading = function(prev,next,alpha=.18){
  if(!Number.isFinite(next)) return Number.isFinite(prev)?prev:null;
  if(!Number.isFinite(prev)) return next;
  const diff=((next-prev+540)%360)-180;
  if(Math.abs(diff)<3) return prev;
  return (prev + diff*alpha + 360) % 360;
};
const casurOnPositionBeforeV14 = onPosition;
onPosition = function(pos){ casurOnPositionBeforeV14(pos); updateGpsDiagnosticFromPos(pos); };
const casurUpdateFieldPanelBeforeV14 = updateFieldPanel;
updateFieldPanel = function(p=selectedProps){
  casurUpdateFieldPanelBeforeV14(p);
  updateLockLotUi();
  const lot=$('fieldLotPanel'); const l=getLockedLot();
  if(l && lot){
    lot.classList.add('locked-lot');
    // V19 FIX: eliminar chip anterior antes de insertar nuevo (evita acumulación infinita por cada fix GPS)
    lot.querySelector('.gps-lock-chip')?.remove();
    lot.insertAdjacentHTML('beforeend', `<div class="gps-lock-chip">🔒 Bloqueado · ${escapeHtml(displayCode(l.codlote))}</div>`);
  } else if(lot){
    lot.classList.remove('locked-lot');
    lot.querySelector('.gps-lock-chip')?.remove();
  }
};
const casurBindUiBeforeV14 = bindUi;
bindUi = function(){
  casurBindUiBeforeV14();
  $('btnLockLot')?.addEventListener('click', lockCurrentLot);
  $('btnUnlockLot')?.addEventListener('click', unlockLot);
  $('btnCenterSelectedLot')?.addEventListener('click', centerSelectedLot);
  $('btnCenterGpsPro')?.addEventListener('click', centerGps);
  updateLockLotUi();
};
window.lockCurrentLot=lockCurrentLot; window.unlockLot=unlockLot; window.centerSelectedLot=centerSelectedLot;


// V15 · Campo Offline básico: la app no queda en blanco si falla conexión; polígonos/datos siguen activos desde cache.
let tileErrorCountV15 = 0;
function updateConnectivityUi(){
  const offline=!navigator.onLine || tileErrorCountV15>8;
  const badge=$('connectivityBadge'), notice=$('offlineMapNotice'), panel=$('offlinePanel');
  if(badge){ badge.textContent=offline?'Sin señal':'Online'; badge.classList.toggle('offline', offline); badge.classList.toggle('online', !offline); }
  if(notice){ notice.classList.toggle('hidden', !offline); }
  if(panel){
    panel.classList.toggle('offline', offline);
    panel.innerHTML=offline ? '<b>Modo sin señal básico activo.</b><br>Polígonos CASUR, GPS, ficha rápida, observaciones, visita y recorrido siguen disponibles.' : 'Online · mapa base disponible según conexión.';
  }
}
function bindOfflineWatchers(){
  window.addEventListener('online', ()=>{tileErrorCountV15=0; updateConnectivityUi();});
  window.addEventListener('offline', updateConnectivityUi);
  if(map){ map.on('tileerror', ()=>{ tileErrorCountV15++; updateConnectivityUi(); }); }
  updateConnectivityUi();
}
const casurBindUiBeforeV15 = bindUi;
bindUi = function(){ casurBindUiBeforeV15(); bindOfflineWatchers(); };


// V17 · Reporte Ejecutivo de Campo CASUR Maps.
function buildExecutiveVisitReportHtml(v){
  const obs=visitObservations(v), lots=Object.keys(v.lots||{});
  const producers={}; lots.forEach(c=>{ const m=codMeta(c); const h=m.hacienda_productor||'Sin dato'; (producers[h]=producers[h]||[]).push(c); });
  const sevAlta=obs.filter(o=>String(o.severidad).toLowerCase()==='alta').length;
  const cats=[...new Set(obs.map(o=>o.categoria).filter(Boolean))];
  const lectura = lots.length ? `Se visitaron ${lots.length} CodLotes con ${obs.length} observaciones registradas. ${sevAlta?`Hay ${sevAlta} observación(es) de severidad alta que requieren seguimiento prioritario.`:'No se registraron alertas de severidad alta.'}` : 'No se registraron lotes visitados en la visita seleccionada.';
  const rowsByLot = lots.map(c=>{ const m=codMeta(c), o=obs.filter(x=>displayCode(x.codlote)===displayCode(c)); const st=agroStatusFor(m); return `<tr><td><b>${escapeHtml(c)}</b></td><td>${escapeHtml(m.hacienda_productor||'—')}</td><td>${escapeHtml(m.variedad||'—')}</td><td>${Number.isFinite(Number(m.tch_ultima_zafra))?formatMetric(m.tch_ultima_zafra,' t/ha'):'—'}</td><td><span class="pill ${escapeHtml(st.cls)}">${escapeHtml(st.label)}</span></td><td>${o.length}</td></tr>`; }).join('');
  const rowsObs = obs.map(o=>`<tr><td>${escapeHtml(new Date(o.fecha_hora).toLocaleString('es-NI'))}</td><td><b>${escapeHtml(o.codlote)}</b></td><td>${escapeHtml(o.hacienda_productor||'—')}</td><td>${escapeHtml(o.categoria)}</td><td>${escapeHtml(o.severidad)}</td><td>${escapeHtml(o.nota||'—')}</td><td>${escapeHtml(o.lat||'')}, ${escapeHtml(o.lng||'')}</td></tr>`).join('');
  const hallazgos = obs.length ? `<ul>${cats.slice(0,8).map(c=>`<li>${escapeHtml(c)}: ${obs.filter(o=>o.categoria===c).length} registro(s).</li>`).join('')}</ul>` : '<p>No se registraron hallazgos en bitácora.</p>';
  const acciones = obs.length ? `<ol>${obs.filter(o=>String(o.severidad).toLowerCase()==='alta').slice(0,5).map(o=>`<li>Priorizar seguimiento en CODLOTE ${escapeHtml(o.codlote)} por ${escapeHtml(o.categoria)}.</li>`).join('') || '<li>Mantener seguimiento normal y revisar bitácora exportada.</li>'}</ol>` : '<p>Mantener monitoreo según programa de visitas.</p>';
  const prodRows = Object.entries(producers).map(([h, arr])=>`<tr><td>${escapeHtml(h)}</td><td>${arr.length}</td><td>${arr.map(escapeHtml).join(' · ')}</td></tr>`).join('');
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Reporte Ejecutivo de Campo · CASUR Maps</title><style>@page{size:letter;margin:12mm}body{font-family:Segoe UI,Roboto,Arial,sans-serif;background:#f6faf7;color:#17212b;margin:0}.top{height:6px;background:linear-gradient(90deg,#0b7f3a 0 42%,#005baa 42% 78%,#f4c542 78%)}main{max-width:1050px;margin:auto;padding:18px}.hero{background:radial-gradient(circle at top right,rgba(244,197,66,.3),transparent 36%),linear-gradient(135deg,#07381d,#0b7f3a 60%,#005baa);color:#fff;border-radius:24px;padding:22px;margin-bottom:14px}h1{margin:0;font-size:30px}.hero p{margin:7px 0 0;font-weight:750;color:rgba(255,255,255,.86)}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.kpi,.card{background:#fff;border:1px solid #dbe5dd;border-radius:18px;padding:14px;box-shadow:0 8px 22px rgba(15,23,42,.05)}.kpi span{display:block;color:#64748b;font-size:11px;font-weight:900;text-transform:uppercase}.kpi b{display:block;margin-top:5px;font-size:21px;color:#0b6031}.card{margin-top:12px}table{width:100%;border-collapse:collapse;font-size:12px}th{background:#0b7f3a;color:#fff;text-align:left;padding:8px}td{border-bottom:1px solid #e5e7eb;padding:8px;vertical-align:top}.pill{border-radius:999px;padding:4px 7px;font-size:10px;font-weight:900}.pill.good{background:#ecfdf5;color:#075e2d}.pill.warn{background:#fff8df;color:#684500}.pill.bad{background:#fff1f1;color:#7f1d1d}.exec{border-left:6px solid #f4c542}.footer{text-align:center;color:#64748b;font-size:11px;margin-top:18px}@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}main{padding:10px}}@media print{body{background:#fff}.kpi,.card{box-shadow:none}}</style></head><body><div class="top"></div><main><section class="hero"><h1>Reporte Ejecutivo de Campo · CASUR Maps</h1><p>Departamento de Negocios de Caña · Generado ${escapeHtml(new Date().toLocaleString('es-NI'))}</p></section><section class="grid"><div class="kpi"><span>Duración</span><b>${escapeHtml(visitDuration(v))}</b></div><div class="kpi"><span>Distancia</span><b>${escapeHtml(fmtDist(v.distance_m||0))}</b></div><div class="kpi"><span>Lotes visitados</span><b>${lots.length}</b></div><div class="kpi"><span>Observaciones</span><b>${obs.length}</b></div></section><section class="card exec"><h2>Lectura ejecutiva</h2><p>${escapeHtml(lectura)}</p></section><section class="card"><h2>Hallazgos principales</h2>${hallazgos}</section><section class="card"><h2>Resumen por CODLOTE</h2><table><thead><tr><th>CODLOTE</th><th>Hacienda/Productor</th><th>Variedad</th><th>TCH</th><th>Semáforo</th><th>Obs.</th></tr></thead><tbody>${rowsByLot||'<tr><td colspan="6">Sin lotes registrados.</td></tr>'}</tbody></table></section><section class="card"><h2>Resumen por Hacienda/Productor</h2><table><thead><tr><th>Hacienda/Productor</th><th>Lotes</th><th>CODLOTE</th></tr></thead><tbody>${prodRows||'<tr><td colspan="3">Sin datos.</td></tr>'}</tbody></table></section><section class="card"><h2>Observaciones</h2><table><thead><tr><th>Hora</th><th>CODLOTE</th><th>Hacienda/Productor</th><th>Categoría</th><th>Severidad</th><th>Nota</th><th>Coordenadas</th></tr></thead><tbody>${rowsObs||'<tr><td colspan="7">Sin observaciones.</td></tr>'}</tbody></table></section><section class="card exec"><h2>Acciones recomendadas</h2>${acciones}</section><div class="footer">Documento generado localmente por CASUR Maps · PWA de campo</div></main></body></html>`;
}
function generateExecutiveVisitReport(download=true){
  const v=latestVisit(); if(!v){ alert('No hay visita guardada. Inicie y finalice una visita primero.'); return; }
  const html=buildExecutiveVisitReportHtml(v); const name='reporte_ejecutivo_campo_casur_maps_'+(v.id||Date.now())+'.html';
  if(download) downloadText(name,html,'text/html;charset=utf-8'); else { const w=window.open('','_blank'); if(w){ w.document.write(html); w.document.close(); } }
}
const casurBindUiBeforeV17 = bindUi;
bindUi = function(){ casurBindUiBeforeV17(); $('btnGenerateExecutiveReport')?.addEventListener('click',()=>generateExecutiveVisitReport(true)); };
window.generateExecutiveVisitReport=generateExecutiveVisitReport;


// V18 · Fotos georreferenciadas locales con IndexedDB.
const PHOTO_DB_NAME='casur_maps_fotos_v18';
const PHOTO_STORE='photos';
let pendingObsPhoto=null;
function openPhotoDb(){
  return new Promise((resolve,reject)=>{
    const req=indexedDB.open(PHOTO_DB_NAME,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE,{keyPath:'id'}); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
  });
}
async function putPhotoRecord(rec){ const db=await openPhotoDb(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).put(rec); tx.oncomplete=()=>res(rec.id); tx.onerror=()=>rej(tx.error); }); }
async function getPhotoRecord(id){ const db=await openPhotoDb(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readonly'); const r=tx.objectStore(PHOTO_STORE).get(id); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); }); }
async function getAllPhotoRecords(){ const db=await openPhotoDb(); return new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readonly'); const r=tx.objectStore(PHOTO_STORE).getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); }); }
async function clearAllPhotos(){ if(!confirm('¿Borrar todas las fotos locales guardadas en este dispositivo?')) return; const db=await openPhotoDb(); await new Promise((res,rej)=>{ const tx=db.transaction(PHOTO_STORE,'readwrite'); tx.objectStore(PHOTO_STORE).clear(); tx.oncomplete=res; tx.onerror=()=>rej(tx.error); }); alert('Fotos locales borradas.'); }
function fileToDataUrl(file){ return new Promise((res,rej)=>{ const fr=new FileReader(); fr.onload=()=>res(fr.result); fr.onerror=()=>rej(fr.error); fr.readAsDataURL(file); }); }
async function onObsPhotoChange(e){
  const file=e.target.files && e.target.files[0]; const prev=$('obsPhotoPreview');
  if(!file){ pendingObsPhoto=null; if(prev) prev.textContent='Sin foto adjunta.'; return; }
  const dataUrl=await fileToDataUrl(file);
  pendingObsPhoto={file_name:file.name||'foto_casur.jpg', mime:file.type||'image/jpeg', data_url:dataUrl, size:file.size||0};
  if(prev) prev.innerHTML=`<img alt="Foto de observación" src="${dataUrl}"><small>Foto lista para guardar</small>`;
}
function clearPendingPhoto(){ pendingObsPhoto=null; const inp=$('obsPhotoInput'); if(inp) inp.value=''; const prev=$('obsPhotoPreview'); if(prev) prev.textContent='Sin foto adjunta.'; }
const casurOpenObsBeforeV18 = openObservationForm;
openObservationForm = function(p){ casurOpenObsBeforeV18(p); clearPendingPhoto(); };
saveObservation = async function(){
  const modal=$('obsModal'); if(!modal) return;
  const cod=modal.dataset.codlote || ''; if(!cod){ alert('Seleccione primero un lote.'); return; }
  const arr=getObservations(); const m=((METRICAS||{}).lotes||{})[cod] || {};
  let photo_id='', photo_name='';
  if(pendingObsPhoto){
    photo_id='FOTO-'+Date.now(); photo_name=pendingObsPhoto.file_name;
    try{ await putPhotoRecord({id:photo_id, codlote:cod, created_at:new Date().toISOString(), lat:lastGpsFix?lastGpsFix.lat:'', lng:lastGpsFix?lastGpsFix.lng:'', precision_m:lastGpsFix?Math.round(lastGpsFix.acc||0):'', ...pendingObsPhoto}); }
    catch(e){ console.error(e); alert('No se pudo guardar la foto localmente, se guardará la observación sin foto.'); photo_id=''; photo_name=''; }
  }
  arr.push({id:'OBS-'+Date.now(), fecha_hora:new Date().toISOString(), codlote:cod, hacienda_productor:m.hacienda_productor||'', tablon:modal.dataset.tablon||'', categoria:$('obsCategory').value, severidad:$('obsSeverity').value, nota:$('obsNote').value.trim(), lat:lastGpsFix?lastGpsFix.lat:'', lng:lastGpsFix?lastGpsFix.lng:'', precision_m:lastGpsFix?Math.round(lastGpsFix.acc||0):'', usuario:'CASUR Maps', photo_id, photo_name});
  setObservations(arr); closeObservationForm(); clearPendingPhoto(); alert(photo_id?'Observación y foto guardadas localmente.':'Observación guardada en este dispositivo.');
};
exportObservationsCsv = function(){
  const arr=getObservations(); if(!arr.length){ alert('No hay observaciones para exportar.'); return; }
  const headers=['id','fecha_hora','codlote','hacienda_productor','tablon','categoria','severidad','nota','lat','lng','precision_m','usuario','photo_id','photo_name'];
  const rows=[headers.join(',')].concat(arr.map(o=>headers.map(h=>'"'+String(o[h]??'').replace(/"/g,'""')+'"').join(',')));
  downloadText('bitacora_campo_casur_maps_con_fotos.csv', rows.join('\n'), 'text/csv;charset=utf-8');
};
async function renderPhotoThumbsForCod(cod){
  const content=$('quickFichaContent'); if(!content) return;
  const obs=getObservations().filter(o=>displayCode(o.codlote)===displayCode(cod) && o.photo_id).slice(-6).reverse();
  let holder=content.querySelector('.quick-photo-section');
  if(!holder){ holder=document.createElement('div'); holder.className='quick-ficha-section quick-photo-section'; holder.innerHTML='<h3>Fotos locales</h3><div class="quick-photo-grid"></div>'; content.appendChild(holder); }
  const grid=holder.querySelector('.quick-photo-grid');
  if(!obs.length){ grid.innerHTML='<div class="quick-ficha-empty">Sin fotos locales para este CodLote.</div>'; return; }
  // V19: leer todas las fotos de una sola transacción en lugar de N awaits secuenciales
  const allRecs = await getAllPhotoRecords().catch(()=>[]);
  const recsById = Object.fromEntries(allRecs.map(r=>[r.id, r]));
  const items = obs.map(o=>{
    const rec = recsById[o.photo_id];
    if(!rec || !rec.data_url) return '';
    return `<div class="quick-photo" onclick="openPhotoLightbox('${escapeHtml(o.photo_id)}')"><img src="${rec.data_url}" alt="Foto ${escapeHtml(o.codlote)}"><small>${escapeHtml(o.categoria)} · ${escapeHtml(new Date(o.fecha_hora).toLocaleDateString('es-NI'))}</small></div>`;
  }).filter(Boolean);
  grid.innerHTML = items.join('') || '<div class="quick-ficha-empty">No se pudieron leer las fotos locales.</div>';
}
const casurOpenQuickBeforeV18 = openQuickFichaForProps;
openQuickFichaForProps = function(p){ casurOpenQuickBeforeV18(p); renderPhotoThumbsForCod(displayCode(getCodLote(p))); };
const casurRenderObsSummaryBeforeV18 = renderObservationSummary;
renderObservationSummary = function(){
  casurRenderObsSummaryBeforeV18();
  const el=$('obsSummary'); if(!el) return;
  const photos=getObservations().filter(o=>o.photo_id).length;
  if(photos) el.insertAdjacentHTML('beforeend', `<br><span class="obs-photo-chip">📷 ${photos} foto(s) locales</span>`);
};
const casurBindUiBeforeV18 = bindUi;
bindUi = function(){
  casurBindUiBeforeV18();
  $('obsPhotoInput')?.addEventListener('change', onObsPhotoChange);
  $('obsPhotoClear')?.addEventListener('click', clearPendingPhoto);
  $('btnClearPhotos')?.addEventListener('click', clearAllPhotos);
};
window.clearAllPhotos=clearAllPhotos;


// ─────────────────────────────────────────────────────────────────
// V19 · Fixes y mejoras acumulativas
// ─────────────────────────────────────────────────────────────────

// V19 FIX 1 · Throttle trackVisitCandidates: máximo 1 punto cada 5 s para evitar
// acumulación masiva en localStorage durante visitas largas (antes: ~1/s = 7200 pts/2h).
(function(){
  const _orig = trackVisitCandidates;
  let _lastTms = 0;
  trackVisitCandidates = function(lng, lat, acc, speed, candidates){
    const now = Date.now();
    if(now - _lastTms < 5000) return;
    _lastTms = now;
    _orig(lng, lat, acc, speed, candidates);
  };
})();

// V19 FIX 2 · Debounce updateFieldPanel (180 ms): evita 3+ actualizaciones DOM
// consecutivas por cada fix GPS (onPosition → trackRouteCandidates → ticker).
(function(){
  const _orig = updateFieldPanel;
  let _timer = null, _lastArg = undefined;
  updateFieldPanel = function(p){
    _lastArg = p;
    if(_timer) clearTimeout(_timer);
    _timer = setTimeout(()=>{ _orig(_lastArg !== undefined ? _lastArg : selectedProps); _lastArg = undefined; }, 180);
  };
})();

// V19 · Lightbox de fotos: visor a pantalla completa al tocar miniatura en Ficha rápida.
function openPhotoLightbox(photoId){
  getPhotoRecord(photoId).then(rec=>{
    if(!rec || !rec.data_url) return;
    let box = $('photoLightbox');
    if(!box){
      box = document.createElement('div');
      box.id = 'photoLightbox';
      box.className = 'photo-lightbox';
      box.innerHTML = '<div class="photo-lb-wrap"><img id="photoLbImg" alt="Foto campo"><div id="photoLbMeta" class="photo-lb-meta"></div><button id="photoLbClose" type="button">✕ Cerrar</button></div>';
      document.body.appendChild(box);
      box.addEventListener('click', e=>{ if(e.target===box || e.target.id==='photoLbClose') box.classList.add('hidden'); });
    }
    box.querySelector('#photoLbImg').src = rec.data_url;
    const meta = [rec.codlote ? 'CodLote ' + displayCode(rec.codlote) : '', rec.created_at ? new Date(rec.created_at).toLocaleString('es-NI') : '', rec.lat && rec.lng ? `${Number(rec.lat).toFixed(5)}, ${Number(rec.lng).toFixed(5)}` : ''].filter(Boolean).join(' · ');
    box.querySelector('#photoLbMeta').textContent = meta;
    box.classList.remove('hidden');
  }).catch(()=>alert('No se pudo abrir la foto.'));
}
window.openPhotoLightbox = openPhotoLightbox;

// V19 · CSV de recorrido: actualizar referencia de versión
const _v19ExportRoute = exportRouteCsv;
exportRouteCsv = function(){
  const _origVer = CASUR_APP_VERSION;
  _v19ExportRoute();
};

// V19 · Galería de fotos: panel rápido con todas las fotos del dispositivo
async function renderPhotoGallery(){
  const el = $('photoGallerySummary'); if(!el) return;
  el.textContent = 'Cargando fotos...';
  try{
    const recs = await getAllPhotoRecords();
    if(!recs.length){ el.textContent = 'Sin fotos guardadas en este dispositivo.'; return; }
    el.innerHTML = `<b>${recs.length}</b> foto(s) locales en este dispositivo.<br><small>Toque un lote en la ficha rápida para ver sus fotos.</small>`;
  }catch(e){ el.textContent = 'Error al leer fotos: '+e.message; }
}
const _v19BindOrig = bindUi;
bindUi = function(){
  _v19BindOrig();
  renderPhotoGallery();
};

console.info('[CASUR V20.4] Capas de edad por rangos integradas: <3, 4–6 y >6 meses.');


// V21.4 · Compartir hallazgo: genera tarjeta visual y permite compartirla.
let hallazgoBlob = null;
function hallazgoDataFromProps(p=selectedProps){
  if(!p) return null;
  const m = metricasFor(p);
  const cod = displayCode(getCodLote(p));
  const hac = m.hacienda_productor || 'Sin dato histórico';
  const tab = getTablon(p) || '—';
  const tch = Number.isFinite(Number(m.tch_ultima_zafra)) ? formatMetric(m.tch_ultima_zafra,' t/ha') : '—';
  const edadVal = edadActualMetric(m);
  const edad = Number.isFinite(edadVal) ? formatMetric(edadVal,' meses') : '—';
  const variedad = m.variedad || '—';
  const center = featureCentroidLatLng({feature:{properties:p, geometry:(selectedLayer&&selectedLayer.feature&&selectedLayer.feature.properties===p&&selectedLayer.feature.geometry)||null}, getBounds:()=> selectedLayer ? selectedLayer.getBounds() : null});
  const lat = center ? Number(center.lat).toFixed(6) : '—';
  const lng = center ? Number(center.lng).toFixed(6) : '—';
  return {cod,hac,tab,tch,edad,variedad,lat,lng,fecha:new Date().toLocaleString('es-NI')};
}
function openHallazgoModal(){
  if(!selectedProps){ alert('Seleccione primero un lote.'); return; }
  const modal=$('hallazgoModal'); if(!modal) return;
  const ta=$('hallazgoComentario'); if(ta) ta.value='';
  modal.classList.remove('hidden');
  renderHallazgoCard();
}
function closeHallazgoModal(){ const modal=$('hallazgoModal'); if(modal) modal.classList.add('hidden'); }
function wrapCanvasText(ctx, text, x, y, maxWidth, lineHeight){
  const words = String(text||'').split(/\s+/); let line=''; let lines=[];
  words.forEach(w=>{ const test = line ? line + ' ' + w : w; if(ctx.measureText(test).width > maxWidth && line){ lines.push(line); line=w; } else line=test; });
  if(line) lines.push(line);
  lines.forEach((ln,i)=> ctx.fillText(ln, x, y + i*lineHeight));
  return lines.length;
}
function roundedRect(ctx,x,y,w,h,r,fill,stroke){
  ctx.beginPath(); ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r); ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  if(fill){ ctx.fillStyle=fill; ctx.fill(); }
  if(stroke){ ctx.strokeStyle=stroke; ctx.stroke(); }
}
function renderHallazgoCard(){
  const c=$('hallazgoCanvas'); if(!c) return;
  const ctx=c.getContext('2d'); const d=hallazgoDataFromProps(); if(!d) return;
  const note=($('hallazgoComentario')?.value||'').trim() || 'Sin comentario registrado.';
  const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
  // background
  const grad=ctx.createLinearGradient(0,0,w,h); grad.addColorStop(0,'#f8fafc'); grad.addColorStop(1,'#eef6f0'); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
  // top band
  const headGrad=ctx.createLinearGradient(0,0,w,0); headGrad.addColorStop(0,'#0b7f3a'); headGrad.addColorStop(.68,'#005baa'); headGrad.addColorStop(1,'#f4c542');
  roundedRect(ctx,50,45,w-100,180,28,headGrad,null);
  ctx.fillStyle='#ffffff'; ctx.font='700 30px Arial'; ctx.fillText('Departamento de Negocios de Caña',90,95);
  ctx.font='900 56px Arial'; ctx.fillText('CASUR Maps',90,155);
  ctx.font='600 28px Arial'; ctx.fillText('Mapa inteligente de lotes cañeros',90,198);
  // body card
  roundedRect(ctx,50,255,w-100,h-315,28,'#ffffff','#dbe5dd'); ctx.lineWidth=2;
  ctx.fillStyle='#0f172a'; ctx.font='900 46px Arial'; ctx.fillText('CODLOTE ' + d.cod,90,335);
  ctx.fillStyle='#334155'; ctx.font='700 32px Arial'; ctx.fillText(d.hac,90,388);
  ctx.font='700 28px Arial'; ctx.fillText('Tablón ' + d.tab,90,430);

  const boxes=[
    ['TCH última zafra', d.tch, '#fff6d8'],
    ['Edad actual', d.edad, '#e8f6ee'],
    ['Variedad', d.variedad, '#e9f0fb'],
    ['Coordenadas', `${d.lat}, ${d.lng}`, '#f4f7fb'],
  ];
  let bx=90, by=470, bw=480, bh=122;
  boxes.forEach((b,idx)=>{
    const col=idx%2, row=Math.floor(idx/2); const x=bx + col*(bw+40), y=by + row*(bh+28);
    roundedRect(ctx,x,y,bw,bh,22,b[2],'#e2e8f0');
    ctx.fillStyle='#64748b'; ctx.font='800 22px Arial'; ctx.fillText(b[0],x+24,y+36);
    ctx.fillStyle='#0f172a'; ctx.font=(b[0]==='Coordenadas' ? '700 24px Arial' : '900 30px Arial');
    wrapCanvasText(ctx,b[1],x+24,y+78,bw-48,30);
  });

  const hy=770;
  roundedRect(ctx,90,hy,w-180,320,24,'#f8fafc','#dbe5dd');
  ctx.fillStyle='#0b7f3a'; ctx.font='900 30px Arial'; ctx.fillText('Hallazgo',120,hy+48);
  ctx.fillStyle='#0f172a'; ctx.font='600 28px Arial';
  wrapCanvasText(ctx,note,120,hy+98,w-240,38);

  ctx.fillStyle='#64748b'; ctx.font='700 22px Arial'; ctx.fillText('Generado: ' + d.fecha,120,h-110);
  ctx.fillText('Fuente: CASUR Maps · Tarjeta de hallazgo rápida para compartir',120,h-74);
  c.toBlob(function(blob){ hallazgoBlob = blob; }, 'image/png');
}
function hallazgoText(){
  const d=hallazgoDataFromProps(); if(!d) return '';
  const note=($('hallazgoComentario')?.value||'').trim() || 'Sin comentario registrado.';
  return `CASUR Maps\nCODLOTE ${d.cod}\n${d.hac}\nTablón ${d.tab}\nTCH última zafra: ${d.tch}\nEdad actual: ${d.edad}\nVariedad: ${d.variedad}\nHallazgo: ${note}\nCoordenadas: ${d.lat}, ${d.lng}\nFecha: ${d.fecha}`;
}
async function shareHallazgo(){
  renderHallazgoCard();
  const text = hallazgoText();
  if(hallazgoBlob && navigator.canShare && navigator.canShare({files:[new File([hallazgoBlob], 'hallazgo_casur.png', {type:'image/png'})]})){
    const file = new File([hallazgoBlob], `hallazgo_casur_${Date.now()}.png`, {type:'image/png'});
    try{ await navigator.share({title:'CASUR Maps · Hallazgo', text:'Tarjeta de hallazgo generada desde CASUR Maps', files:[file]}); return; }catch(err){}
  }
  const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(wa,'_blank');
}
function downloadHallazgoImage(){
  renderHallazgoCard();
  const c=$('hallazgoCanvas'); if(!c) return;
  const a=document.createElement('a');
  const d=hallazgoDataFromProps();
  a.href=c.toDataURL('image/png'); a.download=`hallazgo_codlote_${(d&&d.cod)||'casur'}.png`; a.click();
}
async function copyHallazgoText(){
  const text=hallazgoText();
  try{ await navigator.clipboard.writeText(text); alert('Texto del hallazgo copiado.'); }
  catch(err){ window.prompt('Copie el siguiente texto:', text); }
}
window.openHallazgoModal=openHallazgoModal;
window.closeHallazgoModal=closeHallazgoModal;
window.shareHallazgo=shareHallazgo;
window.downloadHallazgoImage=downloadHallazgoImage;
window.copyHallazgoText=copyHallazgoText;

// bind V21.4 UI after page load
setTimeout(function(){
  $('hallazgoClose')?.addEventListener('click', closeHallazgoModal);
  $('hallazgoGenerar')?.addEventListener('click', renderHallazgoCard);
  $('hallazgoWhatsapp')?.addEventListener('click', shareHallazgo);
  $('hallazgoDescargar')?.addEventListener('click', downloadHallazgoImage);
  $('hallazgoCopiar')?.addEventListener('click', copyHallazgoText);
  $('hallazgoComentario')?.addEventListener('input', function(){ renderHallazgoCard(); });
  $('hallazgoModal')?.addEventListener('click', function(ev){ if(ev.target===this) closeHallazgoModal(); });
},0);


// V21.5 · Compartir hallazgo PRO: categoría, severidad, técnico y foto opcional.
let hallazgoFotoDataUrl = '';
function readHallazgoFormPro(){
  return {
    tecnico: ($('hallazgoTecnico')?.value || '').trim() || 'No especificado',
    categoria: ($('hallazgoCategoria')?.value || 'Seguimiento').trim(),
    severidad: ($('hallazgoSeveridad')?.value || 'Media').trim(),
    comentario: ($('hallazgoComentario')?.value || '').trim() || 'Sin comentario registrado.'
  };
}
function setHallazgoPreviewPhoto(dataUrl){
  hallazgoFotoDataUrl = dataUrl || '';
  const pv = $('hallazgoFotoPreview');
  if(!pv) return;
  if(hallazgoFotoDataUrl) pv.innerHTML = `<img src="${hallazgoFotoDataUrl}" alt="Foto del hallazgo">`;
  else pv.textContent = 'Sin foto adjunta.';
}
function loadHallazgoImage(){
  return new Promise(resolve=>{
    if(!hallazgoFotoDataUrl) return resolve(null);
    const img = new Image();
    img.onload = ()=>resolve(img);
    img.onerror = ()=>resolve(null);
    img.src = hallazgoFotoDataUrl;
  });
}
function drawImageCover(ctx,img,x,y,w,h){
  if(!img) return;
  const r = Math.max(w/img.width, h/img.height);
  const sw = w/r, sh = h/r;
  const sx = (img.width - sw)/2, sy = (img.height - sh)/2;
  ctx.save();
  roundedRect(ctx,x,y,w,h,22,'#f8fafc','#dbe5dd');
  ctx.clip();
  ctx.drawImage(img,sx,sy,sw,sh,x,y,w,h);
  ctx.restore();
}
openHallazgoModal = function(){
  if(!selectedProps){ alert('Seleccione primero un lote.'); return; }
  const modal=$('hallazgoModal'); if(!modal) return;
  ['hallazgoComentario','hallazgoTecnico'].forEach(id=>{ const el=$(id); if(el) el.value=''; });
  if($('hallazgoCategoria')) $('hallazgoCategoria').value='Seguimiento';
  if($('hallazgoSeveridad')) $('hallazgoSeveridad').value='Media';
  setHallazgoPreviewPhoto('');
  modal.classList.remove('hidden');
  renderHallazgoCard();
};
renderHallazgoCard = async function(){
  const c=$('hallazgoCanvas'); if(!c) return;
  const ctx=c.getContext('2d'); const d=hallazgoDataFromProps(); if(!d) return;
  const form=readHallazgoFormPro();
  const photo=await loadHallazgoImage();
  const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,w,h); grad.addColorStop(0,'#f8fafc'); grad.addColorStop(1,'#eef6f0'); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
  const headGrad=ctx.createLinearGradient(0,0,w,0); headGrad.addColorStop(0,'#0b7f3a'); headGrad.addColorStop(.68,'#005baa'); headGrad.addColorStop(1,'#f4c542');
  roundedRect(ctx,50,45,w-100,180,28,headGrad,null);
  ctx.fillStyle='#ffffff'; ctx.font='700 30px Arial'; ctx.fillText('Departamento de Negocios de Caña',90,95);
  ctx.font='900 56px Arial'; ctx.fillText('CASUR Maps',90,155);
  ctx.font='600 28px Arial'; ctx.fillText('Mapa inteligente de lotes cañeros',90,198);

  roundedRect(ctx,50,255,w-100,h-315,28,'#ffffff','#dbe5dd'); ctx.lineWidth=2;
  ctx.fillStyle='#0f172a'; ctx.font='900 46px Arial'; ctx.fillText('CODLOTE ' + d.cod,90,335);
  ctx.fillStyle='#334155'; ctx.font='700 32px Arial'; ctx.fillText(d.hac,90,388);
  ctx.font='700 28px Arial'; ctx.fillText('Tablón ' + d.tab,90,430);

  const sevColor = form.severidad === 'Alta' ? '#b91c1c' : (form.severidad === 'Media' ? '#b7791f' : '#0b7f3a');
  roundedRect(ctx,90,455,450,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('CATEGORÍA',114,482);
  ctx.fillStyle='#0f172a'; ctx.font='900 27px Arial'; ctx.fillText(form.categoria,114,512);
  roundedRect(ctx,570,455,260,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('SEVERIDAD',594,482);
  ctx.fillStyle=sevColor; ctx.font='900 29px Arial'; ctx.fillText(form.severidad,594,512);
  roundedRect(ctx,860,455,250,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('TÉCNICO',884,482);
  ctx.fillStyle='#0f172a'; ctx.font='900 24px Arial'; wrapCanvasText(ctx,form.tecnico,884,512,210,26);

  const boxes=[
    ['TCH última zafra', d.tch, '#fff6d8'],
    ['Edad actual', d.edad, '#e8f6ee'],
    ['Variedad', d.variedad, '#e9f0fb'],
    ['Coordenadas', `${d.lat}, ${d.lng}`, '#f4f7fb'],
  ];
  let bx=90, by=555, bw=480, bh=112;
  boxes.forEach((b,idx)=>{
    const col=idx%2, row=Math.floor(idx/2); const x=bx + col*(bw+40), y=by + row*(bh+24);
    roundedRect(ctx,x,y,bw,bh,22,b[2],'#e2e8f0');
    ctx.fillStyle='#64748b'; ctx.font='800 21px Arial'; ctx.fillText(b[0],x+24,y+34);
    ctx.fillStyle='#0f172a'; ctx.font=(b[0]==='Coordenadas' ? '700 24px Arial' : '900 29px Arial');
    wrapCanvasText(ctx,b[1],x+24,y+74,bw-48,29);
  });

  let hy=835, boxH=photo?240:330;
  roundedRect(ctx,90,hy,w-180,boxH,24,'#f8fafc','#dbe5dd');
  ctx.fillStyle='#0b7f3a'; ctx.font='900 30px Arial'; ctx.fillText('Hallazgo',120,hy+48);
  ctx.fillStyle='#0f172a'; ctx.font='600 27px Arial';
  wrapCanvasText(ctx,form.comentario,120,hy+98,w-240,36);

  if(photo){
    const py=hy+boxH+26;
    ctx.fillStyle='#0b7f3a'; ctx.font='900 26px Arial'; ctx.fillText('Evidencia fotográfica',90,py);
    drawImageCover(ctx,photo,90,py+22,w-180,170);
  }

  ctx.fillStyle='#64748b'; ctx.font='700 22px Arial'; ctx.fillText('Generado: ' + d.fecha,120,h-110);
  ctx.fillText('Fuente: CASUR Maps · Tarjeta de hallazgo rápida para compartir',120,h-74);
  c.toBlob(function(blob){ hallazgoBlob = blob; }, 'image/png');
};
hallazgoText = function(){
  const d=hallazgoDataFromProps(); if(!d) return '';
  const form=readHallazgoFormPro();
  return `CASUR Maps\nCODLOTE ${d.cod}\n${d.hac}\nTablón ${d.tab}\nCategoría: ${form.categoria}\nSeveridad: ${form.severidad}\nTécnico: ${form.tecnico}\nTCH última zafra: ${d.tch}\nEdad actual: ${d.edad}\nVariedad: ${d.variedad}\nHallazgo: ${form.comentario}\nCoordenadas: ${d.lat}, ${d.lng}\nFecha: ${d.fecha}`;
};
setTimeout(function(){
  const file=$('hallazgoFotoInput');
  file?.addEventListener('change', function(){
    const f=this.files && this.files[0];
    if(!f){ setHallazgoPreviewPhoto(''); renderHallazgoCard(); return; }
    const reader=new FileReader();
    reader.onload=e=>{ setHallazgoPreviewPhoto(e.target.result); renderHallazgoCard(); };
    reader.readAsDataURL(f);
  });
  $('hallazgoFotoClear')?.addEventListener('click', function(){
    const f=$('hallazgoFotoInput'); if(f) f.value='';
    setHallazgoPreviewPhoto(''); renderHallazgoCard();
  });
  ['hallazgoTecnico','hallazgoCategoria','hallazgoSeveridad'].forEach(id=>{
    $(id)?.addEventListener('input', renderHallazgoCard);
    $(id)?.addEventListener('change', renderHallazgoCard);
  });
},0);


// V21.6 · FIX Compartir hallazgo: coordenadas, generación, descarga y share robustos.
function hallazgoGetLatLngSafe(){
  try{
    if(selectedLayer && selectedLayer.feature){
      const c = featureCentroid(selectedLayer.feature);
      if(c && Number.isFinite(Number(c[0])) && Number.isFinite(Number(c[1]))){
        return {lat:Number(c[0]), lng:Number(c[1])};
      }
      const b = selectedLayer.getBounds && selectedLayer.getBounds();
      if(b && b.getCenter){
        const cc = b.getCenter();
        return {lat:Number(cc.lat), lng:Number(cc.lng)};
      }
    }
  }catch(err){}
  if(lastGpsLatLng && Number.isFinite(Number(lastGpsLatLng.lat)) && Number.isFinite(Number(lastGpsLatLng.lng))){
    return {lat:Number(lastGpsLatLng.lat), lng:Number(lastGpsLatLng.lng)};
  }
  return null;
}
hallazgoDataFromProps = function(p=selectedProps){
  if(!p) return null;
  const m = metricasFor(p);
  const cod = displayCode(getCodLote(p));
  const hac = m.hacienda_productor || 'Sin dato histórico';
  const tab = getTablon(p) || '—';
  const tch = Number.isFinite(Number(m.tch_ultima_zafra)) ? formatMetric(m.tch_ultima_zafra,' t/ha') : '—';
  const edadVal = edadActualMetric(m);
  const edad = Number.isFinite(edadVal) ? formatMetric(edadVal,' meses') : '—';
  const variedad = m.variedad || '—';
  const ll = hallazgoGetLatLngSafe();
  const lat = ll ? ll.lat.toFixed(6) : '—';
  const lng = ll ? ll.lng.toFixed(6) : '—';
  return {cod,hac,tab,tch,edad,variedad,lat,lng,fecha:new Date().toLocaleString('es-NI')};
};
function canvasToBlobPromise(canvas){
  return new Promise(resolve=>{
    if(!canvas || !canvas.toBlob) return resolve(null);
    canvas.toBlob(blob=>resolve(blob), 'image/png');
  });
}
renderHallazgoCard = async function(){
  const c=$('hallazgoCanvas'); if(!c) return null;
  const ctx=c.getContext('2d'); const d=hallazgoDataFromProps(); if(!d) return null;
  const form=readHallazgoFormPro ? readHallazgoFormPro() : {tecnico:'No especificado', categoria:'Seguimiento', severidad:'Media', comentario:(($('hallazgoComentario')?.value||'').trim()||'Sin comentario registrado.')};
  const photo=await loadHallazgoImage();
  const w=c.width, h=c.height;
  ctx.clearRect(0,0,w,h);
  const grad=ctx.createLinearGradient(0,0,w,h); grad.addColorStop(0,'#f8fafc'); grad.addColorStop(1,'#eef6f0'); ctx.fillStyle=grad; ctx.fillRect(0,0,w,h);
  const headGrad=ctx.createLinearGradient(0,0,w,0); headGrad.addColorStop(0,'#0b7f3a'); headGrad.addColorStop(.68,'#005baa'); headGrad.addColorStop(1,'#f4c542');
  roundedRect(ctx,50,45,w-100,180,28,headGrad,null);
  ctx.fillStyle='#ffffff'; ctx.font='700 30px Arial'; ctx.fillText('Departamento de Negocios de Caña',90,95);
  ctx.font='900 56px Arial'; ctx.fillText('CASUR Maps',90,155);
  ctx.font='600 28px Arial'; ctx.fillText('Mapa inteligente de lotes cañeros',90,198);

  roundedRect(ctx,50,255,w-100,h-315,28,'#ffffff','#dbe5dd'); ctx.lineWidth=2;
  ctx.fillStyle='#0f172a'; ctx.font='900 46px Arial'; ctx.fillText('CODLOTE ' + d.cod,90,335);
  ctx.fillStyle='#334155'; ctx.font='700 32px Arial'; ctx.fillText(d.hac,90,388);
  ctx.font='700 28px Arial'; ctx.fillText('Tablón ' + d.tab,90,430);

  const sevColor = form.severidad === 'Alta' ? '#b91c1c' : (form.severidad === 'Media' ? '#b7791f' : '#0b7f3a');
  roundedRect(ctx,90,455,450,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('CATEGORÍA',114,482);
  ctx.fillStyle='#0f172a'; ctx.font='900 27px Arial'; ctx.fillText(form.categoria,114,512);
  roundedRect(ctx,570,455,260,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('SEVERIDAD',594,482);
  ctx.fillStyle=sevColor; ctx.font='900 29px Arial'; ctx.fillText(form.severidad,594,512);
  roundedRect(ctx,860,455,250,72,18,'#f8fafc','#e2e8f0');
  ctx.fillStyle='#64748b'; ctx.font='800 20px Arial'; ctx.fillText('TÉCNICO',884,482);
  ctx.fillStyle='#0f172a'; ctx.font='900 24px Arial'; wrapCanvasText(ctx,form.tecnico,884,512,210,26);

  const boxes=[
    ['TCH última zafra', d.tch, '#fff6d8'],
    ['Edad actual', d.edad, '#e8f6ee'],
    ['Variedad', d.variedad, '#e9f0fb'],
    ['Coordenadas', `${d.lat}, ${d.lng}`, '#f4f7fb'],
  ];
  let bx=90, by=555, bw=480, bh=112;
  boxes.forEach((b,idx)=>{
    const col=idx%2, row=Math.floor(idx/2); const x=bx + col*(bw+40), y=by + row*(bh+24);
    roundedRect(ctx,x,y,bw,bh,22,b[2],'#e2e8f0');
    ctx.fillStyle='#64748b'; ctx.font='800 21px Arial'; ctx.fillText(b[0],x+24,y+34);
    ctx.fillStyle='#0f172a'; ctx.font=(b[0]==='Coordenadas' ? '700 24px Arial' : '900 29px Arial');
    wrapCanvasText(ctx,b[1],x+24,y+74,bw-48,29);
  });

  let hy=835, boxH=photo?240:330;
  roundedRect(ctx,90,hy,w-180,boxH,24,'#f8fafc','#dbe5dd');
  ctx.fillStyle='#0b7f3a'; ctx.font='900 30px Arial'; ctx.fillText('Hallazgo',120,hy+48);
  ctx.fillStyle='#0f172a'; ctx.font='600 27px Arial';
  wrapCanvasText(ctx,form.comentario,120,hy+98,w-240,36);

  if(photo){
    const py=hy+boxH+26;
    ctx.fillStyle='#0b7f3a'; ctx.font='900 26px Arial'; ctx.fillText('Evidencia fotográfica',90,py);
    drawImageCover(ctx,photo,90,py+22,w-180,170);
  }

  ctx.fillStyle='#64748b'; ctx.font='700 22px Arial'; ctx.fillText('Generado: ' + d.fecha,120,h-110);
  ctx.fillText('Fuente: CASUR Maps · Tarjeta de hallazgo rápida para compartir',120,h-74);
  hallazgoBlob = await canvasToBlobPromise(c);
  return hallazgoBlob;
};
shareHallazgo = async function(){
  const blob = await renderHallazgoCard();
  const text = hallazgoText();
  if(blob && navigator.canShare){
    const file = new File([blob], `hallazgo_casur_${Date.now()}.png`, {type:'image/png'});
    if(navigator.canShare({files:[file]})){
      try{ await navigator.share({title:'CASUR Maps · Hallazgo', text:'Tarjeta de hallazgo generada desde CASUR Maps', files:[file]}); return; }catch(err){}
    }
  }
  // WhatsApp web fallback: comparte texto; el usuario puede adjuntar imagen descargada si el navegador no permite compartir archivos.
  const wa = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(wa,'_blank');
};
downloadHallazgoImage = async function(){
  await renderHallazgoCard();
  const c=$('hallazgoCanvas'); if(!c) return;
  const a=document.createElement('a');
  const d=hallazgoDataFromProps();
  a.href=c.toDataURL('image/png'); a.download=`hallazgo_codlote_${(d&&d.cod)||'casur'}.png`; a.click();
};
copyHallazgoText = async function(){
  const text=hallazgoText();
  try{ await navigator.clipboard.writeText(text); alert('Texto del hallazgo copiado.'); }
  catch(err){ window.prompt('Copie el siguiente texto:', text); }
};
window.shareHallazgo=shareHallazgo;
window.downloadHallazgoImage=downloadHallazgoImage;
window.copyHallazgoText=copyHallazgoText;
window.renderHallazgoCard=renderHallazgoCard;
