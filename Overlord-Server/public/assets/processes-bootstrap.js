/** Process Manager page bootstrap (module, CSP-safe). v1.0.0 */
const PROCESSES_BOOTSTRAP_VERSION = "1.0.0";

try {
  if (new URLSearchParams(location.search).get("embedded") !== "1") {
    await import("/assets/nav.js");
  }
  await import("/assets/processes.js");
} catch (err) {
  const list = document.getElementById("process-list");
  if (list) {
    list.innerHTML = `<div class="proc-list-placeholder px-4 py-6 text-center text-red-400 text-sm"><i class="fa-solid fa-exclamation-triangle mr-2"></i>Failed to load Process Manager</div>`;
  }
  console.error(`processes-bootstrap v${PROCESSES_BOOTSTRAP_VERSION}`, err);
}
