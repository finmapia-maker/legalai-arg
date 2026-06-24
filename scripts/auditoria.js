const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────
const ARCHIVOS = [
  "index.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

// Referencias que no deberían quedar en el flujo público actual.
// Si aparecen, la auditoría las marca como problema técnico antes de analizar conversión.
const REFERENCIAS_OBSOLETAS = [
  "formulario.html",
  "generador.html",
  "generador2.html",
  "contrato-alquiler-residencial.html",
  "contrato-alquiler-comercial.html",
  "contrato-alquiler-temporario.html",
  "contrato-freelance-diseno.html",
  "contrato-freelance-dev.html",
  "contrato-freelance-community.html",
  "acuerdo-confidencialidad-nda.html",
  "terminos-condiciones-web.html",
  "politica-privacidad-web.html"
];

const WORKER_URL   = "https://legalai-worker.finmap-ia.workers.dev";
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
const DATA_DIR     = "data";
const LOG_FILE     = "data/auditoria-log.jsonl";
const STATE_FILE   = "data/auditoria-state.json";

// ── Utilidades ────────────────────────────────────────────────────────────
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);
}

function env(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Falta secret: ${name}`);
  return v;
}

function readSite() {
  let out = "";
  for (const file of ARCHIVOS) {
    if (fs.existsSync(file)) {
      out += `\n\n===== ${file} =====\n${fs.readFileSync(file, "utf8").slice(0, 8000)}`;
    } else {
      out += `\n\n===== ${file} NO ENCONTRADO =====`;
    }
  }
  return out;
}

function validarArchivosPublicos() {
  const problemas = [];
  const oportunidades = [];

  for (const file of ARCHIVOS) {
    if (!fs.existsSync(file)) {
      problemas.push(`Falta archivo público esperado: ${file}`);
      continue;
    }
    const html = fs.readFileSync(file, "utf8");
    for (const ref of REFERENCIAS_OBSOLETAS) {
      if (html.includes(ref)) {
        problemas.push(`${file} conserva referencia obsoleta a ${ref}`);
      }
    }
  }

  const index = fs.existsSync("index.html") ? fs.readFileSync("index.html", "utf8") : "";
  const contrato = fs.existsSync("contrato-alquiler.html") ? fs.readFileSync("contrato-alquiler.html", "utf8") : "";
  const worker = fs.existsSync("worker.js") ? fs.readFileSync("worker.js", "utf8") : "";

  if (index) {
    if (!index.includes("LEGALAI_INLINE_DOCS") || !index.includes("selectDocInline")) {
      problemas.push("index.html no parece tener activo el generador unificado inline.");
    }
    if (!index.includes("gclid") && !index.includes("utm_source")) {
      oportunidades.push("index.html no expone tracking completo de Google Ads/UTM en eventos propios.");
    }
  }

  if (contrato) {
    if (!contrato.includes("index.html?doc=") || !contrato.includes("#generador")) {
      problemas.push("contrato-alquiler.html no deriva claramente al index unificado con doc seleccionado.");
    }
    if (/Generador<\/a>|Contrato alquiler<\/a>|data-sec=\"generador\"/.test(contrato)) {
      problemas.push("contrato-alquiler.html conserva navegación vieja visible.");
    }
  }

  if (worker && worker.includes("formulario.html?payment_error=1")) {
    problemas.push("worker.js conserva back_url failure viejo hacia formulario.html.");
  }

  return { problemas, oportunidades };
}

function readState() {
  if (!fs.existsSync(STATE_FILE)) {
    return {
      fecha_inicio: new Date().toISOString(),
      estado: "baseline_inicial",
      cambio_activo: null,
      cambio_activo_desde: null,
      cambios_probados: []
    };
  }
  return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
}

function readRecentLogs() {
  if (!fs.existsSync(LOG_FILE)) return [];
  return fs.readFileSync(LOG_FILE, "utf8")
    .split("\n")
    .filter(Boolean)
    .slice(-10)
    .map(x => JSON.parse(x));
}

// ── Fetch datos reales del Worker ─────────────────────────────────────────
async function fetchStats(adminKey) {
  const cutoff48h = new Date(Date.now() - 48 * 3600 * 1000);
  const cutoff7d  = new Date(Date.now() - 7  * 86400 * 1000);
  const desde7d   = cutoff7d.toISOString().slice(0, 10);

  // Fuente principal actual: /owner/all. Antes este script consultaba /stats y /eventos,
  // endpoints que pueden no existir o quedar desactualizados. /owner/all es la fuente real del panel.
  const rOwner = await fetch(`${WORKER_URL}/owner/all?desde=${desde7d}`, {
    headers: { "x-admin-key": adminKey }
  });

  const fetch_errors = [];
  if (!rOwner.ok) {
    const txt = await rOwner.text().catch(() => "");
    fetch_errors.push(`/owner/all HTTP ${rOwner.status}: ${txt.slice(0, 250)}`);
    return { stats48: null, stats7d: null, eventosRaw: null, eventosRaw7d: null, fetch_errors };
  }

  const ownerPayload = await rOwner.json().catch(() => null);
  if (!ownerPayload?.ok) {
    fetch_errors.push(`/owner/all sin ok=true: ${JSON.stringify(ownerPayload || {}).slice(0, 250)}`);
    return { stats48: null, stats7d: null, eventosRaw: null, eventosRaw7d: null, fetch_errors };
  }

  const operaciones = Array.isArray(ownerPayload.operaciones)
    ? ownerPayload.operaciones
    : Array.isArray(ownerPayload.ops)
      ? ownerPayload.ops
      : [];

  const ev48 = filterEventsSince(operaciones, cutoff48h);
  const ev7d = filterEventsSince(operaciones, cutoff7d);

  return {
    stats48: buildStatsFromEvents(ev48),
    stats7d: buildStatsFromEvents(ev7d),
    eventosRaw: buildEventosFromEvents(ev48),
    eventosRaw7d: buildEventosFromEvents(ev7d),
    ownerPayload,
    fetch_errors
  };
}

function filterEventsSince(events, cutoff) {
  return (events || []).filter(ev => {
    const d = new Date(ev.date || ev.fecha || ev.created_at || 0);
    return !Number.isNaN(d.getTime()) && d >= cutoff;
  });
}

function eventType(ev) {
  return String(ev?.type || ev?.tipo || ev?.event || ev?.raw?.tipo || ev?.raw?.event || "").toLowerCase();
}

function eventStatus(ev) {
  return String(ev?.status || ev?.estado || ev?.payment_status || "").toLowerCase();
}

function eventProduct(ev) {
  return String(ev?.product || ev?.producto || ev?.doc_tipo || ev?.raw?.doc_tipo || ev?.raw?.pagina || ev?.raw?.page_group || "LegalAI");
}

function eventSource(ev) {
  const raw = ev?.raw || {};
  const source = String(ev?.affiliate_source || raw.utm_src || raw.utm_source || raw.utm || "").toLowerCase();
  const medium = String(raw.utm_med || raw.utm_medium || "").toLowerCase();
  const gclid = ev?.gclid || raw.gclid || raw.raw?.gclid;

  if (gclid) return "google_ads";
  if (source.includes("google") || medium.includes("cpc") || medium.includes("paid")) return "google_ads";
  return String(ev?.affiliate_source || raw.utm_src || raw.utm_source || ev?.affiliate || raw.ref || "directo") || "directo";
}

function isAdsEvent(ev) {
  return eventSource(ev) === "google_ads" || Boolean(ev?.raw?.gclid || ev?.gclid);
}

function isMeaningfulClick(ev) {
  const t = eventType(ev);
  return Boolean(
    t.includes("click") ||
    t.startsWith("cta_") ||
    t.startsWith("nav_") ||
    ["interaccion", "doc_selected", "form_first_input", "form_start", "inicio_formulario", "inicio_pago", "checkout_start", "preview_action", "preview_live_ok", "cta_generar", "cta_formulario", "cta_planes", "cta_contrato_alquiler"].includes(t)
  );
}

function isVisit(ev) {
  const t = eventType(ev);
  return t === "page_view" || t === "form_page_view" || t.endsWith("page_view");
}

function eventPath(ev) {
  return String(ev?.path || ev?.raw?.path || ev?.raw?.url || ev?.url || "").toLowerCase();
}

function isObsoleteUrlEvent(ev) {
  const path = eventPath(ev);
  return REFERENCIAS_OBSOLETAS.some(ref => path.includes(ref.toLowerCase()));
}

function isPaymentReturnFailed(ev) {
  return eventType(ev) === "payment_return_failed" || (eventPath(ev).includes("payment_error=1") && !eventPath(ev).includes("status=approved"));
}

function isFrontendError(ev) {
  return eventType(ev) === "frontend_error" || eventType(ev).includes("js_error");
}

function isConfirmedSale(ev) {
  const t = eventType(ev);
  const s = eventStatus(ev);
  const saleTypes = new Set(["venta", "sale", "payment_approved", "plan_activated", "pack_created"]);
  return saleTypes.has(t) && ["approved", "active", "paid", "success", "ok"].includes(s);
}

function saleKeys(ev) {
  const raw = ev.raw || {};
  const inner = raw.raw || {};
  return [
    ev.order_id, ev.payment_id, ev.id,
    String(ev.id || "").replace(/^MP-/, ""),
    raw.order_id, raw.payment_id, raw.paymentId, raw.externalRef, raw.external_reference,
    inner.order_id, inner.payment_id, inner.paymentId, inner.externalRef, inner.external_reference
  ].filter(Boolean).map(String);
}

function dedupeSales(events) {
  const seen = new Set();
  const out = [];
  for (const ev of events.filter(isConfirmedSale)) {
    const keys = saleKeys(ev);
    if (keys.some(k => seen.has(k))) continue;
    out.push(ev);
    for (const k of keys) seen.add(k);
  }
  return out;
}

function amountARS(ev, checkoutById = new Map()) {
  const direct = Number(ev?.amount_ars || 0);
  if (direct > 0) return direct;
  const currency = String(ev?.currency || "").toUpperCase();
  const amount = Number(ev?.amount || 0);
  if (currency === "ARS" && amount > 0) return amount;

  for (const key of saleKeys(ev)) {
    const related = checkoutById.get(key);
    if (related) {
      const relatedDirect = Number(related.amount_ars || 0);
      if (relatedDirect > 0) return relatedDirect;
      const relatedCurrency = String(related.currency || "").toUpperCase();
      const relatedAmount = Number(related.amount || 0);
      if (relatedCurrency === "ARS" && relatedAmount > 0) return relatedAmount;
    }
  }
  return 0;
}

function buildCheckoutMap(events) {
  const map = new Map();
  for (const ev of events || []) {
    if (eventType(ev) !== "checkout_start") continue;
    for (const key of saleKeys(ev)) map.set(key, ev);
  }
  return map;
}

function buildStatsFromEvents(events) {
  const checkoutById = buildCheckoutMap(events);
  const ventas = dedupeSales(events);
  const total_clics = events.filter(isMeaningfulClick).length;
  const total_visitas = events.filter(isVisit).length;
  const total_ventas = ventas.length;
  const total_ars = ventas.reduce((sum, ev) => sum + amountARS(ev, checkoutById), 0);
  const por_fuente = {};
  const docs = new Map();

  for (const ev of events) {
    const fuente = eventSource(ev);
    if (!por_fuente[fuente]) por_fuente[fuente] = { visitas: 0, clics: 0, ventas: 0, total_ars: 0 };
    if (isVisit(ev)) por_fuente[fuente].visitas += 1;
    if (isMeaningfulClick(ev)) por_fuente[fuente].clics += 1;

    const prod = eventProduct(ev);
    if (!docs.has(prod)) docs.set(prod, { documento: prod, eventos: 0, ventas: 0, total_ars: 0 });
    docs.get(prod).eventos += 1;
  }

  for (const ev of ventas) {
    const fuente = eventSource(ev);
    if (!por_fuente[fuente]) por_fuente[fuente] = { visitas: 0, clics: 0, ventas: 0, total_ars: 0 };
    por_fuente[fuente].ventas += 1;
    por_fuente[fuente].total_ars += amountARS(ev, checkoutById);

    const prod = eventProduct(ev);
    if (!docs.has(prod)) docs.set(prod, { documento: prod, eventos: 0, ventas: 0, total_ars: 0 });
    docs.get(prod).ventas += 1;
    docs.get(prod).total_ars += amountARS(ev, checkoutById);
  }

  return {
    ok: true,
    resumen: { total_clics, total_visitas, total_ventas, total_ars, total_eventos: events.length },
    por_fuente,
    top_documentos: Array.from(docs.values()).sort((a, b) => b.ventas - a.ventas || b.eventos - a.eventos).slice(0, 10),
    ultimas_conversiones: ventas.slice(0, 5)
  };
}

function countWhere(events, predicate) {
  return events.reduce((n, ev) => n + (predicate(ev) ? 1 : 0), 0);
}

function dropPct(prev, current) {
  if (!prev || current >= prev) return 0;
  return Math.round(((prev - current) / prev) * 100);
}

function buildFunnel(steps) {
  let prev = null;
  return steps.map(step => {
    const out = { label: step.label, count: step.count, drop_pct: prev === null ? 0 : dropPct(prev, step.count) };
    prev = step.count;
    return out;
  });
}

function detectBottleneck(funnels) {
  let worst = null;
  for (const [name, funnel] of Object.entries(funnels)) {
    for (const step of funnel) {
      if (step.drop_pct > 50 && (!worst || step.drop_pct > worst.drop_pct)) {
        worst = { funnel: name, etapa: step.label, drop_pct: step.drop_pct, count: step.count };
      }
    }
  }
  return worst;
}

function buildEventosFromEvents(events) {
  const por_tipo = {};
  for (const ev of events) por_tipo[eventType(ev) || "sin_tipo"] = (por_tipo[eventType(ev) || "sin_tipo"] || 0) + 1;

  const funnel_doc = buildFunnel([
    { label: "Visitas", count: countWhere(events, isVisit) },
    { label: "Documento elegido", count: countWhere(events, ev => ["doc_selected", "cta_doc_inline", "click_residencial", "click_comercial", "click_temporario"].includes(eventType(ev))) },
    { label: "Inicio formulario", count: countWhere(events, ev => ["form_start", "form_first_input", "inicio_formulario", "click_generar", "cta_generar", "form_fields_generated"].includes(eventType(ev))) },
    { label: "Preview live OK", count: countWhere(events, ev => eventType(ev) === "preview_live_ok" || eventType(ev) === "preview_ok") },
    { label: "Pago iniciado", count: countWhere(events, ev => ["click_pagar", "inicio_pago", "checkout_start"].includes(eventType(ev))) },
    { label: "Venta confirmada", count: dedupeSales(events).length }
  ]);

  const funnel_plan = buildFunnel([
    { label: "Visitas planes", count: countWhere(events, ev => eventProduct(ev).toLowerCase().includes("planes") || ev.raw?.pagina === "planes" || ev.raw?.page_group === "planes") },
    { label: "Click plan", count: countWhere(events, ev => eventType(ev).includes("plan") || eventProduct(ev).toLowerCase().includes("plan")) },
    { label: "Pago plan iniciado", count: countWhere(events, ev => eventType(ev) === "checkout_start" && eventProduct(ev).toLowerCase().includes("plan")) },
    { label: "Plan activo", count: countWhere(events, ev => ["plan_activated", "pack_created"].includes(eventType(ev)) && ["approved", "active"].includes(eventStatus(ev))) }
  ]);

  const adsEvents = events.filter(isAdsEvent);
  const funnel_ads = buildFunnel([
    { label: "Ads visitas", count: countWhere(adsEvents, ev => isVisit(ev) || eventType(ev) === "ads_landing_view") },
    { label: "Ads click documento", count: countWhere(adsEvents, ev => ["click_residencial", "click_comercial", "click_temporario", "doc_selected", "cta_doc_inline"].includes(eventType(ev))) },
    { label: "Ads inicio formulario", count: countWhere(adsEvents, ev => ["form_start", "form_first_input", "inicio_formulario", "cta_doc_inline"].includes(eventType(ev))) },
    { label: "Ads preview OK", count: countWhere(adsEvents, ev => ["preview_live_ok", "preview_ok"].includes(eventType(ev))) },
    { label: "Ads inicio pago", count: countWhere(adsEvents, ev => ["click_pagar", "inicio_pago", "checkout_start"].includes(eventType(ev))) },
    { label: "Ads vuelta sin pago", count: countWhere(adsEvents, isPaymentReturnFailed) },
    { label: "Ads venta", count: dedupeSales(adsEvents).length }
  ]);

  const alertas_tracking = {
    frontend_errors: countWhere(events, isFrontendError),
    preview_live_errors: countWhere(events, ev => eventType(ev) === "preview_live_error"),
    payment_return_failed: countWhere(events, isPaymentReturnFailed),
    obsolete_url_views: countWhere(events, isObsoleteUrlEvent),
    form_first_input: countWhere(events, ev => eventType(ev) === "form_first_input"),
    doc_selected: countWhere(events, ev => eventType(ev) === "doc_selected"),
  };

  return {
    ok: true,
    total: events.length,
    por_tipo,
    funnel_doc,
    funnel_plan,
    funnel_ads,
    alertas_tracking,
    cuello_botella: detectBottleneck({ doc: funnel_doc, planes: funnel_plan, ads: funnel_ads })
  };
}

// ── Calcular métricas procesadas ──────────────────────────────────────────
function calcularMetricas({ stats48, stats7d, eventosRaw, fetch_errors = [] }) {
  const staticCheck = validarArchivosPublicos();
  const metricasPeriodo = (stats) => {
    if (!stats?.ok) return null;
    const r = stats.resumen || {};
    return {
      visitas:            r.total_visitas || 0,
      clics:              r.total_clics || 0,
      ventas:             r.total_ventas || 0,
      tasa_conv:          r.total_clics > 0 ? ((r.total_ventas / r.total_clics) * 100).toFixed(1) + "%" : "0.0%",
      total_ars:          r.total_ars || 0,
      total_eventos:      r.total_eventos || 0,
      por_fuente:         stats.por_fuente         || {},
      top_documentos:     stats.top_documentos     || [],
      ultimas_conversiones: (stats.ultimas_conversiones || []).slice(0, 5),
    };
  };

  const funnel_doc  = eventosRaw?.funnel_doc  || [];
  const funnel_plan = eventosRaw?.funnel_plan || [];
  const funnel_ads  = eventosRaw?.funnel_ads  || [];
  const cuello      = eventosRaw?.cuello_botella || null;
  const embudoEventos = eventosRaw?.por_tipo || {};
  const alertasTracking = eventosRaw?.alertas_tracking || {};

  const m48 = metricasPeriodo(stats48);
  const problemas     = [];
  const oportunidades = [];

  for (const e of fetch_errors) problemas.push(`Error al leer métricas reales: ${e}`);
  for (const p of staticCheck.problemas) problemas.push(`Control web: ${p}`);
  for (const o of staticCheck.oportunidades) oportunidades.push(`Control web: ${o}`);

  if (!m48) {
    problemas.push("No se pudieron leer métricas desde /owner/all; revisar ADMIN_KEY o Worker.");
  } else {
    if (m48.total_eventos === 0) {
      problemas.push("Sin eventos registrados en 48h → revisar tracker, Worker o tráfico real.");
    } else if (m48.visitas > 0 && m48.clics === 0) {
      problemas.push(`Hay ${m48.visitas} visitas registradas pero 0 clics útiles → revisar visibilidad de CTAs o tracking de clicks.`);
    }

    const adsLanding = (funnel_ads.find(x => x.label === "Ads visitas")?.count || 0);
    const adsDocClick = (funnel_ads.find(x => x.label === "Ads click documento")?.count || 0);
    const adsForm = (funnel_ads.find(x => x.label === "Ads inicio formulario")?.count || 0);
    const adsPago = (funnel_ads.find(x => x.label === "Ads inicio pago")?.count || 0);
    const adsFailed = (funnel_ads.find(x => x.label === "Ads vuelta sin pago")?.count || 0);

    if (adsLanding >= 3 && adsDocClick === 0) {
      problemas.push(`Google Ads: ${adsLanding} visita(s) a landing sin click en documento → revisar claridad del CTA o carga mobile.`);
    }
    if (adsDocClick >= 3 && adsForm === 0) {
      problemas.push(`Google Ads: ${adsDocClick} click(s) de documento sin inicio de formulario → revisar pasaje contrato-alquiler.html → index.`);
    }
    if (adsForm >= 3 && adsPago === 0) {
      problemas.push(`Google Ads: ${adsForm} formulario(s) iniciados sin pago → revisar confianza, precio visible o fricción de formulario.`);
    }
    if (adsFailed > 0) {
      problemas.push(`Google Ads/MercadoPago: ${adsFailed} vuelta(s) sin pago aprobado → revisar rechazo, abandono o medio de pago.`);
    }

    if (alertasTracking.frontend_errors > 0) {
      problemas.push(`Errores frontend detectados: ${alertasTracking.frontend_errors} → revisar consola/compatibilidad mobile.`);
    }
    if (alertasTracking.preview_live_errors > 0) {
      problemas.push(`Preview live con errores: ${alertasTracking.preview_live_errors} → revisar render del formulario.`);
    }
    if (alertasTracking.payment_return_failed > 0) {
      problemas.push(`Retornos de MercadoPago sin pago aprobado: ${alertasTracking.payment_return_failed}.`);
    }
    if (alertasTracking.obsolete_url_views > 0) {
      problemas.push(`Se registraron ${alertasTracking.obsolete_url_views} visita(s) a URLs viejas → revisar enlaces/caché/campañas.`);
    }

    if (m48.clics > 20 && m48.ventas === 0) {
      problemas.push("Muchos clics sin ventas → problema probable en precio, checkout o confianza.");
    }
    if (m48.clics > 5 && parseFloat(m48.tasa_conv) < 1) {
      problemas.push(`Tasa de conv muy baja (${m48.tasa_conv}) → revisar copy, precio o flujo de pago`);
    }
    if (m48.ventas > 0) {
      oportunidades.push(`${m48.ventas} venta(s) confirmada(s) en 48h → analizar fuente/documento y escalar lo que convirtió.`);
    }
    if (m48.clics > 5 && parseFloat(m48.tasa_conv) > 10) {
      oportunidades.push(`Tasa alta (${m48.tasa_conv}) con ${m48.clics} clics → escalar presupuesto de ads`);
    }
    for (const [fuente, datos] of Object.entries(m48.por_fuente || {})) {
      if (datos.clics > 10 && datos.ventas === 0) {
        problemas.push(`Fuente "${fuente}": ${datos.clics} clics y 0 ventas → landing o segmentación`);
      }
    }
    const fuentesTop = Object.entries(m48.por_fuente || {})
      .sort((a, b) => (b[1].ventas || 0) - (a[1].ventas || 0));
    if (fuentesTop.length > 0 && fuentesTop[0][1].ventas > 0) {
      oportunidades.push(`Fuente más rentable: "${fuentesTop[0][0]}" (${fuentesTop[0][1].ventas} ventas)`);
    }
  }

  return {
    periodo_48h:    m48,
    periodo_7d:     metricasPeriodo(stats7d),
    embudo_eventos: embudoEventos,
    alertas_tracking: alertasTracking,
    total_eventos:  eventosRaw?.total || 0,
    funnel_doc,
    funnel_plan,
    funnel_ads,
    cuello_botella: cuello,
    diagnostico: {
      problemas,
      oportunidades,
      estado: problemas.length > 0 ? "PROBLEMA" : oportunidades.length > 0 ? "OPORTUNIDAD" : "OK",
    }
  };
}

// ── Evaluar cambio activo ─────────────────────────────────────────────────
function evaluarCambioActivo(state, metricas) {
  if (!state.cambio_activo) return null;
  const horasActivo = (Date.now() - new Date(state.cambio_activo_desde).getTime()) / 3600000;
  return {
    cambio:           state.cambio_activo.descripcion,
    horas_activo:     Math.round(horasActivo),
    conv_antes:       state.cambio_activo.conv_base || 0,
    conv_ahora:       metricas.periodo_48h?.ventas  || 0,
    delta:            (metricas.periodo_48h?.ventas || 0) - (state.cambio_activo.conv_base || 0),
    suficiente_data:  horasActivo >= 48,
  };
}

// ── Prompt ────────────────────────────────────────────────────────────────
function buildPrompt({ metricas, state, logs, cambioEval }) {
  const logsResumen = logs.slice(-5).map(l => ({
    fecha:    l.fecha,
    decision: l.decision?.decision,
    resumen:  l.decision?.resumen,
    clics:    l.snapshot_metricas?.clics_48h,
    ventas:   l.snapshot_metricas?.ventas_48h,
  }));

  const funnelStr = (funnel) => funnel.length
    ? funnel.map(p => `  ${p.label}: ${p.count}${p.drop_pct > 0 ? ' (↓'+p.drop_pct+'%)' : ''}`).join('\n')
    : '  Sin datos';

  return `
ERES UN AUDITOR DE CONVERSIONES. RESPONDÉ SOLO JSON. SIN TEXTO. SIN BACKTICKS.

FORMATO:
{
  "decision": "NO_CAMBIAR" | "OBSERVAR" | "PROPONER_CAMBIO",
  "resumen": "1 línea",
  "motivo": "dato clave",
  "prioridad": "alta" | "media" | "baja",
  "embudo": "etapa donde cae o null",
  "cambio_sugerido": {
    "archivo": "archivo.html o null",
    "tipo": "copy" | "precio" | "flujo_pago" | "cta" | "ads" | "observar_mas",
    "descripcion": "qué cambiar",
    "hipotesis": "si X → Y",
    "esperar_horas": 48
  }
}

REGLAS:
- Si no hay datos por error de lectura → PROPONER_CAMBIO técnico, no decir que no hay tráfico.
- < 5 visitas reales → NO_CAMBIAR
- Cuello de botella claro (>50% drop) → PROPONER_CAMBIO
- Señal débil → OBSERVAR
- No repetir cambios ya probados
- Cambio activo < 48h → NO_CAMBIAR

FUNNEL DOC (48h):
${funnelStr(metricas.funnel_doc)}

FUNNEL PLANES (48h):
${funnelStr(metricas.funnel_plan)}

FUNNEL GOOGLE ADS / TRÁFICO PAGO (48h):
${funnelStr(metricas.funnel_ads || [])}

CUELLO DE BOTELLA DETECTADO:
${JSON.stringify(metricas.cuello_botella)}

MÉTRICAS 48H:
  Visitas: ${metricas.periodo_48h?.visitas ?? 'N/A'}
  Clics útiles: ${metricas.periodo_48h?.clics ?? 'N/A'}
  Ventas: ${metricas.periodo_48h?.ventas ?? 'N/A'}
  Conv%: ${metricas.periodo_48h?.tasa_conv ?? 'N/A'}
  ARS: ${metricas.periodo_48h?.total_ars ?? 'N/A'}
  Eventos totales: ${metricas.periodo_48h?.total_eventos ?? metricas.total_eventos ?? 'N/A'}
  Tracking fino: ${JSON.stringify(metricas.alertas_tracking || {})}

DIAGNÓSTICO:
  Estado: ${metricas.diagnostico.estado}
  Problemas: ${metricas.diagnostico.problemas.join(' | ') || 'Ninguno'}
  Oport.: ${metricas.diagnostico.oportunidades.join(' | ') || 'Ninguna'}

CAMBIO ACTIVO: ${JSON.stringify(cambioEval)}

HISTORIAL:
${JSON.stringify(logsResumen, null, 2)}
`;
}

// ── Claude ────────────────────────────────────────────────────────────────
async function askClaude(prompt, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: CLAUDE_MODEL,
      max_tokens: 800,
      messages: [{ role: "user", content: prompt }]
    })
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Claude HTTP ${res.status}: ${text}`);
  const parsed = JSON.parse(text);
  return parsed.content?.[0]?.text || "";
}

