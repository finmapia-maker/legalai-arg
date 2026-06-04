const fs = require('fs');

const required = [
  'index.html',
  'contrato-alquiler.html',
  'planes.html',
  'gracias.html',
  'worker.js',
  'scripts/auditoria.js',
  'legalai-tracker.js'
];

const publicFilesToScan = [
  'index.html',
  'contrato-alquiler.html',
  'planes.html',
  'gracias.html',
  'worker.js'
];

const obsoleteRefs = [
  'formulario.html',
  'generador.html',
  'generador2.html',
  'contrato-alquiler-residencial.html',
  'contrato-alquiler-comercial.html',
  'contrato-alquiler-temporario.html'
];

const checks = [];
function ok(msg){ checks.push({level:'ok',msg}); }
function warn(msg){ checks.push({level:'warn',msg}); }
function fail(msg){ checks.push({level:'fail',msg}); }

for (const f of required) {
  fs.existsSync(f) ? ok(`Existe ${f}`) : fail(`Falta ${f}`);
}

for (const f of publicFilesToScan) {
  if (!fs.existsSync(f)) continue;
  const txt = fs.readFileSync(f,'utf8');
  for (const ref of obsoleteRefs) {
    if (txt.includes(ref)) fail(`${f} conserva referencia obsoleta: ${ref}`);
  }
}

if (fs.existsSync('index.html')) {
  const index = fs.readFileSync('index.html','utf8');
  index.includes('LEGALAI_INLINE_DOCS') && index.includes('selectDocInline')
    ? ok('Index tiene generador unificado inline')
    : fail('Index no contiene generador unificado inline');
}

if (fs.existsSync('contrato-alquiler.html')) {
  const c = fs.readFileSync('contrato-alquiler.html','utf8');
  c.includes('index.html?doc=') && c.includes('#generador')
    ? ok('Contrato-alquiler deriva al index con doc seleccionado')
    : fail('Contrato-alquiler no deriva al index con doc seleccionado');
}



if (fs.existsSync('index.html')) {
  const index = fs.readFileSync('index.html','utf8');
  ['doc_selected','form_first_input','preview_live_ok','preview_live_error','payment_return_failed','frontend_error'].forEach(ev => {
    index.includes(ev) ? ok(`Index trackea ${ev}`) : fail(`Index no trackea ${ev}`);
  });
}

if (fs.existsSync('contrato-alquiler.html')) {
  const c = fs.readFileSync('contrato-alquiler.html','utf8');
  ['ads_landing_view','click_residencial','click_comercial','click_temporario'].forEach(ev => {
    c.includes(ev) ? ok(`Contrato-alquiler trackea ${ev}`) : fail(`Contrato-alquiler no trackea ${ev}`);
  });
}

if (fs.existsSync('legalai-tracker.js')) {
  const tracker = fs.readFileSync('legalai-tracker.js','utf8');
  ['frontend_error','form_first_input','payment_return_failed','click_residencial','click_comercial','click_temporario'].forEach(ev => {
    tracker.includes(ev) ? ok(`Tracker central soporta ${ev}`) : fail(`Tracker central no soporta ${ev}`);
  });
}

if (fs.existsSync('worker.js')) {
  const w = fs.readFileSync('worker.js','utf8');
  w.includes('formulario.html?payment_error=1')
    ? fail('Worker conserva failure URL vieja hacia formulario.html')
    : ok('Worker no conserva failure URL vieja');
}

for (const c of checks) {
  const icon = c.level === 'ok' ? '✅' : c.level === 'warn' ? '⚠️' : '❌';
  console.log(`${icon} ${c.msg}`);
}

const errores = checks.filter(x => x.level === 'fail');
const warnings = checks.filter(x => x.level === 'warn');

if (warnings.length) console.log(`\n${warnings.length} advertencia(s). No bloquean deploy.`);
if (errores.length) {
  console.error(`\n${errores.length} control(es) fallaron.`);
  process.exit(1);
}

console.log('\nControles web OK.');
