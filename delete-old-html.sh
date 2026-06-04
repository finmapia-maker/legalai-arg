#!/usr/bin/env bash
set -euo pipefail

# Ejecutar desde la raíz del repo legalai-arg-main.
# Limpia HTML viejos luego de unificar el generador dentro de index.html.

if [ ! -f "index.html" ]; then
  echo "ERROR: ejecutá este script desde la raíz del repo, donde está index.html"
  exit 1
fi

echo "1) Corrigiendo referencias viejas antes de borrar..."

# Evita que gracias.html siga mandando al formulario viejo.
if [ -f "gracias.html" ]; then
  python3 - <<'PY'
from pathlib import Path
p = Path("gracias.html")
txt = p.read_text(encoding="utf-8", errors="ignore")
txt = txt.replace("https://legalai-arg.com/formulario.html", "https://legalai-arg.com/#generador")
txt = txt.replace("https://legalai-arg.com/formulario", "https://legalai-arg.com/#generador")
p.write_text(txt, encoding="utf-8")
PY
fi

# Evita que el Worker vuelva a MercadoPago failure hacia formulario.html si quedó una versión vieja.
if [ -f "worker.js" ]; then
  python3 - <<'PY'
from pathlib import Path
p = Path("worker.js")
txt = p.read_text(encoding="utf-8", errors="ignore")
txt = txt.replace("`${origin}/formulario.html?payment_error=1`", "`${origin}/index.html?payment_error=1#generador`")
txt = txt.replace("${origin}/formulario.html?payment_error=1", "${origin}/index.html?payment_error=1#generador")
p.write_text(txt, encoding="utf-8")
PY
fi

# Actualiza auditoría para que revise solo las páginas activas principales.
if [ -f "scripts/auditoria.js" ]; then
  python3 - <<'PY'
from pathlib import Path
import re
p = Path("scripts/auditoria.js")
txt = p.read_text(encoding="utf-8", errors="ignore")
nuevo = """const ARCHIVOS = [
  "index.html",
  "planes.html",
  "gracias.html",
  "contrato-alquiler.html"
];"""
txt = re.sub(r'const ARCHIVOS = \[[\s\S]*?\];', nuevo, txt, count=1)
p.write_text(txt, encoding="utf-8")
PY
fi

echo "2) Eliminando HTML obsoletos..."

git rm -f --ignore-unmatch \
  "acuerdo-colaboracion-profesionales.html" \
  "acuerdo-confidencialidad-nda.html" \
  "acuerdo-prestamo-particulares.html" \
  "autorizacion-medica-menor.html" \
  "autorizacion-viaje-menor.html" \
  "carta-documento-despido.html" \
  "carta-documento-deuda-impaga.html" \
  "carta-documento-falta-pago-alquiler.html" \
  "carta-documento-incumplimiento-contrato.html" \
  "carta-renuncia-laboral.html" \
  "constancia-recibo-dinero.html" \
  "contrato-alquiler-comercial.html" \
  "contrato-alquiler-residencial.html" \
  "contrato-alquiler-temporario.html" \
  "contrato-community-manager.html" \
  "contrato-compraventa-inmueble.html" \
  "contrato-compraventa-vehiculo.html" \
  "contrato-consultoria.html" \
  "contrato-freelance-dev-web.html" \
  "contrato-freelance-diseno.html" \
  "contrato-freelance-servicios.html" \
  "contrato-sociedad.html" \
  "convenio-pago-cuotas.html" \
  "declaracion-jurada-ingresos.html" \
  "formulario.html" \
  "generador.html" \
  "generador2.html" \
  "intimacion-pago-formal.html" \
  "nda-startup.html" \
  "poder-simple-tramites.html" \
  "politica-privacidad-web.html" \
  "propuesta-comercial.html" \
  "reclamo-demora-entrega.html" \
  "reclamo-producto-garantia.html" \
  "reclamo-servicios-publicos.html" \
  "terminos-condiciones-web.html" 

echo "3) Estado del repo:"
git status --short

echo "4) Commit y push..."
git add -A
git commit -m "Eliminar HTML obsoletos y mantener flujo unificado" || echo "Sin cambios para commitear."
git push

echo "Listo."