function extractJSON(text) {
  try { return JSON.parse(text); } catch {}
  const match = text.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return {
    decision: "OBSERVAR",
    resumen: "Claude no devolvió JSON válido",
    motivo: "Respuesta inválida",
    prioridad: "baja",
    embudo: null,
    cambio_sugerido: null,
    raw: text.slice(0, 300)
  };
}

// ── Estado ────────────────────────────────────────────────────────────────
function updateState(state, decision, metricas) {
  state.ultima_decision = decision.decision;
  state.ultima_prioridad = decision.prioridad || null;
  state.ultimo_embudo = decision.embudo || null;
  state.fecha = new Date().toISOString();

  if (decision.decision === "PROPONER_CAMBIO" && decision.cambio_sugerido?.descripcion) {
    state.cambio_activo = {
      descripcion: decision.cambio_sugerido.descripcion,
      archivo:     decision.cambio_sugerido.archivo,
      tipo:        decision.cambio_sugerido.tipo,
      hipotesis:   decision.cambio_sugerido.hipotesis,
      conv_base:   metricas.periodo_48h?.ventas || 0,
      clics_base:  metricas.periodo_48h?.clics  || 0,
    };
    state.cambio_activo_desde = new Date().toISOString();
    if (!state.cambios_probados) state.cambios_probados = [];
    state.cambios_probados.push({
      descripcion:       decision.cambio_sugerido.descripcion,
      fecha:             new Date().toISOString(),
      resultado_pendiente: true,
    });
  }

  // Cerrar cambio activo si pasaron 48h y se decide NO_CAMBIAR
  if (decision.decision === "NO_CAMBIAR" && state.cambio_activo && state.cambio_activo_desde) {
    const horas = (Date.now() - new Date(state.cambio_activo_desde).getTime()) / 3600000;
    if (horas >= 48) {
      const ultimo = state.cambios_probados?.[state.cambios_probados.length - 1];
      if (ultimo) {
        ultimo.resultado_pendiente = false;
        ultimo.conv_final = metricas.periodo_48h?.ventas || 0;
        ultimo.delta = (metricas.periodo_48h?.ventas || 0) - (state.cambio_activo.conv_base || 0);
      }
      state.cambio_activo = null;
      state.cambio_activo_desde = null;
    }
  }

  return state;
}

