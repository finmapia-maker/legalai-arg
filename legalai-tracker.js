(() => {
  "use strict";

  const WORKER_URL = "https://legalai-worker.finmap-ia.workers.dev";
  const STORAGE_SESSION = "legalai_session_id";
  const STORAGE_REF = "legalai_ref";
  const STORAGE_ATTR = "legalai_attribution";

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getSessionId() {
    let id = sessionStorage.getItem(STORAGE_SESSION) || localStorage.getItem(STORAGE_SESSION);
    if (!id) {
      id = uuid();
      sessionStorage.setItem(STORAGE_SESSION, id);
      localStorage.setItem(STORAGE_SESSION, id);
    }
    return id;
  }

  function params() {
    return new URLSearchParams(location.search);
  }

  function persistAttribution() {
    const p = params();
    const current = readAttribution();

    const ref = p.get("ref") || p.get("afiliado") || p.get("affiliate") || current.ref || "";
    if (ref) localStorage.setItem(STORAGE_REF, ref.toUpperCase());

    const next = {
      ref: ref ? ref.toUpperCase() : (localStorage.getItem(STORAGE_REF) || ""),
      utm_source: p.get("utm_source") || current.utm_source || "",
      utm_medium: p.get("utm_medium") || current.utm_medium || "",
      utm_campaign: p.get("utm_campaign") || current.utm_campaign || "",
      utm_content: p.get("utm_content") || current.utm_content || "",
      utm_term: p.get("utm_term") || current.utm_term || "",
      gclid: p.get("gclid") || current.gclid || "",
      fbclid: p.get("fbclid") || current.fbclid || "",
      msclkid: p.get("msclkid") || current.msclkid || "",
      first_landing: current.first_landing || location.pathname + location.search + location.hash,
      last_landing: location.pathname + location.search + location.hash,
      updated_at: new Date().toISOString()
    };

    localStorage.setItem(STORAGE_ATTR, JSON.stringify(next));
  }

  function readAttribution() {
    try { return JSON.parse(localStorage.getItem(STORAGE_ATTR) || "{}"); } catch { return {}; }
  }

  function getAttribution() {
    const a = readAttribution();
    return {
      ref: a.ref || localStorage.getItem(STORAGE_REF) || "directo",
      utm_source: a.utm_source || "",
      utm_medium: a.utm_medium || "",
      utm_campaign: a.utm_campaign || "",
      utm_content: a.utm_content || "",
      utm_term: a.utm_term || "",
      gclid: a.gclid || "",
      fbclid: a.fbclid || "",
      msclkid: a.msclkid || "",
      first_landing: a.first_landing || "",
      last_landing: a.last_landing || ""
    };
  }

  function getDocParam() {
    const p = params();
    return (p.get("doc") || p.get("documento") || p.get("tipo") || "").trim();
  }

  function inferPageGroup() {
    const path = location.pathname.toLowerCase();
    const hash = location.hash.toLowerCase();
    const doc = getDocParam();

    if (path.includes("contrato-alquiler")) return "contrato_alquiler_landing";
    if (path.includes("planes")) return "planes";
    if (path.includes("gracias")) return "gracias";
    if (path.includes("afiliado")) return "afiliados";
    if (path.includes("admin") || path.includes("owner") || path.includes("auditoria")) return "admin";
    if (path === "/" || path.includes("index")) {
      if (hash.includes("generador") || doc) return "generador_unificado";
      if (hash.includes("afiliados")) return "afiliados";
      if (hash.includes("about")) return "acerca_de";
      return "inicio";
    }
    return "otro";
  }

  function basePayload(tipo, data = {}) {
    const attr = getAttribution();
    const page_group = inferPageGroup();
    const doc_param = getDocParam();
    return {
      tipo,
      event: tipo,
      session_id: getSessionId(),
      anonymous_id: getSessionId(),
      page_group,
      pagina: page_group,
      path: location.pathname,
      url: location.href,
      title: document.title,
      doc_param,
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      device: /mobile|android|iphone|ipad/i.test(navigator.userAgent) ? "Mobile" : "Desktop",
      date: new Date().toISOString(),
      ...attr,
      ...data
    };
  }

  function send(tipo, data = {}) {
    const payload = basePayload(tipo, data);
    try {
      const body = JSON.stringify(payload);
      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json;charset=UTF-8" });
        if (navigator.sendBeacon(`${WORKER_URL}/evento`, blob)) return;
      }
      fetch(`${WORKER_URL}/evento`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        credentials: "omit"
      }).catch(() => {});
    } catch {}
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || el?.value || "").trim().replace(/\s+/g, " ").slice(0, 180);
  }

  function hrefOf(el) {
    return el?.href || el?.closest?.("a")?.href || "";
  }

  function classifyClick(el) {
    const txt = textOf(el).toLowerCase();
    const href = hrefOf(el).toLowerCase();
    const id = (el?.id || "").toLowerCase();
    const onclick = (el?.getAttribute?.("onclick") || "").toLowerCase();

    if (id.includes("btnpagar") || txt.includes("mercadopago") || txt.includes("pagar")) return "click_pagar";
    if (txt.includes("vista previa") || txt.includes("preview") || txt.includes("desbloquear")) return "preview_action";
    if (href.includes("planes") || txt.includes("plan ilimitado")) return "cta_planes";
    if (href.includes("contrato-alquiler")) return "cta_contrato_alquiler";
    if (href.includes("#generador") || href.includes("doc=") || onclick.includes("selectdocinline") || txt.includes("generar") || txt.includes("crear")) return "cta_generador";
    if (href.includes("afiliados") || href.includes("#aff-form") || txt.includes("afiliado")) return "cta_afiliados";
    if (txt.includes("descargar")) return "document_download_click";
    return "click";
  }

  function installClickTracking() {
    document.addEventListener("click", (ev) => {
      const target = ev.target.closest("a,button,[role='button'],input[type='button'],input[type='submit']");
      if (!target) return;
      send(classifyClick(target), {
        button_id: target.id || "",
        button_text: textOf(target),
        href: hrefOf(target),
        onclick: target.getAttribute?.("onclick") || ""
      });
    }, true);
  }

  function installFormStartTracking() {
    let sent = false;
    document.addEventListener("input", (ev) => {
      if (sent) return;
      if (!ev.target.matches("input,select,textarea")) return;
      sent = true;
      send("form_start", {
        form_id: ev.target.closest("form")?.id || "",
        field_id: ev.target.id || "",
        field_name: ev.target.name || "",
        page_group: inferPageGroup()
      });
    }, true);
  }

  function installScrollTracking() {
    const marks = {25:false,50:false,75:false};
    window.addEventListener("scroll", () => {
      const total = Math.max(1, document.body.scrollHeight - window.innerHeight);
      const pct = Math.round((window.scrollY / total) * 100);
      [25,50,75].forEach(m => {
        if (!marks[m] && pct >= m) {
          marks[m] = true;
          send(`scroll_${m}pct`, { page_group: inferPageGroup() });
        }
      });
    }, { passive: true });
  }

  function autoPageEvents() {
    const page_group = inferPageGroup();
    send("page_view", { page_group });
    if (page_group === "contrato_alquiler_landing") send("ads_landing_view", { page_group });
    if (page_group === "generador_unificado") send("generator_view", { page_group, doc_param: getDocParam() });
    if (page_group === "planes") send("plans_view", { page_group });
    if (page_group === "gracias") {
      send("payment_success_page_view", { page_group });
      send("document_ready_page_view", { page_group });
    }
  }

  persistAttribution();
  window.legalaiTrack = send;
  window.legalaiSessionId = getSessionId;
  window.legalaiAttribution = getAttribution;

  const boot = () => {
    autoPageEvents();
    installClickTracking();
    installFormStartTracking();
    installScrollTracking();
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
