/* fishy_ir UI client — vanilla JS, no deps, offline-safe.
 * Server contract: see /api/docs, API.md and openapi.yaml. */
"use strict";

const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* ------------------------------------------------------------ api client */
const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
};

const API = {
  /* Standalone mode: run this UI against the service from another
   * origin/port - either ?base=http://host:8385 on the page URL, or set
   * localStorage.fishyBase once (see API.md §"CORS & standalone").
   * Empty = same origin, the normal deployment. */
  base: (new URLSearchParams(location.search).get("base")
         || store.get("fishyBase") || "").replace(/\/+$/, ""),
  url(path) { return this.base + path; },
  token: store.get("fishyToken") || null,
  async req(path, opts = {}) {
    const h = Object.assign({}, opts.headers || {});
    if (this.token) h["X-Fishy-Token"] = this.token;
    if (opts.body !== undefined) h["Content-Type"] = "application/json";
    const r = await fetch(this.url(path), Object.assign({}, opts, { headers: h }));
    let body = null;
    try { body = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) {
      const err = new Error((body && body.error) || ("HTTP " + r.status));
      err.status = r.status;
      err.body = body;
      if (r.status === 401) onUnauthorized();
      throw err;
    }
    return body;
  },
  setToken(t) { this.token = t || null; store.set("fishyToken", t || ""); },
};

/* -------------------------------------------------------------- helpers */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g,
    c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function shortDt(s) { return s ? String(s).replace("T", " ").slice(0, 16) : "—"; }
function whenDt(s) {   // today → HH:MM, otherwise date + time
  if (!s) return "—";
  return String(s).slice(0, 10) === new Date().toISOString().slice(0, 10) ? String(s).slice(11, 16) : shortDt(s);
}
function shortId(id) { return id ? String(id).slice(0, 8) : "—"; }
function baseName(f) { return f ? String(f).split(/[\\/]/).pop() : ""; }
function stamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, "0");
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + "_" +
         p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
}
function fmtNum(v, digits) {
  if (v == null || v === "" || isNaN(+v)) return v == null ? "—" : String(v);
  return (+v).toFixed(digits);
}
function setPill(el, cls, text) {
  el.className = "pill" + (cls ? " " + cls : "");
  el.querySelector("span").textContent = text;
}
function setMsg(el, text, cls) {
  el.className = "msg" + (cls ? " " + cls : "");
  el.textContent = text || "";
}

/* ---------------------------------------------------------------- toasts */
function toast(msg, kind) {
  const t = document.createElement("div");
  t.className = "toast" + (kind === true || kind === "err" ? " err" : kind === "warn" ? " warn" : "");
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => t.remove(), 5200);
}

/* --------------------------------------------------------------- dialogs */
function confirmDialog({ title, body, ok = "OK", danger = false }) {
  const d = $("#dlg-confirm");
  if (typeof d.showModal !== "function") return Promise.resolve(confirm(body));
  $("#dc-title").textContent = title;
  $("#dc-body").textContent = body;
  const okBtn = $("#dc-ok");
  okBtn.textContent = ok;
  okBtn.className = danger ? "danger" : "primary";
  d.classList.toggle("danger", danger);
  d.returnValue = "";
  d.showModal();
  okBtn.focus();
  return new Promise(res => d.addEventListener("close", () => res(d.returnValue === "ok"), { once: true }));
}

/* --------------------------------------------------------- token prompt */
let TOKEN_DIALOG_OPEN = false, TOKEN_ASKED = false;
function onUnauthorized() {
  API.setToken(null);        // regression contract: clear on 401
  promptToken();
}
function promptToken() {
  if (TOKEN_DIALOG_OPEN) return;
  TOKEN_ASKED = true;
  const d = $("#dlg-token");
  if (typeof d.showModal !== "function") {
    const t = prompt("REST token (printed at service start, also in config/fishy_ir.token):");
    if (t !== null) API.setToken(t.trim());
    toast(t ? "Token stored in this browser" : "A token is required for /api/* calls", !t);
    return;
  }
  TOKEN_DIALOG_OPEN = true;
  $("#tk-input").value = "";
  d.returnValue = "";
  d.showModal();
  d.addEventListener("close", () => {
    TOKEN_DIALOG_OPEN = false;
    const t = $("#tk-input").value.trim();
    if (d.returnValue === "ok" && t) {
      API.setToken(t);
      toast("Token stored in this browser");
      show(VIEW);
    } else {
      toast("A token is required for /api/* calls", "warn");
    }
  }, { once: true });
}
$("#btn-token").onclick = promptToken;