function saveLog(decision, state, metricas) {
  const m = metricas.periodo_48h;
  fs.appendFileSync(LOG_FILE, JSON.stringify({
    fecha: new Date().toISOString(),
    decision,
    snapshot_metricas: {
      visitas_48h: m?.visitas || 0,
      clics_48h:  m?.clics    || 0,
      ventas_48h: m?.ventas   || 0,
      tasa_conv:  m?.tasa_conv || "—",
      ars_48h:    m?.total_ars || 0,
      estado_diag: metricas.diagnostico.estado,
    }
  }) + "\n");
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  // Snapshot completo de métricas para auditoria.html (sin necesitar llamar al worker desde el browser)
  fs.writeFileSync("data/auditoria-metricas.json", JSON.stringify({
    fecha:          new Date().toISOString(),
    periodo_48h:    metricas.periodo_48h,
    periodo_7d:     metricas.periodo_7d,
    embudo_eventos: metricas.embudo_eventos,
    total_eventos:  metricas.total_eventos,
    funnel_doc:     metricas.funnel_doc,
    funnel_plan:    metricas.funnel_plan,
    funnel_ads:     metricas.funnel_ads,
    alertas_tracking: metricas.alertas_tracking,
    cuello_botella: metricas.cuello_botella,
    diagnostico:    metricas.diagnostico,
  }, null, 2));
}

