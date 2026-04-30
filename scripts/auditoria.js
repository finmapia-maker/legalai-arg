const fs = require("fs");

// ==============================
// CONFIG
// ==============================
const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

const CLAUDE_MODEL = process.env.CLAUDE_MODEL || "claude-3-5-sonnet-20241022";

// ==============================
// HELPERS
// ==============================
function log(t, v) {
  console.log(`\n=== ${t} ===`);
  console.log(v);
}

function requireEnv(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Falta secret: ${name}`);
  return v;
}

function readFiles() {
  let contenido = "";
  let ok = 0;

  for (const f of ARCHIVOS) {
    if (fs.existsSync(f)) {
      ok++;
      const data = fs.readFileSync(f, "utf8");
      contenido += `\n\n===== ARCHIVO: ${f} =====\n${data.slice(0, 22000)}\n`;
    } else {
      contenido += `\n\n===== ARCHIVO NO ENCONTRADO: ${f} =====\n`;
    }
  }

  if (ok === 0) throw new Error("No se encontró ningún archivo a auditar.");
  return contenido;
}

function buildPrompt(contenido) {
  return `
Actuás como auditor experto en CRO, UX y monetización en Argentina para LegalAI.

OBJETIVO: aumentar ventas HOY.

REGLAS:
- Sin teoría, sin opciones, sin “podría”
- Cambios concretos, listos para copiar
- Máx 8 cambios, ordenados por impacto
- Español claro (AR)

FORMATO:

ARCHIVO: [nombre]
SECCIÓN: [hero/CTA/pricing/formulario/confianza/postventa]
PROBLEMA: [1 frase]
REEMPLAZAR POR:
[texto exacto]
INSTRUCCIÓN PARA CLAUDE CODE:
[orden concreta]

---

FLUJO:
${contenido}
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
    throw new Error(`HTTP ${res.status} ${url}: ${JSON.stringify(data, null, 2)}`);
  }
  return data;
}

async function analyzeWithClaude(prompt, apiKey) {
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    {
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [{ role: "user", content: prompt }]
    }
  );

  const out = data?.content?.[0]?.text;
  if (!out) throw new Error("Claude respondió sin texto.");
  return out;
}

async function sendWithResend(texto, apiKey, to) {
  return await postJson(
    "https://api.resend.com/emails",
    {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    {
      from: "LegalAI <onboarding@resend.dev>",
      to: [to],
      subject: "Auditoría diaria LegalAI",
      text: texto
    }
  );
}

// ==============================
// RUN
// ==============================
(async () => {
  try {
    log("INICIO", "Auditoría LegalAI");

    const CLAUDE_API_KEY = requireEnv("CLAUDE_API_KEY");
    const RESEND_API_KEY = requireEnv("RESEND_API_KEY");
    const EMAIL_TO = requireEnv("EMAIL_TO");

    log("SECRETS", "OK");

    const contenido = readFiles();
    log("ARCHIVOS", "OK");

    const prompt = buildPrompt(contenido);

    log("CLAUDE", "Analizando...");
    const resultado = await analyzeWithClaude(prompt, CLAUDE_API_KEY);
    log("CLAUDE", "OK");

    log("EMAIL", "Enviando...");
    await sendWithResend(resultado, RESEND_API_KEY, EMAIL_TO);
    log("EMAIL", "Enviado");

    log("FIN", "OK");
  } catch (e) {
    console.error("\n=== ERROR REAL ===");
    console.error(e.message || e);
    process.exit(1);
  }
})();
