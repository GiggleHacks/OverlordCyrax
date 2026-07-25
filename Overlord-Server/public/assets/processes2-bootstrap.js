/** Process Manager 2.0 page bootstrap (module, CSP-safe). v1.0.0 */
const PROCESSES2_BOOTSTRAP_VERSION = "1.0.0";

try {
  await import("/assets/processes2.js");
} catch (err) {
  const list = document.getElementById("proc2-list");
  if (list) {
    list.innerHTML = `<div class="proc2-placeholder err"><i class="fa-solid fa-exclamation-triangle"></i> Failed to load Process Manager 2.0</div>`;
  }
  console.error(`processes2-bootstrap v${PROCESSES2_BOOTSTRAP_VERSION}`, err);
}