// ── Email ─────────────────────────────────────────────────────────────────
async function sendEmail(decision, metricas, resendKey, to) {
  const emojis = { PROPONER_CAMBIO: "🟡", OBSERVAR: "🔵", NO_CAMBIAR: "⚪" };
  const emoji  = emojis[decision.decision] || "⚪";
  const m      = metricas.periodo_48h;
  const diag   = metricas.diagnostico;
  const hora   = new Date().toLocaleString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });

  const body = `${emoji} DECISIÓN: ${decision.decision}
Resumen:   ${decision.resumen}
Motivo:    ${decision.motivo}
Prioridad: ${decision.prioridad || "—"}
Embudo:    ${decision.embudo || "—"}
Hora ARG:  ${hora}

── MÉTRICAS 48H ────────────────────
Visitas:    ${m?.visitas   ?? "—"}
Clics:      ${m?.clics     ?? "—"}
Ventas:     ${m?.ventas    ?? "—"}
Conv Rate:  ${m?.tasa_conv ?? "—"}
Total ARS:  $${m?.total_ars ?? "—"}
Eventos:    ${m?.total_eventos ?? metricas.total_eventos ?? "—"}
Ads funnel: ${metricas.funnel_ads?.map(x => `${x.label}:${x.count}`).join(" | ") || "—"}
Tracking:   ${JSON.stringify(metricas.alertas_tracking || {})}

── DIAGNÓSTICO ─────────────────────
Estado:     ${diag.estado}
Problemas:  ${diag.problemas.join(" | ") || "Ninguno"}
Oport.:     ${diag.oportunidades.join(" | ") || "Ninguna"}

── CAMBIO SUGERIDO ─────────────────
${decision.cambio_sugerido ? JSON.stringify(decision.cambio_sugerido, null, 2) : "Ninguno"}
`;

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from:    "LegalAI <info@mail.legalai-arg.com>",
      to:      [to],
      subject: `${emoji} Auditoría · ${decision.decision} · ${hora}`,
      text:    body
    })
  });
}

