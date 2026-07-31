/** Shared full D2 shell for File Manager concept mocks */
export function mountShell({ letter, name, blurb, filesHtml }) {
  document.title = `Concept ${letter} — ${name}`;
  document.body.innerHTML = `
    <div class="viewer">
      <aside class="side-rail" aria-hidden="true">
        <div class="rail-home"><i class="fa-solid fa-house"></i></div>
        <button type="button" title="Remote Access"><i class="fa-solid fa-plug"></i></button>
        <button type="button" title="Monitoring"><i class="fa-solid fa-eye"></i></button>
        <button type="button" title="System"><i class="fa-solid fa-server"></i></button>
        <button type="button" title="Trolling"><i class="fa-solid fa-ghost"></i></button>
        <button type="button" title="Agent"><i class="fa-solid fa-robot"></i></button>
      </aside>
      <header class="topbar">
        <button type="button" class="back"><i class="fa-solid fa-arrow-left"></i> Clients</button>
        <span class="id-pill">ID e035883bafb3</span>
        <div class="mode-nav">
          <span><i class="fa-solid fa-video"></i> Webcam</span>
          <span><i class="fa-solid fa-display"></i> Desktop</span>
          <span><i class="fa-solid fa-columns"></i> Split</span>
          <span><i class="fa-solid fa-window-restore"></i> PiP</span>
          <span class="is-active"><i class="fa-solid fa-table-cells"></i> Dashboard 2.0</span>
        </div>
        <div class="cap"><i class="fa-solid fa-circle"></i> camera available · 16 ms</div>
      </header>
      <section class="d2">
        <div class="d2-chrome">
          <div style="display:inline-flex;align-items:center;gap:8px">
            <span class="d2-brand">OVERLORD</span>
            <span class="d2-chrome-sep">//</span>
            <span class="d2-chrome-title">Dashboard 2.0</span>
            <span class="d2-version">v0.3.1 · concept ${letter}</span>
          </div>
          <div class="d2-chrome-right">
            <button type="button" class="d2-chrome-btn is-active-slot is-locked">Layout 1 <i class="fa-solid fa-lock" style="font-size:9px;color:#facc15"></i></button>
            <button type="button" class="d2-chrome-btn">Layout 2</button>
            <button type="button" class="d2-chrome-btn">Reset layout</button>
          </div>
        </div>
        <div class="workspace">
          <div class="win win-desktop is-focused">
            <header class="win-titlebar">
              <span class="win-title"><i class="fa-solid fa-display"></i> Remote Desktop</span>
              <div class="win-btns"><span class="sq">□</span></div>
            </header>
            <div class="win-body">
              <div class="fake-rd">
                <div class="browser">
                  <div class="bb">
                    <div class="tab">rental cars in tenkasi - Google Search</div>
                    <div class="omnibox">google.com/search?q=rental+cars+in+tenkasi</div>
                  </div>
                  <div class="page">
                    <h3>Royal Self Drive Cars (Rental Service), Tenkasi</h3>
                    <div class="stars">★★★★☆ 4.8 · 143 reviews</div>
                    <p>People say this car rental service provides well-maintained cars in good condition, with many highlighting the smooth and hassle-free pickup and drop-off process.</p>
                  </div>
                </div>
                <div class="taskbar">
                  <div class="ico"><i class="fa-brands fa-windows"></i></div>
                  <div class="ico"><i class="fa-brands fa-chrome"></i></div>
                  <div class="ico"><i class="fa-solid fa-folder"></i></div>
                  <div class="clock">11:30 AM<br/>7/30/2026</div>
                </div>
              </div>
            </div>
          </div>

          <div class="win win-webcam">
            <header class="win-titlebar">
              <span class="win-title"><i class="fa-solid fa-camera"></i> Webcam</span>
              <div class="win-btns">
                <span class="cam-fps">1 FPS</span>
                <button type="button" class="cam-btn go">Start</button>
                <button type="button" class="cam-btn stop">Stop</button>
                <span class="sq">□</span>
              </div>
            </header>
            <div class="win-body">
              <div class="fake-cam"><div class="face"></div><span class="label">LIVE mock</span></div>
            </div>
          </div>

          <div class="win win-proc">
            <header class="win-titlebar">
              <span class="win-title"><i class="fa-solid fa-list-check"></i> Process Manager 2.0</span>
              <div class="win-btns"><span class="sq">□</span></div>
            </header>
            <div class="win-body">
              <div class="fake-pm">
                <div class="tb">
                  <span class="dot"></span>
                  <input readonly value="Filter processes…" />
                  <span class="cnt">55 · v1.1</span>
                </div>
                <div class="scroll">
                  <table>
                    <thead><tr><th>Name</th><th style="text-align:right">CPU</th><th style="text-align:right">Mem</th></tr></thead>
                    <tbody>
                      <tr class="is-sel"><td>SmartAudio3.exe</td><td class="mem">0.7</td><td class="mem">71M</td></tr>
                      <tr><td>SynTPEnh.exe</td><td class="mem">0.1</td><td class="mem">22M</td></tr>
                      <tr><td>LocationNotificationWindows.exe</td><td class="mem">0.0</td><td class="mem">8M</td></tr>
                      <tr><td>chrome.exe</td><td class="mem">4.2</td><td class="mem">412M</td></tr>
                      <tr><td>explorer.exe</td><td class="mem">0.3</td><td class="mem">98M</td></tr>
                      <tr><td>svchost.exe</td><td class="mem">0.1</td><td class="mem">14M</td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          <div class="win win-files is-focused" style="border-color:#4b5fbf">
            <header class="win-titlebar">
              <span class="win-title"><i class="fa-solid fa-folder-tree"></i> File Manager 2.0</span>
              <div class="win-btns"><span class="sq">□</span></div>
            </header>
            <div class="win-body">${filesHtml}</div>
          </div>
        </div>
      </section>
    </div>
    <div class="vote-bar">
      <span class="pill">${letter}</span>
      <strong>${name}</strong>
      <span style="color:#6b7598;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${blurb}</span>
      <nav>
        <a href="./concept-a.html" class="${letter === "A" ? "is-here" : ""}">A</a>
        <a href="./concept-b.html" class="${letter === "B" ? "is-here" : ""}">B</a>
        <a href="./concept-c.html" class="${letter === "C" ? "is-here" : ""}">C</a>
        <a href="./concept-d.html" class="${letter === "D" ? "is-here" : ""}">D</a>
        <a href="./concept-e.html" class="${letter === "E" ? "is-here" : ""}">E</a>
      </nav>
      <a href="./index.html">Gallery</a>
    </div>
  `;
}

