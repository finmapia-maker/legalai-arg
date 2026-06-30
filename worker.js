const OWNER_ALLOWED_ORIGINS = new Set([
  "https://legalai-arg.com",
  "https://www.legalai-arg.com",
  "http://localhost:8787",
  "http://localhost:3000"
]);

const OWNER_EVENTS_KEY = "events";
const AFFILIATES_KEY = "afiliados";
const AFFILIATE_CONVERSIONS_KEY = "afiliados_conversiones";
const PREVIEWS_KEY = "previews";
const CHECKOUTS_KEY = "checkout";
const CHECKOUT_TTL_SECONDS = 24 * 60 * 60;
const BACKUP_PDF_MAX_BYTES = 8 * 1024 * 1024;
const BACKUP_EMAIL_TTL_SECONDS = 30 * 24 * 60 * 60;

const PACKS_KEY = "packs";
const PLAN_ORDER_PREFIX = "plan_order";
const PLAN_CODE_PREFIX = "plan_code";
const PLAN_PAYMENT_PREFIX = "plan_payment";
const PLAN_CODE_TTL_SECONDS = 90 * 24 * 60 * 60;
const PLAN_ACTIVE_TTL_SECONDS = 370 * 24 * 60 * 60;
const PLAN_CONFIG = {
  starter:   { name: "Starter",   crypto_usd: 19,  card_usd: 22,  duration_days: 30, quota: 10 },
  standard:  { name: "Standard",  crypto_usd: 49,  card_usd: 55,  duration_days: 30, quota: 30 },
  pro:       { name: "PRO",       crypto_usd: 99,  card_usd: 112, duration_days: 30, quota: null },
  business:  { name: "Business",  crypto_usd: 249, card_usd: 279, duration_days: 30, quota: null },
  enterprise:{ name: "Enterprise",crypto_usd: 599, card_usd: 679, duration_days: 30, quota: null }
};

const PRICE_MULTIPLIER = 0.3;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    try {
      const productResponse = await handleProductRoutes(request, env);
      if (productResponse) return productResponse;

      const trackResponse = await handleTrackingRoutes(request, env);
      if (trackResponse) return trackResponse;

      const metricsCompatResponse = await handleMetricsCompatibilityRoutes(request, env);
      if (metricsCompatResponse) return metricsCompatResponse;

      const ownerResponse = await handleOwnerRoutes(request, env);
      if (ownerResponse) return ownerResponse;

      const affiliateAdminResponse = await handleAdminAffiliateRoutes(request, env);
      if (affiliateAdminResponse) return affiliateAdminResponse;

      if (env.ASSETS) return env.ASSETS.fetch(request);

      return json(request, {
        ok: false,
        error: "assets_not_configured",
        message: "No está disponible env.ASSETS. Revisar wrangler.toml."
      }, 500);

    } catch (err) {
      await safeAppendOwnerEvent(env, {
        type: "error",
        category: "worker",
        product: "Error general del Worker",
        status: "failed",
        error_flag: true,
        error_tipo: "worker_exception",
        error_detalle: err?.message || String(err),
        path: url.pathname,
        date: new Date().toISOString()
      });

      return json(request, {
        ok: false,
        error: "worker_exception",
        message: err?.message || String(err),
        path: url.pathname
      }, 500);
    }
  }
};

/* =========================================================
   PRODUCT ROUTES — WEB LEGALAI
   ========================================================= */

async function handleProductRoutes(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/ping") {
    return json(request, {
      ok: true,
      worker: "alive",
      product_routes: true,
      mp_configured: Boolean(env.MERCADOPAGO_ACCESS_TOKEN),
      openai_configured: Boolean(env.OPENAI_API_KEY),
      claude_configured: Boolean(env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY),
      resend_configured: Boolean(env.RESEND_API_KEY),
      backup_email_to_configured: Boolean(env.EMAIL_TO),
      backup_email_from_configured: Boolean(env.EMAIL_FROM),
      nowpayments_configured: Boolean(env.NOWPAYMENTS_API_KEY),
      nowpayments_ipn_configured: Boolean(env.NOWPAYMENTS_IPN_SECRET),
      owner_routes: true,
      affiliate_admin_routes: true,
      tracking_routes: true,
      kv_binding_exists: Boolean(env.OWNER_EVENTS_KV),
      time: new Date().toISOString()
    });
  }

  if (request.method === "POST" && url.pathname === "/planes/crear-orden") {
    return await handleCreatePlanOrder(request, env);
  }

  if (request.method === "POST" && url.pathname === "/planes/activar") {
    return await handleActivatePlanCode(request, env);
  }

  if (request.method === "POST" && url.pathname === "/nowpayments/webhook") {
    return await handleNowPaymentsWebhook(request, env);
  }

  if (request.method === "POST" && url.pathname === "/campos") {
    const body = await readRequestBody(request);
    const tipoDocumento = String(body.tipoDocumento || body.tipo || "Documento legal").trim();
    const pais = String(body.pais || "Argentina").trim();
    const provincia = String(body.provincia || "No especificada").trim();

    const generated = await generarCamposConFallback(env, tipoDocumento, pais, provincia);

    await safeAppendOwnerEvent(env, {
      type: "form_fields_generated",
      product: tipoDocumento,
      category: "formulario",
      status: "approved",
      amount: 0,
      amount_ars: 0,
      customer: "",
      raw: { tipoDocumento, pais, provincia }
    });

    return json(request, generated);
  }

  if (request.method === "POST" && url.pathname === "/preview") {
    const body = await readRequestBody(request);
    const datosDoc = body.datosDoc || body.datos || {};
    const metadata = body.metadata || {};
    const texto = await generarDocumentoTexto(env, datosDoc, metadata, true);

    const previewId = "prev_" + crypto.randomUUID();
    await writePreview(env, previewId, { texto, datosDoc, metadata, created_at: new Date().toISOString() });

    await safeAppendOwnerEvent(env, {
      type: "preview_ok",
      product: metadata.titulo || datosDoc.tipo || "Documento legal",
      category: "preview",
      status: "approved",
      amount: 0,
      amount_ars: 0,
      raw: { previewId, metadata }
    });

    return json(request, { ok: true, previewId, texto });
  }

  if (["GET", "POST"].includes(request.method) && url.pathname === "/mp/webhook") {
    return await handleMercadoPagoWebhook(request, env);
  }

  if (request.method === "POST" && url.pathname === "/mp/preferencia") {
    const body = await readRequestBody(request);

    const montoARS = Math.max(100, Math.round(Number(body.montoARS || body.amount || body.total || 0)));
    const descripcion = String(body.descripcion || body.title || "Documento LegalAI").slice(0, 250);
    const externalRef = String(body.externalRef || body.external_reference || ("legalai_" + Date.now()));
    const ref = normalizeRef(body.ref || body.affiliate || "");
    const tipoCompra = String(body.tipo || "doc").trim().toLowerCase();
    const datosPago = body.datosPago || {};
    const checkoutPayload = body.checkoutPayload || {};
    const checkoutDatosDoc = body.datosDoc || checkoutPayload.datosDoc || null;
    const checkoutMetadata = body.metadata || checkoutPayload.metadata || null;
    const checkoutPreviewId = body.previewId || checkoutPayload.previewId || datosPago.previewId || null;

    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      await safeAppendOwnerEvent(env, {
        type: "error",
        product: descripcion,
        category: "mercadopago",
        status: "failed",
        amount: montoARS,
        amount_ars: montoARS,
        affiliate: ref,
        error_flag: true,
        error_tipo: "missing_mp_token",
        error_detalle: "Falta MERCADOPAGO_ACCESS_TOKEN en Cloudflare."
      });

      return json(request, {
        ok: false,
        error: "missing_mp_token",
        detalle: "Falta MERCADOPAGO_ACCESS_TOKEN en Cloudflare."
      }, 500);
    }

    const origin = "https://legalai-arg.com";
    const returnParams = new URLSearchParams({ tipo: tipoCompra, external_reference: externalRef });
    const successPage = tipoCompra === "plan" ? "gracias.html" : "index.html";
    const pendingPage = tipoCompra === "plan" ? "gracias.html" : "index.html";
    const failurePage = tipoCompra === "plan" ? "planes.html" : "index.html";
    const preferenceBody = {
      items: [{
        title: descripcion || "Documento LegalAI",
        quantity: 1,
        currency_id: "ARS",
        unit_price: montoARS
      }],
      external_reference: externalRef,
      metadata: {
        legalai_external_ref: externalRef,
        legalai_ref: ref,
        legalai_tipo: tipoCompra,
        ...safeMetadata(datosPago)
      },
      notification_url: `https://legalai-worker.finmap-ia.workers.dev/mp/webhook`,
      back_urls: {
        success: `${origin}/${successPage}?${returnParams.toString()}`,
        pending: `${origin}/${pendingPage}?${returnParams.toString()}`,
        failure: `${origin}/${failurePage}?status=failure&${returnParams.toString()}${tipoCompra === "plan" ? "" : "#generador"}`
      },
      auto_return: "approved",
      statement_descriptor: "LEGALAI",
      binary_mode: false
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preferenceBody)
    });

    const mpData = await mpRes.json().catch(() => ({}));

    if (!mpRes.ok || !mpData.init_point) {
      await safeAppendOwnerEvent(env, {
        type: "error",
        product: descripcion,
        category: "mercadopago",
        status: "failed",
        amount: montoARS,
        amount_ars: montoARS,
        affiliate: ref,
        error_flag: true,
        error_tipo: "mp_preference_error",
        error_detalle: JSON.stringify(mpData).slice(0, 600),
        raw: { request: preferenceBody, response: mpData }
      });

      return json(request, {
        ok: false,
        error: "mp_preference_error",
        detalle: mpData.message || mpData.error || "MercadoPago no creó la preferencia.",
        mp: mpData
      }, 502);
    }

    await writeCheckout(env, externalRef, {
      external_reference: externalRef,
      tipo: tipoCompra,
      datosDoc: checkoutDatosDoc,
      metadata: checkoutMetadata,
      previewId: checkoutPreviewId,
      datosPago,
      ref,
      montoARS,
      descripcion,
      preference_id: mpData.id,
      created_at: new Date().toISOString()
    });

    await safeAppendOwnerEvent(env, {
      id: externalRef,
      type: "checkout_start",
      product: descripcion,
      category: "mercadopago",
      amount: montoARS,
      amount_ars: montoARS,
      currency: "ARS",
      payment_method: "MercadoPago",
      status: "pending",
      affiliate: ref,
      affiliate_source: datosPago.utm_src || "",
      raw: { preference_id: mpData.id, externalRef, datosPago }
    });

    return json(request, {
      ok: true,
      id: mpData.id,
      preference_id: mpData.id,
      init_point: mpData.init_point,
      sandbox_init_point: mpData.sandbox_init_point,
      external_reference: externalRef
    });
  }

  if (request.method === "POST" && url.pathname === "/generar") {
    const body = await readRequestBody(request);
    const paymentId = String(body.paymentId || body.payment_id || "").trim();
    const codigoPack = String(body.codigoPack || body.codigo_pack || "").trim();
    const requestedExternalRef = String(body.externalRef || body.external_reference || "").trim();

    let datosDoc = body.datosDoc || body.datos || null;
    let metadata = body.metadata || null;
    let previewId = body.previewId || null;
    let externalRef = requestedExternalRef;
    let checkout = null;
    let mp = null;

    if (!codigoPack) {
      if (!paymentId) {
        return json(request, { ok: false, error: "missing_payment_id", message: "Falta el identificador real del pago." }, 400);
      }

      const verified = await fetchMercadoPagoPayment(env, paymentId);
      if (!verified.ok) {
        return json(request, { ok: false, error: verified.error, message: verified.message }, verified.status || 502);
      }

      mp = verified.payment;
      if (String(mp.status || "").toLowerCase() !== "approved") {
        return json(request, { ok: false, error: "payment_not_approved", message: "El pago todavía no figura aprobado en MercadoPago." }, 402);
      }
      if (!isLegalAiPayment(mp)) {
        return json(request, { ok: false, error: "payment_not_legalai", message: "El pago no corresponde a una operación de LegalAI Arg." }, 403);
      }
      const paidType = String(mp.metadata?.legalai_tipo || "doc").toLowerCase();
      if (paidType !== "doc") {
        return json(request, { ok: false, error: "wrong_payment_type", message: "Este pago no corresponde a la compra de un documento." }, 403);
      }

      await recordApprovedPaymentOnce(env, mp, "generation_validation");

      externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "").trim();
      if (requestedExternalRef && externalRef && requestedExternalRef !== externalRef) {
        return json(request, { ok: false, error: "external_reference_mismatch", message: "La referencia del pago no coincide con la operación iniciada." }, 409);
      }

      checkout = externalRef ? await readCheckout(env, externalRef) : null;
      if (checkout?.texto) {
        await safeAppendOwnerEvent(env, {
          id: `DOC-${paymentId}`,
          payment_id: paymentId,
          order_id: externalRef,
          type: "document_generated",
          product: checkout.metadata?.titulo || metadata?.titulo || checkout.datosDoc?.tipo || "Documento legal",
          category: "documento",
          amount: Number(checkout.metadata?.precio_usd || metadata?.precio_usd || 0),
          amount_ars: Number(mp?.transaction_amount || checkout?.montoARS || 0),
          currency: mp?.currency_id || "ARS",
          payment_method: "MercadoPago",
          status: "approved",
          customer: checkout.datosDoc?.email || mp?.payer?.email || "",
          affiliate: checkout?.ref || "",
          date: checkout.generated_at || new Date().toISOString(),
          raw: { paymentId, externalRef, previewId: checkout.previewId || previewId, recovered: true }
        });
        return json(request, {
          ok: true,
          texto: checkout.texto,
          paymentId,
          external_reference: externalRef,
          metadata: checkout.metadata || metadata || {},
          generated_at: checkout.generated_at || "",
          recovered: true
        });
      }

      if (!datosDoc || !Object.keys(datosDoc).length) datosDoc = checkout?.datosDoc || null;
      if (!metadata || !Object.keys(metadata).length) metadata = checkout?.metadata || null;
      if (!previewId) previewId = checkout?.previewId || null;

      if (!datosDoc || !Object.keys(datosDoc).length) {
        await safeAppendOwnerEvent(env, {
          id: `DOC-ERROR-${paymentId}`,
          payment_id: paymentId,
          order_id: externalRef,
          type: "document_generation_failed",
          product: metadata?.titulo || mp?.description || "Documento legal",
          category: "documento",
          status: "failed",
          error_flag: true,
          error_tipo: "checkout_data_not_found",
          error_detalle: "Pago aprobado sin datos temporales del formulario.",
          raw: { paymentId, externalRef }
        });
        return json(request, {
          ok: false,
          error: "checkout_data_not_found",
          message: "El pago está aprobado, pero no se encontraron los datos temporales del formulario. No vuelvas a pagar; contactá a soporte con el comprobante."
        }, 409);
      }
    }

    datosDoc = datosDoc || {};
    metadata = metadata || {};

    await safeAppendOwnerEvent(env, {
      id: `DOC-START-${paymentId || codigoPack}`,
      payment_id: paymentId,
      order_id: externalRef,
      type: "document_generation_started",
      product: metadata.titulo || datosDoc.tipo || "Documento legal",
      category: "documento",
      status: "pending",
      customer: datosDoc.email || mp?.payer?.email || "",
      raw: { paymentId, externalRef, previewId, codigoPack: Boolean(codigoPack) }
    });

    try {
      let texto = "";
      if (previewId) {
        const prev = await readPreview(env, previewId);
        if (prev?.texto) texto = prev.texto;
      }

      if (!texto) texto = await generarDocumentoTexto(env, datosDoc, metadata, false);
      const generatedAt = new Date().toISOString();

      if (!codigoPack && externalRef) {
        await writeCheckout(env, externalRef, {
          ...(checkout || {}),
          external_reference: externalRef,
          tipo: checkout?.tipo || mp?.metadata?.legalai_tipo || "doc",
          datosDoc,
          metadata,
          previewId,
          texto,
          payment_id: paymentId,
          generated_at: generatedAt
        });
      }

      await safeAppendOwnerEvent(env, {
        id: `DOC-${paymentId || ("PACK-" + codigoPack)}`,
        payment_id: paymentId,
        order_id: externalRef,
        type: "document_generated",
        product: metadata.titulo || datosDoc.tipo || "Documento legal",
        category: "documento",
        amount: Number(metadata.precio_usd || 0),
        amount_ars: Number(mp?.transaction_amount || checkout?.montoARS || 0),
        currency: mp?.currency_id || "USD",
        payment_method: codigoPack ? "Pack" : "MercadoPago",
        status: "approved",
        customer: datosDoc.email || mp?.payer?.email || "",
        affiliate: checkout?.ref || datosDoc.ref || "",
        date: generatedAt,
        raw: { paymentId, externalRef, previewId, metadata, recovered_from_checkout: Boolean(checkout) }
      });

      return json(request, {
        ok: true,
        texto,
        paymentId: paymentId || ("PACK_" + Date.now()),
        external_reference: externalRef,
        metadata,
        generated_at: generatedAt
      });
    } catch (err) {
      await safeAppendOwnerEvent(env, {
        id: `DOC-ERROR-${paymentId || codigoPack}`,
        payment_id: paymentId,
        order_id: externalRef,
        type: "document_generation_failed",
        product: metadata.titulo || datosDoc.tipo || "Documento legal",
        category: "documento",
        status: "failed",
        customer: datosDoc.email || mp?.payer?.email || "",
        error_flag: true,
        error_tipo: "document_generation_exception",
        error_detalle: err?.message || String(err),
        raw: { paymentId, externalRef, previewId }
      });
      throw err;
    }
  }

  if (request.method === "POST" && url.pathname === "/respaldo-pdf") {
    return await handlePdfBackupEmail(request, env);
  }

  if (request.method === "POST" && ["/evento", "/interaccion", "/track"].includes(url.pathname)) {
    const body = await readRequestBody(request);
    const tipo = body.tipo || body.event || (url.pathname === "/interaccion" ? "interaccion" : "evento");

    const saved = await safeAppendOwnerEvent(env, {
      id: body.id || body.event_id || body.payment_id || body.paymentId || body.externalRef || body.external_reference,
      payment_id: body.payment_id || body.paymentId || "",
      order_id: body.order_id || body.externalRef || body.external_reference || "",
      date: body.date || body.event_time || body.client_time || new Date().toISOString(),
      type: tipo,
      product: body.doc_tipo || body.product || body.boton || body.pagina || "Web LegalAI",
      category: body.category || url.pathname.replace("/", ""),
      amount: Number(body.precio_usd || body.amount || 0),
      amount_ars: Number(body.amount_ars || body.monto_ars || 0),
      currency: body.currency || body.moneda || (body.precio_usd ? "USD" : "ARS"),
      payment_method: body.payment_method || body.metodo_pago || "",
      status: body.status || "pending",
      customer: body.email || body.customer || "",
      affiliate: body.ref || body.affiliate || "",
      affiliate_source: body.utm_src || "",
      error_flag: Boolean(body.error_flag || body.error),
      error_tipo: body.error_tipo || body.error_type || "",
      error_detalle: body.error_detalle || body.error_detail || body.message || "",
      raw: body
    });

    return json(request, { ok: true, saved });
  }

  if (request.method === "POST" && url.pathname === "/guia") {
    const body = await readRequestBody(request);
    const paymentIdGuia = String(body.paymentIdGuia || body.payment_id || "").trim();
    const verified = await fetchMercadoPagoPayment(env, paymentIdGuia);
    if (!verified.ok) return json(request, { ok: false, error: verified.error, message: verified.message }, verified.status || 502);
    const mp = verified.payment;
    if (String(mp.status || "").toLowerCase() !== "approved") return json(request, { ok: false, error: "payment_not_approved" }, 402);
    if (!isLegalAiPayment(mp) || String(mp.metadata?.legalai_tipo || "").toLowerCase() !== "guia") return json(request, { ok: false, error: "wrong_payment_type" }, 403);
    const externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "");
    const checkout = externalRef ? await readCheckout(env, externalRef) : null;
    const texto = generarGuiaUso(body.datosDoc || checkout?.datosDoc || {}, body.metadata || checkout?.metadata || {});
    return json(request, { ok: true, texto, paymentId: paymentIdGuia });
  }

  if (request.method === "POST" && url.pathname === "/habilitar") {
    const body = await readRequestBody(request);
    const paymentIdUpgrade = String(body.paymentIdUpgrade || body.payment_id || "").trim();
    const verified = await fetchMercadoPagoPayment(env, paymentIdUpgrade);
    if (!verified.ok) return json(request, { ok: false, error: verified.error, message: verified.message }, verified.status || 502);
    if (String(verified.payment.status || "").toLowerCase() !== "approved") return json(request, { ok: false, error: "payment_not_approved" }, 402);
    if (!isLegalAiPayment(verified.payment) || String(verified.payment.metadata?.legalai_tipo || "").toLowerCase() !== "upgrade") return json(request, { ok: false, error: "wrong_payment_type" }, 403);
    return json(request, { ok: true, habilitado: true, paymentId: paymentIdUpgrade });
  }

  if (request.method === "POST" && url.pathname === "/pack/cotizar") {
    const body = await readRequestBody(request);
    const cantidad = Math.max(1, Number(body.cantidad || 3));
    const precio_usd = Math.round((cantidad * 8 * 0.8 * PRICE_MULTIPLIER) * 100) / 100;
    return json(request, { ok: true, cantidad, precio_usd, descuento: 20 });
  }

  if (request.method === "POST" && url.pathname === "/pack/crear") {
    const body = await readRequestBody(request);
    const code = "PACK-" + Math.random().toString(36).slice(2, 6).toUpperCase() + "-" + Date.now().toString().slice(-4);
    const pack = {
      code,
      total: Number(body.cantidad || 3),
      usados: 0,
      created_at: new Date().toISOString(),
      raw: body
    };
    await writePack(env, code, pack);
    return json(request, { ok: true, code, codigo: code, pack });
  }

  if (request.method === "POST" && url.pathname === "/pack/consultar") {
    const body = await readRequestBody(request);
    const code = String(body.codigo || body.code || "").trim().toUpperCase();
    const pack = await readPack(env, code);
    if (!pack) return json(request, { ok: false, error: "pack_not_found" }, 404);
    return json(request, { ok: true, pack, restantes: Math.max(0, Number(pack.total || 0) - Number(pack.usados || 0)) });
  }

  if (request.method === "POST" && url.pathname === "/afiliado/solicitud") {
    const body = await readRequestBody(request);
    await safeAppendOwnerEvent(env, {
      type: "affiliate_request",
      product: "Solicitud afiliado",
      category: "afiliados",
      status: "pending",
      customer: body.email || "",
      affiliate: body.ref || "",
      raw: body
    });
    return json(request, { ok: true, message: "Solicitud recibida." });
  }

  return null;
}


