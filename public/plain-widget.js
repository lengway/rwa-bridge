(function (global) {
  "use strict";

  var NAMESPACE = "plain-widget";
  var VERSION = 1;
  var PARTNER_ID = "demo-bank";

  function isEnvelope(value) {
    return value !== null && typeof value === "object" &&
      value.namespace === NAMESPACE && value.version === VERSION &&
      typeof value.type === "string";
  }

  function resolveContainer(container) {
    if (typeof container === "string") {
      var element = document.querySelector(container);
      if (!element) throw new Error("Plain Widget container was not found.");
      return element;
    }
    if (container && container.nodeType === 1) return container;
    throw new Error("Plain Widget requires a container element or selector.");
  }

  function resolveBaseUrl(value) {
    var url;
    try {
      url = new URL(value);
    } catch {
      throw new Error("Plain Widget requires a valid application origin.");
    }

    var loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
        url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
      throw new Error("Plain Widget requires an HTTPS application origin or HTTP loopback origin.");
    }
    return url;
  }

  function mount(options) {
    if (!options || options.partnerId !== PARTNER_ID) {
      throw new Error("Plain Widget only supports the demo-bank sandbox partner.");
    }
    if (typeof options.sessionToken !== "string" || !options.sessionToken.trim()) {
      throw new Error("Plain Widget requires a sandbox session token.");
    }
    var baseUrl = resolveBaseUrl(options.baseUrl);
    var container = resolveContainer(options.container);
    var parentOrigin = global.location.origin;
    if (parentOrigin === "null") throw new Error("Plain Widget requires a web page with an origin.");
    var sessionToken = options.sessionToken;

    var iframe = document.createElement("iframe");
    iframe.title = "Plain sandbox widget";
    iframe.src = new URL("/widget", baseUrl.origin).href;
    iframe.referrerPolicy = "origin";
    iframe.loading = "eager";
    iframe.style.width = "100%";
    iframe.style.minHeight = "760px";
    iframe.style.border = "0";
    iframe.style.display = "block";
    iframe.style.background = "transparent";

    var active = true;
    var ready = false;
    var initSent = false;
    var callback = typeof options.onEvent === "function" ? options.onEvent : function () {};
    options = null;

    function emit(event) {
      try {
        callback(event);
      } catch {
        // Consumer callbacks must not interfere with the widget protocol.
      }
    }

    function sendInit() {
      if (!active || !ready || initSent || !iframe.contentWindow) return;
      initSent = true;
      iframe.contentWindow.postMessage({
        namespace: NAMESPACE,
        version: VERSION,
        type: "init",
        partnerId: PARTNER_ID,
        sessionToken: sessionToken,
      }, baseUrl.origin);
    }

    function onMessage(event) {
      if (!active || event.source !== iframe.contentWindow || event.origin !== baseUrl.origin || !isEnvelope(event.data)) return;

      if (event.data.type === "ready") {
        ready = true;
        sendInit();
        emit({ type: "ready" });
      } else if (event.data.type === "initialized") {
        emit({ type: "initialized" });
      } else if (event.data.type === "close") {
        emit({ type: "close" });
      } else if (event.data.type === "action-confirmed" && event.data.network === "devnet" &&
          (event.data.action === "deposit" || event.data.action === "withdraw") &&
          typeof event.data.actionId === "string" && /^[0-9a-f-]{36}$/i.test(event.data.actionId) &&
          typeof event.data.signature === "string" && /^[1-9A-HJ-NP-Za-km-z]{64,90}$/.test(event.data.signature)) {
        emit({ type: "action-confirmed", network: "devnet", action: event.data.action,
          actionId: event.data.actionId, signature: event.data.signature });
      } else if (event.data.type === "error") {
        initSent = false;
        emit({ type: "error", message: "The sandbox widget could not start. Please retry." });
      }
    }

    global.addEventListener("message", onMessage);
    container.appendChild(iframe);

    return {
      iframe: iframe,
      retry: function () {
        if (!active || !ready || initSent || !iframe.contentWindow) return;
        sendInit();
      },
      destroy: function () {
        if (!active) return;
        active = false;
        global.removeEventListener("message", onMessage);
        iframe.remove();
        sessionToken = "";
        callback = function () {};
      },
    };
  }

  global.PlainWidget = { mount: mount };
})(window);
