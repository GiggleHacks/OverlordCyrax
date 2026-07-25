/** Process Manager embedded-mode bootstrap (classic, CSP-safe). v1.0.0 */
(function () {
  "use strict";
  const PROCESSES_EMBEDDED_CHECK_VERSION = "1.0.0";
  if (new URLSearchParams(location.search).get("embedded") !== "1") return;
  document.documentElement.classList.add("processes-embedded-root");
  function markBody() {
    if (document.body) document.body.classList.add("processes-embedded");
  }
  if (document.body) markBody();
  else document.addEventListener("DOMContentLoaded", markBody, { once: true });
  console.debug(`processes-embedded-check v${PROCESSES_EMBEDDED_CHECK_VERSION}`);
})();
