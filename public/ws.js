/*! Neurank AI-traffic beacon — https://neurank.ai */
(function () {
  try {
    var s = document.currentScript;
    var projectId =
      (s && s.getAttribute && s.getAttribute("data-project-id")) ||
      (window.__NEURANK__ && window.__NEURANK__.projectId) ||
      "";
    if (!projectId) return;
    var origin =
      (s && s.getAttribute && s.getAttribute("data-endpoint")) ||
      (window.__NEURANK__ && window.__NEURANK__.endpoint) ||
      "https://neurank.ai";
    var url = origin.replace(/\/$/, "") + "/api/v1/traffic/beacon?projectId=" + encodeURIComponent(projectId);
    var body = JSON.stringify({
      url: location.href,
      userAgent: navigator.userAgent || ""
    });
    // Prefer sendBeacon — survives page navigation and never blocks.
    if (navigator.sendBeacon) {
      try {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return;
      } catch (e) {
        // fall through to fetch
      }
    }
    if (window.fetch) {
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body,
        keepalive: true,
        mode: "cors",
        credentials: "omit"
      }).catch(function () {});
    }
  } catch (e) {
    // never throw from the beacon
  }
})();