async function handleMercadoPagoWebhook(request, env) {
  const url = new URL(request.url);
  const body = request.method === "POST" ? await readRequestBody(request) : {};
  const topic = url.searchParams.get("topic") || url.searchParams.get("type") || body.type || body.topic || "";
  const paymentId = url.searchParams.get("id") || url.searchParams.get("data.id") || body?.data?.id || body.id || body.payment_id || "";
  const requestId = request.headers.get("x-request-id") || crypto.randomUUID();
  const receivedAt = new Date().toISOString();

  await safeAppendOwnerEvent(env, {
    id: `MP-WH-${paymentId || "SIN-ID"}-${requestId}`,
    payment_id: String(paymentId || ""),
    type: "payment_webhook_received",
    category: "webhook",
    product: "Notificación MercadoPago",
    status: "pending",
    date: receivedAt,
    raw: {
      topic,
      paymentId,
      request_id: requestId,
      x_signature_present: Boolean(request.headers.get("x-signature")),
      body
    }
  });

  if (!paymentId) {
    await safeAppendOwnerEvent(env, {
      id: `MP-WH-ERROR-${requestId}`,
      type: "error",
      category: "webhook",
      product: "MercadoPago webhook sin payment_id",
      status: "failed",
      error_flag: true,
      error_tipo: "mp_webhook_missing_payment_id",
      error_detalle: "La notificación no incluyó un identificador de pago.",
      raw: { topic, body, request_id: requestId }
    });
    return json(request, { ok: true, ignored: "missing_payment_id" });
  }

  if (!env.MERCADOPAGO_ACCESS_TOKEN) {
    await safeAppendOwnerEvent(env, {
      id: `MP-WH-ERROR-${paymentId}`,
      payment_id: String(paymentId),
      type: "error",
      category: "webhook",
      product: "MercadoPago webhook sin token",
      status: "failed",
      error_flag: true,
      error_tipo: "missing_mp_token",
      error_detalle: "No se pudo verificar el pago porque falta MERCADOPAGO_ACCESS_TOKEN.",
      raw: { topic, paymentId, body, request_id: requestId }
    });
    return json(request, { ok: true, warning: "missing_mp_token" });
  }

  try {
    const verified = await fetchMercadoPagoPayment(env, String(paymentId));
    if (!verified.ok) {
      await safeAppendOwnerEvent(env, {
        id: `MP-WH-ERROR-${paymentId}`,
        payment_id: String(paymentId),
        type: "error",
        category: "webhook",
        product: "Error al verificar pago MercadoPago",
        status: "failed",
        error_flag: true,
        error_tipo: verified.error || "mp_payment_lookup_error",
        error_detalle: verified.message || "No se pudo consultar el pago.",
        raw: { topic, paymentId, request_id: requestId }
      });
      return json(request, { ok: true, warning: "mp_lookup_error" });
    }

    const mp = verified.payment;
    const approved = String(mp.status || "").toLowerCase() === "approved";
    if (approved) {
      await recordApprovedPaymentOnce(env, mp, "webhook");
      if (String(mp.metadata?.legalai_tipo || "").toLowerCase() === "plan") {
        const externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "").trim();
        const checkout = externalRef ? await readCheckout(env, externalRef) : null;
        await ensurePlanCodeIssued(env, {
          provider: "mercadopago",
          payment_id: String(mp.id || paymentId),
          order_id: externalRef,
          plan_id: checkout?.plan_id || mp.metadata?.plan_id || "",
          email: checkout?.email || mp.metadata?.email || mp.payer?.email || "",
          amount: Number(mp.transaction_amount || 0),
          currency: mp.currency_id || "ARS",
          approved_at: mp.date_approved || mp.date_last_updated || new Date().toISOString(),
          affiliate: checkout?.ref || mp.metadata?.legalai_ref || ""
        });
      }
    } else {
      await recordPaymentStatusEvent(env, mp, "webhook");
    }

    return json(request, { ok: true, saved: true, status: mp.status || "" });
  } catch (err) {
    await safeAppendOwnerEvent(env, {
      id: `MP-WH-EXCEPTION-${paymentId}-${requestId}`,
      payment_id: String(paymentId),
      type: "error",
      category: "webhook",
      product: "Excepción verificando webhook MercadoPago",
      status: "failed",
      error_flag: true,
      error_tipo: "mp_webhook_exception",
      error_detalle: err?.message || String(err),
      raw: { topic, paymentId, body, request_id: requestId }
    });
    return json(request, { ok: true, warning: "webhook_exception" });
  }
}


