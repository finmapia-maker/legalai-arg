const fs = require("fs");
const axios = require("axios");
const nodemailer = require("nodemailer");

// Archivos a analizar
const archivos = [
  "index.html",
  "formulario.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];

// Leer contenido
let contenido = "";

archivos.forEach(file => {
  if (fs.existsSync(file)) {
    const data = fs.readFileSync(file, "utf8");
    contenido += `\n\n===== ARCHIVO: ${file} =====\n\n${data}`;
  }
});

// Prompt nivel DIOS
const prompt = `
Actuás como el mejor experto en CRO, UX y monetización en Argentina.

Objetivo: aumentar ventas inmediatamente.

Analizá este flujo completo de LegalAI.

REGLAS:
- No expliques teoría
- No des opciones
- No uses frases genéricas
- Solo cambios aplicables YA
- Pensá como alguien que quiere vender más hoy

FORMATO OBLIGATORIO:

ARCHIVO: [nombre]
CAMBIO: [qué parte]
REEMPLAZAR POR:
[texto exacto nuevo]

---

ERROR:
[problema claro]

SOLUCIÓN:
[acción concreta]

---

FLUJO COMPLETO:
${contenido}
`;

async function run() {
  const response = await axios.post("https://api.anthropic.com/v1/messages", {
    model: "claude-3-opus-20240229",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }]
  }, {
    headers: {
      "x-api-key": process.env.CLAUDE_API_KEY,
      "anthropic-version": "2023-06-01"
    }
  });

  const resultado = response.data.content[0].text;

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_FROM,
      pass: process.env.EMAIL_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: process.env.EMAIL_TO,
    subject: "Auditoría diaria LegalAI",
    text: resultado
  });
}

run();
