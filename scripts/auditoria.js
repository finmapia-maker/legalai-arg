const fs = require("fs");

const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-4-6";

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

function buildPrompt({ site, state, logs }) {
  return `
RESPONDER SOLO JSON.
SIN TEXTO EXTRA.
SIN MARKDOWN.
SIN EXPLICACIONES.

FORMATO EXACTO:

{
  "decision": "NO_CAMBIAR" | "OBSERVAR" | "PROPONER_CAMBIO",
  "resumen": "texto corto",
  "motivo": "texto corto",
  "cambio_sugerido": null
}

REGLAS:
- Si no hay datos → NO_CAMBIAR
- No contradicciones
- No cambios innecesarios

ESTADO:
${JSON.stringify(state)}

LOGS:
${JSON.stringify(logs)}

SITIO:
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

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text}`);
  }

  return text;
}

// 🔥 parser robusto
function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {}

  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }

  return {
    decision: "OBSERVAR",
    resumen: "Claude no devolvió JSON válido",
    motivo: "Respuesta inválida",
    raw: text
  };
}

async function askClaude(prompt, apiKey) {
  const raw = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    {
      model: CLAUDE_MODEL,
      max_tokens: 1500,
      messages: [{ role: "user", content: prompt }]
    }
  );

  const parsed = JSON.parse(raw);
  return parsed.content?.[0]?.text || "";
}

function updateState(state, decision) {
  state.ultima_decision = decision.decision;
  state.fecha = new Date().toISOString();
  return state;
}

function saveLog(decision, state) {
  fs.appendFileSync(LOG_FILE, JSON.stringify({
    fecha: new Date().toISOString(),
    decision
  }) + "\n");

  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function sendEmail(decision, apiKey, to) {
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      from: "LegalAI <onboarding@resend.dev>",
      to: [to],
      subject: "Auditoría LegalAI",
      text: JSON.stringify(decision, null, 2)
    })
  });
}

(async () => {
  try {
    console.log("Modelo:", CLAUDE_MODEL);

    ensureDataDir();

    const claudeKey = env("CLAUDE_API_KEY");
    const resendKey = env("RESEND_API_KEY");
    const emailTo = env("EMAIL_TO");

    const site = readSite();
    const state = readState();
    const logs = readRecentLogs();

    const prompt = buildPrompt({ site, state, logs });

    const raw = await askClaude(prompt, claudeKey);
    const decision = extractJSON(raw);

    const newState = updateState(state, decision);

    saveLog(decision, newState);
    await sendEmail(decision, resendKey, emailTo);

    console.log("OK:", decision.decision);

  } catch (e) {
    console.error("ERROR REAL:");
    console.error(e.message);
    process.exit(1);
  }
})();