/* =========================================================
   PLANES — ORDEN, PAGO Y ACTIVACIÓN
   ========================================================= */

async function handleCreatePlanOrder(request, env) {
  const body = await readRequestBody(request);
  const planId = String(body.plan_id || "").trim().toLowerCase();
  const method = String(body.metodo_pago || "tarjeta").trim().toLowerCase();
  const email = String(body.email || "").trim().toLowerCase();
  const ref = normalizeRef(body.ref || "");
  const plan = PLAN_CONFIG[planId];

  if (!plan) return json(request, { ok: false, error: "Plan inválido." }, 400);
  if (!isValidEmail(email)) return json(request, { ok: false, error: "Ingresá un email válido." }, 400);
  if (!["tarjeta", "cripto"].includes(method)) return json(request, { ok: false, error: "Método de pago inválido." }, 400);

  const orderId = `plan_${planId}_${Date.now()}_${randomToken(6).toLowerCase()}`;
  const createdAt = new Date().toISOString();

  if (method === "tarjeta") {
    if (!env.MERCADOPAGO_ACCESS_TOKEN) {
      return json(request, { ok: false, error: "Mercado Pago no está configurado." }, 500);
    }

    const usdRate = await getPlanUsdArsRate(env);
    if (!usdRate || usdRate <= 0) {
      return json(request, { ok: false, error: "No se pudo obtener la cotización para crear el pago. Intentá nuevamente." }, 502);
    }
    const amountARS = Math.max(100, Math.ceil((plan.card_usd * usdRate) / 100) * 100);
    const origin = "https://legalai-arg.com";
    const preferenceBody = {
      items: [{
        title: `Plan ${plan.name} LegalAI Arg`,
        quantity: 1,
        currency_id: "ARS",
        unit_price: amountARS
      }],
      payer: { email },
      external_reference: orderId,
      metadata: {
        legalai_external_ref: orderId,
        legalai_tipo: "plan",
        legalai_ref: ref,
        plan_id: planId,
        email
      },
      notification_url: `https://legalai-worker.finmap-ia.workers.dev/mp/webhook`,
      back_urls: {
        success: `${origin}/planes.html?status=success&tipo=plan&external_reference=${encodeURIComponent(orderId)}`,
        pending: `${origin}/planes.html?status=pending&tipo=plan&external_reference=${encodeURIComponent(orderId)}`,
        failure: `${origin}/planes.html?status=failure&tipo=plan&external_reference=${encodeURIComponent(orderId)}`
      },
      auto_return: "approved",
      statement_descriptor: "LEGALAI",
      binary_mode: false
    };

    const mpRes = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preferenceBody)
    });
    const mpData = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok || !mpData.init_point) {
      await safeAppendOwnerEvent(env, {
        id: `PLAN-ORDER-ERROR-${orderId}`,
        order_id: orderId,
        type: "plan_order_failed",
        product: `Plan ${plan.name}`,
        plan_name: planId,
        category: "planes",
        status: "failed",
        customer: email,
        affiliate: ref,
        error_flag: true,
        error_tipo: "mp_preference_error",
        error_detalle: mpData.message || mpData.error || `Mercado Pago HTTP ${mpRes.status}`,
        raw: mpData
      });
      return json(request, { ok: false, error: mpData.message || mpData.error || "Mercado Pago no pudo crear la orden." }, 502);
    }

    const order = {
      order_id: orderId,
      provider: "mercadopago",
      preference_id: mpData.id,
      plan_id: planId,
      email,
      ref,
      amount: amountARS,
      amount_usd: plan.card_usd,
      currency: "ARS",
      status: "pending",
      created_at: createdAt
    };
    await writePlanOrder(env, orderId, order);
    await writeCheckout(env, orderId, {
      external_reference: orderId,
      tipo: "plan",
      plan_id: planId,
      email,
      ref,
      metodo_pago: "tarjeta",
      montoARS: amountARS,
      precio_usd: plan.card_usd,
      preference_id: mpData.id,
      created_at: createdAt
    });
    await safeAppendOwnerEvent(env, {
      id: `PLAN-ORDER-${orderId}`,
      order_id: orderId,
      type: "checkout_start",
      product: `Plan ${plan.name}`,
      plan_name: planId,
      category: "planes",
      amount: amountARS,
      amount_ars: amountARS,
      currency: "ARS",
      payment_method: "MercadoPago",
      status: "pending",
      customer: email,
      affiliate: ref,
      raw: order
    });
    return json(request, { ok: true, invoice_url: mpData.init_point, invoice_id: mpData.id, order_id: orderId });
  }

  if (!env.NOWPAYMENTS_API_KEY) {
    return json(request, {
      ok: false,
      error: "El pago con USDT no está configurado. Seleccioná ‘Tarjeta / Mercado Pago’ o configurá NOWPAYMENTS_API_KEY."
    }, 503);
  }

  const invoiceBody = {
    price_amount: plan.crypto_usd,
    price_currency: "usd",
    order_id: orderId,
    order_description: `Plan ${plan.name} LegalAI Arg`,
    ipn_callback_url: "https://legalai-worker.finmap-ia.workers.dev/nowpayments/webhook",
    success_url: `https://legalai-arg.com/planes.html?status=success&tipo=plan&provider=nowpayments&external_reference=${encodeURIComponent(orderId)}`,
    cancel_url: `https://legalai-arg.com/planes.html?status=failure&tipo=plan&provider=nowpayments&external_reference=${encodeURIComponent(orderId)}`
  };
  const npRes = await fetch("https://api.nowpayments.io/v1/invoice", {
    method: "POST",
    headers: { "x-api-key": env.NOWPAYMENTS_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(invoiceBody)
  });
  const npData = await npRes.json().catch(() => ({}));
  if (!npRes.ok || !npData.invoice_url) {
    await safeAppendOwnerEvent(env, {
      id: `PLAN-ORDER-ERROR-${orderId}`,
      order_id: orderId,
      type: "plan_order_failed",
      product: `Plan ${plan.name}`,
      plan_name: planId,
      category: "planes",
      status: "failed",
      customer: email,
      affiliate: ref,
      error_flag: true,
      error_tipo: "nowpayments_invoice_error",
      error_detalle: npData.message || npData.error || `NOWPayments HTTP ${npRes.status}`,
      raw: npData
    });
    return json(request, { ok: false, error: npData.message || npData.error || "NOWPayments no pudo crear la orden." }, 502);
  }

  const order = {
    order_id: orderId,
    provider: "nowpayments",
    invoice_id: String(npData.id || ""),
    plan_id: planId,
    email,
    ref,
    amount: plan.crypto_usd,
    amount_usd: plan.crypto_usd,
    currency: "USD",
    status: "pending",
    created_at: createdAt
  };
  await writePlanOrder(env, orderId, order);
  await safeAppendOwnerEvent(env, {
    id: `PLAN-ORDER-${orderId}`,
    order_id: orderId,
    invoice_id: String(npData.id || ""),
    type: "checkout_start",
    product: `Plan ${plan.name}`,
    plan_name: planId,
    category: "planes",
    amount: plan.crypto_usd,
    currency: "USD",
    payment_method: "NOWPayments",
    status: "pending",
    customer: email,
    affiliate: ref,
    raw: order
  });
  return json(request, { ok: true, invoice_url: npData.invoice_url, invoice_id: npData.id || "", order_id: orderId });
}

async function handleActivatePlanCode(request, env) {
  const body = await readRequestBody(request);
  const code = String(body.codigo || body.code || "").trim().toUpperCase();
  const email = String(body.email || "").trim().toLowerCase();
  if (!code || !isValidEmail(email)) return json(request, { ok: false, error: "Código o email inválido." }, 400);

  const record = await readPlanCode(env, code);
  if (!record) return json(request, { ok: false, error: "Código inexistente o vencido." }, 404);
  if (String(record.email || "").toLowerCase() !== email) return json(request, { ok: false, error: "El código no corresponde a ese email." }, 403);
  if (record.code_expires_at && Date.now() > new Date(record.code_expires_at).getTime() && record.status !== "active") {
    return json(request, { ok: false, error: "El código venció antes de ser activado." }, 410);
  }

  const plan = PLAN_CONFIG[record.plan_id];
  if (!plan) return json(request, { ok: false, error: "El plan asociado al código no es válido." }, 409);

  if (record.status === "active" && record.expires_at) {
    return json(request, { ok: true, already_active: true, plan_id: record.plan_id, expires_at: record.expires_at });
  }

  const activatedAt = new Date();
  const expiresAt = new Date(activatedAt.getTime() + plan.duration_days * 24 * 60 * 60 * 1000).toISOString();
  const updated = { ...record, status: "active", activated_at: activatedAt.toISOString(), expires_at: expiresAt };
  await writePlanCode(env, code, updated, PLAN_ACTIVE_TTL_SECONDS);
  await writePlanActiveByEmail(env, email, updated);
  await safeAppendOwnerEvent(env, {
    id: `PLAN-ACTIVATED-${record.provider}-${record.payment_id || record.order_id}`,
    payment_id: record.payment_id || "",
    order_id: record.order_id || "",
    type: "plan_activated",
    product: `Plan ${plan.name}`,
    plan_name: record.plan_id,
    category: "planes",
    status: "active",
    customer: email,
    payment_method: record.provider === "mercadopago" ? "MercadoPago" : "NOWPayments",
    date: activatedAt.toISOString(),
    raw: { code, expires_at: expiresAt, provider: record.provider }
  });
  return json(request, { ok: true, plan_id: record.plan_id, expires_at: expiresAt });
}

async function handleNowPaymentsWebhook(request, env) {
  let body = {};
  try { body = await request.json(); }
  catch { return json(request, { ok: false, error: "invalid_json" }, 400); }

  const signature = request.headers.get("x-nowpayments-sig") || "";
  if (!env.NOWPAYMENTS_IPN_SECRET) {
    await safeAppendOwnerEvent(env, {
      id: `NOW-IPN-ERROR-${body.payment_id || body.order_id || crypto.randomUUID()}`,
      order_id: body.order_id || "",
      payment_id: String(body.payment_id || ""),
      type: "plan_payment_webhook_error",
      product: "NOWPayments",
      category: "planes",
      status: "failed",
      error_flag: true,
      error_tipo: "missing_nowpayments_ipn_secret",
      error_detalle: "Falta NOWPAYMENTS_IPN_SECRET."
    });
    return json(request, { ok: false, error: "missing_nowpayments_ipn_secret" }, 500);
  }
  const valid = await verifyNowPaymentsSignature(body, signature, env.NOWPAYMENTS_IPN_SECRET);
  if (!valid) return json(request, { ok: false, error: "invalid_signature" }, 401);

  const orderId = String(body.order_id || "").trim();
  const paymentId = String(body.payment_id || "").trim();
  const status = String(body.payment_status || "").toLowerCase();
  const order = orderId ? await readPlanOrder(env, orderId) : null;

  await safeAppendOwnerEvent(env, {
    id: `NOW-IPN-${paymentId || orderId}-${status}`,
    payment_id: paymentId,
    order_id: orderId,
    invoice_id: String(body.invoice_id || order?.invoice_id || ""),
    type: "payment_webhook_received",
    product: order?.plan_id ? `Plan ${PLAN_CONFIG[order.plan_id]?.name || order.plan_id}` : "Plan LegalAI",
    plan_name: order?.plan_id || "",
    category: "planes",
    amount: Number(body.price_amount || order?.amount || 0),
    currency: String(body.price_currency || order?.currency || "USD").toUpperCase(),
    payment_method: "NOWPayments",
    status,
    customer: order?.email || "",
    affiliate: order?.ref || "",
    raw: body
  });

  if (["finished", "confirmed"].includes(status) && order) {
    await safeAppendOwnerEvent(env, {
      id: `SALE-NOW-${paymentId || orderId}`,
      payment_id: paymentId || String(body.invoice_id || order.invoice_id || orderId),
      order_id: orderId,
      invoice_id: String(body.invoice_id || order.invoice_id || ""),
      type: "payment_approved",
      product: `Plan ${PLAN_CONFIG[order.plan_id]?.name || order.plan_id}`,
      plan_name: order.plan_id,
      category: "planes",
      amount: Number(body.price_amount || order.amount || 0),
      currency: String(body.price_currency || order.currency || "USD").toUpperCase(),
      payment_method: "NOWPayments",
      status: "approved",
      customer: order.email || "",
      affiliate: order.ref || "",
      date: new Date().toISOString(),
      raw: body
    });
    await ensurePlanCodeIssued(env, {
      provider: "nowpayments",
      payment_id: paymentId || String(body.invoice_id || order.invoice_id || orderId),
      order_id: orderId,
      plan_id: order.plan_id,
      email: order.email,
      amount: Number(body.price_amount || order.amount || 0),
      currency: String(body.price_currency || order.currency || "USD").toUpperCase(),
      approved_at: new Date().toISOString(),
      affiliate: order.ref || ""
    });
  }
  return json(request, { ok: true });
}

