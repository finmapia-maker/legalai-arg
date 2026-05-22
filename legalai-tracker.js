(() => {
  "use strict";

  const WORKER_URL = "https://legalai-worker.finmap-ia.workers.dev";
  const STORAGE_SESSION = "legalai_session_id";
  const STORAGE_REF = "legalai_ref";
  const STORAGE_UTM = "legalai_utm";

  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return "sess_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function getSessionId() {
    let id = localStorage.getItem(STORAGE_SESSION);
    if (!id) {
      id = uuid();
      localStorage.setItem(STORAGE_SESSION, id);
    }
    return id;
  }

  function params() {
    return new URLSearchParams(location.search);
  }

  function persistAttribution() {
    const p = params();

    const ref = p.get("ref") || p.get("afiliado") || p.get("affiliate");
    if (ref) localStorage.setItem(STORAGE_REF, ref);

    const utm = {
      utm_source: p.get("utm_source") || "",
      utm_medium: p.get("utm_medium") || "",
      utm_campaign: p.get("utm_campaign") || "",
      utm_content: p.get("utm_content") || "",
      utm_term: p.get("utm_term") || ""
    };

    if (Object.values(utm).some(Boolean)) {
      localStorage.setItem(STORAGE_UTM, JSON.stringify(utm));
    }
  }

  function getAttribution() {
    let utm = {};
    try { utm = JSON.parse(localStorage.getItem(STORAGE_UTM) || "{}"); } catch {}
    return {
      ref: localStorage.getItem(STORAGE_REF) || "",
      ...utm
    };
  }

  function basePayload(event, data = {}) {
    return {
      event,
      session_id: getSessionId(),
      anonymous_id: getSessionId(),
      path: location.pathname,
      url: location.href,
      title: document.title,
      language: navigator.language || "",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "",
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      screen: `${screen.width}x${screen.height}`,
      date: new Date().toISOString(),
      ...getAttribution(),
      ...data
    };
  }

  function send(event, data = {}) {
    const payload = basePayload(event, data);

    try {
      const body = JSON.stringify(payload);

      if (navigator.sendBeacon) {
        const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
        const ok = navigator.sendBeacon(`${WORKER_URL}/track`, blob);
        if (ok) return;
      }

      fetch(`${WORKER_URL}/track`, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body,
        keepalive: true,
        credentials: "omit"
      }).catch(() => {});
    } catch {}
  }

  function textOf(el) {
    return (el?.innerText || el?.textContent || el?.value || "").trim().replace(/\s+/g, " ").slice(0, 160);
  }

  function classifyClick(el) {
    const txt = textOf(el).toLowerCase();
    const href = el?.href || el?.closest?.("a")?.href || "";
    const id = el?.id || "";

    if (id === "btnPagar" || id === "btnPagarDirecto" || txt.includes("mercadopago") || txt.includes("pagar")) {
      return "checkout_start";
    }
    if (txt.includes("preview") || txt.includes("vista previa") || txt.includes("desbloquear")) {
      return "preview_action";
    }
    if (href.includes("contrato-alquiler")) return "cta_contrato_alquiler";
    if (href.includes("formulario")) return "cta_formulario";
    if (href.includes("planes")) return "cta_planes";
    if (txt.includes("descargar")) return "document_download_click";
    if (txt.includes("crear") || txt.includes("generar")) return "cta_generar";
    return "click";
  }

  function installClickTracking() {
    document.addEventListener("click", (ev) => {
      const target = ev.target.closest("a,button,[role='button'],input[type='button'],input[type='submit']");
      if (!target) return;

      const event = classifyClick(target);
      send(event, {
        button_id: target.id || "",
        button_text: textOf(target),
        href: target.href || ""
      });
    }, true);
  }

  function installFormStartTracking() {
    let sent = false;
    const selector = "input,select,textarea";
    document.addEventListener("input", (ev) => {
      if (sent) return;
      if (!ev.target.matches(selector)) return;
      sent = true;
      send("form_start", {
        form_id: ev.target.closest("form")?.id || "",
        field_id: ev.target.id || "",
        page_group: inferPageGroup()
      });
    }, true);
  }

  function inferPageGroup() {
    const p = location.pathname.toLowerCase();
    if (p.includes("contrato-alquiler")) return "contrato_alquiler";
    if (p.includes("formulario")) return "formulario_general";
    if (p.includes("gracias")) return "gracias";
    if (p === "/" || p.includes("index")) return "home";
    return "otro";
  }

  function autoPageEvents() {
    const page_group = inferPageGroup();
    send("page_view", { page_group });

    if (page_group === "formulario_general" || page_group === "contrato_alquiler") {
      send("form_page_view", { page_group });
    }

    if (page_group === "gracias") {
      send("payment_success_page_view", { page_group, status: "tracked" });
      send("document_ready_page_view", { page_group, status: "tracked" });
    }
  }

  persistAttribution();

  window.legalaiTrack = send;
  window.legalaiSessionId = getSessionId;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      autoPageEvents();
      installClickTracking();
      installFormStartTracking();
    });
  } else {
    autoPageEvents();
    installClickTracking();
    installFormStartTracking();
  }
})();
