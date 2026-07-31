/** File Manager 2.0 page bootstrap (module, CSP-safe). v1.0.0 */
const FILES2_BOOTSTRAP_VERSION = "1.0.0";

try {
  await import("/assets/files2.js");
} catch (err) {
  const list = document.getElementById("fm2-list");
  if (list) {
    list.innerHTML = `<div class="fm2-placeholder"><i class="fa-solid fa-triangle-exclamation"></i> Failed to load File Manager 2.0</div>`;
  }
  console.error(`files2-bootstrap v${FILES2_BOOTSTRAP_VERSION}`, err);
}
