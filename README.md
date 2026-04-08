LegalAI ARG — README funcional detallado
Índice
1. Resumen general
2. Arquitectura actual inferida
3. Archivos analizados
4. Flujo general del producto
5. Archivo por archivo
5.1 `acerca_de_legal_ai_layout_dinamico.html`
5.2 `contrato-alquiler.html`
5.3 `planes.html`
5.4 `afiliado.html`
5.5 `admin-afiliados.html`
5.6 `mail-panel.html`
5.7 `admin-owner.html`
6. Endpoints detectados del Worker
7. Datos persistidos en navegador
8. Eventos, tracking y marketing
9. Diferencia entre paneles reales y panel demo
10. Qué se puede hacer hoy
11. Qué no está resuelto o depende del backend
12. Riesgos técnicos y mejoras prioritarias
13. Mejor estrategia recomendada
---
1. Resumen general
Este conjunto de archivos forma una capa frontend bastante avanzada para LegalAI ARG, con foco en:
captación comercial,
venta de documentos o planes,
programa de afiliados,
paneles administrativos,
envío manual de emails,
landing específica para un documento puntual.
No es solamente una web informativa. En la práctica, el sistema ya cubre varios bloques de negocio:
adquisición de tráfico,
tracking de campañas,
atribución por afiliados,
generación de órdenes de planes,
activación manual/autónoma de códigos,
consulta de dashboards de afiliado,
gestión operativa básica de afiliados,
contacto por email desde un panel,
simulación/visualización ejecutiva desde un panel owner.
---
2. Arquitectura actual inferida
La arquitectura que se desprende de los archivos es esta:
Frontend estático en HTML/CSS/JS puro.
Backend principal en Cloudflare Worker: `https://legalai-worker.finmap-ia.workers.dev`.
Google Ads / gtag para tracking de conversiones.
sessionStorage / localStorage para persistencia liviana en navegador.
APIs externas de dólar en la landing de contrato de alquiler.
NOWPayments / MercadoPago inferidos desde los flujos de planes y pagos.
A nivel práctico, el frontend está dividido en dos grupos:
Grupo A — conectado a backend real
`contrato-alquiler.html`
`planes.html`
`afiliado.html`
`admin-afiliados.html`
`mail-panel.html`
Grupo B — panel demo / mock local
`admin-owner.html`
Grupo C — piezas de marketing estáticas
`acerca_de_legal_ai_layout_dinamico.html`
---
3. Archivos analizados
`acerca_de_legal_ai_layout_dinamico.html`
`admin-afiliados.html`
`admin-owner.html`
`afiliado.html`
`contrato-alquiler.html`
`mail-panel.html`
`planes.html`
---
4. Flujo general del producto
Flujo comercial principal
Un usuario llega a una landing o a la home.
Puede comprar un documento puntual o un plan.
Si llegó por afiliado, el `ref` queda guardado en sesión.
El backend genera la orden o registra la interacción.
Luego el usuario paga y activa el acceso o consume el documento.
Flujo de afiliados
Se crea un afiliado desde panel admin.
El sistema devuelve:
link afiliado,
dashboard privado del afiliado.
El afiliado comparte su link.
Las compras/órdenes se atribuyen usando `ref`.
El admin ve conversiones y puede marcar pendientes como pagados.
Flujo de emails
El admin entra al panel de mails.
Carga contactos desde backend.
Selecciona destinatarios o agrega manuales.
Redacta asunto y cuerpo con variables.
El sistema convierte texto a HTML y envía por Worker.
Flujo de plan pago
Usuario elige plan.
Selecciona método: cripto o tarjeta.
Ingresa email.
Se crea una orden en backend.
Se redirige al checkout.
Si vuelve con `status=success`, la UI muestra banner de éxito.
Luego puede activar el código recibido por email.
---
5. Archivo por archivo
5.1 `acerca_de_legal_ai_layout_dinamico.html`
Qué es
Es una página de marketing enfocada en reclutar afiliados.
Qué hace
Presenta la propuesta de valor del programa de afiliados.
Explica que se puede ganar dinero compartiendo un link.
Muestra una lista corta de documentos que la plataforma puede generar.
Refuerza que no es multinivel ni inversión.
Incluye CTA directo a `index.html#afiliados`.
Qué no hace
No tiene lógica JS propia.
No llama al Worker.
No registra eventos por sí sola.
No valida formularios ni captura leads.
Rol dentro del ecosistema
Sirve como pieza de captación previa para llevar tráfico calificado a la sección de alta de afiliados.
---
5.2 `contrato-alquiler.html`
Qué es
Landing dedicada a vender un único producto: contrato de alquiler online.
Objetivo
Reducir fricción y convertir tráfico frío directamente hacia el formulario principal del sitio.
Qué hace visualmente
Hero con propuesta simple.
Problema / solución.
Beneficios.
Explicación en 3 pasos.
Precio dinámico.
Sección de confianza.
FAQ expandible.
CTA final.
Qué hace funcionalmente
1. Tracking Google Ads
Carga `gtag.js` y configura el ID `AW-18073890544`.
2. Tracking propio de interacciones
En los botones principales dispara POST a:
`/interaccion`
Envia:
botón clickeado,
`utm_source`,
`utm_campaign`,
`utm_medium`.
3. Usa UTM desde sesión o URL
Lee UTM desde:
`sessionStorage`, o
`location.search`.
Eso permite mantener trazabilidad básica de campañas.
4. Precio dinámico en ARS
Toma `PRECIO_USD = 5` y obtiene cotización desde varias fuentes:
Dólar MEP vía `dolarapi.com`
Dólar oficial vía `dolarapi.com`
BNA / oficial vía `bluelytics`
Fallback manual si todo falla
5. Redondeo comercial
Convierte el valor a pesos y lo redondea hacia arriba al centenar.
6. FAQ interactiva
Abre y cierra respuestas con `toggleFaq`.
Qué depende del backend
Solo el tracking `/interaccion`. El resto funciona del lado cliente.
Observación importante
Esta landing no genera el documento por sí sola. Empuja al usuario a la home principal (`#formulario`).
---
5.3 `planes.html`
Qué es
Página completa de venta y activación de planes / suscripciones.
Qué hace
1. Muestra grilla de 5 planes
Planes detectados:
`starter`
`standard`
`pro`
`business`
`enterprise`
Cada uno con:
precio cripto,
precio tarjeta,
badge opcional,
lista de features,
CTA de compra.
2. Permite alternar medio de pago
Modos:
`cripto`
`tarjeta`
Eso cambia:
precios mostrados,
copy visual,
nota explicativa,
CTA.
3. Guarda afiliado en sesión
Si llega `?ref=...`, lo guarda en `sessionStorage` como `legalai_ref`.
Esto permite atribuir compras incluso si el usuario navega luego dentro del flujo.
4. Gestiona retorno desde checkout
Si vuelve con `?status=success`:
muestra banner de éxito,
intenta precargar el email guardado,
abre modal de activación.
5. Modal de email previo al pago
Antes de enviar a checkout:
pide email,
valida mínimamente,
llama a `/planes/crear-orden`.
6. Creación de orden
Envía al backend:
`plan_id`
`metodo_pago`
`email`
`ref`
Si backend devuelve `invoice_url`, redirige al checkout.
7. Persistencia de datos de sesión
Guarda:
`legalai_ref`
`legalai_email`
`legalai_invoice`
8. Modal de activación
Permite activar un código con:
`codigo`
`email`
Llama a `/planes/activar`.
9. Muestra vigencia del plan
Si activación es exitosa, renderiza fecha de expiración formateada.
Qué hace bien
flujo claro,
recuperación parcial del estado del usuario,
soporte afiliado incorporado,
UX bastante prolija para checkout externo.
Qué no hace
no valida formato fuerte del código,
no consulta estado del plan ya activo,
no lista historial de activaciones del usuario.
---
5.4 `afiliado.html`
Qué es
Dashboard privado del afiliado individual.
Cómo se accede
Requiere parámetros en URL:
`ref`
`key`
Si faltan, muestra “Acceso no autorizado”.
Qué hace
1. Consulta dashboard al backend
GET a:
`/afiliado/dashboard?ref=...&key=...`
2. Muestra métricas del afiliado
total generado,
pendiente,
conversiones,
link afiliado.
3. Lista conversiones
Renderiza por cada conversión:
fecha,
plan,
monto,
comisión,
estado.
4. Permite copiar link afiliado
Usa `document.execCommand('copy')`.
Observaciones
Tiene timeout con `AbortController` a 8 segundos.
El copiado usa una técnica vieja; funciona, pero conviene migrarlo a `navigator.clipboard.writeText`.
Muestra valores en USD fijos en texto, por lo que el backend debería ser coherente con esa moneda.
---
5.5 `admin-afiliados.html`
Qué es
Panel administrativo real para gestionar afiliados conectado al Worker.
Qué hace
1. Login por admin key
Valida acceso haciendo request a:
`/admin/afiliado/lista`
usando header:
`x-admin-key`
2. Manejo de tema claro/oscuro
Usa `localStorage` para recordar la preferencia visual.
3. Tab principal de afiliados
Muestra resumen de:
afiliados activos,
total conversiones,
monto pendiente,
monto pagado.
4. Lista de afiliados
Por afiliado muestra:
nombre,
ref,
email,
% comisión,
pendiente,
conversiones,
activo/inactivo.
5. Detalle por afiliado
Consulta:
`/admin/afiliado/detalle?ref=...`
y renderiza:
total generado,
pendiente,
ya pagado,
tabla de conversiones.
6. Marcar todo como pagado
POST a:
`/admin/afiliado/pagar`
con body:
```json
{ "ref": "...", "all_pending": true }
```
7. Crear afiliado nuevo
POST a:
`/admin/afiliado/crear`
con:
`ref`
`nombre`
`email`
`commission_pct`
Luego muestra:
`dashboard_url`
`link_afiliado`
8. Botones de copiado
Permite copiar dashboard y link afiliado.
Qué resuelve operativamente
Es el panel más cercano a una operación real para afiliados.
Sirve para:
alta,
consulta,
liquidación manual simple.
Qué le falta
filtros por fechas,
búsqueda de afiliados,
edición de afiliado,
desactivación / reactivación explícita,
pagos parciales,
exportación CSV,
auditoría interna.
---
5.6 `mail-panel.html`
Qué es
Panel de envíos manuales de email desde una interfaz propia.
Qué hace
1. Login simple por admin key
No verifica la clave al entrar. Simplemente la guarda y luego los endpoints pueden rechazarla.
2. Pestañas
Contactos
Redactar
Historial
3. Carga contactos desde backend
GET a:
`/mail/contacts`
Muestra:
email,
nombre,
etiqueta,
fecha,
botón “Escribir”.
4. Selección múltiple
Permite:
seleccionar contactos uno a uno,
seleccionar todos,
limpiar selección,
pasar a redactar con los seleccionados.
5. Agregado manual de destinatarios
Se pueden sumar emails que no estén en la base.
6. Motor de composición
Permite cargar:
asunto,
cuerpo del mensaje.
Acepta variables:
`{{nombre}}`
`{{email}}`
7. Mini parser Markdown → HTML
Convierte:
`**negrita**`
listas con `*` o `-`
líneas vacías en saltos/párrafos
separadores `---`
8. Wrapper HTML para email
Arma una plantilla visual consistente con branding LegalAI Arg.
9. Envío individual por cada destinatario
POST a:
`/mail/send`
con:
`email`
`nombre`
`asunto`
`html`
10. Historial de envíos
GET a:
`/mail/history`
Muestra:
fecha,
email,
asunto,
estado “enviado”.
Qué resuelve
Sirve como un mini CRM operativo muy simple para outreach o comunicaciones manuales.
Limitaciones
no hay drafts,
no hay campañas programadas,
no hay plantillas guardadas,
no hay adjuntos,
no hay tracking de apertura/click,
no hay paginación,
no hay segmentación avanzada.
Riesgo funcional
El login es “optimista”: entra al panel antes de verificar permisos. La validación real ocurre al pedir datos.
---
5.7 `admin-owner.html`
Qué es
Panel ejecutivo/operativo demo local, no conectado al Worker.
Esto es clave
Este archivo no consume backend real. Toda la información proviene de arrays hardcodeados dentro del script:
`OPS`
`AFIL`
`SOLS`
`COMS`
`LERR`
`LEMAIL`
`ALOG`
También tiene una clave hardcodeada:
`owner2024`
Qué hace
1. Dashboard general
Calcula en frontend:
facturación ARS,
facturación USDT,
ventas confirmadas,
ticket promedio,
comisiones pendientes y pagadas,
errores,
afiliados activos.
Además renderiza pseudo-gráficos de barras con HTML/CSS.
2. Módulo de operaciones
Permite:
buscar,
filtrar por fecha,
tipo,
estado,
método,
producto,
afiliado,
error,
ver detalle,
marcar revisada,
agregar observación,
exportar CSV.
3. Módulo de afiliados
Permite:
listar afiliados,
filtrar,
ver detalle,
activar/desactivar,
aprobar solicitudes,
crear afiliado nuevo,
ver estadísticas.
4. Módulo de comisiones
Permite:
filtrar,
ver resúmenes ARS/USDT,
marcar comisiones como pagadas,
exportar CSV.
5. Módulo de logs
Muestra:
errores de sistema,
emails enviados,
estado de resolución.
6. Módulo de auditoría
Registra cambios manuales en un array local.
7. Modales y utilidades
Incluye:
detalle de evento,
detalle de afiliado,
creación de afiliado,
copiar al portapapeles,
toast,
exportación CSV.
Qué representa realmente
Es un mock funcional / panel de concepto muy útil para:
validar UX,
mostrar funcionamiento,
definir requerimientos del panel real.
Qué no es
No es una consola productiva real.
Cualquier cambio:
no persiste en servidor,
no impacta datos reales,
se pierde al recargar.
---
6. Endpoints detectados del Worker
Afiliados
`GET /afiliado/dashboard?ref=...&key=...`
`GET /admin/afiliado/lista`
`GET /admin/afiliado/detalle?ref=...`
`POST /admin/afiliado/pagar`
`POST /admin/afiliado/crear`
Mail panel
`GET /mail/contacts`
`POST /mail/send`
`GET /mail/history`
Planes
`POST /planes/crear-orden`
`POST /planes/activar`
Tracking
`POST /interaccion`
---
7. Datos persistidos en navegador
`localStorage`
`theme` en `admin-afiliados.html`
`sessionStorage`
`legalai_ref`
`legalai_email`
`legalai_invoice`
`legalai_utm_source`
`legalai_utm_campaign`
`legalai_utm_medium`
Uso funcional
mantener afiliado atribuido,
recordar email del comprador,
recordar factura/orden,
conservar UTM para tracking entre páginas,
recordar tema visual del panel de afiliados.
---
8. Eventos, tracking y marketing
Google Ads
La landing de contrato dispara conversiones con `gtag('event', 'conversion', ...)`.
Tracking propio
Se registran clics de CTA en `/interaccion` con UTM asociadas.
Atribución afiliada
`planes.html` conserva `ref` en sesión y lo manda al backend al crear una orden.
Marketing operativo
`mail-panel.html` permite campañas o envíos manuales one-to-one / one-to-many sin salir del ecosistema propio.
---
9. Diferencia entre paneles reales y panel demo
Reales
`admin-afiliados.html`
`afiliado.html`
`mail-panel.html`
`planes.html`
parte de `contrato-alquiler.html`
Todos ellos dependen de respuestas reales del Worker.
Demo / mock
`admin-owner.html`
Este archivo hoy sirve para diseño, validación y definición de alcance, no para producción.
---
10. Qué se puede hacer hoy
Con lo que ya está implementado, el proyecto puede:
captar afiliados con una landing específica,
vender planes con dos modalidades de cobro,
atribuir compras a afiliados mediante `ref`,
crear afiliados desde admin,
consultar resultados individuales de afiliados,
marcar conversiones como pagadas,
enviar emails manuales con personalización básica,
mostrar historial de envíos,
vender un producto puntual con landing dedicada,
trackear interacciones comerciales,
mostrar un panel owner demo para validar la lógica de negocio.
---
11. Qué no está resuelto o depende del backend
No puedo verificar desde estos archivos si el backend ya implementa correctamente lo siguiente:
generación real del documento desde la landing principal,
webhook completo de pagos,
persistencia estable de comisiones y liquidaciones,
control fino de renovaciones de planes,
expiración/revocación de dashboards de afiliado,
seguridad fuerte del mail panel,
limitación antiabuso,
roles/permisos múltiples,
reporting histórico consolidado.
[inferencia] Los archivos frontend están preparados para esos flujos, pero la robustez real depende del Worker y de la base de datos detrás.
---
12. Riesgos técnicos y mejoras prioritarias
Riesgos
`admin-owner.html` puede confundirse con panel real, pero es mock.
Claves hardcodeadas en panel demo.
Login optimista en `mail-panel.html`.
Copiado antiguo en `afiliado.html` con `execCommand`.
Poca validación en algunos formularios.
Sin manejo de estados vacíos/errores avanzados en varios flujos.
Dependencia de APIs externas de dólar en la landing puntual.
Mejoras prioritarias
Convertir `admin-owner.html` en panel real conectado al Worker.
Unificar autenticación admin entre paneles.
Agregar exportación CSV al panel real de afiliados.
Agregar filtros y búsqueda a `admin-afiliados.html`.
Agregar plantillas y guardado de borradores al mail panel.
Reemplazar copiado legado por Clipboard API moderna.
Crear documentación técnica oficial de endpoints y payloads.
Agregar modo “solo lectura” para reporting.
Registrar auditoría real en backend.
Centralizar tracking de UTM y conversiones.
---
13. Mejor estrategia recomendada
La mejor opción es usar este stack en tres capas claras:
Capa 1 — producción inmediata
Mantener como operativos reales:
`planes.html`
`admin-afiliados.html`
`afiliado.html`
`mail-panel.html`
`contrato-alquiler.html`
Capa 2 — consolidación
Transformar `admin-owner.html` en el panel unificado real del negocio, conectado al Worker y a datos persistentes.
Capa 3 — documentación
Usar este README como base y luego sumar:
mapa de endpoints,
estructura de respuestas JSON,
variables de entorno,
flujo de pagos,
flujo de afiliados,
flujo de emails,
checklist de seguridad.
Esa es la estrategia más conveniente porque evita rehacer el frontend que ya tenés avanzado y concentra el esfuerzo en donde hoy hay más retorno: backend, persistencia, seguridad y unificación de paneles.