async function ensurePlanCodeIssued(env, input) {
  const planId = String(input.plan_id || "").toLowerCase();
  const email = String(input.email || "").trim().toLowerCase();
  const paymentKey = `${input.provider}:${input.payment_id || input.order_id}`;
  const plan = PLAN_CONFIG[planId];
  if (!plan || !isValidEmail(email) || !paymentKey) {
    await safeAppendOwnerEvent(env, {
      id: `PLAN-CODE-ERROR-${paymentKey || crypto.randomUUID()}`,
      payment_id: input.payment_id || "",
      order_id: input.order_id || "",
      type: "plan_code_error",
      product: planId || "Plan LegalAI",
      category: "planes",
      status: "failed",
      customer: email,
      error_flag: true,
      error_tipo: "missing_plan_data",
      error_detalle: "No se pudo emitir el código: faltan plan o email.",
      raw: input
    });
    return null;
  }

  let record = await readPlanPayment(env, paymentKey);
  if (!record) {
    const code = `${planId.toUpperCase()}-${randomToken(4)}-${randomToken(4)}-${randomToken(4)}`;
    record = {
      code,
      plan_id: planId,
      email,
      provider: input.provider,
      payment_id: input.payment_id || "",
      order_id: input.order_id || "",
      amount: Number(input.amount || 0),
      currency: input.currency || "",
      affiliate: input.affiliate || "",
      status: "issued",
      issued_at: new Date().toISOString(),
      code_expires_at: new Date(Date.now() + PLAN_CODE_TTL_SECONDS * 1000).toISOString(),
      email_sent: false
    };
    await writePlanPayment(env, paymentKey, record);
    await writePlanCode(env, code, record, PLAN_CODE_TTL_SECONDS);
  }

  if (!record.email_sent) {
    try {
      await sendPlanCodeEmail(env, record, plan);
      record = { ...record, email_sent: true, email_sent_at: new Date().toISOString() };
      await writePlanPayment(env, paymentKey, record);
      await writePlanCode(env, record.code, record, PLAN_CODE_TTL_SECONDS);
      await safeAppendOwnerEvent(env, {
        id: `PLAN-CODE-SENT-${paymentKey}`,
        payment_id: record.payment_id,
        order_id: record.order_id,
        type: "plan_code_sent",
        product: `Plan ${plan.name}`,
        plan_name: planId,
        category: "planes",
        amount: record.amount,
        currency: record.currency,
        payment_method: input.provider === "mercadopago" ? "MercadoPago" : "NOWPayments",
        status: "approved",
        customer: email,
        affiliate: record.affiliate || "",
        raw: { code: record.code, email_sent_at: record.email_sent_at }
      });
    } catch (err) {
      await safeAppendOwnerEvent(env, {
        id: `PLAN-CODE-EMAIL-ERROR-${paymentKey}`,
        payment_id: record.payment_id,
        order_id: record.order_id,
        type: "plan_code_email_error",
        product: `Plan ${plan.name}`,
        plan_name: planId,
        category: "planes",
        status: "failed",
        customer: email,
        error_flag: true,
        error_tipo: "plan_code_email_error",
        error_detalle: err?.message || String(err),
        raw: { code: record.code }
      });
    }
  }
  return record;
}

async function sendPlanCodeEmail(env, record, plan) {
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) throw new Error("Falta configurar RESEND_API_KEY o EMAIL_FROM.");
  const payload = {
    from: env.EMAIL_FROM,
    to: [record.email],
    subject: `Tu código del Plan ${plan.name} · LegalAI Arg`,
    html: `<div style="font-family:Arial,sans-serif;color:#222;line-height:1.55"><h2>Pago confirmado</h2><p>Tu código para activar el <strong>Plan ${escapeHtml(plan.name)}</strong> es:</p><p style="font-size:22px;font-weight:700;letter-spacing:1px">${escapeHtml(record.code)}</p><p>Ingresalo junto con este email en la sección “Ya tengo un código de activación” de LegalAI Arg.</p><p>El código puede activarse hasta el ${escapeHtml(new Date(record.code_expires_at).toLocaleDateString("es-AR"))}.</p></div>`
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
      "Idempotency-Key": `legalai-plan-${record.provider}-${record.payment_id || record.order_id}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.id) throw new Error(data.message || data.error || `Resend HTTP ${res.status}`);
  return data;
}

async function getPlanUsdArsRate(env) {
  const configured = Number(env.PLAN_USD_ARS_RATE || 0);
  if (configured > 0) return configured;
  const urls = [
    "https://dolarapi.com/v1/dolares/bolsa",
    "https://dolarapi.com/v1/dolares/oficial"
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { cf: { cacheTtl: 300, cacheEverything: true } });
      const data = await res.json();
      const rate = Number(data?.venta || 0);
      if (res.ok && rate > 0) return rate;
    } catch (_) {}
  }
  return 0;
}

function planKV(env) { return env.PAGOS_KV || env.OWNER_EVENTS_KV || null; }
async function writePlanOrder(env, orderId, value) {
  const kv = planKV(env); if (!kv || !orderId) return false;
  await kv.put(`${PLAN_ORDER_PREFIX}:${orderId}`, JSON.stringify(value), { expirationTtl: PLAN_CODE_TTL_SECONDS });
  return true;
}
async function readPlanOrder(env, orderId) {
  const kv = planKV(env); if (!kv || !orderId) return null;
  const value = await kv.get(`${PLAN_ORDER_PREFIX}:${orderId}`); return value ? JSON.parse(value) : null;
}
async function writePlanPayment(env, key, value) {
  const kv = planKV(env); if (!kv || !key) return false;
  await kv.put(`${PLAN_PAYMENT_PREFIX}:${key}`, JSON.stringify(value), { expirationTtl: PLAN_ACTIVE_TTL_SECONDS });
  return true;
}
async function readPlanPayment(env, key) {
  const kv = planKV(env); if (!kv || !key) return null;
  const value = await kv.get(`${PLAN_PAYMENT_PREFIX}:${key}`); return value ? JSON.parse(value) : null;
}
async function writePlanCode(env, code, value, ttl = PLAN_CODE_TTL_SECONDS) {
  const kv = planKV(env); if (!kv || !code) return false;
  await kv.put(`${PLAN_CODE_PREFIX}:${code}`, JSON.stringify(value), { expirationTtl: ttl }); return true;
}
async function readPlanCode(env, code) {
  const kv = planKV(env); if (!kv || !code) return null;
  const value = await kv.get(`${PLAN_CODE_PREFIX}:${code}`); return value ? JSON.parse(value) : null;
}
async function writePlanActiveByEmail(env, email, value) {
  const kv = planKV(env); if (!kv || !email) return false;
  await kv.put(`plan_active:${email}`, JSON.stringify(value), { expirationTtl: PLAN_ACTIVE_TTL_SECONDS }); return true;
}

async function verifyNowPaymentsSignature(body, signature, secret) {
  if (!signature || !secret) return false;
  const canonical = JSON.stringify(sortObjectDeep(body));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  const expected = Array.from(new Uint8Array(signed)).map(b => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected.toLowerCase(), String(signature).toLowerCase());
}
function sortObjectDeep(value) {
  if (Array.isArray(value)) return value.map(sortObjectDeep);
  if (!value || typeof value !== "object") return value;
  return Object.keys(value).sort().reduce((out, key) => { out[key] = sortObjectDeep(value[key]); return out; }, {});
}
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0;
}
function randomToken(length = 4) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(length); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
function isValidEmail(value) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim()); }

/* =========================================================
   IA / DOCUMENTOS
   ========================================================= */

async function generarCamposConFallback(env, tipoDocumento, pais, provincia) {
  const lower = tipoDocumento.toLowerCase();

  const base = {
    ok: true,
    titulo: toTitle(tipoDocumento),
    descripcion: `Formulario para generar ${tipoDocumento}.`,
    legislacion: pais === "Argentina" ? `Argentina${provincia && provincia !== "No especificada" ? " · " + provincia : ""}` : pais,
    precio_usd: (lower.includes("alquiler") ? 11 : 8) * PRICE_MULTIPLIER,
    upgrade_porcentaje: lower.includes("alquiler") ? 32 : 40,
    categoria: lower.includes("reclamo") || lower.includes("carta documento") ? "complejo" : "intermedio",
    requiere_advertencia_legal: lower.includes("carta documento") || lower.includes("intim") || lower.includes("reclamo"),
    campos: camposFallback(tipoDocumento)
  };

  if (!env.OPENAI_API_KEY && !env.CLAUDE_API_KEY && !env.ANTHROPIC_API_KEY) return base;

  const prompt = `Devolvé SOLO JSON válido, sin markdown. Generá campos para un formulario legal.
Documento: ${tipoDocumento}
País: ${pais}
Provincia/Estado: ${provincia}
Formato exacto:
{
 "titulo": "...",
 "descripcion": "...",
 "legislacion": "...",
 "precio_usd": ${(lower.includes("alquiler") ? 11 : 8) * PRICE_MULTIPLIER},
 "upgrade_porcentaje": 40,
 "categoria": "basico|intermedio|complejo",
 "requiere_advertencia_legal": false,
 "campos": [{"id":"...", "label":"...", "tipo":"text|number|date|textarea|select", "requerido":true, "placeholder":"...", "opciones":["..."]}]
}
Si el documento identifica personas o entidades, incluí para cada parte campos separados de nombre o razón social, DNI / CUIT / CUIL y domicilio. Priorizá esos datos identificatorios dentro del máximo permitido.\nMáximo 12 campos. IDs en snake_case.`;

  try {
    const txt = await callBestAI(env, prompt, 1200);
    const parsed = parseJsonLoose(txt);
    if (parsed?.campos?.length) {
      parsed.campos = asegurarCamposIdentificacion(parsed.campos);
      return { ...base, ...parsed, ok: true };
    }
  } catch (_) {}

  return base;
}

async function generarDocumentoTexto(env, datosDoc, metadata, preview) {
  const titulo = metadata.titulo || datosDoc.tipo || "Documento legal";
  const prompt = `Redactá un ${preview ? "BORRADOR DE VISTA PREVIA" : "DOCUMENTO LEGAL ORIENTATIVO COMPLETO"} en español claro para Argentina si aplica.
Título: ${titulo}
Datos:
${JSON.stringify(datosDoc, null, 2)}

Condiciones:
- Usá formato con títulos markdown (#, ##).
- No inventes datos faltantes: usá [COMPLETAR].
- Incluir aviso breve: "Modelo orientativo. No reemplaza asesoramiento legal profesional."
- Debe ser práctico y listo para revisar.
`;

  if (env.OPENAI_API_KEY || env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY) {
    try {
      return await callBestAI(env, prompt, preview ? 1600 : 2600);
    } catch (_) {}
  }

  return documentoFallback(datosDoc, metadata);
}

async function callBestAI(env, prompt, maxTokens) {
  if (env.OPENAI_API_KEY) {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: "Sos LegalAI Arg. Respondés documentos legales orientativos en español argentino. No das asesoramiento legal definitivo." },
          { role: "user", content: prompt }
        ],
        temperature: 0.25,
        max_tokens: maxTokens
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || "openai_error");
    return data.choices?.[0]?.message?.content || "";
  }

  const anthropicKey = env.CLAUDE_API_KEY || env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "claude-3-5-haiku-20241022",
        max_tokens: maxTokens,
        system: "Sos LegalAI Arg. Respondés documentos legales orientativos en español argentino.",
        messages: [{ role: "user", content: prompt }]
      })
    });
    const data = await res.json();
    if (!res.ok || data.error) throw new Error(data.error?.message || "claude_error");
    return data.content?.[0]?.text || "";
  }

  throw new Error("no_ai_configured");
}


function asegurarCamposIdentificacion(campos) {
  const lista = Array.isArray(campos) ? campos.map(c => ({ ...c })) : [];
  if (!lista.length) return lista;

  const normalizar = valor => String(valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const esIdentificador = campo => /\b(dni|cuit|cuil|pasaporte)\b|documento de identidad/.test(
    normalizar(`${campo?.id || ""} ${campo?.label || ""}`)
  );

  const esParte = campo => {
    if (esIdentificador(campo)) return false;
    const texto = normalizar(`${campo?.id || ""} ${campo?.label || ""}`);
    return /(propietar|locador|inquilin|locatari|anfitri|huesped|socio|vendedor|comprador|parte[_\s-]*[0-9]|cliente|prestador|freelancer|titular|responsable|declarante|trabajador|empleador|acreedor|deudor|remitente|destinatario|otorgante|apoderado|poderdante|autorizante|autorizado|representante|proveedor|consumidor|contratante|contratista|cedente|cesionario|donante|donatario|comodante|comodatario|mutuante|mutuario|garante|fiador|beneficiario|progenitor|padre|madre|menor)/.test(texto);
  };

  const slug = valor => normalizar(valor)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60) || "parte";

  const obtenerRol = campo => {
    const texto = slug(`${campo?.id || ""}_${campo?.label || ""}`);
    const match = texto.match(/(parte_[0-9]+|socio_[0-9]+|propietario|locador|inquilino|locatario|anfitrion|huesped|socio|vendedor|comprador|cliente|prestador|freelancer|titular|responsable|declarante|trabajador|empleador|acreedor|deudor|remitente|destinatario|otorgante|apoderado|poderdante|autorizante|autorizado|representante|proveedor|consumidor|contratante|contratista|cedente|cesionario|donante|donatario|comodante|comodatario|mutuante|mutuario|garante|fiador|beneficiario|progenitor|padre|madre|menor)/);
    return match?.[1] || slug(campo?.id || campo?.label || "parte");
  };

  const partes = lista
    .map((campo, indice) => ({ campo, indice }))
    .filter(item => esParte(item.campo));

  if (!partes.length) {
    if (!lista.some(esIdentificador)) {
      lista.splice(Math.min(1, lista.length), 0, {
        id: "dni_cuit_cuil",
        label: "DNI / CUIT / CUIL",
        tipo: "text",
        requerido: true,
        placeholder: "Ej: DNI 12.345.678 / CUIT 20-12345678-3"
      });
    }
    return lista;
  }

  let desplazamiento = 0;
  for (const { campo, indice } of partes.slice(0, 4)) {
    const clave = obtenerRol(campo);
    const identificadoresExistentes = lista.filter(esIdentificador);
    const yaExiste = identificadoresExistentes.some(otro =>
      slug(`${otro.id || ""}_${otro.label || ""}`).includes(clave)
    ) || (partes.length === 1 && identificadoresExistentes.length > 0);
    if (yaExiste) continue;

    const etiquetaParte = String(campo.label || campo.id || "la parte").trim();
    lista.splice(indice + desplazamiento + 1, 0, {
      id: `dni_cuit_${clave}`,
      label: `DNI / CUIT / CUIL — ${etiquetaParte}`,
      tipo: "text",
      requerido: true,
      placeholder: "Ej: DNI 12.345.678 / CUIT 20-12345678-3"
    });
    desplazamiento += 1;
  }

  return lista;
}

function camposFallback(tipoDocumento) {
  const lower = tipoDocumento.toLowerCase();

  if (lower.includes("alquiler")) {
    return [
      { id: "propietario", label: "Propietario / locador", tipo: "text", requerido: true, placeholder: "Nombre completo o razón social" },
      { id: "dni_cuit_locador", label: "DNI / CUIT / CUIL del locador", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIT 20-12345678-3" },
      { id: "domicilio_locador", label: "Domicilio del locador", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
      { id: "inquilino", label: "Inquilino / locatario", tipo: "text", requerido: true, placeholder: "Nombre completo" },
      { id: "dni_cuit_locatario", label: "DNI / CUIT / CUIL del locatario", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIL 20-12345678-3" },
      { id: "domicilio_locatario", label: "Domicilio del locatario", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
      { id: "direccion", label: "Dirección del inmueble", tipo: "text", requerido: true, placeholder: "Calle, número, piso/depto" },
      { id: "ciudad", label: "Ciudad", tipo: "text", requerido: true, placeholder: "Ej: Buenos Aires" },
      { id: "provincia", label: "Provincia", tipo: "text", requerido: true, placeholder: "Ej: CABA" },
      { id: "monto_mensual", label: "Monto mensual", tipo: "number", requerido: true, placeholder: "Ej: 450000" },
      { id: "duracion_meses", label: "Duración en meses", tipo: "number", requerido: true, placeholder: "Ej: 24" },
      { id: "fecha_inicio", label: "Fecha de inicio", tipo: "date", requerido: true },
      { id: "deposito", label: "Depósito en garantía", tipo: "text", requerido: false, placeholder: "Ej: 1 mes de alquiler" },
      { id: "ajuste", label: "Cláusula de ajuste", tipo: "text", requerido: false, placeholder: "Ej: IPC trimestral / ICL / otro" },
      { id: "servicios", label: "Servicios y expensas", tipo: "textarea", requerido: false, placeholder: "Indicar qué paga cada parte" },
      { id: "observaciones", label: "Observaciones adicionales", tipo: "textarea", requerido: false, placeholder: "Condiciones especiales" }
    ];
  }

  if (lower.includes("community") || lower.includes("freelance") || lower.includes("servicio") || lower.includes("diseño") || lower.includes("dev")) {
    return [
      { id: "cliente", label: "Cliente", tipo: "text", requerido: true, placeholder: "Nombre o razón social" },
      { id: "dni_cuit_cliente", label: "DNI / CUIT / CUIL del cliente", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIT 30-12345678-9" },
      { id: "domicilio_cliente", label: "Domicilio del cliente", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
      { id: "prestador", label: "Prestador / freelancer", tipo: "text", requerido: true, placeholder: "Nombre completo o marca" },
      { id: "dni_cuit_prestador", label: "DNI / CUIT / CUIL del prestador", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIT 20-12345678-3" },
      { id: "domicilio_prestador", label: "Domicilio del prestador", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
      { id: "servicio", label: "Servicio contratado", tipo: "textarea", requerido: true, placeholder: "Describir tareas incluidas" },
      { id: "honorarios", label: "Honorarios", tipo: "text", requerido: true, placeholder: "Monto y moneda" },
      { id: "plazo", label: "Plazo o duración", tipo: "text", requerido: true, placeholder: "Ej: mensual / 3 meses" },
      { id: "forma_pago", label: "Forma de pago", tipo: "text", requerido: false, placeholder: "Transferencia, MP, etc." },
      { id: "entregables", label: "Entregables", tipo: "textarea", requerido: false, placeholder: "Qué se entrega y cuándo" },
      { id: "confidencialidad", label: "Confidencialidad", tipo: "select", requerido: false, opciones: ["Sí", "No"] },
      { id: "observaciones", label: "Observaciones", tipo: "textarea", requerido: false }
    ];
  }

  return [
    { id: "parte_1", label: "Parte 1", tipo: "text", requerido: true, placeholder: "Nombre completo o razón social" },
    { id: "dni_cuit_parte_1", label: "DNI / CUIT / CUIL de la parte 1", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIT 30-12345678-9" },
    { id: "domicilio_parte_1", label: "Domicilio de la parte 1", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
    { id: "parte_2", label: "Parte 2", tipo: "text", requerido: true, placeholder: "Nombre completo o razón social" },
    { id: "dni_cuit_parte_2", label: "DNI / CUIT / CUIL de la parte 2", tipo: "text", requerido: true, placeholder: "Ej: DNI 12.345.678 / CUIT 30-12345678-9" },
    { id: "domicilio_parte_2", label: "Domicilio de la parte 2", tipo: "text", requerido: true, placeholder: "Calle, número, localidad y provincia" },
    { id: "objeto", label: "Objeto del documento", tipo: "textarea", requerido: true, placeholder: "Describir el motivo o acuerdo" },
    { id: "monto", label: "Monto / valor si corresponde", tipo: "text", requerido: false, placeholder: "Ej: $100.000" },
    { id: "plazo", label: "Plazo / fecha", tipo: "text", requerido: false, placeholder: "Ej: 30 días" },
    { id: "jurisdiccion", label: "Jurisdicción", tipo: "text", requerido: false, placeholder: "Ej: CABA / Provincia de Buenos Aires" },
    { id: "observaciones", label: "Observaciones", tipo: "textarea", requerido: false }
  ];
}

function documentoFallback(datos, metadata) {
  const titulo = metadata.titulo || datos.tipo || "Documento legal";
  const lines = [
    `# ${String(titulo).toUpperCase()}`,
    "",
    "Modelo orientativo generado por LegalAI Arg. No reemplaza asesoramiento legal profesional.",
    "",
    "## DATOS PRINCIPALES",
    ""
  ];

  for (const [k, v] of Object.entries(datos || {})) {
    if (v !== undefined && v !== null && String(v).trim() !== "") {
      lines.push(`- ${humanize(k)}: ${v}`);
    }
  }

  lines.push(
    "",
    "## CLÁUSULAS ORIENTATIVAS",
    "",
    "1. Las partes declaran que los datos consignados son correctos y suficientes para identificar el objeto del presente documento.",
    "2. Las obligaciones específicas serán cumplidas de buena fe, conforme la normativa aplicable y los usos habituales.",
    "3. Cualquier modificación deberá realizarse por escrito y con conformidad de las partes.",
    "4. Ante diferencias de interpretación, las partes procurarán una solución amistosa antes de iniciar reclamos formales.",
    "",
    "## FIRMA",
    "",
    "Firma parte 1: ________________________________",
    "",
    "Firma parte 2: ________________________________",
    "",
    "Fecha: ____ / ____ / ______"
  );

  return lines.join("\n");
}

