const fs = require("fs");

// ── Config ────────────────────────────────────────────────────────────────
const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html",
  "acerca_de_legal_ai_layout_dinamico.html"
];

const WORKER_URL   = "https://legalai-arg-worker.finmap-ia.workers.dev";
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
  const desde48h = new Date(Date.now() - 48 * 3600 * 1000).toISOString().slice(0, 10);
  const desde7d  = new Date(Date.now() - 7  * 86400 * 1000).toISOString().slice(0, 10);

  const [r48, r7d, rEventos] = await Promise.all([
    fetch(`${WORKER_URL}/stats?desde=${desde48h}`, { headers: { "x-admin-key": adminKey } }),
    fetch(`${WORKER_URL}/stats?desde=${desde7d}`,  { headers: { "x-admin-key": adminKey } }),
    fetch(`${WORKER_URL}/eventos`),
  ]);

  const [stats48, stats7d, eventosRaw] = await Promise.all([
    r48.ok      ? r48.json()      : null,
    r7d.ok      ? r7d.json()      : null,
    rEventos.ok ? rEventos.json() : null,
  ]);

  return { stats48, stats7d, eventosRaw };
}

// ── Calcular métricas procesadas ──────────────────────────────────────────
function calcularMetricas({ stats48, stats7d, eventosRaw }) {
  const metricasPeriodo = (stats) => {
    if (!stats?.ok) return null;
    const r = stats.resumen;
    return {
      clics:              r.total_clics,
      ventas:             r.total_ventas,
      tasa_conv:          r.total_clics > 0 ? ((r.total_ventas / r.total_clics) * 100).toFixed(1) + "%" : "0.0%",
      total_ars:          r.total_ars,
      por_fuente:         stats.por_fuente         || {},
      top_documentos:     stats.top_documentos     || [],
      ultimas_conversiones: (stats.ultimas_conversiones || []).slice(0, 5),
    };
  };

  // Embudo por tipo de evento
  const embudoEventos = {};
  if (eventosRaw?.eventos) {
    for (const ev of eventosRaw.eventos) {
      const k = ev.tipo || "unknown";
      embudoEventos[k] = (embudoEventos[k] || 0) + 1;
    }
  }

  const m48 = metricasPeriodo(stats48);
  const problemas     = [];
  const oportunidades = [];

  if (m48) {
    if (m48.clics > 20 && m48.ventas === 0) {
      problemas.push("Alto tráfico sin conversiones → problema en checkout o precio");
    }
    if (m48.clics === 0) {
      problemas.push("Sin clics en 48h → problema en ads, copy o segmentación");
    }
    if (m48.clics > 5 && parseFloat(m48.tasa_conv) < 1) {
      problemas.push(`Tasa de conv muy baja (${m48.tasa_conv}) → revisar copy, precio o flujo de pago`);
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
    total_eventos:  eventosRaw?.total || 0,
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

  return `
ERES UN AUDITOR DE CONVERSIONES DE UN SITIO WEB DE DOCUMENTOS LEGALES (ARGENTINA).
RESPONDÉ SOLO JSON. SIN TEXTO EXTRA. SIN MARKDOWN. SIN BACKTICKS.

FORMATO EXACTO:
{
  "decision": "NO_CAMBIAR" | "OBSERVAR" | "PROPONER_CAMBIO",
  "resumen": "1 línea máx",
  "motivo": "dato clave que justifica la decisión",
  "prioridad": "alta" | "media" | "baja",
  "embudo": "donde cae el usuario o null",
  "cambio_sugerido": {
    "archivo": "nombre_archivo.html o null",
    "tipo": "copy" | "precio" | "flujo_pago" | "cta" | "ads" | "observar_mas",
    "descripcion": "qué cambiar exactamente (1-2 líneas)",
    "hipotesis": "si cambiamos X esperamos Y",
    "esperar_horas": 48
  }
}

REGLAS:
- Menos de 5 clics → NO_CAMBIAR (sin datos)
- Problema claro con datos → PROPONER_CAMBIO (cambio_sugerido completo)
- Señal débil → OBSERVAR (cambio_sugerido null)
- No repetir cambios ya probados
- Si hay cambio activo < 48h → NO_CAMBIAR automático
- Priorizar: conversiones > clics > tráfico

MÉTRICAS 48H:
${JSON.stringify(metricas.periodo_48h, null, 2)}

MÉTRICAS 7 DÍAS:
${JSON.stringify(metricas.periodo_7d, null, 2)}

DIAGNÓSTICO AUTOMÁTICO:
${JSON.stringify(metricas.diagnostico, null, 2)}

EMBUDO EVENTOS (24h):
${JSON.stringify(metricas.embudo_eventos, null, 2)}
Total eventos: ${metricas.total_eventos}

ESTADO Y CAMBIO ACTIVO:
${JSON.stringify(state, null, 2)}

EVALUACIÓN CAMBIO ACTIVO:
${JSON.stringify(cambioEval, null, 2)}

HISTORIAL (últimas 5 decisiones):
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
Clics:      ${m?.clics     ?? "—"}
Ventas:     ${m?.ventas    ?? "—"}
Conv Rate:  ${m?.tasa_conv ?? "—"}
Total ARS:  $${m?.total_ars ?? "—"}

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

    console.log(`Diag: ${metricas.diagnostico.estado} | Clics 48h: ${metricas.periodo_48h?.clics ?? "N/A"} | Ventas: ${metricas.periodo_48h?.ventas ?? "N/A"}`);

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
