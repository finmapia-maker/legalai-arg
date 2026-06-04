INSTALACIÓN RÁPIDA - LEGALAI ARG

1) Subí a la raíz del repo estos archivos:
   - legalai-doc-page.js
   - todos los .html incluidos en este pack

2) En index.html reemplazá el bloque completo:
   <!-- CARD 1 -->
   ...hasta antes de:
   <!-- LOADING FORM -->

   por el contenido de:
   INDEX_REEMPLAZAR_CARD1.txt

3) En el menú superior del index cambiá el link viejo de contrato-alquiler.html siguiendo:
   INDEX_CAMBIO_NAV_CONTRATO_ALQUILER.txt

4) No borres formulario.html ni contrato-alquiler.html todavía.
   Dejalos como respaldo hasta verificar que las páginas nuevas funcionen.

5) Probá primero estas URLs:
   - https://legalai-arg.com/contrato-alquiler-residencial.html
   - https://legalai-arg.com/acuerdo-confidencialidad-nda.html
   - https://legalai-arg.com/carta-documento-deuda-impaga.html

Arquitectura:
- Cada botón del index apunta a una hoja HTML real.
- No se usa ?tipo=.
- No se redirige a contrato-alquiler.html.
- Las páginas nuevas usan el Worker existente: https://legalai-worker.finmap-ia.workers.dev