function generarGuiaUso(datos, metadata) {
  const titulo = metadata.titulo || datos.tipo || "documento";
  return `# Guía de uso — ${titulo}

## Cómo usarlo
1. Revisá que todos los datos estén completos.
2. Corregí nombres, DNI/CUIT, domicilios, montos y fechas.
3. Imprimí una copia para cada parte.
4. Firmá todas las hojas.

## Recomendación
Este documento es orientativo. Para operaciones relevantes o conflictos, conviene revisión de un profesional matriculado.`;
}

/* =========================================================
   TRACKING ROUTES
   ========================================================= */

async function handleTrackingRoutes(request, env) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/track/ping") {
    return json(request, {
      ok: true,
      tracking_routes: true,
      kv_binding_exists: Boolean(env.OWNER_EVENTS_KV),
      time: new Date().toISOString()
    });
  }

  if (request.method === "POST" && url.pathname === "/track/batch") {
    const body = await readRequestBody(request);
    const events = Array.isArray(body.events) ? body.events : [];
    const saved = [];
    for (const event of events.slice(0, 50)) {
      saved.push(await safeAppendOwnerEvent(env, {
        type: event.type || event.tipo || "track",
        product: event.product || event.page || "LegalAI Web",
        category: "track",
        status: "pending",
        raw: event
      }));
    }
    return json(request, { ok: true, saved_count: saved.length });
  }

  return null;
}

/* =========================================================
   COMPATIBILIDAD AUDITORÍA DIARIA (/stats y /eventos)
   ========================================================= */

async function handleMetricsCompatibilityRoutes(request, env) {
  const url = new URL(request.url);
  if (!['/stats', '/eventos'].includes(url.pathname)) return null;

  if (!isOwnerAuthorized(request, env)) {
    return json(request, { ok: false, error: 'unauthorized', message: 'ADMIN_KEY ausente o incorrecta.' }, 401);
  }

  const events = filterOwnerEventsByDate(await readOwnerEvents(env), url);
  if (url.pathname === '/stats') return json(request, buildLegacyStatsPayload(events));
  if (url.pathname === '/eventos') return json(request, buildLegacyEventosPayload(events));
  return null;
}

/* =========================================================
   ADMIN AFILIADOS
   ========================================================= */

async function handleAdminAffiliateRoutes(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/admin/afiliado")) return null;

  if (!isOwnerAuthorized(request, env)) {
    return json(request, { ok: false, error: "unauthorized", message: "ADMIN_KEY ausente o incorrecta." }, 401);
  }

  if (!env.OWNER_EVENTS_KV) {
    return json(request, { ok: false, error: "missing_kv", message: "Falta vincular OWNER_EVENTS_KV." }, 500);
  }

  if (request.method === "GET" && url.pathname === "/admin/afiliado/lista") {
    return json(request, { ok: true, afiliados: await buildAffiliateList(env) });
  }

  if (request.method === "GET" && url.pathname === "/admin/afiliado/detalle") {
    const ref = normalizeRef(url.searchParams.get("ref"));
    if (!ref) return json(request, { ok: false, error: "missing_ref" }, 400);

    const afiliados = await readAffiliates(env);
    const afiliado = afiliados.find(a => normalizeRef(a.ref) === ref);
    if (!afiliado) return json(request, { ok: false, error: "affiliate_not_found" }, 404);

    const conversiones = (await readAffiliateConversions(env))
      .filter(c => normalizeRef(c.ref) === ref)
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    return json(request, { ok: true, afiliado, earnings: calcAffiliateEarnings(conversiones), conversiones });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/crear") {
    const body = await readRequestBody(request);
    const ref = normalizeRef(body.ref);
    const nombre = String(body.nombre || "").trim();
    const email = String(body.email || "").trim().toLowerCase();
    const commission_pct = Number(body.commission_pct ?? body.pct ?? 20);

    if (!ref || !nombre || !email) {
      return json(request, { ok: false, error: "missing_fields", message: "Faltan ref, nombre o email." }, 400);
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

    if (existingIndex >= 0) afiliados[existingIndex] = { ...afiliados[existingIndex], ...afiliado };
    else afiliados.unshift(afiliado);

    await writeAffiliates(env, afiliados);

    const dashboard_url = `https://legalai-arg.com/afiliado.html?ref=${encodeURIComponent(ref)}`;
    const link_afiliado = `https://legalai-arg.com/?ref=${encodeURIComponent(ref)}`;

    await safeAppendOwnerEvent(env, {
      type: "afiliado",
      product: "Alta / actualización de afiliado",
      category: "admin",
      status: "approved",
      customer: email,
      affiliate: ref,
      amount: 0,
      amount_ars: 0,
      currency: "ARS"
    });

    return json(request, { ok: true, afiliado, dashboard_url, link_afiliado });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/pagar") {
    const body = await readRequestBody(request);
    const ref = normalizeRef(body.ref);
    if (!ref) return json(request, { ok: false, error: "missing_ref" }, 400);

    const conversiones = await readAffiliateConversions(env);
    let count = 0, total = 0;
    const now = new Date().toISOString();

    const updated = conversiones.map(c => {
      if (normalizeRef(c.ref) !== ref) return c;
      const shouldPay = body.all_pending || (body.conversion_id && c.id === body.conversion_id);
      if (!shouldPay || c.paid) return c;
      count += 1;
      total += Number(c.commission || 0);
      return { ...c, paid: true, paid_at: now, updated_at: now };
    });

    await writeAffiliateConversions(env, updated);
    await safeAppendOwnerEvent(env, {
      type: "audit",
      product: "Pago de comisiones afiliado",
      category: "afiliados",
      status: "approved",
      affiliate: ref,
      amount: total,
      amount_ars: total,
      currency: "ARS"
    });

    return json(request, { ok: true, conversiones_pagadas: count, monto_total: total, comision_pagada: total });
  }

  if (request.method === "POST" && url.pathname === "/admin/afiliado/conversion") {
    const saved = await appendAffiliateConversion(env, await readRequestBody(request));
    return json(request, { ok: true, conversion: saved });
  }

  return json(request, { ok: false, error: "admin_affiliate_route_not_found", path: url.pathname }, 404);
}

/* =========================================================
   OWNER PANEL ROUTES
   ========================================================= */

async function handleOwnerRoutes(request, env) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/owner")) return null;

  if (url.pathname === "/owner/ping") {
    return json(request, {
      ok: true,
      worker: "alive",
      owner_routes: true,
      affiliate_admin_routes: true,
      product_routes: true,
      tracking_routes: true,
      configured_key_exists: Boolean(getConfiguredOwnerKey(env)),
      kv_binding_exists: Boolean(env.OWNER_EVENTS_KV),
      mp_configured: Boolean(env.MERCADOPAGO_ACCESS_TOKEN),
      compatibility: "LegalAI Full Worker",
      time: new Date().toISOString()
    });
  }

  if (!isOwnerAuthorized(request, env)) {
    return json(request, {
      ok: false,
      error: "unauthorized",
      message: "ADMIN_KEY ausente o incorrecta.",
      configured_key_exists: Boolean(getConfiguredOwnerKey(env)),
      received_key_exists: Boolean(getReceivedOwnerKey(request))
    }, 401);
  }

  if (request.method === "POST" && ["/owner/event", "/owner/track", "/owner/log"].includes(url.pathname)) {
    return json(request, { ok: true, saved: await safeAppendOwnerEvent(env, await readRequestBody(request)) });
  }

  if (url.pathname === "/owner/test-event") {
    return json(request, {
      ok: true,
      saved: await safeAppendOwnerEvent(env, {
        type: "test",
        product: "Evento de prueba Owner Panel",
        category: "debug",
        amount: 1000,
        currency: "ARS",
        amount_ars: 1000,
        payment_method: "manual",
        status: "approved",
        customer: "test@legalai-arg.com",
        affiliate: ""
      })
    });
  }

  if (url.pathname === "/owner/mp-sync") {
    return json(request, await syncMercadoPagoPayments(request, env));
  }

  const allEvents = await readOwnerEvents(env);
  const filteredEvents = filterOwnerEventsByDate(allEvents, url);
  const payload = await buildOwnerPayload(env, filteredEvents, Boolean(env.OWNER_EVENTS_KV));

  if (url.pathname === "/owner/dashboard" || url.pathname === "/owner/all") return json(request, payload);
  if (url.pathname === "/owner/operaciones") return json(request, payload.operaciones);
  if (url.pathname === "/owner/afiliados") return json(request, payload.afiliados);
  if (url.pathname === "/owner/comisiones") return json(request, payload.comisiones);
  if (url.pathname === "/owner/logs") return json(request, payload.logs);
  if (url.pathname === "/owner/emails") return json(request, payload.emails);
  if (url.pathname === "/owner/auditoria") return json(request, payload.auditoria);

  return json(request, { ok: false, error: "owner_route_not_found", path: url.pathname }, 404);
}