export const DOWNLOADS_ROWS = `
<tr class="is-on" data-name="Invoices" data-type="Folder" data-size="—"><td><span class="fm-name"><i class="fa-solid fa-folder f"></i>Invoices</span></td><td class="col-s">—</td><td class="col-t">File folder</td><td class="col-m">7/28/2026 9:41 AM</td></tr>
<tr data-name="Work"><td><span class="fm-name"><i class="fa-solid fa-folder f"></i>Work</span></td><td class="col-s">—</td><td class="col-t">File folder</td><td class="col-m">7/10/2026 12:00 PM</td></tr>
<tr class="is-on" data-name="rental-quote-tenkasi.pdf" data-type="PDF" data-size="1.24 MB"><td><span class="fm-name"><i class="fa-solid fa-file-pdf pdf"></i>rental-quote-tenkasi.pdf</span></td><td class="col-s">1.24 MB</td><td class="col-t">PDF Document</td><td class="col-m">7/30/2026 8:15 AM</td></tr>
<tr data-name="Aadhaar_scan_front.png"><td><span class="fm-name"><i class="fa-solid fa-file-image img"></i>Aadhaar_scan_front.png</span></td><td class="col-s">890 KB</td><td class="col-t">PNG Image</td><td class="col-m">7/27/2026 4:44 PM</td></tr>
<tr data-name="setup-Overlord-2.6.8.zip"><td><span class="fm-name"><i class="fa-solid fa-file-zipper zip"></i>setup-Overlord-2.6.8.zip</span></td><td class="col-s">48.6 MB</td><td class="col-t">Compressed folder</td><td class="col-m">7/29/2026 9:03 PM</td></tr>
<tr data-name="Q3-costs.xlsx"><td><span class="fm-name"><i class="fa-solid fa-file-excel xls"></i>Q3-costs.xlsx</span></td><td class="col-s">220 KB</td><td class="col-t">Microsoft Excel</td><td class="col-m">7/20/2026 11:09 AM</td></tr>
<tr data-name="meeting-notes.txt"><td><span class="fm-name"><i class="fa-solid fa-file-lines txt"></i>meeting-notes.txt</span></td><td class="col-s">4 KB</td><td class="col-t">Text Document</td><td class="col-m">7/18/2026 7:22 PM</td></tr>
<tr data-name="ChromeSetup.exe"><td><span class="fm-name"><i class="fa-solid fa-gears exe"></i>ChromeSetup.exe</span></td><td class="col-s">1.1 MB</td><td class="col-t">Application</td><td class="col-m">7/15/2026 7:01 AM</td></tr>
<tr data-name="vacation-goa.mp4"><td><span class="fm-name"><i class="fa-solid fa-file-video vid"></i>vacation-goa.mp4</span></td><td class="col-s">214 MB</td><td class="col-t">MP4 Video</td><td class="col-m">6/02/2026 2:18 PM</td></tr>
<tr data-name="resume-2026.docx"><td><span class="fm-name"><i class="fa-solid fa-file-word doc"></i>resume-2026.docx</span></td><td class="col-s">88 KB</td><td class="col-t">Microsoft Word</td><td class="col-m">5/11/2026 10:05 AM</td></tr>
`;

export function wireTable(root = document) {
  root.querySelectorAll(".fm-table tbody tr").forEach((row) => {
    row.addEventListener("click", (e) => {
      const table = row.closest("tbody");
      if (!e.ctrlKey && !e.metaKey) table.querySelectorAll("tr").forEach((r) => r.classList.remove("is-on"));
      row.classList.toggle("is-on");
    });
  });
  root.querySelectorAll(".fm-place").forEach((btn) => {
    btn.addEventListener("click", () => {
      root.querySelectorAll(".fm-place").forEach((b) => b.classList.remove("is-on"));
      btn.classList.add("is-on");
      const path = btn.getAttribute("data-path");
      const input = root.querySelector(".fm-path");
      if (path && input) input.value = path;
      const sb = root.querySelector(".fm-sb .r");
      if (path && sb) sb.textContent = path;
    });
  });
}
