// Minimal, privacy-preserving usage analytics.
//
// No cookies, no fingerprinting, no personal data. The session id is random,
// lives in sessionStorage and is gone when the tab closes. Events are batched
// and sent with keepalive so a flush still completes if the page is closing.
// If the API is absent (for example on GitHub Pages) every call is a no-op.
(function () {
  const ENDPOINT = "./api/events";
  const FLUSH_MS = 2500;

  let queue = [];
  let timer = null;
  let disabled = false;

  const sessionId = (() => {
    try {
      let id = sessionStorage.getItem("ar_session");
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) ||
          String(Date.now()) + Math.random().toString(36).slice(2);
        sessionStorage.setItem("ar_session", id);
      }
      return id;
    } catch (error) {
      return String(Date.now()) + Math.random().toString(36).slice(2);
    }
  })();

  const device = (() => {
    const width = Math.min(screen.width, screen.height);
    const touch = navigator.maxTouchPoints > 1;
    if (!touch) return "desktop";
    return width >= 600 ? "tablet" : "mobile";
  })();

  function flush(useBeacon) {
    if (disabled || !queue.length) return;
    const payload = JSON.stringify({ session_id: sessionId, device, events: queue });
    queue = [];
    if (timer) { clearTimeout(timer); timer = null; }

    try {
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: "application/json" }));
        return;
      }
      fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
        keepalive: true
      }).then((response) => {
        // Any error response means there is no backend here (a 404 on static
        // hosting, for example). Stop retrying for the rest of the session
        // rather than firing a failed request every few seconds.
        if (!response.ok) disabled = true;
      }).catch(() => { disabled = true; });
    } catch (error) {
      disabled = true;
    }
  }

  window.ARTrack = {
    event(name, model) {
      if (disabled) return;
      queue.push(model ? { event: name, model } : { event: name });
      if (queue.length >= 20) return flush(false);
      if (!timer) timer = setTimeout(() => flush(false), FLUSH_MS);
    }
  };

  addEventListener("pagehide", () => flush(true));
  addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush(true);
  });
})();
