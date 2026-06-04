# LegalAI Arg

Plataforma web para generar documentos legales orientativos en Argentina con formularios simples, vista previa en vivo, pago online y descarga del documento final.

El objetivo actual es reducir al mínimo la fricción de compra: el usuario entra, elige el documento, completa los datos, ve una vista previa en la misma pantalla, paga y descarga.

---

## Estado actual

El flujo fue simplificado. Ya no se recomienda usar una página universal separada ni múltiples HTML individuales por documento.

La estructura vigente es:

```txt
index.html
  Landing principal + generador unificado + afiliados + acerca de

contrato-alquiler.html
  Landing comercial para Google Ads
  Redirige al flujo actual del index mediante botones por tipo de alquiler

planes.html
  Plan ilimitado

gracias.html
  Retorno post pago / documento listo / upsells

worker.js
  Backend Cloudflare Worker
```

Páginas administrativas o internas que se conservan:

```txt
admin-owner.html
admin-afiliados.html
owner-dashboard.html
auditoria.html
mail-panel.html
afiliado.html
comprar-mejor.html
```

---

## Flujo comercial actual

### Entrada orgánica

```txt
Usuario entra a index.html
↓
Clic en Crear mi contrato / Crear mi documento
↓
Se abre el generador dentro del mismo index
↓
Elige documento
↓
Completa formulario
↓
Ve preview live al costado
↓
Paga con MercadoPago
↓
Vuelve a gracias.html o al flujo del index según estado
```

### Entrada desde Google Ads

La campaña puede seguir apuntando a:

```txt
https://legalai-arg.com/contrato-alquiler.html
```

Esa URL se mantiene porque es clara, útil para anuncios y evita perder historial o enlaces compartidos.

Desde esa landing, los botones llevan al flujo nuevo:

```txt
Residencial  → index.html?doc=alquiler_residencial#generador
Comercial    → index.html?doc=alquiler_comercial#generador
Temporario   → index.html?doc=alquiler_temporario#generador
```

Recomendación técnica: mantener esta URL como destino de Ads y usar el `index` como motor real del formulario.

---

## Navegación pública actual

La barra principal debe mantenerse simple:

```txt
Inicio / Plan ilimitado / Afiliados / Acerca de
```

No se recomienda volver a incluir en la barra:

```txt
Generador
Contrato alquiler
```

El generador vive dentro del `index.html` y `contrato-alquiler.html` funciona como landing comercial específica.

---

## Frontend

Tecnologías:

```txt
HTML
CSS
JavaScript vanilla
```

Archivos principales:

```txt
index.html
contrato-alquiler.html
planes.html
gracias.html
```

Archivos de soporte visual:

```txt
legalai-theme.css
components.css
```

Actualmente las páginas principales tienen mucho estilo embebido para evitar dependencias rotas. Los CSS externos quedan como base de diseño común para auditoría, futuras páginas y mantenimiento visual.

---

## Backend

El backend corre en Cloudflare Workers.

Archivo:

```txt
worker.js
```

Funciones principales:

```txt
/campos              Generación de campos dinámicos
/preview             Generación de preview IA
/mp/preferencia      Creación de preferencia MercadoPago
/mp/webhook          Webhook MercadoPago
/generar             Generación del documento final
/evento              Tracking de eventos
/interaccion         Tracking de clics simples
/owner/all           Métricas completas para panel y auditoría
/admin/afiliado/*    Administración de afiliados
```

La URL de error de MercadoPago debe volver al flujo actual:

```txt
index.html?payment_error=1#generador
```

No debe volver a:

```txt
formulario.html?payment_error=1
```

---

## Tracking y métricas

El sistema registra eventos propios en el Worker.

Eventos importantes:

```txt
page_view
cta_generador
cta_doc_inline
inicio_formulario
preview_ok
preview_fallback
click_pagar
inicio_pago
checkout_start
venta
document_generated
conversion_plan
affiliate_request
```

Datos de atribución relevantes:

```txt
utm_source
utm_medium
utm_campaign
utm_content
utm_term
gclid
ref
device
session_id
```

Esto permite cruzar datos propios con Google Ads sin depender únicamente del panel de Google.

---

## Auditoría automática

La auditoría se ejecuta desde GitHub Actions usando:

```txt
.github/workflows/main.yml
scripts/auditoria.js
```

El script consulta:

```txt
/owner/all
```

Y genera o actualiza:

```txt
data/auditoria-log.jsonl
data/auditoria-state.json
data/auditoria-metricas.json
```

La auditoría debe controlar:

```txt
visitas
clics útiles
inicio de formulario
preview generado
inicio de pago
ventas confirmadas
fuentes / campañas
tráfico con gclid
links viejos a formulario.html o generador.html
coherencia de landing de Ads
estado de cambio activo mínimo 48h
```

---

## Variables y secrets

Cloudflare / GitHub Actions:

```txt
ADMIN_KEY
OPENAI_API_KEY
CLAUDE_API_KEY
MERCADOPAGO_ACCESS_TOKEN
MERCADOPAGO_PUBLIC_KEY
RESEND_API_KEY
EMAIL_TO
```

Cloudflare KV:

```txt
OWNER_EVENTS_KV
PAGOS_KV
LEGALAI_TELEGRAM_KV
```

---

## Google Ads

Destino recomendado actual:

```txt
https://legalai-arg.com/contrato-alquiler.html
```

Motivo:

```txt
URL clara para intención de búsqueda
No rompe historial de campaña
Permite landing específica
Deriva al flujo nuevo del index
```

Controles mínimos posteriores a cada deploy:

```txt
Abrir contrato-alquiler.html en incógnito
Clic en Residencial
Confirmar llegada al generador actual
Completar campos de prueba
Ver preview live
Avanzar a MercadoPago
Volver desde MercadoPago
Confirmar que no aparece formulario.html
Verificar evento en owner/auditoría
```

---

## Limpieza de archivos

El proyecto puede conservar solo los HTML actuales. Los HTML individuales de documentos viejos no deberían volver a usarse salvo decisión expresa.

No borrar:

```txt
index.html
contrato-alquiler.html
planes.html
gracias.html
afiliado.html
admin-owner.html
admin-afiliados.html
owner-dashboard.html
auditoria.html
mail-panel.html
comprar-mejor.html
```

---

## Roadmap recomendado

Prioridad alta:

```txt
1. Que index.html lea ?doc=... y abra automáticamente el formulario correcto.
2. Mejorar tracking de gclid/UTM en todo el embudo.
3. Agregar control automático post deploy.
4. Auditar links rotos y referencias viejas en cada Action.
```

Prioridad media:

```txt
1. Separar estilo común en legalai-theme.css y components.css.
2. Reducir CSS embebido cuando el flujo esté estable.
3. Agregar dashboard simple de campañas: Google Ads vs eventos propios.
4. Crear tests de humo para index, contrato-alquiler, planes y gracias.
```

---

## Regla operativa

Antes de cambiar estructura o crear nuevas páginas, priorizar:

```txt
menos HTML
menos redirecciones
menos pasos
más tracking
más consistencia visual
```

