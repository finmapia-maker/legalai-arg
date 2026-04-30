const fs = require("fs");
const axios = require("axios");

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

// ==============================
// FUNCION: leer archivos
// ==============================

function leerArchivos() {
  let contenido = "";

  ARCHIVOS.forEach(file => {
    if (fs.existsSync(file)) {
      const data = fs.readFileSync(file, "utf8");
      contenido += `\n\n===== ARCHIVO: ${file} =====\n\n${data}`;
    } else {
      contenido += `\n\n===== ARCHIVO: ${file} NO ENCONTRADO =====\n\n`;
    }
  });

  return contenido;
}

// ==============================
// PROMPT NIVEL DIOS
// ==============================

function generarPrompt(contenido) {
  return `
Actuás como el mejor experto en CRO, UX y monetización en Argentina.

Tu único objetivo es aumentar ventas HOY.

Analizá este flujo completo de LegalAI como si fuera tu negocio.

REGLAS ESTRICTAS:
- No expliques teoría
- No des alternativas
- No suavices nada
- No uses lenguaje genérico
- Pensá como alguien que vive de vender
- Todo debe ser aplicable directamente

FORMATO OBLIGATORIO:

ARCHIVO: [nombre exacto]
CAMBIO: [sección concreta]
REEMPLAZAR POR:
[texto exacto listo para copiar]

---

ERROR:
[problema directo]

SOLUCIÓN:
[acción concreta sin explicación]

---

PRIORIZAR:
1. Conversión
2. Claridad inmediata
3. Reducción de fricción
4. Venta directa

FLUJO COMPLETO:
${contenido}
`;
}

// ==============================
// LLAMADA A CLAUDE
// ==============================

async function analizar(prompt) {
  try {
    const response = await axios.post(
      "https://api.anthropic.com/v1/messages",
      {
        model: "claude-3-opus-20240229",
        max_tokens: 2000,
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
        }
      }
    );

    return response.data.content[0].text;

  } catch (error) {
    console.error("ERROR CLAUDE:", error.response?.data || error.message);
    return "Error en análisis con Claude";
  }
}

// ==============================
// ENVIO POR RESEND
// ==============================

async function enviarEmail(contenido) {
  try {
    await axios.post(
      "https://api.resend.com/emails",
      {
        from: "LegalAI <onboarding@resend.dev>",
        to: [process.env.EMAIL_TO],
        subject: "Auditoría diaria LegalAI",
        text: contenido
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    console.log("Email enviado correctamente");

  } catch (error) {
    console.error("ERROR EMAIL:", error.response?.data || error.message);
  }
}

// ==============================
// EJECUCION
// ==============================

async function run() {
  console.log("Iniciando auditoría...");

  const contenido = leerArchivos();
  const prompt = generarPrompt(contenido);

  const resultado = await analizar(prompt);

  await enviarEmail(resultado);

  console.log("Auditoría finalizada");
}

run();