/* ----------------------------------------------------------------- views */
let VIEW = "queue";
const VIEWS = ["queue", "live", "results", "settings", "api"];
function show(view) {
  if (!VIEWS.includes(view)) view = "queue";
  VIEW = view;
  $$("nav button").forEach(b => {
    const on = b.dataset.view === view;
    b.classList.toggle("on", on);
    if (on) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  $$("main section").forEach(s => { s.hidden = s.id !== "view-" + view; });
  if (location.hash.slice(1) !== view) history.replaceState(null, "", location.search + "#" + view);
  if (view === "queue") refreshQueue();
  if (view === "live") refreshLive();
  if (view === "results") refreshResults();
  if (view === "settings") refreshSettings();
  if (view === "api") refreshApi();
}
$$("nav button").forEach(b => b.addEventListener("click", () => show(b.dataset.view)));
window.addEventListener("hashchange", () => show(location.hash.slice(1)));

/* ------------------------------------------------------------- banners -- */
let LAST_HEALTH = null;
function refreshBanners(h) {
  const b = $("#banners");
  b.innerHTML = "";
  if (h && h.background && h.background.ok === false && h.background.warning) {
    const d = document.createElement("div");
    d.className = "banner warn";
    d.setAttribute("role", "alert");
    d.innerHTML = `<span class="b-k">Background</span><span class="b-t"></span>`;
    d.querySelector(".b-t").textContent = h.background.warning;
    if (!h.busy) {
      const btn = document.createElement("button");
      btn.className = "secondary rowbtn";
      btn.textContent = "Measure background now";
      btn.onclick = () => startBackgroundJob();
      d.appendChild(btn);
    }
    b.appendChild(d);
  }
}

async function startBackgroundJob() {
  try {
    const name = "background-" + stamp();
    const r = await API.req("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ name, kind: "background", params: {}, start_now: true }),
    });
    toast("Background started (" + shortId(r.job.id) + ")");
    show("live");
  } catch (e) {
    if (handleBusy(e)) return;
    toast("Could not start: " + e.message, true);
  }
}

/* --------------------------------------------- 409 busy (concurrency UX) */
let HIGHLIGHT = null;
function handleBusy(e, msgEl) {
  if (!(e.status === 409 && e.body && e.body.busy)) return false;
  HIGHLIGHT = e.body.current || null;
  const text = e.message + (HIGHLIGHT ? " · running: " + shortId(HIGHLIGHT) : "");
  if (msgEl) setMsg(msgEl, text, "warn"); else toast(text, "warn");
  if (VIEW === "queue") refreshQueue(); else toast("The running job is highlighted in the queue", "warn");
  return true;
}

/* ----------------------------------------------------------------- queue */
function currentKind() { return ($("input[name=f-kind]:checked") || {}).value || "sample"; }
$$("input[name=f-kind]").forEach(r => r.addEventListener("change", () => {
  $("#form-hint").textContent = currentKind() === "background"
    ? "Background only, on the KBr reference."
    : "Full round: automatic background check, then sample.";
  $("#f-name").placeholder = currentKind() === "background" ? "e.g. background-morning" : "e.g. KBr pellet #12";
}));

function formPayload(startNow) {
  return {
    kind: currentKind(),
    name: $("#f-name").value.trim() || "",
    notes: $("#f-notes").value.trim(),
    params: {
      scans: +$("#f-scans").value,
      resolution: +$("#f-res").value,
      start: +$("#f-start").value,
      end: +$("#f-end").value,
      detector: $("#f-det").value,
    },
    start_now: startNow,
  };
}

function validateForm() {
  for (const id of ["#f-scans", "#f-res", "#f-start", "#f-end"]) {
    const el = $(id);
    if (!el.checkValidity() || el.value === "") { el.focus(); return el.validationMessage || "Please fill in all parameters."; }
  }
  if (+$("#f-start").value >= +$("#f-end").value) { $("#f-end").focus(); return "End must be larger than start (cm⁻¹)."; }
  return null;
}

async function submitJob(startNow) {
  const msg = $("#form-msg");
  const bad = validateForm();
  if (bad) return setMsg(msg, bad, "err");
  setMsg(msg, startNow ? "Adding and starting…" : "Adding to queue…");
  $("#btn-add").disabled = $("#btn-add-start").disabled = true;
  try {
    const r = await API.req("/api/jobs", { method: "POST", body: JSON.stringify(formPayload(startNow)) });
    setMsg(msg, (startNow ? "Started · " : "Staged · ") + shortId(r.job.id), "ok");
    toast(startNow ? "Measurement started" : "Job added to queue");
    $("#f-name").value = "";
    refreshQueue();
    if (startNow) show("live");
  } catch (e) {
    if (!handleBusy(e, msg)) setMsg(msg, e.message, "err");
    else refreshQueue();   // the job may have been staged even though it could not start
  } finally {
    $("#btn-add").disabled = $("#btn-add-start").disabled = false;
  }
}
$("#btn-add").onclick = () => submitJob(false);
$("#btn-add-start").onclick = () => submitJob(true);
$("#job-form").addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target.tagName === "INPUT") { e.preventDefault(); submitJob(false); }
});

