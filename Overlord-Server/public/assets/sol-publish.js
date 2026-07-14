(() => {
const rpcSelect = document.getElementById("rpc-url");
const customRpcWrapper = document.getElementById("custom-rpc-wrapper");
const customRpcInput = document.getElementById("custom-rpc-url");
const privateKeyInput = document.getElementById("private-key");
const toggleKeyBtn = document.getElementById("toggle-key-visibility");
const serverUrlInput = document.getElementById("server-url");
const previewBtn = document.getElementById("preview-btn");
const publishBtn = document.getElementById("publish-btn");
const outputSection = document.getElementById("output-section");
const outputDiv = document.getElementById("output");
const walletInfo = document.getElementById("wallet-info");
const walletAddress = document.getElementById("wallet-address");
const rpcEndpointList = document.getElementById("rpc-endpoint-list");
const newRpcInput = document.getElementById("new-rpc-url");
const addRpcBtn = document.getElementById("add-rpc-btn");
const rpcManagerError = document.getElementById("rpc-manager-error");

if (!rpcSelect || !customRpcWrapper || !customRpcInput || !privateKeyInput || !toggleKeyBtn || !serverUrlInput || !previewBtn || !publishBtn || !outputSection || !outputDiv || !walletInfo || !walletAddress || !rpcEndpointList || !newRpcInput || !addRpcBtn || !rpcManagerError) {
  return;
}

function normalizeRpcEndpoints(value) {
  const seen = new Set();
  const endpoints = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const endpoint = String(raw || "").trim();
    if (!/^https?:\/\//i.test(endpoint) || seen.has(endpoint)) continue;
    seen.add(endpoint);
    endpoints.push(endpoint);
  }
  return endpoints;
}

function appendRpcOption(value, label = value) {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  rpcSelect.appendChild(opt);
}

async function loadRpcEndpoints() {
  const selected = rpcSelect.value;
  rpcSelect.innerHTML = "";
  let records = [];
  try {
    const res = await fetch("/api/sol/rpc-endpoints", { credentials: "include" });
    if (res.ok) {
      const data = await res.json();
      const urls = normalizeRpcEndpoints(data?.endpoints);
      records = Array.isArray(data?.records)
        ? data.records.filter((item) => item && typeof item.id === "string" && urls.includes(item.url))
        : urls.map((url) => ({ id: "", url }));
    }
  } catch {}
  records.forEach((item) => appendRpcOption(item.url));
  appendRpcOption("__custom__", "Custom RPC endpoint...");
  rpcSelect.value = records.some((item) => item.url === selected) ? selected : (records[0]?.url || "__custom__");
  customRpcWrapper.classList.toggle("hidden", rpcSelect.value !== "__custom__");
  renderRpcEndpointManager(records);
}

function setRpcManagerError(message = "") {
  rpcManagerError.textContent = message;
  rpcManagerError.classList.toggle("hidden", !message);
}

function renderRpcEndpointManager(records) {
  rpcEndpointList.innerHTML = "";
  if (records.length === 0) {
    const empty = document.createElement("p");
    empty.className = "rounded-lg border border-dashed border-slate-700 px-3 py-4 text-center text-xs text-slate-500";
    empty.textContent = "No saved endpoints. Add one below or use a custom endpoint for this publish.";
    rpcEndpointList.appendChild(empty);
    return;
  }
  records.forEach((record) => {
    const row = document.createElement("div");
    row.className = "group flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-950/60 p-1.5";
    const input = document.createElement("input");
    input.type = "url";
    input.value = record.url;
    input.className = "flex-1 min-w-0 px-2 py-1.5 bg-transparent border border-transparent rounded text-xs font-mono text-slate-300 focus:outline-none focus:border-sky-500/60 focus:bg-slate-950";
    const save = document.createElement("button");
    save.type = "button";
    save.className = "inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-slate-500 hover:text-sky-300 hover:bg-sky-500/10 transition-colors";
    save.title = "Save endpoint";
    save.innerHTML = '<i class="fa-solid fa-floppy-disk"></i>';
    save.addEventListener("click", () => mutateRpcEndpoint(`/api/sol/rpc-endpoints/${record.id}`, "PATCH", { url: input.value }));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "inline-flex items-center justify-center w-8 h-8 shrink-0 rounded-md text-slate-500 hover:text-red-300 hover:bg-red-500/10 transition-colors";
    remove.title = "Delete endpoint";
    remove.innerHTML = '<i class="fa-solid fa-trash"></i>';
    remove.addEventListener("click", () => mutateRpcEndpoint(`/api/sol/rpc-endpoints/${record.id}`, "DELETE"));
    row.append(input, save, remove);
    rpcEndpointList.appendChild(row);
  });
}

async function mutateRpcEndpoint(path, method, body) {
  setRpcManagerError();
  try {
    const res = await fetch(path, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      credentials: "include",
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || "Failed to save RPC endpoints");
    newRpcInput.value = "";
    await loadRpcEndpoints();
  } catch (error) {
    setRpcManagerError(error?.message || "Failed to save RPC endpoints");
  }
}

addRpcBtn.addEventListener("click", () => mutateRpcEndpoint("/api/sol/rpc-endpoints", "POST", { url: newRpcInput.value }));
newRpcInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addRpcBtn.click();
  }
});

