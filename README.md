# ⚖️ LegalAI Arg

Sistema automatizado de generación de documentos legales para Argentina.

---

# Qué es LegalAI

LegalAI Arg permite generar documentos legales en minutos mediante formularios dinámicos, automatización e inteligencia artificial.

El usuario:

1. Ingresa a la web
2. Selecciona el tipo de documento
3. Completa un formulario guiado
4. Visualiza una vista previa
5. Decide si pagar
6. Descarga el documento final

El objetivo principal es reducir fricción:

* sin abogados para tareas repetitivas
* sin registros obligatorios
* sin esperas
* sin procesos complejos

---

# Estado actual del proyecto

El sistema ya se encuentra funcionando online.

Actualmente incluye:

* generación automática de documentos
* formularios dinámicos
* integración con MercadoPago
* panel administrativo
* sistema de afiliados
* tracking de eventos
* panel visual de métricas
* backend serverless sobre Cloudflare Workers
* almacenamiento persistente mediante KV

---

# Arquitectura general

## Frontend

La interfaz está desarrollada principalmente con:

* HTML
* CSS
* JavaScript vanilla

Archivos principales:

* `index.html`
* `formulario.html`
* `contrato-alquiler.html`
* `gracias.html`
* `admin-owner.html`
* `admin-afiliados.html`

---

## Backend

El backend corre sobre Cloudflare Workers.

Archivo principal:

* `worker.js`

Funciones principales:

* generación de formularios
* generación de previews
* creación de pagos MercadoPago
* generación de documentos
* tracking de eventos
* administración de afiliados
* APIs del panel owner

---

## Persistencia

El sistema utiliza Cloudflare KV.

Namespaces utilizados:

* `OWNER_EVENTS_KV`
* `PAGOS_KV`
* `LEGALAI_TELEGRAM_KV`

Se utilizan para almacenar:

* operaciones
* pagos
* logs
* afiliados
* conversiones
* eventos de tracking
* auditoría

---

# Sistema de tracking

LegalAI incluye tracking interno propio.

Eventos registrados:

* page_view
* form_start
* preview_generado
* checkout_start
* pago_pendiente
* pago_aprobado
* documento_generado
* descarga_documento
* errores

Esto permite visualizar:

* embudo de conversión
* puntos de abandono
* errores de integración
* rendimiento de campañas
* comportamiento de usuarios

---

# Panel Owner

URL:

```txt
/admin-owner.html
```

Incluye:

* métricas generales
* operaciones
* reclamos
* afiliados
* comisiones
* auditoría
* estado del sistema
* embudo visual
* eventos en tiempo real
* debug API

---

# Sistema de afiliados

URL:

```txt
/admin-afiliados.html
```

Permite:

* crear afiliados
* generar links únicos
* calcular comisiones
* registrar conversiones
* marcar pagos
* visualizar ganancias

---

# Integraciones

## MercadoPago

Variables utilizadas:

```txt
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_PUBLIC_KEY
```

El sistema crea preferencias automáticamente y habilita la descarga luego del pago.

---

## OpenAI

Variable:

```txt
OPENAI_API_KEY
```

Se utiliza para generación y asistencia IA.

---

## Claude

Variable:

```txt
CLAUDE_API_KEY
```

Utilizado como proveedor alternativo o complementario.

---

## Resend

Variables:

```txt
RESEND_API_KEY
EMAIL_TO
```

Utilizado para:

* envío de emails
* reportes
* notificaciones
* auditoría

---

# Variables importantes de Cloudflare

Secrets principales:

```txt
ADMIN_KEY
OPENAI_API_KEY
CLAUDE_API_KEY
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_PUBLIC_KEY
RESEND_API_KEY
EMAIL_TO
```

---

# Wrangler

Archivo:

```txt
wrangler.toml
```

Bindings actuales:

```toml
[[kv_namespaces]]
binding = "OWNER_EVENTS_KV"

[[kv_namespaces]]
binding = "PAGOS_KV"

[[kv_namespaces]]
binding = "LEGALAI_TELEGRAM_KV"
```

---

# Flujo simplificado del sistema

```txt
Usuario entra
↓
Selecciona documento
↓
Completa formulario
↓
Se genera preview
↓
Se crea preferencia MercadoPago
↓
Usuario paga
↓
Worker valida estado
↓
Se genera documento final
↓
Se habilita descarga
↓
Se registran eventos y métricas
```

---

# Objetivos del proyecto

* automatizar procesos legales repetitivos
* reducir costos operativos
* minimizar fricción de compra
* escalar sin estructura tradicional
* centralizar métricas y eventos
* integrar APIs y automatizaciones
* crear un ecosistema legal automatizado

---

# Roadmap

Próximos objetivos:

* más tipos de documentos
* API pública
* integración empresas
* dashboard avanzado
* IA contextual por documento
* automatización de reclamos
* recuperación automática de pagos
* analítica avanzada
* sistema de packs dinámicos
* generación multilenguaje

---

# LegalAI Arg

Acceso legal simple, automatizado y escalable.