async function refreshQueue() {
  let jobs;
  try { jobs = (await API.req("/api/jobs?limit=200")).jobs || []; }
  catch (e) { return; }
  const running = LAST_HEALTH && LAST_HEALTH.current;
  const rows = jobs.map(j => {
    const st = j.status;
    const acts = [];
    if (st === "staged") {
      acts.push(`<button class="rowbtn primary" data-act="start" data-id="${esc(j.id)}">Start</button>`);
      acts.push(`<button class="rowbtn" data-act="edit" data-id="${esc(j.id)}">Edit</button>`);
      acts.push(`<button class="rowbtn danger" data-act="del" data-id="${esc(j.id)}" title="Remove from queue" aria-label="Remove">✕</button>`);
    } else if (st === "running") {
      acts.push(`<button class="rowbtn danger" data-act="stop" data-id="${esc(j.id)}">Stop</button>`);
    }
    const when = st === "running" ? (j.started || "…") : (j.finished || j.created || j.createdAt);
    const cls = [
      (st === "running" || j.id === running) ? "is-current" : "",
      j.id === HIGHLIGHT ? "flash" : "",
    ].join(" ").trim();
    const sub = j.error ? `<small>${esc(j.error.slice(0, 140))}</small>`
              : j.notes ? `<small>${esc(j.notes)}</small>` : "";
    return `<tr data-id="${esc(j.id)}" class="${cls}">
        <td><span class="tpill ${esc(st)}">${esc(st)}</span></td>
        <td>${esc(j.kind)}</td>
        <td class="name">${esc(j.name) || '<span class="mono">' + shortId(j.id) + "</span>"}${sub}</td>
        <td class="mono">${esc(j.paramsSummary || "")}</td>
        <td class="mono when" title="${esc(when || "")}">${esc(whenDt(when))}</td>
        <td class="r">${acts.join(" ")}</td></tr>`;
  }).join("");
  const tbody = $("#queue-table tbody");
  tbody.innerHTML = rows;
  $("#queue-table").style.display = rows ? "" : "none";
  $("#queue-empty").hidden = !!rows;
  tbody.onclick = onQueueAction;
  if (HIGHLIGHT) {
    const tr = tbody.querySelector(`tr[data-id="${CSS.escape(HIGHLIGHT)}"]`);
    if (tr) tr.scrollIntoView({ block: "nearest", behavior: "smooth" });
    HIGHLIGHT = null;
  }

  $("#qs-staged").textContent = jobs.filter(j => j.status === "staged").length;
  const today = new Date().toISOString().slice(0, 10);
  const done = jobs.filter(j => j.status === "finished" && String(j.finished || "").slice(0, 10) === today);
  $("#qs-done").textContent = done.length;
  const failed = jobs.filter(j => j.status === "failed" && String(j.finished || "").slice(0, 10) === today).length;
  $("#qs-done-sub").textContent = failed ? failed + " failed today" : "measurements";
}

async function onQueueAction(ev) {
  const btn = ev.target.closest("button[data-act]");
  if (!btn) return;
  const id = btn.dataset.id, act = btn.dataset.act;
  try {
    if (act === "start") {
      await API.req(`/api/jobs/${id}/start`, { method: "POST" });
      toast("Started " + shortId(id));
      show("live");
      return;
    } else if (act === "stop") {
      if (!await confirmDialog({ title: "Stop measurement?", danger: true, ok: "Stop",
        body: "The engine aborts the running scan within ~8 s. The job ends as “aborted”." })) return;
      await API.req(`/api/jobs/${id}/stop`, { method: "POST" });
      toast("Stop requested — engine aborts within ~8 s");
    } else if (act === "del") {
      if (!await confirmDialog({ title: "Remove job?", danger: true, ok: "Remove",
        body: "Remove this staged job from the queue? This cannot be undone." })) return;
      await API.req(`/api/jobs/${id}`, { method: "DELETE" });
      toast("Removed " + shortId(id));
    } else if (act === "edit") {
      await editJob(id);
    }
    refreshQueue();
  } catch (e) {
    if (!handleBusy(e)) toast(e.message, true);
  }
}