loadRpcEndpoints();

rpcSelect.addEventListener("change", () => {
  customRpcWrapper.classList.toggle("hidden", rpcSelect.value !== "__custom__");
});

function getSelectedRpc() {
  if (rpcSelect.value === "__custom__") {
    return customRpcInput.value.trim();
  }
  return rpcSelect.value;
}

const isHttps = window.location.protocol === "https:";
const host = window.location.host;
serverUrlInput.value = `${isHttps ? "wss" : "ws"}://${host}`;

let keyVisible = false;
toggleKeyBtn.addEventListener("click", () => {
  keyVisible = !keyVisible;
  privateKeyInput.type = keyVisible ? "text" : "password";
  toggleKeyBtn.innerHTML = keyVisible
    ? '<i class="fa-solid fa-eye-slash"></i> Hide'
    : '<i class="fa-solid fa-eye"></i> Show';
});

let balanceTimeout = null;
privateKeyInput.addEventListener("input", () => {
  clearTimeout(balanceTimeout);
  balanceTimeout = setTimeout(checkWalletBalance, 800);
});

async function checkWalletBalance() {
  const key = privateKeyInput.value.trim();
  if (!key || key.length < 32) {
    walletInfo.classList.add("hidden");
    return;
  }

  try {
    const rpc = getSelectedRpc();
    const res = await fetch("/api/sol/balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ publicKeyBase58: key, rpcUrl: rpc }),
    });
    walletInfo.classList.add("hidden");
  } catch {
    walletInfo.classList.add("hidden");
  }
}

function showOutput(text, isError = false) {
  outputSection.classList.remove("hidden");
  outputDiv.textContent = text;
  outputDiv.className = `p-4 bg-slate-950/70 border rounded-lg text-sm font-mono break-all whitespace-pre-wrap max-h-72 overflow-y-auto ${
    isError ? "border-red-500/40 text-red-300" : "border-slate-800 text-slate-200"
  }`;
}

previewBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim();
  if (!serverUrl) {
    showOutput("Error: Server URL is required", true);
    return;
  }

  previewBtn.disabled = true;
  previewBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Encrypting...';

  try {
    const res = await fetch("/api/sol/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ serverUrl }),
    });

    const data = await res.json();
    if (!res.ok) {
      showOutput(`Error: ${data.error}`, true);
      return;
    }

    showOutput(
      `Encrypted Memo (${data.memoLength} chars):\n\n${data.memo}\n\nThis is what would be stored in the Solana memo transaction.`
    );
  } catch (err) {
    showOutput(`Error: ${err.message}`, true);
  } finally {
    previewBtn.disabled = false;
    previewBtn.innerHTML = '<i class="fa-solid fa-eye"></i> Preview Memo';
  }
});

publishBtn.addEventListener("click", async () => {
  const serverUrl = serverUrlInput.value.trim();
  const privateKey = privateKeyInput.value.trim();
  const rpcUrl = getSelectedRpc();

  if (!serverUrl) {
    showOutput("Error: Server URL is required", true);
    return;
  }
  if (!privateKey) {
    showOutput("Error: Private key is required", true);
    return;
  }
  if (!rpcUrl) {
    showOutput("Error: RPC endpoint is required", true);
    return;
  }

  if (!confirm(
    "Publish encrypted server URL to Solana?\n\n" +
    `Server URL: ${serverUrl}\n` +
    `RPC: ${rpcUrl}\n\n` +
    "This will create a transaction costing ~0.000005 SOL."
  )) {
    return;
  }

  publishBtn.disabled = true;
  publishBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Publishing...';

  try {
    const res = await fetch("/api/sol/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ serverUrl, privateKeyBase58: privateKey, rpcUrl }),
    });

    const data = await res.json();
    if (!res.ok) {
      showOutput(`Error: ${data.error}`, true);
      return;
    }

    showOutput(
      `Published successfully!\n\n` +
      `Signature: ${data.signature}\n` +
      `Address: ${data.address}\n` +
      `Memo length: ${data.memoLength} chars\n\n` +
      `Explorer: ${data.explorerUrl}\n\n` +
      `Clients built with Solana mode and address "${data.address}" will now connect to:\n${serverUrl}`
    );

    walletInfo.classList.remove("hidden");
    walletAddress.textContent = `Address: ${data.address}`;
  } catch (err) {
    showOutput(`Error: ${err.message}`, true);
  } finally {
    publishBtn.disabled = false;
    publishBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Publish to Solana';
  }
});
})();
