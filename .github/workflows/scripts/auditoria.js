const fs = require("fs");
const axios = require("axios");

const ARCHIVOS = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

function validarEnv() {
  const faltantes = [];

  if (!process.env.CLAUDE_API_KEY) faltantes.push("CLAUDE_API_KEY");
  if (!process.env.RESEND_API_KEY) faltantes.push("RESEND_API_KEY");
  if (!process.env.EMAIL_TO) faltantes.push("EMAIL_TO");

  if (faltantes.length > 0) {
    throw new Error("Faltan secrets: " + faltantes.join(", "));
  }
}

function leerArchivos() {
  let contenido = "";

  for (const file of ARCHIVOS) {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, "utf8");
      contenido += `\n\n===== ARCHIVO: ${file} =====\n\n${data.slice(0, 25000)}`;
    } else {
      contenido += `\n\n===== ARCHIVO NO ENCONTRADO: ${file} =====\n\n`;
    }
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
- No expliques de más.
- Indicá exactamente qué archivo modificar.
- Indicá exactamente qué texto reemplazar.
- Priorizá cambios de alto impacto.
- Si algo está bien, no lo menciones.
- Máximo 10 cambios.
- Ordená por impacto en ventas.

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

async function analizarConClaude(prompt) {
  const response = await axios.post(
    "https://api.anthropic.com/v1/messages",
    {
      model: "claude-3-5-sonnet-20241022",
      max_tokens: 3000,
      messages: [
        {
          role: "user",
          content: prompt
        }
      ]
    },
    {
      headers: {
        "x-api-key": process.env.CLAUDE_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json"
      },
      timeout: 60000
    }
  );

  return response.data.content?.[0]?.text || "Claude no devolvió contenido.";
}

async function enviarPorResend(texto) {
  const response = await axios.post(
    "https://api.resend.com/emails",
    {
      from: "LegalAI <onboarding@resend.dev>",
      to: [process.env.EMAIL_TO],
      subject: "Auditoría diaria LegalAI",
      text: texto
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      timeout: 30000
    }
  );

  return response.data;
}

async function run() {
  try {
    console.log("Iniciando auditoría LegalAI...");

    validarEnv();

    const contenido = leerArchivos();

    if (!contenido.trim()) {
      throw new Error("No se pudo leer contenido de archivos.");
    }

    console.log("Archivos leídos correctamente.");

    const prompt = generarPrompt(contenido);

    console.log("Enviando análisis a Claude...");

    const resultado = await analizarConClaude(prompt);

    console.log("Claude respondió correctamente.");
    console.log("Enviando email...");

    await enviarPorResend(resultado);

    console.log("Email enviado correctamente.");
    console.log("Auditoría finalizada.");
  } catch (error) {
    console.error("FALLÓ LA AUDITORÍA:");
    console.error(error.response?.data || error.message || error);

    process.exit(1);
  }
}

run();
