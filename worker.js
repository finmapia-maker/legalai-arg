const OWNER_ALLOWED_ORIGINS = new Set([
  "https://legalai-arg.com",
  "https://www.legalai-arg.com",
  "http://localhost:8787",
  "http://localhost:3000"
]);

const OWNER_EVENTS_KEY = "events";
const AFFILIATES_KEY = "afiliados";
const AFFILIATE_CONVERSIONS_KEY = "afiliados_conversiones";

export default {
  async fetch(request, env, ctx) {
    const ownerResponse = await handleOwnerRoutes(request, env);
    if (ownerResponse) return ownerResponse;

    const affiliateAdminResponse = await handleAdminAffiliateRoutes(request, env);
    if (affiliateAdminResponse) return affiliateAdminResponse;

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return json(request, {
      ok: false,
      error: "assets_not_configured",
      message: "No está disponible env.ASSETS. Revisar wrangler.toml."
    }, 500);
  }
};

/* =========================================================
   ADMIN AFILIADOS
   ========================================================= */

async function handleAdminAffiliateRoutes(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/admin/afiliado")) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  if (!isOwnerAuthorized(request, env)) {
    return json(request, {
      ok: false,
      error: "unauthorized",
      message: "ADMIN_KEY ausente o incorrecta."
    }, 401);
  }

  if (!env.OWNER_EVENTS_KV) {
    return json(request, {
      ok: false,
      error: "missing_kv",
      message: "Falta vincular OWNER_EVENTS_KV."
    }, 500);
  }

  if (request.method === "GET" && url.pathname === "/admin/afiliado/lista") {
    const afiliados = await buildAffiliateList(env);
    return json(request, { ok: true, afiliados });
  }

  if (request.method === "GET" && url.pathname === "/admin/afiliado/detalle") {
    const ref = normalizeRef(url.searchParams.get("ref"));
    if (!ref) {
      return json(request, { ok: false, error: "missing_ref" }, 400);
    }

    const afiliados = await readAffiliates(env);
    const afiliado = afiliados.find(a => normalizeRef(a.ref) === ref);

    if (!afiliado) {
      return json(request, { ok: false, error: "affiliate_not_found" }, 404);
    }

    const conversiones = (await readAffiliateConversions(env))
      .filter(c => normalizeRef(c.ref) === ref)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const earnings = calcAffiliateEarnings(conversiones);

    return json(request, {
      ok: true,
      afiliado,
      earnings,
      conversiones
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/crear") {
    const body = await readRequestBody(request);

    const ref = normalizeRef(body.ref);
    const nombre = String(body.nombre || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const commission_pct = Number(body.commission_pct ?? body.pct ?? 20);

    if (!ref || !nombre || !email) {
      return json(request, {
        ok: false,
        error: "missing_fields",
        message: "Faltan ref, nombre o email."
      }, 400);
    }

    const afiliados = await readAffiliates(env);
    const existingIndex = afiliados.findIndex(a => normalizeRef(a.ref) === ref);

    const afiliado = {
      ref,
      nombre,
      email,
      commission_pct: Number.isFinite(commission_pct) ? commission_pct : 20,
      active: true,
      created_at: existingIndex >= 0 ? afiliados[existingIndex].created_at : new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    if (existingIndex >= 0) {
      afiliados[existingIndex] = { ...afiliados[existingIndex], ...afiliado };
    } else {
      afiliados.unshift(afiliado);
    }

    await writeAffiliates(env, afiliados);

    const dashboard_url = `https://legalai-arg.com/afiliado.html?ref=${encodeURIComponent(ref)}`;
    const link_afiliado = `https://legalai-arg.com/?ref=${encodeURIComponent(ref)}`;

    await appendOwnerEvent(env, {
      type: "afiliado",
      product: "Alta / actualización de afiliado",
      category: "admin",
      status: "approved",
      customer: email,
      affiliate: ref,
      amount: 0,
      amount_ars: 0,
      currency: "ARS",
      date: new Date().toISOString()
    });

    return json(request, {
      ok: true,
      afiliado,
      dashboard_url,
      link_afiliado
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/pagar") {
    const body = await readRequestBody(request);
    const ref = normalizeRef(body.ref);

    if (!ref) {
      return json(request, { ok: false, error: "missing_ref" }, 400);
    }

    const conversiones = await readAffiliateConversions(env);
    let count = 0;
    let total = 0;
    const now = new Date().toISOString();

    const updated = conversiones.map(c => {
      if (normalizeRef(c.ref) !== ref) return c;

      const shouldPay = body.all_pending || (body.conversion_id && c.id === body.conversion_id);
      if (!shouldPay || c.paid) return c;

      count += 1;
      total += Number(c.commission || 0);

      return {
        ...c,
        paid: true,
        paid_at: now,
        updated_at: now
      };
    });

    await writeAffiliateConversions(env, updated);

    await appendOwnerEvent(env, {
      type: "audit",
      product: "Pago de comisiones afiliado",
      category: "afiliados",
      status: "approved",
      affiliate: ref,
      amount: total,
      amount_ars: total,
      currency: "ARS",
      date: now,
      ref
    });

    return json(request, {
      ok: true,
      conversiones_pagadas: count,
      monto_total: total,
      comision_pagada: total
    });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/conversion") {
    const body = await readRequestBody(request);
    const saved = await appendAffiliateConversion(env, body);

    return json(request, {
      ok: true,
      conversion: saved
    });
  }

  return json(request, {
    ok: false,
    error: "admin_affiliate_route_not_found",
    path: url.pathname
  }, 404);
}

async function buildAffiliateList(env) {
  const afiliados = await readAffiliates(env);
  const conversiones = await readAffiliateConversions(env);

  return afiliados.map(a => {
    const ref = normalizeRef(a.ref);
    const convs = conversiones.filter(c => normalizeRef(c.ref) === ref);
    const earnings = calcAffiliateEarnings(convs);

    return {
      ...a,
      ref,
      active: a.active !== false,
      total_conv: convs.length,
      earnings
    };
  });
}

function calcAffiliateEarnings(conversiones) {
  const total = conversiones.reduce((s, c) => s + Number(c.commission || 0), 0);
  const paid = conversiones.filter(c => c.paid).reduce((s, c) => s + Number(c.commission || 0), 0);
  const pending = conversiones.filter(c => !c.paid).reduce((s, c) => s + Number(c.commission || 0), 0);

  return { total, paid, pending };
}

async function readAffiliates(env) {
  return await readJsonKV(env, AFFILIATES_KEY, []);
}

async function writeAffiliates(env, afiliados) {
  return await writeJsonKV(env, AFFILIATES_KEY, afiliados);
}

async function readAffiliateConversions(env) {
  return await readJsonKV(env, AFFILIATE_CONVERSIONS_KEY, []);
}

async function writeAffiliateConversions(env, conversiones) {
  return await writeJsonKV(env, AFFILIATE_CONVERSIONS_KEY, conversiones.slice(0, 5000));
}

async function appendAffiliateConversion(env, input = {}) {
  const ref = normalizeRef(input.ref || input.affiliate || input.afiliado);
  if (!ref) throw new Error("missing_ref");

  const afiliados = await readAffiliates(env);
  const afiliado = afiliados.find(a => normalizeRef(a.ref) === ref);
  const pct = Number(input.commission_pct ?? afiliado?.commission_pct ?? 20);

  const amount = Number(input.amount ?? input.monto ?? input.total ?? 0);
  const commission = Number(input.commission ?? input.comision ?? (amount * pct / 100));

  const conversion = {
    id: String(input.id || input.conversion_id || input.payment_id || crypto.randomUUID()),
    ref,
    created_at: input.created_at || input.date || input.fecha || new Date().toISOString(),
    plan_id: input.plan_id || input.plan || input.product || input.producto || "venta",
    amount,
    currency: input.currency || input.moneda || "ARS",
    commission,
    commission_pct: pct,
    paid: Boolean(input.paid),
    paid_at: input.paid_at || null,
    customer: input.customer || input.email || input.cliente || "",
    source_event_id: input.source_event_id || input.event_id || "",
    raw: input
  };

  const current = await readAffiliateConversions(env);

  const exists = current.some(c =>
    String(c.id) === String(conversion.id) ||
    (conversion.source_event_id && String(c.source_event_id) === String(conversion.source_event_id))
  );

  if (!exists) {
    current.unshift(conversion);
    await writeAffiliateConversions(env, current);
  }

  return conversion;
}

async function maybeCreateAffiliateConversionFromOwnerEvent(env, event) {
  if (!event || !event.affiliate) return;
  if (!["approved", "active"].includes(event.status)) return;

  const afiliados = await readAffiliates(env);
  const afiliado = afiliados.find(a => normalizeRef(a.ref) === normalizeRef(event.affiliate));
  if (!afiliado) return;

  const amount = Number(event.amount || event.amount_ars || 0);
  const pct = Number(afiliado.commission_pct || 20);
  const commission = Number(event.commission_amount || (amount * pct / 100));

  await appendAffiliateConversion(env, {
    id: event.id,
    source_event_id: event.id,
    ref: event.affiliate,
    created_at: event.date,
    plan_id: event.plan_name || event.product || event.type,
    amount,
    currency: event.currency || "ARS",
    commission,
    commission_pct: pct,
    paid: false,
    customer: event.customer,
    raw_event: event
  });
}

/* =========================================================
   OWNER PANEL ROUTES
   ========================================================= */

async function handleOwnerRoutes(request, env) {
  const url = new URL(request.url);

  if (!url.pathname.startsWith("/owner")) return null;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(request)
    });
  }

  if (url.pathname === "/owner/ping") {
    return json(request, {
      ok: true,
      worker: "alive",
      owner_routes: true,
      affiliate_admin_routes: true,
      configured_key_exists: Boolean(getConfiguredOwnerKey(env)),
      kv_binding_exists: Boolean(env.OWNER_EVENTS_KV),
      compatibility: "LegalAI Owner + Afiliados",
      time: new Date().toISOString()
    });
  }

  if (!isOwnerAuthorized(request, env)) {
    return json(request, {
      ok: false,
      error: "unauthorized",
      message: "ADMIN_KEY ausente o incorrecta.",
      configured_key_exists: Boolean(getConfiguredOwnerKey(env)),
      received_key_exists: Boolean(getReceivedOwnerKey(request)),
      accepted_env_names: [
        "ADMIN_KEY",
        "OWNER_ADMIN_KEY",
        "OWNER_KEY",
        "LEGALAI_ADMIN_KEY",
        "ADMIN_OWNER_KEY"
      ]
    }, 401);
  }

  if (request.method === "POST" && ["/owner/event", "/owner/track", "/owner/log"].includes(url.pathname)) {
    const body = await readRequestBody(request);
    const saved = await appendOwnerEvent(env, body);

    return json(request, {
      ok: true,
      saved
    });
  }

  if (url.pathname === "/owner/test-event") {
    const saved = await appendOwnerEvent(env, {
      type: "test",
      product: "Evento de prueba Owner Panel",
      category: "debug",
      amount: 1000,
      currency: "ARS",
      amount_ars: 1000,
      payment_method: "manual",
      status: "approved",
      customer: "test@legalai-arg.com",
      affiliate: "",
      date: new Date().toISOString()
    });

    return json(request, {
      ok: true,
      message: "Evento de prueba guardado.",
      saved
    });
  }

  const allEvents = await readOwnerEvents(env);
  const filteredEvents = filterOwnerEventsByDate(allEvents, url);
  const payload = buildOwnerPayload(filteredEvents, Boolean(env.OWNER_EVENTS_KV));

  if (url.pathname === "/owner/dashboard" || url.pathname === "/owner/all") {
    return json(request, payload);
  }

  if (url.pathname === "/owner/operaciones") {
    return json(request, payload.operaciones);
  }

  if (url.pathname === "/owner/afiliados") {
    return json(request, payload.afiliados);
  }

  if (url.pathname === "/owner/comisiones") {
    return json(request, payload.comisiones);
  }

  if (url.pathname === "/owner/logs") {
    return json(request, payload.logs);
  }

  if (url.pathname === "/owner/emails") {
    return json(request, payload.emails);
  }

  if (url.pathname === "/owner/auditoria") {
    return json(request, payload.auditoria);
  }

  return json(request, {
    ok: false,
    error: "owner_route_not_found",
    path: url.pathname
  }, 404);
}

/* =========================================================
   AUTH
   ========================================================= */

function getConfiguredOwnerKey(env) {
  return (
    env.ADMIN_KEY ||
    env.OWNER_ADMIN_KEY ||
    env.OWNER_KEY ||
    env.LEGALAI_ADMIN_KEY ||
    env.ADMIN_OWNER_KEY ||
    ""
  );
}

function getReceivedOwnerKey(request) {
  const url = new URL(request.url);

  const queryKey = url.searchParams.get("admin_key") || "";
  const headerKey =
    request.headers.get("X-Admin-Key") ||
    request.headers.get("x-admin-key") ||
    "";
  const bearerKey = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");

  return queryKey || headerKey || bearerKey || "";
}

function isOwnerAuthorized(request, env) {
  const configured = getConfiguredOwnerKey(env);
  const received = getReceivedOwnerKey(request);

  return Boolean(configured && received && received === configured);
}

/* =========================================================
   STORAGE GENERAL
   ========================================================= */

async function readJsonKV(env, key, fallback) {
  if (!env.OWNER_EVENTS_KV) return fallback;

  const txt = await env.OWNER_EVENTS_KV.get(key);
  if (!txt) return fallback;

  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

async function writeJsonKV(env, key, value) {
  if (!env.OWNER_EVENTS_KV) return;
  await env.OWNER_EVENTS_KV.put(key, JSON.stringify(value));
}

async function readOwnerEvents(env) {
  return await readJsonKV(env, OWNER_EVENTS_KEY, []);
}

async function writeOwnerEvents(env, events) {
  const limited = events.slice(0, 5000);
  await writeJsonKV(env, OWNER_EVENTS_KEY, limited);
}

async function appendOwnerEvent(env, event) {
  const normalized = normalizeOwnerEvent(event);

  if (!env.OWNER_EVENTS_KV) {
    return {
      ...normalized,
      warning: "OWNER_EVENTS_KV no está vinculado. El evento no queda persistido."
    };
  }

  const current = await readOwnerEvents(env);
  current.unshift(normalized);

  await writeOwnerEvents(env, current);
  await maybeCreateAffiliateConversionFromOwnerEvent(env, normalized);

  return normalized;
}

/* =========================================================
   DATA NORMALIZATION
   ========================================================= */

function normalizeRef(ref) {
  return String(ref || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function normalizeOwnerEvent(input = {}) {
  const now = new Date().toISOString();

  const statusRaw = String(
    input.status ||
    input.estado ||
    input.payment_status ||
    ""
  ).toLowerCase();

  let status = statusRaw || "pending";

  if (["approved", "aprobado", "confirmada", "confirmado", "paid", "pagado"].includes(statusRaw)) {
    status = "approved";
  }

  if (["active", "activo"].includes(statusRaw)) {
    status = "active";
  }

  if (["pending", "pendiente", "in_process", "en_proceso"].includes(statusRaw)) {
    status = "pending";
  }

  if (["rejected", "rechazado", "failed", "error", "fallida"].includes(statusRaw)) {
    status = "failed";
  }

  if (["refunded", "reintegrado", "reembolsado", "devuelto"].includes(statusRaw)) {
    status = "refunded";
  }

  return {
    id: String(
      input.id ||
      input.event_id ||
      input.payment_id ||
      input.paymentId ||
      input.order_id ||
      crypto.randomUUID()
    ),
    date: input.date || input.fecha || input.created_at || input.createdAt || now,
    type: input.type || input.tipo || input.event || input.event_type || "operacion",
    product: input.product || input.producto || input.formulario || input.document_type || input.doc_tipo || input.descripcion || "",
    category: input.category || input.categoria || input.subtipo || "",
    amount: Number(input.amount ?? input.monto ?? input.total ?? input.price ?? 0),
    currency: input.currency || input.moneda || "ARS",
    amount_ars: Number(
      input.amount_ars ??
      input.monto_ars ??
      input.amountARS ??
      input.montoARS ??
      input.monto ??
      input.total ??
      0
    ),
    payment_method: input.payment_method || input.metodo_pago || input.gateway || input.provider || "",
    status,
    customer: input.customer || input.email || input.customer_email || input.cliente || "",
    affiliate: normalizeRef(input.affiliate || input.afiliado || input.ref || input.affiliate_ref || input.afiliado_ref || ""),
    affiliate_source: input.affiliate_source || input.fuente || input.utm_source || "",
    commission_amount: Number(input.commission_amount ?? input.comision_monto ?? 0),
    commission_currency: input.commission_currency || input.comision_moneda || "",
    commission_status: input.commission_status || input.comision_estado || "",
    plan_name: input.plan_name || input.plan || "",
    active_code: Boolean(input.active_code || input.codigo_activo || input.codigo),
    error_flag: Boolean(
      input.error_flag ||
      input.error ||
      input.type === "error" ||
      input.tipo === "error"
    ),
    error_tipo: input.error_tipo || input.error_type || "",
    error_detalle: input.error_detalle || input.error_detail || input.message || "",
    raw: input
  };
}

function filterOwnerEventsByDate(events, url) {
  const desde = url.searchParams.get("desde");
  const hasta = url.searchParams.get("hasta");

  const start = desde ? new Date(`${desde}T00:00:00-03:00`) : null;
  const end = hasta ? new Date(`${hasta}T23:59:59-03:00`) : null;

  return events.filter(event => {
    const d = new Date(event.date);

    if (Number.isNaN(d.getTime())) return true;
    if (start && d < start) return false;
    if (end && d > end) return false;

    return true;
  });
}

function buildOwnerPayload(events, hasKv) {
  const operaciones = events;
  const afiliadosMap = new Map();
  const comisiones = [];
  const logs = [];
  const emails = [];
  const auditoria = [];

  for (const event of events) {
    if (event.affiliate) {
      if (!afiliadosMap.has(event.affiliate)) {
        afiliadosMap.set(event.affiliate, {
          codigo: event.affiliate,
          nombre: event.affiliate,
          email: "",
          estado: "Activo",
          porcentaje: 0,
          clientes_referidos: 0,
          total_ars: 0,
          total_usdt: 0,
          pendiente_ars: 0,
          fecha_alta: event.date
        });
      }

      const affiliate = afiliadosMap.get(event.affiliate);

      if (event.customer) {
        affiliate.clientes_referidos += 1;
      }

      if (event.commission_amount) {
        if (event.commission_currency === "ARS" || event.currency === "ARS") {
          affiliate.total_ars += Number(event.commission_amount || 0);
        }

        if (["USD", "USDT"].includes(event.commission_currency || event.currency)) {
          affiliate.total_usdt += Number(event.commission_amount || 0);
        }

        if (["pending", "pendiente", "pending_payment", ""].includes(String(event.commission_status || "").toLowerCase())) {
          if (event.commission_currency === "ARS" || event.currency === "ARS") {
            affiliate.pendiente_ars += Number(event.commission_amount || 0);
          }
        }

        comisiones.push({
          id: `COM-${event.id}`,
          fecha: event.date,
          afil_c: event.affiliate,
          afil_n: event.affiliate,
          afil_e: "",
          venta: event.id,
          cli: event.customer,
          producto: event.product,
          monto_v: event.amount,
          mon_v: event.currency,
          pct: 0,
          monto_c: event.commission_amount,
          mon_c: event.commission_currency || event.currency,
          estado: event.commission_status || "Pendiente",
          renovacion: false
        });
      }
    }

    if (event.error_flag || event.status === "failed") {
      logs.push({
        id: `ERR-${event.id}`,
        fecha: event.date,
        tipo: event.error_tipo || event.type || "error",
        detalle: event.error_detalle || event.product || "Evento con error",
        resuelto: false
      });
    }

    if (event.type === "email") {
      emails.push({
        id: `EMAIL-${event.id}`,
        fecha: event.date,
        para: event.customer,
        asunto: event.product,
        estado: event.status,
        resend: event.raw?.resend_id || ""
      });
    }

    if (event.type === "audit" || event.type === "auditoria") {
      auditoria.push({
        id: `AUD-${event.id}`,
        fecha: event.date,
        accion: event.product,
        detalle: event.error_detalle || "",
        ref: event.raw?.ref || ""
      });
    }
  }

  const confirmed = operaciones.filter(event => ["approved", "active"].includes(event.status));

  const facturacion_ars = confirmed.reduce((sum, event) => {
    return sum + Number(event.amount_ars || 0);
  }, 0);

  const ventas_confirmadas = confirmed.length;

  return {
    ok: true,
    source: hasKv ? "OWNER_EVENTS_KV" : "empty_no_kv",
    generated_at: new Date().toISOString(),
    metrics: {
      facturacion_ars,
      ventas_confirmadas,
      ticket_promedio_ars: ventas_confirmadas ? Math.round(facturacion_ars / ventas_confirmadas) : 0,
      total_operaciones: operaciones.length,
      total_afiliados: afiliadosMap.size,
      total_comisiones: comisiones.length,
      total_logs: logs.length
    },
    operaciones,
    ops: operaciones,
    afiliados: Array.from(afiliadosMap.values()),
    comisiones,
    logs,
    emails,
    auditoria
  };
}

/* =========================================================
   HTTP HELPERS
   ========================================================= */

async function readRequestBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      return Object.fromEntries(new URLSearchParams(text));
    }
  } catch {
    return {};
  }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = OWNER_ALLOWED_ORIGINS.has(origin)
    ? origin
    : "https://legalai-arg.com";

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Admin-Key, x-admin-key",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(request, data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(request),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
