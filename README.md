# legalai-arg

Plataforma de generación automática de documentos legales con IA

---

# ✦ LegalAI Arg

### Documentos legales generados con inteligencia artificial

Describí qué necesitás. La IA genera el formulario, completás los datos, pagás y descargás el PDF.

---

# 🚀 ¿Qué es?

LegalAI Arg es una plataforma que permite generar documentos legales orientativos de forma automática.

Sin registro obligatorio. Sin fricción. En minutos.

---

# ⚙️ ¿Cómo funciona?

1. Describís lo que necesitás
2. La IA genera el formulario
3. Completás los datos
4. Pagás
5. Descargás el PDF

---

# 💳 Pagos

* MercadoPago → ARS
* NOWPayments → cripto (USDT, etc.)

---

# 💼 Planes

El sistema está diseñado para empujar a planes pagos (no hay plan gratuito).

## 🎯 Estructura de planes

### Plan Básico

* Acceso a documentos simples
* Descarga con marca de agua

### Plan Intermedio

* Más tipos de documentos
* Menor marca de agua o reducción

### Plan Pro

* Documentos completos
* Mejor calidad
* Menor o sin marca de agua

### Plan Business (objetivo principal)

* Acceso total
* Uso intensivo
* Sin marca de agua
* Prioridad en generación

### Plan Premium (opcional - ancla psicológica)

* Precio más alto
* Beneficios similares a Business
* Función: mejorar conversión hacia Business

---

# 🧠 Estrategia de precios

* Documentos simples → precio bajo + upgrade 50% para quitar marca
* Documentos medios → upgrade 40%
* Documentos complejos → upgrade 30%

Objetivo:
👉 empujar a planes superiores

---

# 🤝 Sistema de afiliados

Sistema interno optimizado para crecimiento orgánico.

---

## 🔗 Funcionamiento

Cada afiliado tiene:

* ref único
* link para compartir

Ejemplo:

/planes.html?ref=ABC123

---

## 🧠 Regla de atribución

👉 El pago queda asociado al ref activo en el momento del pago

Si el usuario entra con otro afiliado:

👉 el último ref válido reemplaza al anterior

---

## 💰 Comisiones

### Compra única

* comisión alta

### Suscripciones

* comisión inicial mayor
* comisión recurrente menor

Condición:

* pago acreditado

---

## ❌ No genera comisión si:

* pago fallido
* cancelado
* revertido

---

## 📊 Panel afiliado

Muestra:

* saldo pendiente
* últimos 20 movimientos
* estado de cada comisión
* fecha
* moneda y conversión
* ref
* link
* última actualización

Estados:

* Pendiente
* Confirmado
* Pagado
* Cancelado

---

## 🔐 Acceso

/afiliado?ref=XXX&key=XXX

* sin usuario
* con key
* rotación desde admin

---

## 📬 Notificaciones

Email (Resend) solo cuando:

* se genera comisión
* se paga

---

## ⚙️ Lógica técnica

El sistema es interno.

El Worker controla:

* órdenes
* pagos
* comisiones

---

## 🔁 Idempotencia

* 1 pago = 1 comisión
* 1 ciclo = 1 comisión

Nunca duplicados.

---

# 🏗️ Arquitectura

* Frontend → GitHub Pages
* Backend → Cloudflare Worker
* DB → Cloudflare KV
* Pagos → MercadoPago / NOWPayments
* Email → Resend

---

# ⚠️ Importante

* Documentos orientativos
* No reemplaza abogado

---

# 🚀 Objetivo del sistema

* Maximizar conversiones
* Escalar con afiliados
* Automatizar ingresos

---

**LegalAI Arg**