async function syncMercadoPagoPayments(request, env) {
  const url = new URL(request.url);
  if (!env.MERCADOPAGO_ACCESS_TOKEN) {
    await safeAppendOwnerEvent(env, {
      type: "error", category: "mercadopago", product: "Sincronización MercadoPago",
      status: "failed", error_flag: true, error_tipo: "missing_mp_token",
      error_detalle: "No se puede sincronizar MercadoPago porque falta MERCADOPAGO_ACCESS_TOKEN."
    });
    return { ok: false, error: "missing_mp_token" };
  }

  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || 45)));
  const end = new Date();
  const begin = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);
  const params = new URLSearchParams({
    sort: "date_created",
    criteria: "desc",
    range: "date_created",
    begin_date: begin.toISOString(),
    end_date: end.toISOString(),
    limit: "50"
  });

  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/search?${params.toString()}`, {
    headers: { "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` }
  });
  const data = await mpRes.json().catch(() => ({}));

  if (!mpRes.ok) {
    await safeAppendOwnerEvent(env, {
      type: "error", category: "mercadopago", product: "Error sincronizando MercadoPago",
      status: "failed", error_flag: true, error_tipo: "mp_sync_error",
      error_detalle: JSON.stringify(data).slice(0, 600), raw: data
    });
    return { ok: false, error: "mp_sync_error", detail: data };
  }

  const results = Array.isArray(data.results) ? data.results : [];
  let imported = 0;
  let skipped = 0;

  for (const mp of results) {
    if (!isLegalAiPayment(mp)) { skipped++; continue; }
    const paymentId = String(mp.id || "");
    if (!paymentId) { skipped++; continue; }
    const approved = String(mp.status || "").toLowerCase() === "approved";
    if (approved) await recordApprovedPaymentOnce(env, mp, "mp_sync");
    else await recordPaymentStatusEvent(env, mp, "mp_sync");
    imported++;
  }

  return { ok: true, days, found: results.length, imported, skipped };
}

function isLegalAiPayment(mp = {}) {
  const metadata = mp.metadata || {};
  const hayMetadata = Boolean(metadata.legalai_external_ref || metadata.legalai_tipo || metadata.legalai_ref);
  const ref = String(mp.external_reference || metadata.legalai_external_ref || "").toLowerCase();
  const desc = String(mp.description || "").toLowerCase();
  return hayMetadata || ref.startsWith("doc_sess_") || ref.startsWith("legalai_") || desc.includes("legalai") || desc.includes("contrato") || desc.includes("documento legal");
}

/* =========================================================
   STORAGE / AFFILIATES
   ========================================================= */

async function readAffiliates(env) { return await readJsonKV(env, AFFILIATES_KEY, []); }
async function writeAffiliates(env, afiliados) { return await writeJsonKV(env, AFFILIATES_KEY, afiliados); }
async function readAffiliateConversions(env) { return await readJsonKV(env, AFFILIATE_CONVERSIONS_KEY, []); }
async function writeAffiliateConversions(env, conversiones) { return await writeJsonKV(env, AFFILIATE_CONVERSIONS_KEY, conversiones.slice(0, 5000)); }

async function buildAffiliateList(env) {
  const afiliados = await readAffiliates(env);
  const conversiones = await readAffiliateConversions(env);

  return afiliados.map(a => {
    const ref = normalizeRef(a.ref);
    const convs = conversiones.filter(c => normalizeRef(c.ref) === ref);
    return { ...a, ref, active: a.active !== false, total_conv: convs.length, earnings: calcAffiliateEarnings(convs) };
  });
}

function calcAffiliateEarnings(conversiones) {
  const total = conversiones.reduce((s, c) => s + Number(c.commission || 0), 0);
  const paid = conversiones.filter(c => c.paid).reduce((s, c) => s + Number(c.commission || 0), 0);
  const pending = conversiones.filter(c => !c.paid).reduce((s, c) => s + Number(c.commission || 0), 0);
  return { total, paid, pending };
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

  const amount = Number(event.amount_ars || event.amount || 0);
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

async function recordApprovedPaymentOnce(env, mp, source = "unknown") {
  const paymentId = String(mp?.id || "").trim();
  if (!paymentId || String(mp?.status || "").toLowerCase() !== "approved" || !isLegalAiPayment(mp)) return null;

  const externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "").trim();
  const amountARS = Number(mp.transaction_amount || 0);
  return await safeAppendOwnerEvent(env, {
    id: `SALE-${paymentId}`,
    payment_id: paymentId,
    order_id: externalRef,
    type: "payment_approved",
    product: mp.description || mp.metadata?.titulo || mp.metadata?.legalai_tipo || "Documento LegalAI",
    category: "mercadopago",
    amount: amountARS,
    amount_ars: String(mp.currency_id || "ARS").toUpperCase() === "ARS" ? amountARS : 0,
    currency: mp.currency_id || "ARS",
    payment_method: "MercadoPago",
    status: "approved",
    customer: mp.payer?.email || mp.metadata?.email || "",
    affiliate: mp.metadata?.legalai_ref || mp.metadata?.ref || "",
    date: mp.date_approved || mp.date_last_updated || new Date().toISOString(),
    raw: {
      source,
      paymentId,
      externalRef,
      payment_status: mp.status || "approved",
      approved_at: mp.date_approved || "",
      preference_id: mp.preference_id || "",
      mp
    }
  });
}

async function recordPaymentStatusEvent(env, mp, source = "unknown") {
  const paymentId = String(mp?.id || "").trim();
  if (!paymentId || !isLegalAiPayment(mp)) return null;
  const status = String(mp.status || "pending").toLowerCase();
  const externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "").trim();
  return await safeAppendOwnerEvent(env, {
    id: `MP-STATUS-${paymentId}-${status}`,
    payment_id: paymentId,
    order_id: externalRef,
    type: "payment_status_updated",
    product: mp.description || mp.metadata?.legalai_tipo || "Documento LegalAI",
    category: "mercadopago",
    amount: Number(mp.transaction_amount || 0),
    amount_ars: String(mp.currency_id || "ARS").toUpperCase() === "ARS" ? Number(mp.transaction_amount || 0) : 0,
    currency: mp.currency_id || "ARS",
    payment_method: "MercadoPago",
    status,
    customer: mp.payer?.email || mp.metadata?.email || "",
    affiliate: mp.metadata?.legalai_ref || mp.metadata?.ref || "",
    date: mp.date_last_updated || new Date().toISOString(),
    raw: { source, paymentId, externalRef, mp }
  });
}

async function handlePdfBackupEmail(request, env) {
  let form;
  try {
    form = await request.formData();
  } catch (err) {
    return json(request, { ok: false, error: "invalid_multipart", message: "No se pudo leer el archivo PDF." }, 400);
  }

  const paymentId = String(form.get("paymentId") || form.get("payment_id") || "").trim();
  const requestedExternalRef = String(form.get("externalRef") || form.get("external_reference") || "").trim();
  const file = form.get("archivo");
  const clientDatos = parseJsonValue(form.get("datosDoc"), {});
  const clientMetadata = parseJsonValue(form.get("metadata"), {});

  if (!paymentId || !/^\d+$/.test(paymentId)) {
    return json(request, { ok: false, error: "missing_payment_id", message: "Falta un payment_id válido." }, 400);
  }
  if (!file || typeof file.arrayBuffer !== "function") {
    return json(request, { ok: false, error: "missing_pdf", message: "Falta adjuntar el PDF generado." }, 400);
  }
  if (file.size <= 0 || file.size > BACKUP_PDF_MAX_BYTES) {
    return json(request, { ok: false, error: "invalid_pdf_size", message: "El PDF está vacío o supera el límite permitido." }, 413);
  }
  if (String(file.type || "application/pdf").toLowerCase() !== "application/pdf") {
    return json(request, { ok: false, error: "invalid_file_type", message: "El archivo de respaldo debe ser PDF." }, 415);
  }

  const verified = await fetchMercadoPagoPayment(env, paymentId);
  if (!verified.ok) return json(request, { ok: false, error: verified.error, message: verified.message }, verified.status || 502);
  const mp = verified.payment;
  if (String(mp.status || "").toLowerCase() !== "approved") {
    return json(request, { ok: false, error: "payment_not_approved", message: "El pago no figura aprobado." }, 402);
  }
  if (!isLegalAiPayment(mp) || String(mp.metadata?.legalai_tipo || "doc").toLowerCase() !== "doc") {
    return json(request, { ok: false, error: "wrong_payment_type", message: "El pago no corresponde a un documento LegalAI." }, 403);
  }

  await recordApprovedPaymentOnce(env, mp, "backup_email_validation");

  const externalRef = String(mp.external_reference || mp.metadata?.legalai_external_ref || "").trim();
  if (requestedExternalRef && externalRef && requestedExternalRef !== externalRef) {
    return json(request, { ok: false, error: "external_reference_mismatch", message: "La referencia no coincide con el pago." }, 409);
  }

  const checkout = externalRef ? await readCheckout(env, externalRef) : null;
  const backupState = await readBackupEmailState(env, paymentId);
  const previousSent = backupState?.status === "sent" ? backupState : (checkout?.backup_email?.status === "sent" ? checkout.backup_email : null);
  if (previousSent) {
    return json(request, {
      ok: true,
      already_sent: true,
      resend_id: previousSent.resend_id || "",
      sent_at: previousSent.sent_at || ""
    });
  }

  const datosDoc = checkout?.datosDoc && Object.keys(checkout.datosDoc).length ? checkout.datosDoc : clientDatos;
  const metadata = checkout?.metadata && Object.keys(checkout.metadata).length ? checkout.metadata : clientMetadata;
  const title = metadata?.titulo || datosDoc?.tipo || mp.description || "Documento LegalAI";
  const buyerName = extractBuyerName(datosDoc) || mp.payer?.first_name || "Sin nombre identificado";
  const payerEmail = mp.payer?.email || datosDoc?.email || "";
  const approvedAt = mp.date_approved || mp.date_last_updated || new Date().toISOString();
  const safeFilename = sanitizePdfFilename(file.name || `${title}-${paymentId}.pdf`);

  await safeAppendOwnerEvent(env, {
    id: `BACKUP-REQUEST-${paymentId}`,
    payment_id: paymentId,
    order_id: externalRef,
    type: "backup_email_requested",
    product: title,
    category: "email_respaldo",
    status: "pending",
    customer: payerEmail,
    date: new Date().toISOString(),
    raw: { paymentId, externalRef, filename: safeFilename, bytes: file.size, buyerName }
  });

  if (!env.RESEND_API_KEY || !env.EMAIL_TO || !env.EMAIL_FROM) {
    const missing = [
      !env.RESEND_API_KEY ? "RESEND_API_KEY" : "",
      !env.EMAIL_TO ? "EMAIL_TO" : "",
      !env.EMAIL_FROM ? "EMAIL_FROM" : ""
    ].filter(Boolean).join(", ");
    await markBackupEmailFailure(env, checkout, externalRef, paymentId, title, payerEmail, "missing_email_config", `Falta configurar: ${missing}`);
    return json(request, { ok: false, error: "missing_email_config", message: `Falta configurar: ${missing}` }, 500);
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfBase64 = arrayBufferToBase64(arrayBuffer);
    const backupRecipients = String(env.EMAIL_TO || "").split(/[;,]/).map(v => v.trim()).filter(Boolean);
    if (!backupRecipients.length || !backupRecipients.every(isValidEmail)) {
      throw new Error("EMAIL_TO no contiene una casilla receptora válida.");
    }
    const resendPayload = {
      from: env.EMAIL_FROM,
      to: backupRecipients,
      subject: `[LegalAI respaldo] Pago ${paymentId} · ${title} · ${buyerName}`.slice(0, 240),
      html: buildBackupEmailHtml({ paymentId, externalRef, title, buyerName, payerEmail, approvedAt, datosDoc, metadata, filename: safeFilename }),
      attachments: [{ filename: safeFilename, content: pdfBase64 }],
      tags: [
        { name: "payment_id", value: paymentId.slice(0, 256) },
        { name: "email_type", value: "legalai_backup" }
      ]
    };

    let resendResponse = null;
    let resendData = {};
    let lastResendError = "";
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        resendResponse = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": `legalai-backup-${paymentId}`
          },
          body: JSON.stringify(resendPayload)
        });
        resendData = await resendResponse.json().catch(() => ({}));
        if (resendResponse.ok && resendData.id) break;
        lastResendError = resendData.message || resendData.error || `Resend HTTP ${resendResponse.status}`;
        if (resendResponse.status < 500 && resendResponse.status !== 429) break;
      } catch (err) {
        lastResendError = err?.message || String(err);
      }
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 350 * attempt));
    }
    if (!resendResponse?.ok || !resendData.id) {
      throw new Error(lastResendError || "Resend no aceptó el correo de respaldo.");
    }

    const sentAt = new Date().toISOString();
    const sentState = {
      status: "sent",
      sent_at: sentAt,
      resend_id: resendData.id,
      filename: safeFilename,
      bytes: file.size,
      to: env.EMAIL_TO
    };
    await writeBackupEmailState(env, paymentId, sentState);
    if (externalRef) {
      await writeCheckout(env, externalRef, {
        ...(checkout || {}),
        external_reference: externalRef,
        datosDoc,
        metadata,
        backup_email: sentState
      });
    }

    await safeAppendOwnerEvent(env, {
      id: `BACKUP-EMAIL-${paymentId}`,
      payment_id: paymentId,
      order_id: externalRef,
      type: "backup_email_sent",
      product: title,
      category: "email_respaldo",
      status: "approved",
      customer: payerEmail,
      date: sentAt,
      raw: { paymentId, externalRef, resend_id: resendData.id, filename: safeFilename, bytes: file.size, buyerName, to: env.EMAIL_TO }
    });

    return json(request, { ok: true, sent: true, resend_id: resendData.id, sent_at: sentAt });
  } catch (err) {
    await markBackupEmailFailure(env, checkout, externalRef, paymentId, title, payerEmail, "backup_email_send_error", err?.message || String(err));
    return json(request, { ok: false, error: "backup_email_send_error", message: err?.message || String(err) }, 502);
  }
}

