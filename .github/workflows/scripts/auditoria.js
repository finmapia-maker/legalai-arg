const fs = require("fs");

const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

const CLAUDE_MODEL = "claude-3-5-sonnet-20241022";

function log(title, value) {
  console.log(`\n=== ${title} ===`);
  console.log(value);
}

function requiredEnv(name) {
  const value = process.env[name];

  if (!value || !value.trim()) {
    throw new Error(`Falta configurar la secret: ${name}`);
  }

  return value;
}

function leerArchivos() {
  let contenido = "";
  let encontrados = 0;

  for (const file of ARCHIVOS) {
    if (!fs.existsSync(file)) {
      contenido += `\n\n===== ARCHIVO NO ENCONTRADO: ${file} =====\n`;
      continue;
    }

    encontrados++;
    const data = fs.readFileSync(file, "utf8");

    contenido += `
    
===== ARCHIVO: ${file} =====
${data.slice(0, 22000)}
`;
  }

  if (encontrados === 0) {
    throw new Error("No se encontró ninguno de los archivos definidos para auditar.");
  }

  return contenido;
}

function generarPrompt(contenido) {
  return `
Actuás como auditor experto en conversión, UX, pricing y monetización para LegalAI Arg.

OBJETIVO:
Aumentar ventas reales de LegalAI Arg con cambios concretos en los archivos del sitio.

CONTEXTO:
LegalAI Arg vende generación de documentos legales con IA. El usuario debe entender rápido qué compra, confiar, avanzar al formulario y pagar.

REGLAS:
- No des opciones.
- No des teoría.
- No seas genérico.
- No digas "podría".
- Indicá exactamente qué archivo modificar.
- Indicá exactamente qué texto reemplazar.
- Priorizá cambios de alto impacto.
- Si algo está bien, no lo menciones.
- Máximo 8 cambios.
- Ordená por impacto en ventas.
- Escribí en español argentino, claro y directo.

FORMATO OBLIGATORIO:

# Auditoría diaria LegalAI

## 1. Cambio crítico

ARCHIVO:
[nombre exacto del archivo]

SECCIÓN:
[hero / CTA / pricing / formulario / confianza / post venta / otro]

PROBLEMA:
[problema claro en una frase]

REEMPLAZAR POR:
[texto exacto listo para copiar]

INSTRUCCIÓN PARA CLAUDE CODE:
[orden concreta para que Claude Code aplique el cambio]

---

FLUJO COMPLETO A ANALIZAR:
${contenido}
`;
}

async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });

  const text = await response.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} en ${url}: ${JSON.stringify(data, null, 2)}`);
  }

  return data;
}

async function analizarConClaude(prompt, claudeKey) {
  const data = await postJson(
    "https://api.anthropic.com/v1/messages",
    {
      "x-api-key": claudeKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    {
      model: CLAUDE_MODEL,
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    }
  );

  const texto = data?.content?.[0]?.text;

  if (!texto) {
    throw new Error("Claude respondió, pero no devolvió texto útil.");
  }

  return texto;
}

async function enviarPorResend(resultado, resendKey, emailTo) {
  const data = await postJson(
    "https://api.resend.com/emails",
    {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json"
    },
    {
      from: "LegalAI <onboarding@resend.dev>",
      to: [emailTo],
      subject: "Auditoría diaria LegalAI",
      text: resultado
    }
  );

  return data;
}

async function run() {
  try {
    log("INICIO", "Auditoría LegalAI iniciada");

    const claudeKey = requiredEnv("CLAUDE_API_KEY");
    const resendKey = requiredEnv("RESEND_API_KEY");
    const emailTo = requiredEnv("EMAIL_TO");

    log("SECRETS", "Secrets detectadas correctamente");

    const contenido = leerArchivos();
    log("ARCHIVOS", "Archivos leídos correctamente");

    const prompt = generarPrompt(contenido);

    log("CLAUDE", "Enviando análisis a Claude...");
    const resultado = await analizarConClaude(prompt, claudeKey);
    log("CLAUDE", "Respuesta recibida correctamente");

    log("RESEND", "Enviando email...");
    const resendResult = await enviarPorResend(resultado, resendKey, emailTo);
    log("RESEND", JSON.stringify(resendResult, null, 2));

    log("FINAL", "Auditoría finalizada correctamente");
  } catch (error) {
    console.error("\n=== ERROR REAL ===");
    console.error(error.message || error);
    process.exit(1);
  }
}

run();
