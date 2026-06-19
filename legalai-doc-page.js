(function(){
'use strict';
const CFG = window.LEGALAI_DOC_CONFIG || {};
const WORKER = CFG.workerUrl || 'https://legalai-worker.finmap-ia.workers.dev';
const PRICE_USD = Number(CFG.priceUsd || 4);
const SESSION = Math.random().toString(36).slice(2) + Date.now().toString(36);
let state = { previewId:null, texto:'', cotizacion:null, montoARS:0 };

function savePaymentState(key, value){
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  try{ sessionStorage.setItem(key, text); }catch(_){}
  try{ localStorage.setItem(key, text); }catch(_){}
}
function removePaymentState(key){ try{sessionStorage.removeItem(key);}catch(_){} try{localStorage.removeItem(key);}catch(_){} }

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const cleanName = (s) => String(s || 'documento').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60) || 'documento';

function injectStyles(){
  const st = document.createElement('style');
  st.textContent = `
:root{--ink:#0f1117;--paper:#f7f3ec;--cream:#ede8dc;--surface:#fff;--gold:#c8a84b;--gold-dim:rgba(200,168,75,.12);--sage:#3d5a46;--mist:#6b7580;--line:rgba(15,17,23,.10);--btn-bg:#0f1117;--btn-txt:#c8a84b;--btn-hover:#1c2030;--danger:#b42318}
[data-theme="dark"]{--ink:#eceef2;--paper:#0c0e12;--cream:#141720;--surface:#1c2030;--gold:#d4a847;--gold-dim:rgba(212,168,71,.13);--sage:#6abf8a;--mist:#7a8494;--line:rgba(255,255,255,.08);--btn-bg:#d4a847;--btn-txt:#0c0e12;--btn-hover:#e0b85b}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:'DM Sans',system-ui,-apple-system,Segoe UI,sans-serif}a{text-decoration:none;color:inherit}.top{background:#0f1117;border-bottom:1px solid rgba(200,168,75,.18)}.top-inner{height:58px;display:flex;align-items:center;justify-content:space-between;gap:16px;max-width:1120px;margin:0 auto;padding:0 24px}.logo{font-family:'Playfair Display',serif;font-weight:900;letter-spacing:.055em;color:var(--gold)}.logo span{color:rgba(200,168,75,.42)}.nav{display:flex;align-items:center;gap:16px}.nav a{font-size:.82rem;color:rgba(255,255,255,.55)}.theme{display:flex;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:18px;padding:3px;gap:2px}.theme button{border:0;background:transparent;color:rgba(255,255,255,.45);font-family:'DM Mono',monospace;font-size:.65rem;border-radius:14px;padding:4px 9px;cursor:pointer}.theme button.active{background:var(--gold);color:#111}
.wrap{max-width:980px;margin:0 auto;padding:46px 22px 80px}.hero{text-align:center;margin-bottom:28px}.kicker{font-family:'DM Mono',monospace;font-size:.68rem;letter-spacing:.16em;text-transform:uppercase;color:var(--gold);margin-bottom:12px}.hero h1{font-family:'Playfair Display',serif;font-size:clamp(2rem,4.2vw,3.1rem);line-height:1.08;margin:0 0 12px}.hero p{color:var(--mist);line-height:1.55;margin:0 auto;max-width:620px}.steps{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:9px;overflow:hidden;margin:24px 0 26px;background:var(--surface)}.step{font-family:'DM Mono',monospace;font-size:.64rem;letter-spacing:.08em;text-transform:uppercase;color:var(--mist);padding:12px;text-align:center;border-right:1px solid var(--line)}.step:last-child{border-right:0}.step.active{background:var(--gold);color:#111}.step.done{background:var(--gold-dim);color:var(--gold)}.card{display:none;background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:28px;box-shadow:0 16px 45px rgba(0,0,0,.06)}[data-theme="dark"] .card{box-shadow:0 16px 45px rgba(0,0,0,.25)}.card.visible{display:block}.trust{display:flex;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:16px;margin-bottom:20px}.trust span{font-family:'DM Mono',monospace;font-size:.7rem;color:var(--mist)}.card-title{font-family:'Playfair Display',serif;font-weight:700;font-size:1.55rem;margin-bottom:6px}.card-sub{font-size:.92rem;color:var(--mist);line-height:1.55;margin-bottom:22px}.doc-summary{display:grid;grid-template-columns:64px 1fr;gap:16px;background:var(--cream);border:1px solid var(--line);border-radius:14px;padding:18px;margin-bottom:22px}.doc-icon{width:64px;height:64px;border-radius:18px;background:var(--gold-dim);display:flex;align-items:center;justify-content:center;font-size:2rem}.doc-summary h2{font-family:'Playfair Display',serif;margin:0 0 6px;font-size:1.45rem}.doc-summary p{margin:0;color:var(--mist);line-height:1.5}.fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.field.full{grid-column:1/-1}label{display:block;font-size:.78rem;font-weight:650;margin-bottom:7px;color:var(--ink)}label small{color:var(--gold);font-weight:800}input,select,textarea{width:100%;border:1.5px solid var(--line);border-radius:10px;background:var(--paper);color:var(--ink);padding:13px 14px;font-family:'DM Sans',sans-serif;font-size:.94rem;outline:none}textarea{min-height:104px;resize:vertical}input:focus,select:focus,textarea:focus{border-color:var(--gold)}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:22px}.btn{border:0;border-radius:10px;padding:14px 20px;font-family:'DM Sans',sans-serif;font-size:.95rem;font-weight:800;cursor:pointer;transition:.15s;display:inline-flex;align-items:center;justify-content:center;gap:8px}.btn.primary{background:var(--gold);color:#0f1117;flex:1}.btn.dark{background:var(--btn-bg);color:var(--btn-txt);flex:1}.btn.ghost{background:transparent;border:1.5px solid var(--line);color:var(--mist)}.btn:hover{opacity:.88;transform:translateY(-1px)}.btn:disabled{opacity:.5;cursor:not-allowed;transform:none}.alert{display:none;border-radius:10px;padding:12px 14px;margin-top:14px;font-size:.88rem;line-height:1.45}.alert.show{display:block}.alert.err{background:rgba(180,35,24,.09);border:1px solid rgba(180,35,24,.2);color:var(--danger)}.alert.ok{background:var(--gold-dim);border:1px solid rgba(200,168,75,.25);color:var(--ink)}.preview{background:var(--paper);border:1px solid var(--line);border-radius:12px;padding:20px;max-height:470px;overflow:auto;white-space:pre-wrap;font-family:Georgia,'Times New Roman',serif;font-size:.92rem;line-height:1.65;position:relative}.watermark{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;color:rgba(200,168,75,.14);font-family:'DM Mono',monospace;font-weight:800;font-size:1.4rem;transform:rotate(-28deg)}.pricebox{display:flex;align-items:center;justify-content:space-between;gap:16px;background:var(--cream);border:1px solid var(--line);border-radius:12px;padding:18px;margin-bottom:18px}.price{font-family:'Playfair Display',serif;font-size:1.8rem;font-weight:900}.muted{color:var(--mist);font-size:.82rem;line-height:1.45}.loading{display:none;text-align:center;padding:48px}.loading.visible{display:block}.spinner{width:34px;height:34px;border:3px solid var(--line);border-top-color:var(--gold);border-radius:50%;animation:spin .8s linear infinite;margin:0 auto 14px}@keyframes spin{to{transform:rotate(360deg)}}.fine{font-size:.78rem;color:var(--mist);line-height:1.55;margin-top:16px}.mobile-sticky{display:none}
@media(max-width:760px){.top-inner{padding:0 16px}.nav a{display:none}.wrap{padding:32px 16px 90px}.steps{grid-template-columns:1fr 1fr}.step:nth-child(2){border-right:0}.step:nth-child(1),.step:nth-child(2){border-bottom:1px solid var(--line)}.card{padding:20px}.doc-summary{grid-template-columns:1fr;text-align:left}.fields{grid-template-columns:1fr}.actions{flex-direction:column}.btn{width:100%}.mobile-sticky{display:block;position:fixed;left:0;right:0;bottom:0;padding:10px 14px 16px;background:linear-gradient(to top,var(--paper) 82%,transparent);z-index:30}.mobile-sticky .btn{box-shadow:0 8px 28px rgba(0,0,0,.22)}}`;
  document.head.appendChild(st);
}

function setTheme(t){
  localStorage.setItem('theme', t);
  const dark = t === 'dark' || (t === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.querySelectorAll('[data-theme-btn]').forEach(b => b.classList.toggle('active', b.dataset.themeBtn === t));
}
window.setLegalAITheme = setTheme;

function render(){
  document.body.innerHTML = `
<header class="top"><div class="top-inner"><a class="logo" href="index.html">LegalAI <span>ARG</span></a><div class="nav"><a href="index.html#generador">← Volver al generador</a><a href="planes.html">Plan ilimitado</a><div class="theme"><button data-theme-btn="light" onclick="setLegalAITheme('light')">☀ Claro</button><button data-theme-btn="system" onclick="setLegalAITheme('system')">⊙ Auto</button><button data-theme-btn="dark" onclick="setLegalAITheme('dark')">◗ Oscuro</button></div></div></div></header>
<main class="wrap">
  <section class="hero"><div class="kicker">// ${esc(CFG.categoryLabel || 'Documento legal')}</div><h1>${esc(CFG.emoji || '📄')} ${esc(CFG.title || 'Documento legal')}</h1><p>${esc(CFG.description || 'Completá los datos, generá una vista previa y avanzá al pago para obtener el documento.')}</p></section>
  <div class="steps"><div class="step active" id="s1">1 · Datos</div><div class="step" id="s2">2 · Vista previa</div><div class="step" id="s3">3 · Pago</div><div class="step" id="s4">4 · Descarga</div></div>
  <section class="card visible" id="cardDatos"><div class="trust"><span>🔒 Pago seguro MP</span><span>⚡ Descarga inmediata</span><span>📄 PDF listo para firmar</span><span id="desdeTxt">✓ Precio calculando...</span></div><div class="doc-summary"><div class="doc-icon">${esc(CFG.emoji || '📄')}</div><div><h2>${esc(CFG.title || 'Documento legal')}</h2><p>${esc(CFG.description || '')}</p></div></div><div class="card-title">Completá los datos</div><div class="card-sub">Los campos marcados con <b style="color:var(--gold)">*</b> son obligatorios. Si algún dato no lo tenés ahora, dejalo en observaciones.</div><div class="fields" id="fields"></div><div class="alert err" id="errDatos"></div><div class="actions"><button class="btn ghost" onclick="location.href='index.html#generador'">← Elegir otro documento</button><button class="btn primary" id="btnPreview">Generar vista previa →</button></div><p class="fine">Modelo orientativo para Argentina. No reemplaza asesoramiento profesional. Revisá nombres, DNI/CUIT, domicilios, montos y fechas antes de firmar.</p></section>
  <div class="loading" id="loading"><div class="spinner"></div><div class="muted">Preparando documento...</div></div>
  <section class="card" id="cardPreview"><div class="card-title">Vista previa</div><div class="card-sub">Verificá que el contenido corresponda al documento que necesitás. Después podés pagar y descargar la versión completa.</div><div class="pricebox"><div><b>PDF listo para firmar</b><div class="muted" id="priceDet">Pago único con MercadoPago</div></div><div class="price" id="priceAmt">$ —</div></div><div class="preview" id="previewBox"></div><div class="alert err" id="errPago"></div><div class="actions"><button class="btn ghost" onclick="showCard('cardDatos',1)">← Corregir datos</button><button class="btn dark" id="btnPagar">Pagar con MercadoPago →</button></div></section>
</main>
<div class="mobile-sticky" id="sticky"><button class="btn primary" id="btnPreviewMobile">Generar vista previa →</button></div>`;
  renderFields();
  $('btnPreview').addEventListener('click', generarPreview);
  $('btnPreviewMobile').addEventListener('click', generarPreview);
  $('btnPagar').addEventListener('click', pagar);
  const t = localStorage.getItem('theme') || 'system'; setTheme(t);
  initUTM(); obtenerCotizacion(); track('page_view', {doc_tipo: CFG.title, pagina: location.pathname});
}

function renderFields(){
  const fields = CFG.fields || [];
  $('fields').innerHTML = fields.map(c => {
    const full = c.type === 'textarea' || String(c.placeholder || '').length > 45;
    const req = c.required ? '<small>*</small>' : '';
    const common = `id="f_${esc(c.id)}" name="${esc(c.id)}" ${c.required?'required':''}`;
    let input = '';
    if (c.type === 'textarea') input = `<textarea ${common} placeholder="${esc(c.placeholder || '')}"></textarea>`;
    else if (c.type === 'select') input = `<select ${common}>${(c.options||[]).map(o=>`<option value="${esc(o)}">${esc(o)}</option>`).join('')}</select>`;
    else input = `<input ${common} type="${esc(c.type || 'text')}" placeholder="${esc(c.placeholder || '')}">`;
    return `<div class="field ${full?'full':''}"><label for="f_${esc(c.id)}">${esc(c.label)} ${req}</label>${input}</div>`;
  }).join('');
}

function showCard(id, step){
  ['cardDatos','cardPreview'].forEach(x => { const el=$(x); if(el) el.classList.remove('visible'); });
  const l=$('loading'); if(l) l.classList.remove('visible');
  const el=$(id); if(el) el.classList.add('visible');
  [1,2,3,4].forEach(i=>{ const s=$('s'+i); if(!s) return; s.classList.remove('active','done'); if(i<step) s.classList.add('done'); if(i===step) s.classList.add('active'); });
  const sticky = $('sticky'); if(sticky) sticky.style.display = id === 'cardDatos' ? '' : 'none';
  scrollTo({top:0, behavior:'smooth'});
}
function showLoading(step){
  ['cardDatos','cardPreview'].forEach(x => { const el=$(x); if(el) el.classList.remove('visible'); });
  $('loading').classList.add('visible');
  [1,2,3,4].forEach(i=>{ const s=$('s'+i); if(!s)return; s.classList.remove('active','done'); if(i<step) s.classList.add('done'); if(i===step) s.classList.add('active'); });
  const sticky = $('sticky'); if(sticky) sticky.style.display='none';
}
function alertEl(id,msg){ const el=$(id); if(!el)return; el.textContent=msg; el.classList.add('show'); }
function clearAlert(id){ const el=$(id); if(el){el.textContent=''; el.classList.remove('show');} }

function getDatos(){
  const datos = { tipo: CFG.title || 'Documento legal', pais:'Argentina', origen_hoja: location.pathname };
  for(const c of (CFG.fields || [])){
    const el = $('f_'+c.id); datos[c.id] = (el?.value || '').trim();
  }
  return datos;
}
function validate(){
  clearAlert('errDatos');
  for(const c of (CFG.fields || [])){
    if(!c.required) continue;
    const el = $('f_'+c.id);
    if(!el || !String(el.value || '').trim()){
      alertEl('errDatos', 'Completá el campo obligatorio: ' + c.label + '.');
      el && el.focus();
      return false;
    }
  }
  return true;
}
function meta(){ return { titulo: CFG.title, categoria: CFG.category || 'documento', precio_usd: PRICE_USD, requiere_advertencia_legal: !!CFG.warning, page: location.pathname }; }

async function generarPreview(){
  if(!validate()) return;
  clearAlert('errPago');
  const datos = getDatos();
  savePaymentState('legalai_datos', datos);
  savePaymentState('legalai_meta', meta());
  savePaymentState('legalai_titulo', CFG.title || 'Documento legal');
  savePaymentState('legalai_precio_usd', String(PRICE_USD));
  showLoading(2);
  track('generar_preview', {doc_tipo: CFG.title});
  try{
    const res = await fetch(WORKER + '/preview', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({datosDoc:datos, metadata:meta()}), signal:AbortSignal.timeout(30000)});
    const data = await res.json().catch(()=>({}));
    if(!res.ok || data.error) throw new Error(data.error || 'No se pudo generar la vista previa');
    state.previewId = data.previewId || null; state.texto = data.texto || '';
    savePaymentState('legalai_previewId', state.previewId || '');
    renderPreview(state.texto || fallbackPreview(datos));
  }catch(err){
    state.previewId = null; state.texto = fallbackPreview(datos);
    removePaymentState('legalai_previewId');
    renderPreview(state.texto);
    track('preview_fallback', {doc_tipo: CFG.title, error:String(err.message||err).slice(0,90)});
  }
  showCard('cardPreview',2);
}
function fallbackPreview(datos){
  const lines = [`# ${CFG.title || 'Documento legal'}`, '', 'Modelo orientativo. No reemplaza asesoramiento legal profesional.', '', '## Datos cargados'];
  Object.entries(datos).forEach(([k,v])=>{ if(v) lines.push(`- ${k.replace(/_/g,' ')}: ${v}`); });
  lines.push('', '## Cláusulas orientativas', 'El documento completo se generará con las condiciones indicadas y espacios de firma para las partes.');
  return lines.join('\n');
}
function renderPreview(txt){
  const safe = esc(txt).slice(0, 5200);
  $('previewBox').innerHTML = safe + '<div class="watermark">VISTA PREVIA</div>';
}

async function pagar(){
  clearAlert('errPago');
  $('btnPagar').disabled = true;
  showLoading(3);
  const datos = getDatos();
  savePaymentState('legalai_datos', datos);
  savePaymentState('legalai_meta', meta());
  savePaymentState('legalai_titulo', CFG.title || 'Documento legal');
  savePaymentState('legalai_precio_usd', String(PRICE_USD));
  const montoARS = state.montoARS || Math.ceil(PRICE_USD * 1400 / 100) * 100;
  savePaymentState('legalai_monto_ars', String(montoARS));
  const ref = new URLSearchParams(location.search).get('ref') || sessionStorage.getItem('legalai_ref') || '';
  const externalRef = 'doc_' + cleanName(CFG.slug || CFG.title) + '_' + Date.now();
  track('inicio_pago', {doc_tipo: CFG.title, amount_ars:montoARS});
  try{
    savePaymentState('legalai_external_reference', externalRef);
    const res = await fetch(WORKER + '/mp/preferencia', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tipo:'doc', montoARS, descripcion:CFG.title || 'Documento LegalAI', externalRef, ref, datosDoc:datos, metadata:meta(), previewId:state.previewId || '', datosPago:{titulo:CFG.title, origen:'doc_page', page:location.pathname, previewId:state.previewId || '', ...utmData()}}), signal:AbortSignal.timeout(25000)});
    const data = await res.json().catch(()=>({}));
    if(!res.ok || !data.init_point) throw new Error(data.detalle || data.error || 'MercadoPago no devolvió link de pago');
    location.href = data.init_point;
  }catch(err){
    $('btnPagar').disabled = false;
    showCard('cardPreview',2);
    alertEl('errPago', 'No se pudo iniciar el pago: ' + (err.message || err));
    track('error_pago', {doc_tipo: CFG.title, error:String(err.message||err).slice(0,100)});
  }
}