async function markBackupEmailFailure(env, checkout, externalRef, paymentId, title, payerEmail, errorType, detail) {
  const failedAt = new Date().toISOString();
  const failedState = { status: "failed", failed_at: failedAt, error: detail };
  await writeBackupEmailState(env, paymentId, failedState);
  if (externalRef) {
    await writeCheckout(env, externalRef, {
      ...(checkout || {}),
      external_reference: externalRef,
      backup_email: failedState
    });
  }
  await safeAppendOwnerEvent(env, {
    id: `BACKUP-EMAIL-ERROR-${paymentId}`,
    payment_id: paymentId,
    order_id: externalRef,
    type: "backup_email_error",
    product: title,
    category: "email_respaldo",
    status: "failed",
    customer: payerEmail,
    date: failedAt,
    error_flag: true,
    error_tipo: errorType,
    error_detalle: detail,
    raw: { paymentId, externalRef, to: env.EMAIL_TO || "" }
  });
}

function parseJsonValue(value, fallback = {}) {
  if (typeof value !== "string" || !value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function extractBuyerName(datos = {}) {
  const preferredKeys = [
    "comprador", "inquilino", "locatario", "huesped", "cliente", "contratante",
    "parte_1", "socio_1", "deudor", "mutuario", "beneficiario", "titular",
    "nombre_completo", "nombre", "razon_social"
  ];
  for (const key of preferredKeys) {
    const value = datos?.[key];
    if (value !== undefined && value !== null && String(value).trim()) return String(value).trim();
  }
  for (const [key, value] of Object.entries(datos || {})) {
    if (/nombre|comprador|inquilin|locatari|cliente|huesped|parte_1|socio_1/i.test(key) && String(value || "").trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function sanitizePdfFilename(filename) {
  const clean = String(filename || "documento-legal.pdf")
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
  return clean.toLowerCase().endsWith(".pdf") ? clean : `${clean || "documento-legal"}.pdf`;
}

function buildBackupEmailHtml({ paymentId, externalRef, title, buyerName, payerEmail, approvedAt, datosDoc, metadata, filename }) {
  const rows = Object.entries(datosDoc || {}).map(([key, value]) => {
    const displayed = typeof value === "object" ? JSON.stringify(value) : String(value ?? "");
    return `<tr><td style="padding:6px 8px;border:1px solid #ddd;font-weight:600;vertical-align:top">${escapeHtml(humanize(key))}</td><td style="padding:6px 8px;border:1px solid #ddd;white-space:pre-wrap">${escapeHtml(displayed)}</td></tr>`;
  }).join("");
  return `
    <div style="font-family:Arial,sans-serif;color:#222;line-height:1.5">
      <h2 style="margin:0 0 14px">Respaldo automático LegalAI Arg</h2>
      <p><strong>Pago Mercado Pago:</strong> ${escapeHtml(paymentId)}</p>
      <p><strong>Referencia:</strong> ${escapeHtml(externalRef || "—")}</p>
      <p><strong>Estado validado:</strong> approved</p>
      <p><strong>Fecha de aprobación:</strong> ${escapeHtml(approvedAt || "—")}</p>
      <p><strong>Documento:</strong> ${escapeHtml(title)}</p>
      <p><strong>Comprador / parte identificada:</strong> ${escapeHtml(buyerName || "—")}</p>
      <p><strong>Email informado por Mercado Pago:</strong> ${escapeHtml(payerEmail || "—")}</p>
      <p><strong>Archivo adjunto:</strong> ${escapeHtml(filename)}</p>
      <h3 style="margin-top:22px">Datos ingresados en el formulario</h3>
      <table style="border-collapse:collapse;width:100%;font-size:13px">${rows || '<tr><td style="padding:8px;border:1px solid #ddd">Sin datos recuperables</td></tr>'}</table>
      <p style="margin-top:18px;color:#666;font-size:12px">Metadata: ${escapeHtml(JSON.stringify(metadata || {}))}</p>
    </div>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function fetchMercadoPagoPayment(env, paymentId) {
  if (!paymentId) return { ok: false, error: "missing_payment_id", message: "Falta payment_id.", status: 400 };
  if (!env.MERCADOPAGO_ACCESS_TOKEN) return { ok: false, error: "missing_mp_token", message: "Falta configurar MercadoPago.", status: 500 };
  try {
    const res = await fetch(`https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`, {
      headers: { "Authorization": `Bearer ${env.MERCADOPAGO_ACCESS_TOKEN}` }
    });
    const payment = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, error: "mp_payment_lookup_error", message: payment.message || "No se pudo verificar el pago en MercadoPago.", status: 502 };
    return { ok: true, payment };
  } catch (err) {
    return { ok: false, error: "mp_payment_lookup_exception", message: err?.message || String(err), status: 502 };
  }
}

function checkoutKV(env) { return env.PAGOS_KV || env.OWNER_EVENTS_KV || null; }
async function readCheckout(env, externalRef) {
  const kv = checkoutKV(env);
  if (!kv || !externalRef) return null;
  try {
    const txt = await kv.get(`${CHECKOUTS_KEY}:${externalRef}`);
    if (!txt) return null;
    return JSON.parse(txt);
  } catch { return null; }
}
async function writeCheckout(env, externalRef, value) {
  const kv = checkoutKV(env);
  if (!kv || !externalRef) return false;
  try {
    await kv.put(`${CHECKOUTS_KEY}:${externalRef}`, JSON.stringify(value), { expirationTtl: CHECKOUT_TTL_SECONDS });
    return true;
  } catch { return false; }
}
async function readBackupEmailState(env, paymentId) {
  const kv = checkoutKV(env);
  if (!kv || !paymentId) return null;
  try {
    const txt = await kv.get(`backup_email:${paymentId}`);
    return txt ? JSON.parse(txt) : null;
  } catch { return null; }
}
async function writeBackupEmailState(env, paymentId, value) {
  const kv = checkoutKV(env);
  if (!kv || !paymentId) return false;
  try {
    await kv.put(`backup_email:${paymentId}`, JSON.stringify(value), { expirationTtl: BACKUP_EMAIL_TTL_SECONDS });
    return true;
  } catch { return false; }
}

async function readOwnerEvents(env) { return await readJsonKV(env, OWNER_EVENTS_KEY, []); }
async function writeOwnerEvents(env, events) { await writeJsonKV(env, OWNER_EVENTS_KEY, events.slice(0, 5000)); }
async function readPreview(env, id) { return await readJsonKV(env, `${PREVIEWS_KEY}:${id}`, null); }
async function writePreview(env, id, value) { await writeJsonKV(env, `${PREVIEWS_KEY}:${id}`, value); }
async function readPack(env, code) { return await readJsonKV(env, `${PACKS_KEY}:${code}`, null); }
async function writePack(env, code, value) { await writeJsonKV(env, `${PACKS_KEY}:${code}`, value); }

async function safeAppendOwnerEvent(env, event) {
  try { return await appendOwnerEvent(env, event); }
  catch (_) { return normalizeOwnerEvent(event); }
}

async function appendOwnerEvent(env, event) {
  const normalized = normalizeOwnerEvent(event);

  if (!env.OWNER_EVENTS_KV) return { ...normalized, warning: "OWNER_EVENTS_KV no está vinculado. El evento no queda persistido." };

  const current = await readOwnerEvents(env);
  const exists = current.some(e => String(e.id) === String(normalized.id) && e.type === normalized.type);
  if (!exists) {
    current.unshift(normalized);
    await writeOwnerEvents(env, current);
    await maybeCreateAffiliateConversionFromOwnerEvent(env, normalized);
  }

  return normalized;
}

async function readJsonKV(env, key, fallback) {
  if (!env.OWNER_EVENTS_KV) return fallback;
  const txt = await env.OWNER_EVENTS_KV.get(key);
  if (!txt) return fallback;
  try { return JSON.parse(txt); } catch { return fallback; }
}

async function writeJsonKV(env, key, value) {
  if (!env.OWNER_EVENTS_KV) return;
  await env.OWNER_EVENTS_KV.put(key, JSON.stringify(value));
}

/* =========================================================
   PAYLOAD OWNER
   ========================================================= */

async function buildOwnerPayload(env, events, hasKv) {
  const operaciones = events;
  const checkoutById = new Map();
  for (const ev of operaciones) {
    if (String(ev.type || "").toLowerCase() === "checkout_start") {
      checkoutById.set(String(ev.id), ev);
      const externalRef = ev.raw?.externalRef || ev.raw?.raw?.externalRef;
      if (externalRef) checkoutById.set(String(externalRef), ev);
    }
  }
  const afiliadosMap = new Map();
  const comisiones = [];
  const logs = [];
  const emails = [];
  const auditoria = [];

  const afiliadosReales = await readAffiliates(env);
  for (const a of afiliadosReales) {
    afiliadosMap.set(normalizeRef(a.ref), {
      codigo: normalizeRef(a.ref),
      nombre: a.nombre || normalizeRef(a.ref),
      email: a.email || "",
      estado: a.active === false ? "Inactivo" : "Activo",
      porcentaje: Number(a.commission_pct || 20),
      clientes_referidos: 0,
      total_ars: 0,
      total_usdt: 0,
      pendiente_ars: 0,
      fecha_alta: a.created_at || ""
    });
  }

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
      if (event.customer) affiliate.clientes_referidos += 1;

      if (event.commission_amount) {
        if (event.commission_currency === "ARS" || event.currency === "ARS") affiliate.total_ars += Number(event.commission_amount || 0);
        if (["USD", "USDT"].includes(event.commission_currency || event.currency)) affiliate.total_usdt += Number(event.commission_amount || 0);
        if (["pending", "pendiente", "pending_payment", ""].includes(String(event.commission_status || "").toLowerCase())) {
          if (event.commission_currency === "ARS" || event.currency === "ARS") affiliate.pendiente_ars += Number(event.commission_amount || 0);
        }
      }
    }

    if (event.commission_amount) {
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

    if (isErrorOwnerEvent(event)) {
      logs.push({
        id: `ERR-${event.id}`,
        fecha: event.date,
        tipo: event.error_tipo || event.type || "error",
        detalle: event.error_detalle || event.raw?.reclamo_motivo || event.raw?.raw?.reclamo_motivo || event.product || "Evento con error",
        resuelto: false,
        raw: event.raw || event
      });
    }

    if (event.type === "email" || String(event.type || "").startsWith("backup_email_")) {
      emails.push({ id: `EMAIL-${event.id}`, fecha: event.date, para: event.raw?.to || event.customer, asunto: event.product, estado: event.status, resend: event.raw?.resend_id || "" });
    }

    if (event.type === "audit" || event.type === "auditoria") {
      auditoria.push({ id: `AUD-${event.id}`, fecha: event.date, accion: event.product, detalle: event.error_detalle || "", ref: event.raw?.ref || "" });
    }
  }

  const confirmedSales = dedupeConfirmedSalesOwnerEvents(operaciones.filter(isConfirmedSaleOwnerEvent));
  const facturacion_ars = confirmedSales.reduce((sum, event) => sum + getOwnerEventAmountARS(event, checkoutById), 0);
  const ventas_confirmadas = confirmedSales.length;

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

function buildLegacyStatsPayload(events = []) {
  const checkoutById = new Map();
  for (const ev of events) {
    if (String(ev.type || '').toLowerCase() === 'checkout_start') {
      for (const key of getOwnerSaleKeys(ev)) checkoutById.set(String(key), ev);
    }
  }

  const ventas = dedupeConfirmedSalesOwnerEvents(events.filter(isConfirmedSaleOwnerEvent));
  const total_clics = events.filter(isMeaningfulOwnerClickEvent).length;
  const total_visitas = events.filter(isOwnerVisitEvent).length;
  const total_ventas = ventas.length;
  const total_ars = ventas.reduce((sum, ev) => sum + getOwnerEventAmountARS(ev, checkoutById), 0);
  const por_fuente = {};
  const docs = new Map();

  for (const ev of events) {
    const fuente = getOwnerEventSource(ev);
    if (!por_fuente[fuente]) por_fuente[fuente] = { visitas: 0, clics: 0, ventas: 0, total_ars: 0 };
    if (isOwnerVisitEvent(ev)) por_fuente[fuente].visitas += 1;
    if (isMeaningfulOwnerClickEvent(ev)) por_fuente[fuente].clics += 1;

    const doc = ev.product || ev.raw?.doc_tipo || ev.raw?.pagina || 'LegalAI';
    if (!docs.has(doc)) docs.set(doc, { documento: doc, eventos: 0, ventas: 0, total_ars: 0 });
    docs.get(doc).eventos += 1;
  }

  for (const ev of ventas) {
    const fuente = getOwnerEventSource(ev);
    if (!por_fuente[fuente]) por_fuente[fuente] = { visitas: 0, clics: 0, ventas: 0, total_ars: 0 };
    por_fuente[fuente].ventas += 1;
    por_fuente[fuente].total_ars += getOwnerEventAmountARS(ev, checkoutById);

    const doc = ev.product || ev.raw?.doc_tipo || ev.raw?.pagina || 'LegalAI';
    if (!docs.has(doc)) docs.set(doc, { documento: doc, eventos: 0, ventas: 0, total_ars: 0 });
    docs.get(doc).ventas += 1;
    docs.get(doc).total_ars += getOwnerEventAmountARS(ev, checkoutById);
  }

  return {
    ok: true,
    source: 'OWNER_EVENTS_KV_COMPAT',
    generated_at: new Date().toISOString(),
    resumen: { total_clics, total_visitas, total_ventas, total_ars, total_eventos: events.length },
    por_fuente,
    top_documentos: Array.from(docs.values()).sort((a, b) => b.ventas - a.ventas || b.eventos - a.eventos).slice(0, 10),
    ultimas_conversiones: ventas.slice(0, 5)
  };
}

function buildLegacyEventosPayload(events = []) {
  const por_tipo = {};
  for (const ev of events) {
    const t = String(ev.type || ev.tipo || ev.raw?.tipo || ev.raw?.event || 'sin_tipo').toLowerCase();
    por_tipo[t] = (por_tipo[t] || 0) + 1;
  }

  const ventas = dedupeConfirmedSalesOwnerEvents(events.filter(isConfirmedSaleOwnerEvent)).length;
  const funnel_doc = buildLegacyFunnel([
    { label: 'Visitas', count: events.filter(isOwnerVisitEvent).length },
    { label: 'Interacciones/CTA', count: events.filter(isMeaningfulOwnerClickEvent).length },
    { label: 'Inicio formulario', count: events.filter(ev => ['form_start', 'inicio_formulario', 'click_generar', 'cta_generar', 'form_fields_generated'].includes(String(ev.type || '').toLowerCase())).length },
    { label: 'Pago iniciado', count: events.filter(ev => ['click_pagar', 'inicio_pago', 'checkout_start'].includes(String(ev.type || '').toLowerCase())).length },
    { label: 'Venta confirmada', count: ventas }
  ]);

  const funnel_plan = buildLegacyFunnel([
    { label: 'Visitas planes', count: events.filter(ev => String(ev.product || '').toLowerCase().includes('planes') || ev.raw?.pagina === 'planes').length },
    { label: 'Click plan', count: events.filter(ev => String(ev.type || '').toLowerCase().includes('plan') || String(ev.product || '').toLowerCase().includes('plan')).length },
    { label: 'Pago plan iniciado', count: events.filter(ev => String(ev.type || '').toLowerCase() === 'checkout_start' && String(ev.product || '').toLowerCase().includes('plan')).length },
    { label: 'Plan activo', count: events.filter(ev => ['plan_activated', 'pack_created'].includes(String(ev.type || '').toLowerCase()) && ['approved', 'active'].includes(String(ev.status || '').toLowerCase())).length }
  ]);

  return {
    ok: true,
    source: 'OWNER_EVENTS_KV_COMPAT',
    generated_at: new Date().toISOString(),
    total: events.length,
    por_tipo,
    funnel_doc,
    funnel_plan,
    cuello_botella: detectLegacyBottleneck({ doc: funnel_doc, planes: funnel_plan })
  };
}

function getOwnerEventSource(ev = {}) {
  return String(ev.affiliate_source || ev.raw?.utm_src || ev.raw?.utm_source || ev.affiliate || ev.raw?.ref || 'directo') || 'directo';
}

function isOwnerVisitEvent(ev = {}) {
  const t = String(ev.type || ev.tipo || ev.raw?.tipo || ev.raw?.event || '').toLowerCase();
  return t === 'page_view' || t === 'form_page_view' || t.endsWith('page_view');
}

function isMeaningfulOwnerClickEvent(ev = {}) {
  const t = String(ev.type || ev.tipo || ev.raw?.tipo || ev.raw?.event || '').toLowerCase();
  return Boolean(
    t.includes('click') ||
    t.startsWith('cta_') ||
    t.startsWith('nav_') ||
    ['interaccion', 'form_start', 'inicio_formulario', 'inicio_pago', 'checkout_start', 'preview_action', 'cta_generar', 'cta_formulario', 'cta_planes', 'cta_contrato_alquiler'].includes(t)
  );
}

function buildLegacyFunnel(steps) {
  let prev = null;
  return steps.map(step => {
    const drop_pct = prev === null || !prev || step.count >= prev ? 0 : Math.round(((prev - step.count) / prev) * 100);
    prev = step.count;
    return { ...step, drop_pct };
  });
}

function detectLegacyBottleneck(funnels = {}) {
  let worst = null;
  for (const [name, funnel] of Object.entries(funnels)) {
    for (const step of funnel || []) {
      if (step.drop_pct > 50 && (!worst || step.drop_pct > worst.drop_pct)) {
        worst = { funnel: name, etapa: step.label, drop_pct: step.drop_pct, count: step.count };
      }
    }
  }
  return worst;
}

/* =========================================================
   NORMALIZATION / AUTH / HELPERS
   ========================================================= */

function normalizeOwnerEvent(input = {}) {
  const now = new Date().toISOString();

  const statusRaw = String(input.status || input.estado || input.payment_status || "").toLowerCase();
  let status = statusRaw || "pending";

  if (["approved", "aprobado", "confirmada", "confirmado", "paid", "pagado", "ok"].includes(statusRaw)) status = "approved";
  if (["active", "activo"].includes(statusRaw)) status = "active";
  if (["pending", "pendiente", "in_process", "en_proceso", ""].includes(statusRaw)) status = statusRaw ? "pending" : "pending";
  if (["rejected", "rechazado", "failed", "error", "fallida"].includes(statusRaw)) status = "failed";
  if (["refunded", "reintegrado", "reembolsado", "devuelto", "cancelled", "cancelado"].includes(statusRaw)) status = "refunded";

  return {
    id: String(input.id || input.event_id || input.payment_id || input.paymentId || input.order_id || crypto.randomUUID()),
    date: input.date || input.fecha || input.created_at || input.createdAt || now,
    type: input.type || input.tipo || input.event || input.event_type || "operacion",
    product: input.product || input.producto || input.formulario || input.document_type || input.doc_tipo || input.descripcion || "",
    category: input.category || input.categoria || input.subtipo || "",
    amount: Number(input.amount ?? input.monto ?? input.total ?? input.price ?? 0),
    currency: input.currency || input.moneda || "ARS",
    amount_ars: Number(input.amount_ars ?? input.monto_ars ?? input.amountARS ?? input.montoARS ?? input.monto ?? input.total ?? 0),
    payment_method: input.payment_method || input.metodo_pago || input.gateway || input.provider || "",
    payment_id: input.payment_id || input.paymentId || input.mp_payment_id || input.mercadopago_payment_id || "",
    order_id: input.order_id || input.external_reference || input.externalRef || "",
    status,
    customer: input.customer || input.email || input.customer_email || input.cliente || "",
    affiliate: normalizeRef(input.affiliate || input.afiliado || input.ref || input.affiliate_ref || input.afiliado_ref || ""),
    affiliate_source: input.affiliate_source || input.fuente || input.utm_source || "",
    commission_amount: Number(input.commission_amount ?? input.comision_monto ?? 0),
    commission_currency: input.commission_currency || input.comision_moneda || "",
    commission_status: input.commission_status || input.comision_estado || "",
    plan_name: input.plan_name || input.plan || "",
    active_code: Boolean(input.active_code || input.codigo_activo || input.codigo),
    error_flag: Boolean(input.error_flag || input.error || input.type === "error" || input.tipo === "error"),
    error_tipo: input.error_tipo || input.error_type || "",
    error_detalle: input.error_detalle || input.error_detail || input.message || "",
    raw: input.raw && Object.keys(input).length < 5 ? input.raw : input
  };
}



function getOwnerSaleKeys(event = {}) {
  const raw = event.raw || {};
  const inner = raw.raw || {};
  return [
    event.order_id, event.payment_id, event.id,
    String(event.id || "").replace(/^MP-/, ""),
    raw.order_id, raw.payment_id, raw.paymentId, raw.externalRef, raw.external_reference,
    inner.order_id, inner.payment_id, inner.paymentId, inner.externalRef, inner.external_reference
  ].filter(Boolean).map(String);
}

function dedupeConfirmedSalesOwnerEvents(events = []) {
  const seen = new Set();
  const out = [];
  for (const event of events) {
    const keys = getOwnerSaleKeys(event);
    if (keys.some(k => seen.has(k))) continue;
    out.push(event);
    for (const key of keys) seen.add(key);
  }
  return out;
}

function isConfirmedSaleOwnerEvent(event = {}) {
  const type = String(event.type || "").toLowerCase();
  const status = String(event.status || "").toLowerCase();
  const saleTypes = new Set(["venta", "sale", "payment_approved", "plan_activated", "pack_created"]);
  return saleTypes.has(type) && ["approved", "active", "paid", "success", "ok"].includes(status);
}

function getOwnerEventAmountARS(event = {}, checkoutById = new Map()) {
  const direct = Number(event.amount_ars || 0);
  if (direct > 0) return direct;
  const currency = String(event.currency || "").toUpperCase();
  const amount = Number(event.amount || 0);
  if (currency === "ARS" && amount > 0) return amount;

  const possibleKeys = [
    event.id,
    event.payment_id,
    event.order_id,
    event.raw?.payment_id,
    event.raw?.paymentId,
    event.raw?.externalRef,
    event.raw?.external_reference,
    event.raw?.externalRef,
    event.raw?.raw?.payment_id,
    event.raw?.raw?.externalRef,
    event.raw?.raw?.external_reference,
    event.raw?.raw?.externalRef
  ].filter(Boolean).map(String);

  for (const key of possibleKeys) {
    const related = checkoutById.get(key);
    if (related) {
      return Number(related.amount_ars || (String(related.currency || "").toUpperCase() === "ARS" ? related.amount : 0) || 0);
    }
  }

  return 0;
}

function isErrorOwnerEvent(event = {}) {
  const type = String(event.type || "").toLowerCase();
  const status = String(event.status || "").toLowerCase();
  return Boolean(
    event.error_flag ||
    ["failed", "error", "rejected"].includes(status) ||
    type === "error" ||
    type.includes("error") ||
    event.raw?.error ||
    event.raw?.raw?.error ||
    event.raw?.reclamo ||
    event.raw?.raw?.reclamo
  );
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

function normalizeRef(ref) {
  return String(ref || "").trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "");
}

function getConfiguredOwnerKey(env) {
  return env.ADMIN_KEY || env.OWNER_ADMIN_KEY || env.OWNER_KEY || env.LEGALAI_ADMIN_KEY || env.ADMIN_OWNER_KEY || "";
}

function getReceivedOwnerKey(request) {
  const url = new URL(request.url);
  const queryKey = url.searchParams.get("admin_key") || "";
  const headerKey = request.headers.get("X-Admin-Key") || request.headers.get("x-admin-key") || "";
  const bearerKey = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return queryKey || headerKey || bearerKey || "";
}

function isOwnerAuthorized(request, env) {
  const configured = getConfiguredOwnerKey(env);
  const received = getReceivedOwnerKey(request);
  return Boolean(configured && received && received === configured);
}

async function readRequestBody(request) {
  try {
    const text = await request.text();
    if (!text) return {};
    try { return JSON.parse(text); }
    catch { return Object.fromEntries(new URLSearchParams(text)); }
  } catch { return {}; }
}

function corsHeaders(request) {
  const origin = request.headers.get("Origin") || "";
  const allowOrigin = OWNER_ALLOWED_ORIGINS.has(origin) ? origin : "https://legalai-arg.com";

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

function parseJsonLoose(txt) {
  const raw = String(txt || "").trim().replace(/^```json/i, "").replace(/^```/i, "").replace(/```$/i, "").trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]); } catch {}
  }
  return null;
}

function safeMetadata(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined || v === null) continue;
    const key = String(k).slice(0, 40);
    const val = typeof v === "object" ? JSON.stringify(v).slice(0, 500) : String(v).slice(0, 500);
    out[key] = val;
  }
  return out;
}

function humanize(k) {
  return String(k).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function toTitle(str) {
  return String(str || "").trim().replace(/\b\w/g, c => c.toUpperCase());
}
