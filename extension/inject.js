// inject.js — Runs in the page context (not isolated world)
// Wraps window.fetch to intercept usage-related API responses
(function () {
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const response = await originalFetch.apply(this, args);

    try {
      const url = typeof args[0] === "string" ? args[0] : args[0]?.url || "";

      // Match usage / rate-limit / billing endpoints
      if (
        url.includes("usage") ||
        url.includes("rate_limit") ||
        url.includes("limit") ||
        url.includes("billing")
      ) {
        const clone = response.clone();
        const contentType = clone.headers.get("content-type") || "";

        if (contentType.includes("application/json")) {
          const data = await clone.json();
          window.postMessage(
            {
              type: "__CLAUDE_USAGE_INTERCEPT__",
              url: url,
              payload: data,
            },
            "*"
          );
        }
      }
    } catch (e) {
      // Silent fail — never break the host page
    }

    return response;
  };
})();