// ── Main ──────────────────────────────────────────────────────────────────
(async () => {
  try {
    console.log("Modelo:", CLAUDE_MODEL);
    ensureDataDir();

    const claudeKey = env("CLAUDE_API_KEY");
    const resendKey = env("RESEND_API_KEY");
    const emailTo   = env("EMAIL_TO");
    const adminKey  = env("ADMIN_KEY");

    console.log("Fetching worker stats...");
    const rawData  = await fetchStats(adminKey);
    const metricas = calcularMetricas(rawData);
    const state    = readState();
    const logs     = readRecentLogs();
    const cambioEval = evaluarCambioActivo(state, metricas);

    console.log(`Diag: ${metricas.diagnostico.estado} | Visitas 48h: ${metricas.periodo_48h?.visitas ?? "N/A"} | Clics 48h: ${metricas.periodo_48h?.clics ?? "N/A"} | Ventas: ${metricas.periodo_48h?.ventas ?? "N/A"}`);

    let decision;

    // Cambio activo < 48h → no molestar a Claude
    if (state.cambio_activo && cambioEval && !cambioEval.suficiente_data) {
      console.log(`Cambio activo (${cambioEval.horas_activo}h) → NO_CAMBIAR automático`);
      decision = {
        decision:       "NO_CAMBIAR",
        resumen:        `Cambio activo: "${state.cambio_activo.descripcion}"`,
        motivo:         `${cambioEval.horas_activo}h activo. Mínimo 48h para evaluar.`,
        prioridad:      "baja",
        embudo:         null,
        cambio_sugerido: null,
      };
    } else {
      const prompt = buildPrompt({ metricas, state, logs, cambioEval });
      console.log("Consultando Claude...");
      const raw  = await askClaude(prompt, claudeKey);
      decision   = extractJSON(raw);
    }

    const newState = updateState(state, decision, metricas);
    saveLog(decision, newState, metricas);
    await sendEmail(decision, metricas, resendKey, emailTo);

    console.log(`OK: ${decision.decision} | ${decision.resumen}`);

  } catch (e) {
    console.error("ERROR:", e.message);
    process.exit(1);
  }
})();