async function editJob(id) {
  const j = (await API.req(`/api/jobs/${id}`)).job;
  const p = j.params || {};
  const d = $("#dlg-edit");
  $("#ed-id").textContent = shortId(j.id);
  $("#ed-name").value = j.name || "";
  $("#ed-notes").value = j.notes || "";
  $("#ed-scans").value = p.scans ?? p.numberOfScans ?? 10;
  $("#ed-res").value = p.resolution ?? 4;
  $("#ed-start").value = p.start ?? p.startFrequency ?? 400;
  $("#ed-end").value = p.end ?? p.endFrequency ?? 4000;
  $("#ed-det").value = p.detector || "TGSA";
  setMsg($("#ed-msg"), "", "err");
  d.returnValue = "";
  d.showModal();
  await new Promise(res => d.addEventListener("close", res, { once: true }));
  if (d.returnValue !== "ok") return;
  if (+$("#ed-start").value >= +$("#ed-end").value) { toast("End must be larger than start — not saved", true); return; }
  const r = await API.req(`/api/jobs/${id}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: $("#ed-name").value.trim() || j.name,
      notes: $("#ed-notes").value.trim(),
      params: {
        ...j.params,
        scans: +$("#ed-scans").value, resolution: +$("#ed-res").value,
        startFrequency: +$("#ed-start").value, endFrequency: +$("#ed-end").value,
        detector: $("#ed-det").value,
      },
    }),
  });
  toast("Updated " + shortId(r.job.id));
}

/* ------------------------------------------------------------------ live */
const PHASES = ["connecting", "collecting", "processing", "pushing"];
let LIVE_BUSY = false;
async function refreshLive() {
  let h;
  try { h = await API.req("/health"); } catch (e) { liveOffline(); return; }
  const busy = !!h.busy;
  const state = $("#lv-state");
  state.textContent = busy ? "Measuring" : "Idle";
  state.className = "live-state " + (busy ? "running" : "idle");
  $("#lv-phase").textContent = h.phase || "idle";
  $("#lv-engine").textContent = h.connected ? "connected" : "not connected";
  $("#lv-engine").className = h.connected ? "good" : "";
  $("#lv-updated").textContent = "updated " + new Date().toLocaleTimeString();

  const idx = PHASES.indexOf(h.phase);
  $$("#lv-phases li").forEach((li, i) => {
    li.className = !busy ? "" : i < idx ? "done" : i === idx ? "now" : "";
  });

  if (busy && h.current) {
    try {
      const j = (await API.req(`/api/jobs/${h.current}`)).job;
      $("#lv-job").innerHTML = `<b>${esc(j.name)}</b> · ${esc(j.kind)}<span class="mono">${esc(shortId(j.id))}</span>`;
      $("#lv-elapsed").textContent = (j.live && j.live.phaseSeconds != null) ? j.live.phaseSeconds + " s in phase" : "—";
    } catch (e) { /* job vanished mid-poll */ }
    $("#btn-stop").hidden = false;
    $("#live-progress").classList.toggle("hidden", idx >= 0);
  } else {
    $("#lv-job").textContent = "No measurement running";
    $("#lv-elapsed").textContent = "—";
    $("#btn-stop").hidden = true;
    $("#live-progress").classList.add("hidden");
  }
  if (LIVE_BUSY && !busy) refreshQueue();
  LIVE_BUSY = busy;

  try {
    const st = (await API.req("/api/instrument/status")).instrument || {};
    $("#lv-ready").textContent = st.readyState ? st.readyState + (st.description ? " — " + st.description : "") : (st.phase || (st.busy ? "busy" : "—"));
    if (st.background || h.background) bgInto($("#lv-bg"), st.background || h.background);
  } catch (e) { $("#lv-ready").textContent = "—"; bgInto($("#lv-bg"), h.background); }

  // activity log: jobs list order is a good proxy (statuses + timestamps)
  try {
    const js = (await API.req("/api/jobs?limit=8")).jobs || [];
    $("#live-log").innerHTML = js.map(j => `<li>
        <span class="tpill ${esc(j.status)}">${esc(j.status)}</span>
        <span class="l-name">${esc(j.name) || shortId(j.id)}</span>
        <span class="l-meta">${esc(j.kind)} · ${esc(shortDt(j.finished || j.started || j.created || j.createdAt))}</span>
        ${j.error ? `<span class="l-err">${esc(j.error.slice(0, 160))}</span>` : ""}
      </li>`).join("") || `<li class="l-empty">No activity yet.</li>`;
  } catch (e) { /* ignore */ }
}
$("#btn-stop").onclick = async () => {
  if (!await confirmDialog({ title: "Stop measurement?", danger: true, ok: "Stop measurement",
    body: "The engine aborts the running scan within ~8 s. The job ends as “aborted” — no data is saved for it." })) return;
  try {
    await API.req("/api/instrument/stop", { method: "POST" });
    toast("Stop requested — engine aborts within ~8 s");
    refreshLive();
  } catch (e) { toast(e.message, true); }
};
function liveOffline() {
  const s = $("#lv-state");
  s.textContent = "Offline";
  s.className = "live-state offline";
  $("#lv-job").textContent = "The fishy_ir service is not reachable.";
  $("#btn-stop").hidden = true;
  $("#live-progress").classList.add("hidden");
  $$("#lv-phases li").forEach(li => { li.className = ""; });
}
function bgText(bg) {
  if (!bg) return "—";
  if (!bg.ok) return bg.measuredAt ? `expired · ${bg.ageHours} h old (limit ${bg.maxAgeHours} h)` : "none measured";
  return `ok · ${bg.ageHours} h old (limit ${bg.maxAgeHours} h)`;
}
function bgInto(el, bg) {
  el.textContent = bgText(bg);
  el.className = !bg ? "" : bg.ok ? "good" : "warn";
}

/* --------------------------------------------------------------- results */
let SELECTED = null, MEASUREMENTS = [];
function pushPill(s) {
  const v = s || "not_configured";
  const cls = v === "sent" ? "push-sent" : v === "failed" ? "push-failed" : "push-off";
  const label = v === "not_configured" ? "off" : v;
  return `<span class="tpill ${cls}">${esc(label)}</span>`;
}
async function refreshResults() {
  try {
    const h = await API.req("/health");
    $("#res-dir").textContent = h.resultsDir || "—";
  } catch (e) { /* offline */ }
  let r;
  try { r = await API.req("/api/finished"); } catch (e) { return; }
  MEASUREMENTS = (r.measurements || [])
    .slice().sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
  const rows = MEASUREMENTS.map(m => {
    const f = baseName((m.files || [])[0]);
    return `<tr data-id="${esc(m.id)}" class="clickable${m.id === SELECTED ? " sel" : ""}" tabindex="0">
        <td class="mono">${esc(shortDt(m.finished))}</td>
        <td>${esc(m.kind)}</td>
        <td class="name">${esc(m.name)}</td>
        <td class="n">${esc(m.n ?? (m.result && m.result.n) ?? "—")}</td>
        <td class="n">${esc(m.peaks ?? (m.result && m.result.peaks ? m.result.peaks.length : "—"))}</td>
        <td><span class="tpill ${esc(m.status)}">${esc(m.status)}</span></td>
        <td>${pushPill(m.push_status)}</td>
        <td class="r">${f ? `<a class="button rowbtn" href="${esc(API.url(`/api/finished/${m.id}/file/${encodeURIComponent(f)}`))}" target="_blank" rel="noopener">File</a>` : ""}</td>
    </tr>`;
  }).join("");
  const tbody = $("#res-table tbody");
  tbody.innerHTML = rows;
  $("#res-table").style.display = rows ? "" : "none";
  $("#res-empty").hidden = !!rows;
  tbody.onclick = ev => {
    if (ev.target.closest("a")) return;
    const tr = ev.target.closest("tr[data-id]");
    if (tr) openResult(tr.dataset.id);
  };
  tbody.onkeydown = ev => {
    const tr = ev.target.closest("tr[data-id]");
    if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openResult(tr.dataset.id); }
  };
  const keep = SELECTED && MEASUREMENTS.some(m => m.id === SELECTED);
  if (MEASUREMENTS.length) openResult(keep ? SELECTED : MEASUREMENTS[0].id);
  else $("#res-detail").hidden = true;
}

let PLOT = null;
async function openResult(id) {
  SELECTED = id;
  $$("#res-table tbody tr").forEach(tr => tr.classList.toggle("sel", tr.dataset.id === id));
  try {
    const { measurement: m } = await API.req(`/api/finished/${id}?spectrum=1`);
    $("#res-detail").hidden = false;
    $("#rd-title").textContent = m.name || ("Spectrum " + shortId(id));
    $("#rd-sub").textContent = [m.kind, shortDt(m.finished), shortId(m.id)].filter(Boolean).join(" · ");
    $("#rd-err").textContent = (m.status === "finished" ? "" : "Job " + m.status + (m.error ? ": " + m.error : ""));
    const res = m.result || {};
    const st = res.stats || {};
    const chips = [
      ["Points", res.n],
      ["Unit", res.unit],
      ["Range", res.xMin != null ? fmtNum(res.xMin, 0) + "–" + fmtNum(res.xMax, 0) + " cm⁻¹" : null],
      ["Mean", st.mean != null ? fmtNum(st.mean, 3) : null],
      ["Min", st.min != null ? fmtNum(st.min, 3) : null],
      ["Max", st.max != null ? fmtNum(st.max, 3) : null],
      ["Push", (m.push_status || "off").replace("not_configured", "off")],
    ].filter(c => c[1] != null);
    $("#rd-chips").innerHTML = chips.map(c => `<div class="chip"><span>${c[0]}</span><b>${esc(c[1])}</b></div>`).join("");
    $("#rd-chips").hidden = !chips.length;

    // contract: x/y/peaks live on result (API.md §3.2); older builds used m.spectrum
    const sp = (m.spectrum && m.spectrum.x) ? m.spectrum : res;
    const plot = $("#rd-canvas").closest(".plot");
    if (sp.x && sp.x.length && sp.y && sp.y.length) {
      PLOT = { xs: sp.x, ys: sp.y, peaks: sp.peaks || res.peaks || [], unit: res.unit || "" };
      plot.hidden = false;
      drawSpectrum();
    } else {
      PLOT = null;
      plot.hidden = true;
      if (m.status === "finished") $("#rd-err").textContent += " (no decodable spectrum)";
    }
    const csv = (m.files || []).find(f => /\.csv$/i.test(f));
    const xml = baseName(res.sourceFile) || (m.files || []).find(f => /\.xml$/i.test(f));
    linkHref($("#rd-csv"), m.status === "finished" && csv ? API.url(`/api/finished/${id}/file/${encodeURIComponent(baseName(csv))}`) : "");
    linkHref($("#rd-xml"), xml ? API.url(`/api/finished/${id}/file/${encodeURIComponent(baseName(xml))}`) : "");
  } catch (e) {
    $("#res-detail").hidden = false;
    $("#rd-err").textContent = e.message;
  }
}
function linkHref(a, href) {
  if (href) { a.href = href; a.hidden = false; }
  else { a.removeAttribute("href"); a.hidden = true; }
}

/* ------------------------- canvas spectrum plot (vanilla, dependency-free)
 * IR convention: wavenumber axis runs high → low (left → right). */
const PLOT_C = {
  trace: "#006C66", grid: "#EEEEEE", frame: "#A7A7A8", text: "#5f5f5f",
  peak: "#EF7C00", cross: "#29485D", font: '11px Roboto, Arial, sans-serif',
};
function niceStep(range, target) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
function drawSpectrum(hover) {
  if (!PLOT) return;
  const cv = $("#rd-canvas");
  const { xs, ys, peaks, unit } = PLOT;
  const DPR = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 1100, H = cv.clientHeight || 420;
  if (cv.width !== Math.round(W * DPR) || cv.height !== Math.round(H * DPR)) {
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  const g = cv.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);

  const L = 64, R = 18, T = 16, B = 50;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < x0) x0 = xs[i]; if (xs[i] > x1) x1 = xs[i];
    if (ys[i] < y0) y0 = ys[i]; if (ys[i] > y1) y1 = ys[i];
  }
  if (x1 - x0 < 1e-9) { x1 += 1; x0 -= 1; }
  if (y1 - y0 < 1e-9) { y1 += 1; y0 -= 1; }
  const pad = (y1 - y0) * 0.07; y0 -= pad; y1 += pad;
  const pw = W - L - R, ph = H - T - B;
  const px = v => L + (x1 - v) / (x1 - x0) * pw;          // reversed axis
  const py = v => T + (1 - (v - y0) / (y1 - y0)) * ph;
  PLOT.geo = { L, R, T, B, W, H, x0, x1, px };

  g.font = PLOT_C.font;
  g.lineWidth = 1;
  // y grid + ticks
  const ys0 = niceStep(y1 - y0, 5), ydig = Math.max(0, -Math.floor(Math.log10(ys0)));
  g.textAlign = "right"; g.textBaseline = "middle";
  for (let v = Math.ceil(y0 / ys0) * ys0; v <= y1; v += ys0) {
    const yy = Math.round(py(v)) + .5;
    g.strokeStyle = PLOT_C.grid; g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
    g.fillStyle = PLOT_C.text; g.fillText(v.toFixed(Math.min(ydig, 4)), L - 8, yy);
  }
  // x grid + ticks
  const xs0 = niceStep(x1 - x0, Math.max(4, Math.floor(pw / 90)));
  g.textAlign = "center"; g.textBaseline = "top";
  for (let v = Math.ceil(x0 / xs0) * xs0; v <= x1; v += xs0) {
    const xx = Math.round(px(v)) + .5;
    g.strokeStyle = PLOT_C.grid; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
    g.fillStyle = PLOT_C.text; g.fillText(v.toFixed(0), xx, T + ph + 8);
  }
  // axis titles
  g.font = 'bold 10.5px Roboto, Arial, sans-serif';
  g.fillStyle = PLOT_C.text;
  g.fillText("WAVENUMBER  (cm⁻¹)", L + pw / 2, H - 18);
  if (unit) {
    g.save(); g.translate(14, T + ph / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = "middle"; g.fillText(String(unit).toUpperCase(), 0, 0); g.restore();
  }
  // frame (bottom + left only — flat, open)
  g.strokeStyle = PLOT_C.frame;
  g.beginPath(); g.moveTo(L + .5, T); g.lineTo(L + .5, T + ph + .5); g.lineTo(W - R, T + ph + .5); g.stroke();

  // trace (downsample to ~2*W points)
  g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
  const STEP = Math.max(1, Math.floor(xs.length / (W * 2)));
  g.beginPath();
  for (let i = 0; i < xs.length; i += STEP) {
    const xx = px(xs[i]), yy = py(ys[i]);
    if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
  }
  g.strokeStyle = PLOT_C.trace;
  g.lineWidth = 1.5;
  g.lineJoin = "round";
  g.stroke();
  g.restore();

  // peaks: contract {pos, prominence}; tolerate {x, y}
  const pk = peaks.slice(0, 12).map(p => {
    const x = p.pos ?? p.x;
    return { x, y: p.y ?? yAt(x) };
  }).filter(p => p.x != null && p.y != null);
  g.font = PLOT_C.font; g.textAlign = "center";
  const mid = (y0 + y1) / 2;   // dips (%T) get labels below, maxima (Abs) above
  pk.forEach((p, i) => {
    const xx = px(p.x), yy = py(p.y);
    g.fillStyle = PLOT_C.peak;
    g.fillRect(Math.round(xx) - 3, Math.round(yy) - 3, 6, 6);
    if (i < 6) {
      const below = p.y < mid ? yy < T + ph - 22 : yy < T + 22;
      g.fillStyle = "#000";
      g.textBaseline = below ? "top" : "bottom";
      g.fillText(fmtNum(p.x, 0), Math.max(L + 16, Math.min(W - R - 16, xx)), below ? yy + 7 : yy - 7);
    }
  });

  // hover crosshair
  const read = $("#rd-read");
  if (hover != null) {
    const xx = px(hover.x), yy = py(hover.y);
    g.strokeStyle = PLOT_C.cross; g.lineWidth = 1; g.setLineDash([3, 3]);
    g.beginPath(); g.moveTo(Math.round(xx) + .5, T); g.lineTo(Math.round(xx) + .5, T + ph); g.stroke();
    g.setLineDash([]);
    g.fillStyle = "#fff"; g.strokeStyle = PLOT_C.cross; g.lineWidth = 1.5;
    g.beginPath(); g.arc(xx, yy, 4, 0, Math.PI * 2); g.fill(); g.stroke();
    read.hidden = false;
    read.innerHTML = `<b>${fmtNum(hover.x, 1)}</b> cm⁻¹ · ${fmtNum(hover.y, 3)} ${esc(unit)}`;
  } else {
    read.hidden = true;
  }
}
function yAt(x) {
  if (!PLOT) return null;
  const { xs, ys } = PLOT;
  let best = 0, bd = Infinity;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
  return ys[best];
}
(function wirePlot() {
  const cv = $("#rd-canvas");
  cv.addEventListener("mousemove", ev => {
    if (!PLOT || !PLOT.geo) return;
    const { L, R, W, x0, x1 } = PLOT.geo;
    const rect = cv.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    if (mx < L || mx > W - R) return drawSpectrum();
    const x = x1 - (mx - L) / (W - L - R) * (x1 - x0);
    drawSpectrum({ x: x, y: yAt(x) });
  });
  cv.addEventListener("mouseleave", () => drawSpectrum());
  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => drawSpectrum(), 80); });
})();

/* ------------------------------------------------------------- settings */
async function refreshSettings() {
  $("#sv-base").textContent = API.base || "same origin";
  try {
    const h = await API.req("/health");
    $("#sv-ver").textContent = h.version || "—";
    $("#sv-uptime").textContent = fmtUptime(h.uptime_s);
    $("#sv-token").textContent = h.tokenRequired
      ? (API.token ? "required · set in this browser" : "required (X-Fishy-Token) · not set")
      : "off (loopback)";
    $("#sv-dir").textContent = h.resultsDir || "—";
  } catch (e) { /* offline */ }
  try {
    const st = (await API.req("/api/instrument/status")).instrument || {};
    $("#st-ready").textContent = st.readyState
      ? st.readyState + (st.description ? " — " + st.description : "")
      : (st.busy ? "busy: " + (st.phase || "measuring") : "—");
    $("#st-session").textContent = st.session || (st.busy ? "in use by the running measurement" : "not connected yet (lazy)");
    const b = st.background || (LAST_HEALTH && LAST_HEALTH.background);
    const el = $("#st-bgrule");
    el.textContent = b ? `last ${b.measuredAt ? shortDt(b.measuredAt) : "never"} · limit ${b.maxAgeHours} h` : "—";
    el.className = b ? (b.ok ? "good" : "warn") : "";
    if (b && !b.ok && b.warning) el.textContent += " · " + b.warning;
  } catch (e) {
    $("#st-ready").textContent = "offline (" + e.message + ")";
    $("#st-ready").className = "bad";
  }
  try { $("#st-time").textContent = (await API.req("/api/instrument/time")).time || "unreachable"; } catch (e) { /* offline */ }
}
function fmtUptime(s) {
  if (s == null) return "—";
  const m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24);
  return d ? `${d} d ${h % 24} h` : h ? `${h} h ${m % 60} min` : `${m} min`;
}
$("#btn-st-refresh").onclick = refreshSettings;
$("#btn-opt").onclick = async () => {
  const out = $("#opt-out"), msg = $("#opt-msg");
  const det = $("#opt-det").value;
  setMsg(msg, "Asking engine…");
  out.hidden = true;
  try {
    const d = await API.req("/api/settings/optimal?detector=" + encodeURIComponent(det));
    const v = d.optimal || d;
    out.innerHTML = Object.entries(v).map(([k, val]) =>
      `<dt>${esc(k)}</dt><dd>${esc(typeof val === "object" ? JSON.stringify(val) : val)}</dd>`).join("");
    out.hidden = false;
    setMsg(msg, "");
  } catch (e) { setMsg(msg, e.message, "err"); }
};
$("#btn-push-test").onclick = async () => {
  const m = $("#push-msg");
  setMsg(m, "Firing push…");
  try {
    const r = await API.req("/api/push/test", { method: "POST" });
    setMsg(m, `Remote answered ${r.status} · ${r.ok ? "OK" : "rejected"}`, r.ok ? "ok" : "err");
  } catch (e) { setMsg(m, e.message, "err"); }
};

function renderConstraints(settings) {
  const rows = Object.entries(settings || {}).map(([k, c]) => {
    c = c || {};
    const valid = Array.isArray(c.valid) ? c.valid.join(" – ") : (c.valid ?? "");
    return `<tr><td class="name">${esc(c.label || c.name || k)}<small>${esc(c.description || "")}</small></td>
      <td class="mono">${esc(valid)}</td><td class="mono">${esc(c.step ?? "")}</td><td class="mono">${esc(c.unit ?? "")}</td></tr>`;
  }).join("");
  return rows
    ? `<table><thead><tr><th>Parameter</th><th>Valid</th><th>Step</th><th>Unit</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="msg">No constraints reported.</p>`;
}
function renderObject(obj) {
  const entries = Object.entries(obj || {});
  return entries.length
    ? `<dl class="kv">${entries.map(([k, v]) =>
        `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>`
    : `<p class="msg">Nothing reported.</p>`;
}
function lazyDetails(detailsSel, outSel, path, render) {
  $(detailsSel).addEventListener("toggle", async ev => {
    if (!ev.target.open) return;
    const out = $(outSel);
    out.innerHTML = `<p class="msg">Loading…</p>`;
    try { out.innerHTML = render(await API.req(path)); }
    catch (e) { out.innerHTML = `<p class="msg err">${esc(e.message)} — instrument offline?</p>`; }
  });
}
lazyDetails("#con-details", "#con-out", "/api/settings/constraints", d => renderConstraints(d.settings));
lazyDetails("#xml-details", "#xml-out", "/api/settings/instrumentxml", d => renderObject(d.instrumentxml || d));

/* ------------------------------------------------------------------- api */
async function refreshApi() {
  $("#api-openapi").href = API.url("/openapi.yaml");
  try {
    const d = await API.req("/api/docs");
    $("#api-auth").textContent = "Auth: " + (d.auth || "—") + (API.token ? " · token set in this browser" : "");
    $("#api-src").textContent = [d.service, d.version].filter(Boolean).join(" ") || "served by the running service";
    const eps = d.endpoints || [];
    $("#api-table tbody").innerHTML = eps.map(e => {
      const m = String(e.method || e.m || "").toUpperCase();
      return `<tr><td><span class="method ${esc(m.toLowerCase())}">${esc(m)}</span></td>
        <td><code>${esc(e.path || e.p)}</code></td><td class="hint">${esc(e.description || e.d)}</td></tr>`;
    }).join("");
    $("#api-table").style.display = eps.length ? "" : "none";
    $("#api-empty").hidden = !!eps.length;
  } catch (e) {
    $("#api-table").style.display = "none";
    $("#api-empty").hidden = false;
  }
}

/* ------------------------------------------------------------- boot ----- */
async function pollHealth() {
  try {
    const h = await API.req("/health");
    LAST_HEALTH = h;
    $("#rail-ver").textContent = h.version ? "v" + String(h.version).replace(/^v/, "") : "online";
    const e = $("#eng-pill");
    if (h.busy) setPill(e, "busy", "Measuring" + (h.phase && h.phase !== "idle" ? " · " + h.phase : ""));
    else if (h.connected) setPill(e, "ok", "Engine ready");
    else setPill(e, "", "Engine idle");
    $("#rail-dot").className = "dot " + (h.busy ? "busy" : "ok");

    const b = h.background, bgp = $("#bg-pill");
    if (b && !b.ok) setPill(bgp, "warn", b.measuredAt ? "Background stale" : "No background");
    else if (b && b.ok) setPill(bgp, "ok", "Background ok");
    else setPill(bgp, "", "Background —");

    // queue stat blocks
    const qs = $("#qs-state");
    qs.textContent = h.busy ? "Measuring" : h.connected ? "Ready" : "Idle";
    qs.className = "stat-v " + (h.busy ? "" : h.connected ? "is-ok" : "");
    $("#qs-state-sub").textContent = h.busy ? (h.phase || "busy") + " · " + shortId(h.current) : h.connected ? "engine connected" : "connects on first job";
    const qb = $("#qs-bg");
    qb.textContent = !b ? "—" : b.ok ? "Fresh" : b.measuredAt ? "Expired" : "None";
    qb.className = "stat-v " + (!b ? "" : b.ok ? "is-ok" : "is-warn");
    $("#qs-bg-sub").textContent = !b ? "—" : b.measuredAt ? `${b.ageHours} h old · limit ${b.maxAgeHours} h` : `limit ${b.maxAgeHours} h`;

    refreshBanners(h);
    if (h.tokenRequired && !API.token && !TOKEN_ASKED) promptToken();
    if (VIEW === "live") refreshLive();
    else if (VIEW === "queue" && h.busy !== QUEUE_BUSY) refreshQueue();
    QUEUE_BUSY = h.busy;
  } catch (err) {
    LAST_HEALTH = null;
    setPill($("#eng-pill"), "err", "Service offline");
    setPill($("#bg-pill"), "", "Background —");
    $("#rail-dot").className = "dot err";
    $("#rail-ver").textContent = "offline";
    $("#qs-state").textContent = "Offline";
    $("#qs-state").className = "stat-v is-err";
    $("#qs-state-sub").textContent = "service not reachable";
    if (VIEW === "live") liveOffline();
  }
}
let QUEUE_BUSY = null;
pollHealth();
setInterval(pollHealth, 3000);
show(location.hash.slice(1) || "queue");