async function obtenerCotizacion(){
  const fuentes = [
    ['https://dolarapi.com/v1/dolares/oficial', d => d?.venta, 'BNA'],
    ['https://api.bluelytics.com.ar/v2/latest', d => d?.official?.value_sell, 'BNA'],
    ['https://dolarapi.com/v1/dolares/bolsa', d => d?.venta, 'MEP']
  ];
  for(const [url, fn, fuente] of fuentes){
    try{ const r = await fetch(url, {signal:AbortSignal.timeout(4500)}); const d = await r.json(); const v = Number(fn(d)); if(v>0){ state.cotizacion={valor:v, fuente}; renderPrecio(); return; } }catch(_){ }
  }
  state.cotizacion={valor:1400, fuente:'ref.'}; renderPrecio();
}
function renderPrecio(){
  const v = Number(state.cotizacion?.valor || 1400);
  const ars = Math.ceil(PRICE_USD * v / 100) * 100;
  state.montoARS = ars;
  const txt = '$ ' + ars.toLocaleString('es-AR');
  const det = `USD ${PRICE_USD.toFixed(1)} · dólar ${state.cotizacion?.fuente || 'ref.'} $${Math.round(v)}`;
  const p1=$('priceAmt'), p2=$('priceDet'), p3=$('desdeTxt');
  if(p1) p1.textContent = txt;
  if(p2) p2.textContent = det + ' · pago único';
  if(p3) p3.textContent = '✓ ' + txt + ' ARS aprox.';
  savePaymentState('legalai_monto_ars', String(ars));
}

function initUTM(){
  const p = new URLSearchParams(location.search);
  ['utm_source','utm_medium','utm_campaign','gclid','ref'].forEach(k=>{ const v=p.get(k); if(v) sessionStorage.setItem('legalai_'+(k==='ref'?'ref':k), v); });
}
function utmData(){
  return {utm_src:sessionStorage.getItem('legalai_utm_source')||'',utm_med:sessionStorage.getItem('legalai_utm_medium')||'',utm_cmp:sessionStorage.getItem('legalai_utm_campaign')||'',gclid:sessionStorage.getItem('legalai_gclid')||'',device: /Mobi|Android/i.test(navigator.userAgent)?'mobile':'desktop'};
}
function track(tipo, extra){
  try{ if(window.gtag) window.gtag('event', tipo, extra || {}); }catch(_){ }
  try{ fetch(WORKER + '/evento', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tipo, pagina:location.pathname, session_id:SESSION, doc_tipo:CFG.title, product:CFG.title, ...utmData(), ...(extra||{})})}).catch(()=>{}); }catch(_){ }
}

injectStyles();
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();