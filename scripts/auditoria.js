const fs = require("fs");

const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";
console.log("Modelo usado:", CLAUDE_MODEL);

const DATA_DIR = "data";
const LOG_FILE = "data/auditoria-log.jsonl";
const STATE_FILE = "data/auditoria-state.json";

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
      out += `\n\n===== ${file} =====\n${fs.readFileSync(file, "utf8").slice(0, 18000)}`;
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
      experimento_activo: null,
      cambios_probados: [],
      regla: "No proponer cambios diarios. Primero observar, comparar y registrar."
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
    .map(x => {
      try { return JSON.parse(x); } catch { return null; }
    })
    .filter(Boolean);
}

function readMetrics() {
  if (!fs.existsSync("data/metrics.json")) {
    return {
      fuente: "sin_metricas_conectadas",
      aviso: "GitHub no informa conversiones reales. Faltan métricas externas.",
      visitas: null,
      clics_cta: null,
      formularios: null,
      pagos: null,
      conversiones: null
    };
  }

  return JSON.parse(fs.readFileSync("data/metrics.json", "utf8"));
}

function prompt({ site, state, logs, metrics }) {
  return `
Actuás como auditor CRO de LegalAI Arg.

OBJETIVO:
No cambiar por cambiar. Mantener memoria, comparar contra el día anterior y solo recomendar cambios cuando haya motivo real.

REGLAS ESTRICTAS:
- No propongas cambios contradictorios con cambios recientes.
- No propongas cambios diarios si no hubo plazo suficiente.
- Si no hay métricas reales, priorizá "mantener y observar".
- Si hay un experimento activo con menos de 3 días, no recomendar cambios nuevos.
- Si ya se probó un cambio antes, indicarlo.
- Máximo 1 cambio sugerido.
- Si no hay evidencia suficiente, responder "NO CAMBIAR".
- Separar observación, hipótesis, plazo y métrica esperada.
- No tocar diseño ni copy si no hay justificación fuerte.

FORMATO OBLIGATORIO EN JSON PURO:
{
  "decision": "NO_CAMBIAR" | "OBSERVAR" | "PROPONER_CAMBIO",
  "resumen": "...",
  "comparacion_vs_dia_anterior": "...",
  "conversiones_disponibles": true/false,
  "motivo": "...",
  "cambio_sugerido": {
    "archivo": "...",
    "seccion": "...",
    "accion": "...",
    "texto_actual_estimado": "...",
    "texto_nuevo": "...",
    "hipotesis": "...",
    "metrica_a_medir": "...",
    "plazo_minimo_dias": 3,
    "riesgo": "bajo" | "medio" | "alto"
  },
  "instruccion_para_claude_code": "...",
  "nota_final": "..."
}

ESTADO ACTUAL:
${JSON.stringify(state, null, 2)}

LOGS RECIENTES:
${JSON.stringify(logs, null, 2)}

METRICAS:
${JSON.stringify(metrics, null, 2)}

ARCHIVOS DEL SITIO:
${site}
`;
}

async function postJson(url, headers, body) {
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data;

  try { data = JSON.parse(text); } catch { data = text; }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(data, null, 2)}`);
  }

  return data;
}

async function askClaude(p, key) {
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    {
      model: MODEL,
      max_tokens: 2500,
      messages: [{ role: "user", content: p }]
    }
  );

  return data.content?.[0]?.text || "";
}

function parseClaude(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      decision: "OBSERVAR",
      resumen: "Claude no devolvió JSON válido.",
      raw: text
    };
  }
}

function updateState(state, decision) {
  const today = new Date().toISOString();

  state.ultima_auditoria = today;
  state.ultima_decision = decision.decision;
  state.ultimo_resumen = decision.resumen;

  if (decision.decision === "PROPONER_CAMBIO" && decision.cambio_sugerido) {
    state.experimento_activo = {
      fecha_inicio: today,
      estado: "propuesto_no_aplicado",
      cambio: decision.cambio_sugerido
    };

    state.cambios_probados = state.cambios_probados || [];
    state.cambios_probados.push({
      fecha: today,
      archivo: decision.cambio_sugerido.archivo,
      seccion: decision.cambio_sugerido.seccion,
      hipotesis: decision.cambio_sugerido.hipotesis,
      plazo_minimo_dias: decision.cambio_sugerido.plazo_minimo_dias
    });
  }

  return state;
}

function saveLog(decision, state, metrics) {
  const entry = {
    fecha: new Date().toISOString(),
    decision: decision.decision,
    resumen: decision.resumen,
    motivo: decision.motivo,
    comparacion_vs_dia_anterior: decision.comparacion_vs_dia_anterior,
    cambio_sugerido: decision.cambio_sugerido || null,
    metricas: metrics,
    modelo: MODEL
  };

  fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + "\n");
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendEmail(decision, resendKey, to) {
  const body = `
Auditoría diaria LegalAI

DECISIÓN:
${decision.decision}

RESUMEN:
${decision.resumen || ""}

COMPARACIÓN VS DÍA ANTERIOR:
${decision.comparacion_vs_dia_anterior || ""}

MOTIVO:
${decision.motivo || ""}

CAMBIO SUGERIDO:
${decision.cambio_sugerido ? JSON.stringify(decision.cambio_sugerido, null, 2) : "Sin cambio sugerido"}

INSTRUCCIÓN PARA CLAUDE CODE:
${decision.instruccion_para_claude_code || "No aplicar cambios."}

NOTA:
${decision.nota_final || ""}
`;

  await postJson(
    "https://api.resend.com/emails",
    {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    {
      from: "LegalAI <onboarding@resend.dev>",
      to: [to],
      subject: `Auditoría LegalAI - ${decision.decision}`,
      text: body
    }
  );
}

(async () => {
  try {
    console.log("Modelo usado:", MODEL);
    ensureDataDir();

    const claudeKey = env("CLAUDE_API_KEY");
    const resendKey = env("RESEND_API_KEY");
    const emailTo = env("EMAIL_TO");

    const site = readSite();
    const state = readState();
    const logs = readRecentLogs();
    const metrics = readMetrics();

    const p = prompt({ site, state, logs, metrics });
    const raw = await askClaude(p, claudeKey);
    const decision = parseClaude(raw);

    const newState = updateState(state, decision);

    saveLog(decision, newState, metrics);
    await sendEmail(decision, resendKey, emailTo);

    console.log("Auditoría finalizada:", decision.decision);
  } catch (e) {
    console.error("ERROR REAL:");
    console.error(e.message || e);
    process.exit(1);
  }
})();
