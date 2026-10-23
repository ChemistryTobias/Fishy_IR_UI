/* fishy_ir UI client — vanilla JS, no deps, offline-safe, desktop.
 * One main page (status · queue · recent) + a slide-in panel for everything else.
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
const today = () => new Date().toISOString().slice(0, 10);
function shortDt(s) { return s ? String(s).replace("T", " ").slice(0, 16) : "—"; }
function whenDt(s) {   // today → HH:MM, otherwise date + time
  if (!s) return "—";
  return String(s).slice(0, 10) === today() ? String(s).slice(11, 16) : shortDt(s);
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
function setMsg(el, text, cls) {
  el.className = "msg" + (cls ? " " + cls : "");
  el.textContent = text || "";
}
function jobTime(j) { return j.finished || j.started || j.created || j.createdAt || ""; }

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
      tick();
    } else {
      toast("A token is required for /api/* calls", "warn");
    }
  }, { once: true });
}
$("#btn-token").onclick = promptToken;

/* ===================================================== metadata (YAML/JSON)
 * A small, dependency-free YAML subset: block mappings and lists, nested by
 * spaces, `- key: v` list items, quoted strings, numbers, true/false/null,
 * `|` / `>` block text and simple one-level [a, b] / {a: 1} flow values.
 * Anything starting with { or [ is parsed as JSON. */
function yamlError(n, msg) { const e = new Error(`line ${n}: ${msg}`); e.line = n; return e; }
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === q && s[i - 1] !== "\\") q = null; }
    else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i);
  }
  return s;
}
function splitFlow(s) {
  const out = []; let q = null, cur = "";
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; }
    else if (c === '"' || c === "'") { q = c; cur += c; }
    else if (c === ",") { out.push(cur.trim()); cur = ""; }
    else cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
function yamlScalar(s, n) {
  s = s.trim();
  if (s.startsWith('"')) {
    try { return JSON.parse(s); } catch (e) { throw yamlError(n, "unterminated or invalid \"string\""); }
  }
  if (s.startsWith("'")) {
    if (!s.endsWith("'") || s.length < 2) throw yamlError(n, "unterminated 'string'");
    return s.slice(1, -1).replace(/''/g, "'");
  }
  if (s.startsWith("[") || s.startsWith("{")) {
    try { return JSON.parse(s); } catch (e) { /* YAML flow style */ }
    const inner = s.slice(1, -1);
    if (!(s.endsWith("]") || s.endsWith("}")) || /[\[\]{}]/.test(inner)) throw yamlError(n, "nested flow values must be valid JSON");
    if (s[0] === "[") return splitFlow(inner).map(v => yamlScalar(v, n));
    const o = {};
    for (const part of splitFlow(inner)) {
      const m = part.match(/^([^:]+?)\s*:\s*(.*)$/);
      if (!m) throw yamlError(n, "expected 'key: value' inside { }");
      o[yamlKey(m[1])] = yamlScalar(m[2], n);
    }
    return o;
  }
  if (s === "true" || s === "True" || s === "TRUE") return true;
  if (s === "false" || s === "False" || s === "FALSE") return false;
  if (s === "null" || s === "Null" || s === "~" || s === "") return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) && !/^[-+]?0\d/.test(s)) return Number(s);
  return s;
}
function yamlKey(k) {
  k = k.trim();
  if (k.startsWith('"')) return JSON.parse(k);
  if (k.startsWith("'")) return k.slice(1, -1).replace(/''/g, "'");
  return k;
}
function parseYAML(src) {
  const L = [];
  src.replace(/\r/g, "").split("\n").forEach((raw, i) => {
    const lead = raw.match(/^[ \t]*/)[0];
    const s = stripComment(raw);
    if (!s.trim() || s.trim() === "---") return;
    if (lead.includes("\t")) throw yamlError(i + 1, "use spaces, not tabs, for indentation");
    L.push({ ind: lead.length, text: s.trim(), n: i + 1 });
  });
  let p = 0;
  const isItem = t => t === "-" || t.startsWith("- ");
  const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:(?:\s+(.*))?$/;
  function block(ind) { return isItem(L[p].text) ? list(ind) : map(ind); }
  function blockText(ind, style) {
    const rows = [];
    while (p < L.length && L[p].ind > ind) rows.push(L[p++]);
    if (!rows.length) return "";
    const base = Math.min(...rows.map(r => r.ind));
    const lines = rows.map(r => " ".repeat(r.ind - base) + r.text);
    return style === ">" ? lines.join(" ") : lines.join("\n");
  }
  function map(ind) {
    const o = {};
    while (p < L.length && L[p].ind === ind && !isItem(L[p].text)) {
      const ln = L[p];
      const m = ln.text.match(KEY);
      if (!m) throw yamlError(ln.n, "expected 'key: value'");
      const key = yamlKey(m[1]), rest = m[2];
      if (Object.prototype.hasOwnProperty.call(o, key)) throw yamlError(ln.n, `duplicate key "${key}"`);
      p++;
      if (rest === undefined || rest === "") {
        const nxt = L[p];
        o[key] = nxt && (nxt.ind > ind || (nxt.ind === ind && isItem(nxt.text))) ? block(nxt.ind) : null;
      } else if (/^[|>][-+]?$/.test(rest)) {
        o[key] = blockText(ind, rest[0]);
      } else {
        o[key] = yamlScalar(rest, ln.n);
      }
    }
    if (p < L.length && L[p].ind > ind) throw yamlError(L[p].n, "unexpected indentation");
    return o;
  }
  function list(ind) {
    const a = [];
    while (p < L.length && L[p].ind === ind && isItem(L[p].text)) {
      const ln = L[p];
      const after = ln.text.slice(1);
      const rest = after.trim();
      if (!rest) { p++; a.push(p < L.length && L[p].ind > ind ? block(L[p].ind) : null); continue; }
      const opensMap = KEY.test(rest) && !/^[\[{]/.test(rest) &&
        (!/^["']/.test(rest) || /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*:(\s|$)/.test(rest));
      if (opensMap) {
        const childInd = ind + 1 + after.match(/^ */)[0].length;
        L[p] = { ind: childInd, text: rest, n: ln.n };    // "- key: v" opens a mapping
        a.push(map(childInd));
      } else {
        p++;
        a.push(yamlScalar(rest, ln.n));
      }
    }
    return a;
  }
  if (!L.length) return null;
  const out = block(L[0].ind);
  if (p < L.length) throw yamlError(L[p].n, "unexpected content (check indentation)");
  return out;
}
function toYAML(v, ind = 0) {
  const pad = " ".repeat(ind);
  const sc = x => {
    if (x === null || x === undefined) return "null";
    if (typeof x === "number" || typeof x === "boolean") return String(x);
    const s = String(x);
    return (/^[\w./@-][\w ./@()+-]*$/.test(s) && yamlScalar(s, 0) === s && !/\s$/.test(s)) ? s : JSON.stringify(s);
  };
  if (Array.isArray(v)) {
    if (!v.length) return pad + "[]";
    return v.map(x => (x && typeof x === "object")
      ? pad + "- " + toYAML(x, ind + 2).trimStart()
      : pad + "- " + sc(x)).join("\n");
  }
  if (v && typeof v === "object") {
    const ks = Object.keys(v);
    if (!ks.length) return pad + "{}";
    return ks.map(k => {
      const x = v[k], key = /^[\w.-]+$/.test(k) ? k : JSON.stringify(k);
      if (x && typeof x === "object" && Object.keys(x).length) return pad + key + ":\n" + toYAML(x, ind + 2);
      if (typeof x === "string" && x.includes("\n")) return pad + key + ": |\n" + x.split("\n").map(l => pad + "  " + l).join("\n");
      return pad + key + ": " + (x && typeof x === "object" ? (Array.isArray(x) ? "[]" : "{}") : sc(x));
    }).join("\n");
  }
  return pad + sc(v);
}
function parseMeta(text) {
  const t = (text || "").trim();
  if (!t) return { value: null, fmt: "" };
  let value, fmt;
  if (t[0] === "{" || t[0] === "[") {
    fmt = "json";
    try { value = JSON.parse(t); }
    catch (e) { throw new Error("JSON: " + e.message.replace(/^JSON\.parse: /, "")); }
  } else {
    fmt = "yaml";
    value = parseYAML(t);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("metadata must be a mapping (key: value), not a list or a single value");
  return { value, fmt };
}
function parseHeaders(text) {
  const t = (text || "").trim();
  if (!t) return {};
  let h = {};
  if (t[0] === "{") {
    try { h = JSON.parse(t); } catch (e) { throw new Error("headers JSON: " + e.message); }
    if (!h || typeof h !== "object" || Array.isArray(h)) throw new Error("headers must be an object");
  } else {
    t.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const m = line.match(/^\s*([^:\s]+)\s*:\s*(.*)$/);
      if (!m) throw new Error(`headers line ${i + 1}: expected "Name: value"`);
      h[m[1]] = m[2].trim();
    });
  }
  for (const k of Object.keys(h)) {
    if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(k)) throw new Error(`invalid header name "${k}"`);
    h[k] = String(h[k]);
  }
  return h;
}

/* --------------------------------------------------- job extras
 * Metadata + per-job output (save path, API push) are not in the API
 * contract yet — see ../BACKEND_REQUESTS.md for what the service must add.
 *   FEATURES.jobExtras = false (default, works with today's service):
 *     they travel inside the job's free-text `notes` as a small JSON envelope,
 *     so they at least stay with the measurement.
 *   FEATURES.jobExtras = true (once the service implements the request):
 *     they are sent as first-class `metadata` / `output` fields.
 * Reading always prefers first-class fields and falls back to the envelope. */
const FEATURES = { jobExtras: false };   // switched on automatically when /health lists "job.extras"
const ENVELOPE = "fishy_ui";
function jobExtras(j) {
  if (j && (j.metadata || j.output)) {
    return { metadata: j.metadata || null, metadataText: j.metadata ? toYAML(j.metadata) : "", output: j.output || null };
  }
  return decodeNotes(j && j.notes);
}
function extrasPayload(extras) {
  if (FEATURES.jobExtras) return { metadata: extras.metadata || null, output: extras.output || null };
  return { notes: encodeNotes(extras) };
}
function encodeNotes({ metadata, metadataText, output }) {
  const env = { [ENVELOPE]: 1 };
  if (metadata) { env.metadata = metadata; env.metadataText = metadataText; }
  if (output && (output.path || output.push)) env.output = output;
  return Object.keys(env).length > 1 ? JSON.stringify(env) : "";
}
function decodeNotes(notes) {
  if (!notes) return { metadata: null, metadataText: "", output: null };
  try {
    const env = JSON.parse(notes);
    if (env && env[ENVELOPE]) {
      return {
        metadata: env.metadata || null,
        metadataText: env.metadataText || (env.metadata ? toYAML(env.metadata) : ""),
        output: env.output || null,
      };
    }
  } catch (e) { /* plain text notes */ }
  return { metadata: { notes }, metadataText: toYAML({ notes }), output: null, plain: true };
}
function metaSummary(meta) {
  if (!meta) return "";
  const flat = [];
  for (const [k, v] of Object.entries(meta)) {
    if (v && typeof v === "object") flat.push(k);
    else flat.push(k + ": " + v);
    if (flat.length >= 3) break;
  }
  return flat.join(" · ");
}

/* ====================================================== slide-in panel */
let STACK = [];               // [{ view, id?, title, sub }]
let FORM_DIRTY = false;
const scrim = $("#scrim"), panel = $("#panel");

function openPanel(entry, reset) {
  if (reset) STACK = [];
  STACK.push(entry);
  renderPanel();
}
async function panelBack() {
  if (panelTop().view === "form" && FORM_DIRTY &&
      !await confirmDialog({ title: "Discard changes?", body: "Your changes to this measurement have not been saved.", ok: "Discard", danger: true })) return;
  FORM_DIRTY = false;
  STACK.pop();
  if (STACK.length) renderPanel(); else closePanel();
}
function closePanel() {
  STACK = [];
  FORM_DIRTY = false;
  panel.classList.remove("open");
  panel.setAttribute("aria-hidden", "true");
  scrim.hidden = true;
  document.body.classList.remove("panel-open");
  PLOT = null;
}
const panelTop = () => STACK[STACK.length - 1] || {};
function setPanelTitle(title, sub) {
  $("#pn-title").textContent = title || "";
  $("#pn-sub").textContent = sub || "";
}
function renderPanel() {
  const e = panelTop();
  $$("#panel [data-pv]").forEach(s => { s.hidden = s.dataset.pv !== e.view; });
  $("#pn-back-l").textContent = STACK.length > 1 ? "Back" : "Overview";
  panel.classList.add("open");
  panel.setAttribute("aria-hidden", "false");
  scrim.hidden = false;
  document.body.classList.add("panel-open");
  $(".panel-body").scrollTop = 0;
  if (e.view === "form") renderForm(e);
  if (e.view === "live") { setPanelTitle("Current measurement", shortId(e.id)); refreshLive(); }
  if (e.view === "recent") { setPanelTitle("Recent activity", "finished, failed and aborted measurements"); refreshRecent(); }
  if (e.view === "result") { setPanelTitle("Measurement", shortId(e.id)); openResult(e.id); }
  if (e.view === "settings") { setPanelTitle("Settings", "instrument · service · API"); showSettingsTab(); }
  setTimeout(() => { const b = $("#pn-back"); if (document.activeElement === document.body) b.focus(); }, 50);
}
$("#pn-back").onclick = panelBack;
scrim.onclick = () => { if (!FORM_DIRTY) closePanel(); else panelBack(); };
document.addEventListener("keydown", ev => {
  if (ev.key === "Escape" && STACK.length && !document.querySelector("dialog[open]")) { ev.preventDefault(); panelBack(); }
});

/* ------------------------------------------------------------ open helpers */
function openJob(j) {
  if (!j) return;
  if (j.status === "staged") openPanel({ view: "form", id: j.id }, true);
  else if (j.status === "running") openPanel({ view: "live", id: j.id }, true);
  else openPanel({ view: "result", id: j.id }, true);
}
$("#btn-new").onclick = () => openPanel({ view: "form" }, true);
$("#btn-recent").onclick = () => openPanel({ view: "recent" }, true);
$("#btn-settings").onclick = () => openPanel({ view: "settings" }, true);
$("#btn-follow").onclick = () => { if (LAST_HEALTH && LAST_HEALTH.current) openPanel({ view: "live", id: LAST_HEALTH.current }, true); };
$("#lv-recent").onclick = () => openPanel({ view: "recent" });

/* =========================================================== main page */
let LAST_HEALTH = null, JOBS = [], INST = null, INST_ERR = null, INST_AT = 0, STOPPING = false;
let HIGHLIGHT = null;
const DISMISSED_KEY = "fishyDismissedFailure";

const PHASES = ["connecting", "collecting", "processing", "pushing"];
function paintPhases(list, busy, phase) {
  const idx = PHASES.indexOf(phase);
  $$(list + " li").forEach((li, i) => { li.className = !busy ? "" : i < idx ? "done" : i === idx ? "now" : ""; });
}

function lastCompleted() {
  return JOBS.filter(j => ["finished", "failed", "aborted"].includes(j.status))
    .sort((a, b) => jobTime(b).localeCompare(jobTime(a)))[0] || null;
}

function renderHero() {
  const h = LAST_HEALTH, hero = $("#hero");
  const show = (sel, on) => { $(sel).hidden = !on; };
  let state, title, sub = "";
  const failed = lastCompleted();
  const failure = failed && failed.status === "failed" && store.get(DISMISSED_KEY) !== failed.id ? failed : null;
  if (!h) {
    state = "offline"; title = "Offline";
    sub = "The fishy_ir service is not reachable. The page keeps retrying every few seconds.";
  } else if (h.busy) {
    state = STOPPING ? "stopping" : "running";
    title = STOPPING ? "Stopping" : "Running";
    const j = JOBS.find(x => x.id === h.current);
    sub = j ? `<b>${esc(j.name) || shortId(j.id)}</b> · ${esc(j.kind)}<span class="mono">${esc(shortId(j.id))}</span>`
            : `<span class="mono">${esc(shortId(h.current))}</span>`;
    sub += ` · ${esc(h.phase || "busy")}`;
  } else if (INST_ERR) {
    state = "error"; title = "Error"; sub = "Instrument not reachable: " + esc(INST_ERR);
  } else if (failure) {
    state = "error"; title = "Error";
    sub = `Last measurement <b>${esc(failure.name) || shortId(failure.id)}</b> failed` +
          (failure.error ? `: ${esc(failure.error)}` : ".");
  } else {
    state = "idle"; title = "Idle";
    sub = h.connected ? "Ready for the next measurement." : "Ready · the engine connects on the first measurement.";
  }
  hero.dataset.state = state;
  $("#hs-state").textContent = title;
  $("#hs-sub").innerHTML = sub;
  $("#hs-phases").hidden = !(h && h.busy);
  if (h) paintPhases("#hs-phases", h.busy, h.phase);
  show("#btn-follow", h && h.busy);
  show("#btn-stop", h && h.busy && !STOPPING);
  show("#btn-err-open", state === "error" && !!failure && !INST_ERR);
  show("#btn-err-dismiss", state === "error" && !!failure && !INST_ERR);
  $("#btn-err-open").onclick = () => failure && openPanel({ view: "result", id: failure.id }, true);
  $("#btn-err-dismiss").onclick = () => { if (failure) store.set(DISMISSED_KEY, failure.id); renderHero(); };

  // facts
  const b = h && h.background;
  const bgv = $("#hs-bg");
  bgv.textContent = !b ? "—" : b.ok ? "Fresh" : b.measuredAt ? "Expired" : "None";
  bgv.className = "fact-v " + (!b ? "" : b.ok ? "is-ok" : "is-warn");
  $("#hs-bg-sub").textContent = !b ? "—" : b.measuredAt ? `${b.ageHours} h old · limit ${b.maxAgeHours} h` : `limit ${b.maxAgeHours} h`;
  $("#hf-bg").classList.toggle("warn", !!(b && !b.ok));
  $("#btn-bg").hidden = !(b && !b.ok && h && !h.busy);
  const warn = $("#hs-warn");
  warn.hidden = !(b && !b.ok && b.warning);
  if (b && b.warning) warn.textContent = "⚠ " + b.warning;

  const iv = $("#hs-inst");
  if (!h) { iv.textContent = "Offline"; iv.className = "fact-v is-err"; $("#hs-inst-sub").textContent = "service not reachable"; }
  else if (h.busy) { iv.textContent = "Busy"; iv.className = "fact-v"; $("#hs-inst-sub").textContent = h.phase || "measuring"; }
  else if (INST_ERR) { iv.textContent = "Error"; iv.className = "fact-v is-err"; $("#hs-inst-sub").textContent = INST_ERR; }
  else if (INST && INST.readyState) { iv.textContent = INST.readyState; iv.className = "fact-v is-ok"; $("#hs-inst-sub").textContent = INST.description || (h.connected ? "connected" : ""); }
  else { iv.textContent = h.connected ? "Connected" : "Idle"; iv.className = "fact-v" + (h.connected ? " is-ok" : ""); $("#hs-inst-sub").textContent = h.connected ? "engine connected" : "connects on first job"; }

  $("#hs-queue").textContent = JOBS.filter(j => j.status === "staged").length;

  $("#rail-dot").className = "dot " + (!h ? "err" : h.busy ? "busy" : "ok");
  $("#rail-ver").textContent = !h ? "offline" : h.version ? "fishy_ir v" + String(h.version).replace(/^v/, "") : "online";
}

$("#btn-stop").onclick = () => stopMeasurement();
$("#btn-bg").onclick = () => startBackgroundJob();

async function stopMeasurement() {
  if (!await confirmDialog({ title: "Stop measurement?", danger: true, ok: "Stop measurement",
    body: "The engine aborts the running scan within ~8 s. The job ends as “aborted”." })) return;
  try {
    await API.req("/api/instrument/stop", { method: "POST" });
    STOPPING = true;
    toast("Stop requested — engine aborts within ~8 s");
    renderHero();
  } catch (e) { toast(e.message, true); }
}

async function startBackgroundJob() {
  try {
    const name = "background-" + stamp();
    const r = await API.req("/api/jobs", {
      method: "POST",
      body: JSON.stringify({ name, kind: "background", params: {}, start_now: true }),
    });
    toast("Background started (" + shortId(r.job.id) + ")");
    await tick();
    openPanel({ view: "live", id: r.job.id }, true);
  } catch (e) {
    if (!handleBusy(e)) toast("Could not start: " + e.message, true);
  }
}

/* --------------------------------------------- 409 busy (concurrency UX) */
function handleBusy(e, msgEl) {
  if (!(e.status === 409 && e.body && e.body.busy)) return false;
  HIGHLIGHT = e.body.current || null;
  const text = e.message + (HIGHLIGHT ? " · running: " + shortId(HIGHLIGHT) : "");
  if (msgEl) setMsg(msgEl, text, "warn"); else toast(text, "warn");
  renderQueue();
  return true;
}

/* --------------------------------------------------------------- queue */
function outMarkers(out) {
  if (!out || (!out.path && !out.push)) return `<span class="out"><span class="none">default</span></span>`;
  return `<span class="out">${out.path ? `<span title="${esc(out.path)}">Path</span>` : ""}${out.push ? `<span title="${esc((out.push.method || "POST") + " " + out.push.url)}">API</span>` : ""}</span>`;
}
function renderQueue() {
  const current = LAST_HEALTH && LAST_HEALTH.current;
  const rows = JOBS.filter(j => j.status === "running" || j.status === "staged")
    .sort((a, b) => (a.status === "running" ? -1 : b.status === "running" ? 1 : 0)
      || String(a.created || a.createdAt || "").localeCompare(String(b.created || b.createdAt || "")));
  $("#queue-table tbody").innerHTML = rows.map(j => {
    const st = j.status, n = jobExtras(j);
    const act = st === "staged"
      ? `<button class="rowbtn primary" data-act="start" data-id="${esc(j.id)}"${LAST_HEALTH && LAST_HEALTH.busy ? " disabled title=\"Instrument busy\"" : ""}>Start</button>`
      : `<button class="rowbtn danger" data-act="stop" data-id="${esc(j.id)}">Stop</button>`;
    const cls = ["clickable", (st === "running" || j.id === current) ? "is-current" : "", j.id === HIGHLIGHT ? "flash" : ""].join(" ");
    const sub = metaSummary(n.metadata);
    return `<tr data-id="${esc(j.id)}" class="${cls}" tabindex="0">
        <td><span class="tpill ${esc(st)}">${esc(st === "staged" ? "queued" : st)}</span></td>
        <td class="name">${esc(j.name) || shortId(j.id)}${sub ? `<small>${esc(sub)}</small>` : ""}</td>
        <td>${esc(j.kind)}</td>
        <td class="mono">${esc(j.paramsSummary || "")}</td>
        <td>${outMarkers(n.output)}</td>
        <td class="mono when" title="${esc(j.created || j.createdAt || "")}">${esc(whenDt(j.created || j.createdAt))}</td>
        <td class="r">${act}</td></tr>`;
  }).join("");
  $("#queue-table").hidden = !rows.length;
  $("#queue-empty").hidden = !!rows.length;
  if (HIGHLIGHT) setTimeout(() => { HIGHLIGHT = null; }, 3500);
}
$("#queue-table tbody").addEventListener("click", async ev => {
  const btn = ev.target.closest("button[data-act]");
  const tr = ev.target.closest("tr[data-id]");
  if (!tr) return;
  const id = tr.dataset.id;
  if (!btn) return openJob(JOBS.find(j => j.id === id));
  try {
    if (btn.dataset.act === "start") {
      await API.req(`/api/jobs/${id}/start`, { method: "POST" });
      toast("Started " + shortId(id));
      await tick();
      openPanel({ view: "live", id }, true);
    } else if (btn.dataset.act === "stop") {
      await stopMeasurement();
    }
  } catch (e) {
    if (!handleBusy(e)) toast(e.message, true);
  }
});
$("#queue-table tbody").addEventListener("keydown", ev => {
  const tr = ev.target.closest("tr[data-id]");
  if (tr && ev.target === tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openJob(JOBS.find(j => j.id === tr.dataset.id)); }
});

/* ---------------------------------------------------------- recent bar */
function renderRecentBar() {
  const done = JOBS.filter(j => ["finished", "failed", "aborted"].includes(j.status))
    .sort((a, b) => jobTime(b).localeCompare(jobTime(a)));
  $("#rb-list").innerHTML = done.slice(0, 4).map(j =>
    `<span class="rb-item"><span class="tpill ${esc(j.status)}">${esc(j.status)}</span><b>${esc(j.name) || shortId(j.id)}</b><span class="mono">${esc(whenDt(jobTime(j)))}</span></span>`
  ).join("") || "No measurements yet";
}

/* ================================================================ form */
const F = {
  kind: () => ($("input[name=f-kind]:checked") || {}).value || "sample",
  setKind(k) { const r = $(`input[name=f-kind][value="${k}"]`); if (r) r.checked = true; kindHint(); },
};
function kindHint() {
  const bg = F.kind() === "background";
  $("#f-kind-hint").textContent = bg ? "Background only, on the KBr reference." : "Full round: automatic background check, then sample.";
  $("#f-name").placeholder = bg ? "e.g. background-morning" : "e.g. KBr pellet #12";
}
$$("input[name=f-kind]").forEach(r => r.addEventListener("change", kindHint));

function fillForm(j) {
  const p = (j && j.params) || {};
  const n = jobExtras(j);
  F.setKind((j && j.kind) || "sample");
  $("#f-name").value = (j && j.name) || "";
  $("#f-scans").value = p.scans ?? p.numberOfScans ?? 10;
  $("#f-res").value = p.resolution ?? 4;
  $("#f-start").value = p.start ?? p.startFrequency ?? 400;
  $("#f-end").value = p.end ?? p.endFrequency ?? 4000;
  $("#f-det").value = p.detector || "TGSA";
  $("#f-meta").value = n.metadataText || "";
  const o = n.output || {};
  $("#f-path").value = o.path || "";
  $("#f-push-on").checked = !!o.push;
  $("#f-push-method").value = (o.push && o.push.method) || "POST";
  $("#f-push-url").value = (o.push && o.push.url) || "";
  $("#f-push-headers").value = o.push && o.push.headers ? Object.entries(o.push.headers).map(([k, v]) => `${k}: ${v}`).join("\n") : "";
  $("#f-push").hidden = !$("#f-push-on").checked;
  checkMeta(); checkPush();
}
async function renderForm(e) {
  const isNew = !e.id;
  setMsg($("#f-msg"), "");
  $("#f-add").hidden = $("#f-addstart").hidden = !isNew;
  $("#f-save").hidden = $("#f-savestart").hidden = $("#f-del").hidden = isNew;
  if (isNew) {
    setPanelTitle("New measurement", "added to the queue · start now or later");
    fillForm(null);
    $("#f-name").focus();
  } else {
    setPanelTitle("Queued measurement", shortId(e.id) + " · editable until it starts");
    try {
      const j = (await API.req(`/api/jobs/${e.id}`)).job;
      if (j.status !== "staged") { STACK.pop(); openJob(j); return; }
      setPanelTitle(j.name || "Queued measurement", shortId(j.id) + " · queued · editable until it starts");
      fillForm(j);
    } catch (err) { setMsg($("#f-msg"), err.message, "err"); }
  }
  FORM_DIRTY = false;
  updateBusyHint();
}
function updateBusyHint() {
  const busy = !!(LAST_HEALTH && LAST_HEALTH.busy);
  $("#f-addstart").disabled = $("#f-savestart").disabled = busy;
  $("#f-addstart").title = $("#f-savestart").title = busy ? "Instrument busy — add it to the queue and start it later" : "";
}
$("[data-pv=form]").addEventListener("input", () => { FORM_DIRTY = true; });
$("#f-push-on").addEventListener("change", () => { $("#f-push").hidden = !$("#f-push-on").checked; checkPush(); });

function checkMeta() {
  const ta = $("#f-meta"), fmt = $("#f-meta-fmt"), msg = $("#f-meta-msg");
  try {
    const r = parseMeta(ta.value);
    ta.classList.toggle("good", !!r.value); ta.classList.remove("bad");
    fmt.className = "fmt good";
    fmt.textContent = r.value ? r.fmt.toUpperCase() + " ✓" : "";
    setMsg(msg, r.value ? Object.keys(r.value).length + " top-level field(s)" : "");
    return r;
  } catch (e) {
    ta.classList.add("bad"); ta.classList.remove("good");
    fmt.className = "fmt bad"; fmt.textContent = "Invalid";
    setMsg(msg, e.message, "err");
    return null;
  }
}
function checkPush() {
  const msg = $("#f-push-msg");
  if (!$("#f-push-on").checked) { setMsg(msg, ""); return { push: null }; }
  try {
    const url = $("#f-push-url").value.trim();
    if (url && !/^https?:\/\/[^\s/]+/i.test(url)) throw new Error("endpoint must be an http(s) URL");
    const headers = parseHeaders($("#f-push-headers").value);
    const n = Object.keys(headers).length;
    setMsg(msg, n ? n + " header(s)" : "");
    return { push: url ? { url, method: $("#f-push-method").value, headers } : null };
  } catch (e) { setMsg(msg, e.message, "err"); return null; }
}
let META_T = null;
$("#f-meta").addEventListener("input", () => { clearTimeout(META_T); META_T = setTimeout(checkMeta, 250); });
$("#f-meta").addEventListener("keydown", ev => {   // Tab inserts two spaces in the code box
  if (ev.key === "Tab" && !ev.shiftKey) {
    ev.preventDefault();
    const t = ev.target, s = t.selectionStart;
    t.setRangeText("  ", s, t.selectionEnd, "end");
    t.dispatchEvent(new Event("input", { bubbles: true }));
  }
});
["#f-push-url", "#f-push-headers", "#f-push-method"].forEach(s => $(s).addEventListener("input", checkPush));

function collectForm() {
  for (const id of ["#f-scans", "#f-res", "#f-start", "#f-end"]) {
    const el = $(id);
    if (!el.checkValidity() || el.value === "") { el.focus(); throw new Error(el.validationMessage || "Please fill in all parameters."); }
  }
  if (+$("#f-start").value >= +$("#f-end").value) { $("#f-end").focus(); throw new Error("End must be larger than start (cm⁻¹)."); }
  const meta = checkMeta();
  if (!meta) { $("#f-meta").focus(); throw new Error("Fix the metadata first."); }
  const push = checkPush();
  if (!push) { $("#f-push-headers").focus(); throw new Error("Fix the API endpoint settings first."); }
  if ($("#f-push-on").checked && !push.push) { $("#f-push-url").focus(); throw new Error("Enter the endpoint URL, or untick the API option."); }
  const path = $("#f-path").value.trim();
  const output = (path || push.push) ? Object.assign({}, path ? { path } : {}, push.push ? { push: push.push } : {}) : null;
  return {
    kind: F.kind(),
    name: $("#f-name").value.trim(),
    params: {
      scans: +$("#f-scans").value, resolution: +$("#f-res").value,
      start: +$("#f-start").value, end: +$("#f-end").value,
      detector: $("#f-det").value,
    },
    ...extrasPayload({ metadata: meta.value, metadataText: $("#f-meta").value.trim(), output }),
  };
}

async function submitNew(startNow) {
  const msg = $("#f-msg");
  let body;
  try { body = collectForm(); } catch (e) { return setMsg(msg, e.message, "err"); }
  setMsg(msg, startNow ? "Adding and starting…" : "Adding to queue…");
  try {
    const r = await API.req("/api/jobs", { method: "POST", body: JSON.stringify(Object.assign(body, { start_now: startNow })) });
    FORM_DIRTY = false;
    toast(startNow ? "Measurement started" : "Added to queue");
    await tick();
    if (startNow) openPanel({ view: "live", id: r.job.id }, true); else closePanel();
  } catch (e) {
    if (handleBusy(e, msg)) { FORM_DIRTY = false; tick(); } else setMsg(msg, e.message, "err");
  }
}
async function saveStaged(andStart) {
  const id = panelTop().id, msg = $("#f-msg");
  let body;
  try { body = collectForm(); } catch (e) { return setMsg(msg, e.message, "err"); }
  setMsg(msg, "Saving…");
  try {
    const j = (await API.req(`/api/jobs/${id}`)).job;
    await API.req(`/api/jobs/${id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: body.name || j.name, kind: body.kind,
        ...(FEATURES.jobExtras ? { metadata: body.metadata, output: body.output } : { notes: body.notes }),
        params: {
          ...j.params,
          scans: body.params.scans, resolution: body.params.resolution,
          startFrequency: body.params.start, endFrequency: body.params.end,
          detector: body.params.detector,
        },
      }),
    });
    FORM_DIRTY = false;
    if (andStart) {
      await API.req(`/api/jobs/${id}/start`, { method: "POST" });
      toast("Saved and started");
      await tick();
      openPanel({ view: "live", id }, true);
    } else {
      toast("Saved " + shortId(id));
      await tick();
      closePanel();
    }
  } catch (e) {
    if (!handleBusy(e, msg)) setMsg(msg, e.message, "err");
  }
}
$("#f-add").onclick = () => submitNew(false);
$("#f-addstart").onclick = () => submitNew(true);
$("#f-save").onclick = () => saveStaged(false);
$("#f-savestart").onclick = () => saveStaged(true);
$("#f-del").onclick = async () => {
  const id = panelTop().id;
  if (!await confirmDialog({ title: "Delete measurement?", danger: true, ok: "Delete",
    body: "Remove this queued measurement? This cannot be undone." })) return;
  try {
    await API.req(`/api/jobs/${id}`, { method: "DELETE" });
    FORM_DIRTY = false;
    toast("Deleted " + shortId(id));
    await tick();
    closePanel();
  } catch (e) { setMsg($("#f-msg"), e.message, "err"); }
};

/* ================================================================ live */
function metaBlock(n, el) {
  const parts = [];
  if (n && n.metadata) parts.push(`<h3>Metadata</h3><pre class="meta">${esc(n.metadataText || toYAML(n.metadata))}</pre>`);
  if (n && n.output) {
    const o = n.output;
    parts.push(`<h3>Output</h3><dl class="kv">` +
      (o.path ? `<dt>Save to</dt><dd>${esc(o.path)}</dd>` : "") +
      (o.push ? `<dt>API endpoint</dt><dd>${esc((o.push.method || "POST") + " " + o.push.url)}</dd>` +
                `<dt>Headers</dt><dd>${esc(Object.keys(o.push.headers || {}).join(", ") || "—")}</dd>` : "") +
      `</dl>`);
  }
  el.innerHTML = parts.join("");
}
async function refreshLive() {
  const e = panelTop();
  if (e.view !== "live") return;
  let j;
  try { j = (await API.req(`/api/jobs/${e.id}`)).job; }
  catch (err) { setMsg($("#lv-msg"), err.message, "err"); return; }
  const h = LAST_HEALTH || {};
  const running = j.status === "running";
  setPanelTitle(j.name || "Current measurement", `${j.kind} · ${shortId(j.id)}`);
  const st = $("#lv-state");
  st.textContent = running ? (STOPPING ? "Stopping" : "Measuring") : j.status;
  st.className = "live-state " + (running ? "running" : j.status);
  $("#lv-job").innerHTML = running
    ? `<b>${esc(j.name) || shortId(j.id)}</b> · ${esc(j.kind)}<span class="mono">${esc(shortId(j.id))}</span>`
    : j.status === "finished" ? "Measurement finished — the result is ready."
    : j.status === "aborted" ? "Stopped on request (aborted)."
    : esc(j.error || "Measurement failed.");
  $("#lv-stop").hidden = !running || STOPPING;
  $("#lv-result").hidden = running;
  $("#lv-result").onclick = () => openPanel({ view: "result", id: j.id });
  paintPhases("#lv-phases", running, running ? h.phase : null);
  $("#lv-phases").hidden = !running;
  $("#lv-phase").textContent = running ? (h.phase || "—") : j.status;
  $("#lv-elapsed").textContent = running && j.live && j.live.phaseSeconds != null ? j.live.phaseSeconds + " s in phase" : "—";
  $("#lv-started").textContent = shortDt(j.started);
  $("#lv-params").textContent = j.paramsSummary || "—";
  $("#lv-engine").textContent = h.connected ? "connected" : "not connected";
  $("#lv-engine").className = h.connected ? "good" : "";
  const b = h.background;
  $("#lv-bg").textContent = !b ? "—" : b.ok ? `ok · ${b.ageHours} h old (limit ${b.maxAgeHours} h)` : (b.measuredAt ? `expired · ${b.ageHours} h old (limit ${b.maxAgeHours} h)` : "none measured");
  $("#lv-bg").className = !b ? "" : b.ok ? "good" : "warn";
  setMsg($("#lv-msg"), "updated " + new Date().toLocaleTimeString());
  metaBlock(jobExtras(j), $("#lv-meta"));
}
$("#lv-stop").onclick = () => stopMeasurement().then(refreshLive);

/* ============================================================== recent */
let RECENT = [];
function pushPill(s) {
  const v = s || "not_configured";
  const cls = v === "sent" ? "push-sent" : v === "failed" ? "push-failed" : "push-off";
  return `<span class="tpill ${cls}">${esc(v === "not_configured" ? "off" : v)}</span>`;
}
async function refreshRecent() {
  try {
    const r = await API.req("/api/finished");
    RECENT = (r.measurements || []).slice().sort((a, b) => (b.finished || "").localeCompare(a.finished || ""));
  } catch (e) { RECENT = []; }
  if (LAST_HEALTH && LAST_HEALTH.resultsDir) $("#rc-dir").innerHTML = `Files are saved under <code>${esc(LAST_HEALTH.resultsDir)}</code>.`;
  renderRecent();
}
function renderRecent() {
  const f = ($("input[name=rc-f]:checked") || {}).value || "all";
  const rows = RECENT.filter(m => f === "all" ? true
    : f === "problem" ? (m.status === "failed" || m.status === "aborted")
    : m.kind === f);
  $("#rc-table tbody").innerHTML = rows.map(m => `<tr data-id="${esc(m.id)}" class="clickable" tabindex="0">
      <td><span class="tpill ${esc(m.status)}">${esc(m.status)}</span></td>
      <td class="name">${esc(m.name) || shortId(m.id)}${m.error ? `<small>${esc(m.error)}</small>` : (() => { const s = metaSummary(jobExtras(m).metadata); return s ? `<small>${esc(s)}</small>` : ""; })()}</td>
      <td>${esc(m.kind)}</td>
      <td class="mono when">${esc(shortDt(m.finished))}</td>
      <td class="n">${esc(m.peaks ?? (m.result && m.result.peaks ? m.result.peaks.length : "—"))}</td>
      <td>${pushPill(m.push_status)}</td></tr>`).join("");
  $("#rc-table").hidden = !rows.length;
  $("#rc-empty").hidden = !!rows.length;
}
$$("input[name=rc-f]").forEach(r => r.addEventListener("change", renderRecent));
$("#rc-table tbody").addEventListener("click", ev => {
  const tr = ev.target.closest("tr[data-id]");
  if (tr) openPanel({ view: "result", id: tr.dataset.id });
});
$("#rc-table tbody").addEventListener("keydown", ev => {
  const tr = ev.target.closest("tr[data-id]");
  if (tr && (ev.key === "Enter" || ev.key === " ")) { ev.preventDefault(); openPanel({ view: "result", id: tr.dataset.id }); }
});

/* ============================================================== result */
let PLOT = null;
function linkHref(a, href) {
  if (href) { a.href = href; a.hidden = false; }
  else { a.removeAttribute("href"); a.hidden = true; }
}
async function openResult(id) {
  $("#rd-chips").innerHTML = ""; $("#rd-meta").innerHTML = ""; setMsg($("#rd-err"), "", "err");
  $("#rd-plot").hidden = true; PLOT = null;
  try {
    const { measurement: m } = await API.req(`/api/finished/${id}?spectrum=1`);
    if (panelTop().view !== "result" || panelTop().id !== id) return;
    setPanelTitle(m.name || ("Measurement " + shortId(id)), [m.kind, m.status, shortDt(m.finished), shortId(m.id)].filter(Boolean).join(" · "));
    setMsg($("#rd-err"), m.status === "finished" ? "" : "Measurement " + m.status + (m.error ? ": " + m.error : ""), m.status === "aborted" ? "" : "err");
    const res = m.result || {}, st = res.stats || {};
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
    $("#rd-chips").hidden = chips.length <= 1;

    // contract: x/y/peaks live on result (API.md §3.2); older builds used m.spectrum
    const sp = (m.spectrum && m.spectrum.x) ? m.spectrum : res;
    if (sp.x && sp.x.length && sp.y && sp.y.length) {
      PLOT = { xs: sp.x, ys: sp.y, peaks: sp.peaks || res.peaks || [], unit: res.unit || "" };
      $("#rd-plot").hidden = false;
      requestAnimationFrame(() => drawSpectrum());
    } else if (m.status === "finished") {
      setMsg($("#rd-err"), "No decodable spectrum in this measurement.", "warn");
    }
    metaBlock(jobExtras(m), $("#rd-meta"));
    const csv = (m.files || []).find(f => /\.csv$/i.test(f));
    const xml = baseName(res.sourceFile) || (m.files || []).find(f => /\.xml$/i.test(f));
    linkHref($("#rd-csv"), m.status === "finished" && csv ? API.url(`/api/finished/${id}/file/${encodeURIComponent(baseName(csv))}`) : "");
    linkHref($("#rd-xml"), xml ? API.url(`/api/finished/${id}/file/${encodeURIComponent(baseName(xml))}`) : "");
  } catch (e) {
    setMsg($("#rd-err"), e.message, "err");
  }
}

/* ------------------------- canvas spectrum plot (vanilla, dependency-free)
 * IR convention: wavenumber axis runs high → low (left → right). */
const PLOT_C = {
  trace: "#006C66", grid: "#EEEEEE", frame: "#A7A7A8", text: "#5f5f5f",
  peak: "#EF7C00", cross: "#29485D", font: "11px Roboto, Arial, sans-serif",
};
function niceStep(range, target) {
  const raw = range / target, mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}
function yAt(x) {
  if (!PLOT) return null;
  const { xs, ys } = PLOT;
  let best = 0, bd = Infinity;
  for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - x); if (d < bd) { bd = d; best = i; } }
  return ys[best];
}
function drawSpectrum(hover) {
  if (!PLOT) return;
  const cv = $("#rd-canvas");
  const { xs, ys, peaks, unit } = PLOT;
  const DPR = window.devicePixelRatio || 1;
  const W = cv.clientWidth || 780, H = cv.clientHeight || 400;
  if (cv.width !== Math.round(W * DPR) || cv.height !== Math.round(H * DPR)) {
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  }
  const g = cv.getContext("2d");
  g.setTransform(DPR, 0, 0, DPR, 0, 0);
  g.clearRect(0, 0, W, H);

  const L = 60, R = 12, T = 14, B = 50;
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
  PLOT.geo = { L, R, W, x0, x1 };

  g.font = PLOT_C.font;
  g.lineWidth = 1;
  const ys0 = niceStep(y1 - y0, 5), ydig = Math.max(0, -Math.floor(Math.log10(ys0)));
  g.textAlign = "right"; g.textBaseline = "middle";
  for (let v = Math.ceil(y0 / ys0) * ys0; v <= y1; v += ys0) {
    const yy = Math.round(py(v)) + .5;
    g.strokeStyle = PLOT_C.grid; g.beginPath(); g.moveTo(L, yy); g.lineTo(W - R, yy); g.stroke();
    g.fillStyle = PLOT_C.text; g.fillText(v.toFixed(Math.min(ydig, 4)), L - 8, yy);
  }
  const xs0 = niceStep(x1 - x0, Math.max(4, Math.floor(pw / 90)));
  g.textAlign = "center"; g.textBaseline = "top";
  for (let v = Math.ceil(x0 / xs0) * xs0; v <= x1; v += xs0) {
    const xx = Math.round(px(v)) + .5;
    g.strokeStyle = PLOT_C.grid; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, T + ph); g.stroke();
    g.fillStyle = PLOT_C.text; g.fillText(v.toFixed(0), xx, T + ph + 8);
  }
  g.font = "bold 10.5px Roboto, Arial, sans-serif";
  g.fillStyle = PLOT_C.text;
  g.fillText("WAVENUMBER  (cm⁻¹)", L + pw / 2, H - 18);
  if (unit) {
    g.save(); g.translate(12, T + ph / 2); g.rotate(-Math.PI / 2);
    g.textBaseline = "middle"; g.fillText(String(unit).toUpperCase(), 0, 0); g.restore();
  }
  g.strokeStyle = PLOT_C.frame;
  g.beginPath(); g.moveTo(L + .5, T); g.lineTo(L + .5, T + ph + .5); g.lineTo(W - R, T + ph + .5); g.stroke();

  g.save(); g.beginPath(); g.rect(L, T, pw, ph); g.clip();
  const STEP = Math.max(1, Math.floor(xs.length / (W * 2)));
  g.beginPath();
  for (let i = 0; i < xs.length; i += STEP) {
    const xx = px(xs[i]), yy = py(ys[i]);
    if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
  }
  g.strokeStyle = PLOT_C.trace; g.lineWidth = 1.5; g.lineJoin = "round"; g.stroke();
  g.restore();

  // peaks: contract {pos, prominence}; tolerate {x, y}
  const pk = peaks.slice(0, 12).map(p => { const x = p.pos ?? p.x; return { x, y: p.y ?? yAt(x) }; })
    .filter(p => p.x != null && p.y != null);
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
(function wirePlot() {
  const cv = $("#rd-canvas");
  cv.addEventListener("mousemove", ev => {
    if (!PLOT || !PLOT.geo) return;
    const { L, R, W, x0, x1 } = PLOT.geo;
    const mx = ev.clientX - cv.getBoundingClientRect().left;
    if (mx < L || mx > W - R) return drawSpectrum();
    const x = x1 - (mx - L) / (W - L - R) * (x1 - x0);
    drawSpectrum({ x, y: yAt(x) });
  });
  cv.addEventListener("mouseleave", () => drawSpectrum());
  let rz = null;
  window.addEventListener("resize", () => { clearTimeout(rz); rz = setTimeout(() => drawSpectrum(), 80); });
})();

/* ============================================================ settings */
function showSettingsTab() {
  const tab = ($("input[name=st-tab]:checked") || {}).value || "instrument";
  $$("[data-st]").forEach(d => { d.hidden = d.dataset.st !== tab; });
  if (tab === "instrument") refreshInstrument();
  if (tab === "service") refreshService();
  if (tab === "api") refreshApi();
}
$$("input[name=st-tab]").forEach(r => r.addEventListener("change", showSettingsTab));

async function refreshInstrument() {
  try {
    const st = (await API.req("/api/instrument/status")).instrument || {};
    $("#st-ready").textContent = st.readyState
      ? st.readyState + (st.description ? " — " + st.description : "")
      : (st.busy ? "busy: measuring" : "—");
    $("#st-ready").className = "";
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
function refreshService() {
  const h = LAST_HEALTH;
  $("#sv-base").textContent = API.base || "same origin";
  if (!h) return;
  $("#sv-ver").textContent = h.version || "—";
  $("#sv-uptime").textContent = fmtUptime(h.uptime_s);
  $("#sv-token").textContent = h.tokenRequired
    ? (API.token ? "required · set in this browser" : "required (X-Fishy-Token) · not set")
    : "off (loopback)";
  $("#sv-dir").textContent = h.resultsDir || "—";
}
$("#btn-st-refresh").onclick = refreshInstrument;
$("#btn-opt").onclick = async () => {
  const out = $("#opt-out"), msg = $("#opt-msg");
  setMsg(msg, "Asking engine…");
  out.hidden = true;
  try {
    const d = await API.req("/api/settings/optimal?detector=" + encodeURIComponent($("#opt-det").value));
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
    ? `<table><thead><tr><th>Parameter</th><th style="width:150px">Valid</th><th style="width:90px">Step</th><th style="width:80px">Unit</th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="msg">No constraints reported.</p>`;
}
function renderObject(obj) {
  const entries = Object.entries(obj || {});
  return entries.length
    ? `<dl class="kv">${entries.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "object" ? JSON.stringify(v) : v)}</dd>`).join("")}</dl>`
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

async function refreshApi() {
  $("#api-openapi").href = API.url("/openapi.yaml");
  try {
    const d = await API.req("/api/docs");
    $("#api-auth").textContent = "Auth: " + (d.auth || "—") + (API.token ? " · token set in this browser" : "");
    $("#api-src").textContent = [d.service, d.version].filter(Boolean).join(" ");
    const eps = d.endpoints || [];
    $("#api-table tbody").innerHTML = eps.map(e => {
      const m = String(e.method || e.m || "").toUpperCase();
      return `<tr><td><span class="method ${esc(m.toLowerCase())}">${esc(m)}</span></td>
        <td><code>${esc(e.path || e.p)}</code></td><td class="hint">${esc(e.description || e.d)}</td></tr>`;
    }).join("");
    $("#api-table").hidden = !eps.length;
    $("#api-empty").hidden = !!eps.length;
  } catch (e) {
    $("#api-table").hidden = true;
    $("#api-empty").hidden = false;
  }
}

/* ================================================================ poll */
let TICKING = null;
async function tick() {
  if (TICKING) return TICKING;
  TICKING = (async () => {
    try {
      LAST_HEALTH = await API.req("/health");
    } catch (e) {
      LAST_HEALTH = null;
    }
    const h = LAST_HEALTH;
    if (h) {
      if (h.tokenRequired && !API.token && !TOKEN_ASKED) promptToken();
      if (!h.busy) STOPPING = false;
      if (Array.isArray(h.features) && h.features.includes("job.extras")) FEATURES.jobExtras = true;   // BACKEND_REQUESTS.md §5
      try { JOBS = (await API.req("/api/jobs?limit=200")).jobs || []; } catch (e) { /* keep last */ }
      // ready-state probe: not while busy, and at most every 15 s (it talks to the engine)
      if (!h.busy && Date.now() - INST_AT > 15000) {
        INST_AT = Date.now();
        try { INST = (await API.req("/api/instrument/status")).instrument || null; INST_ERR = null; }
        catch (e) { INST = null; INST_ERR = e.status === 401 ? null : e.message; }
      }
      if (h.busy) INST_ERR = null;
    }
    renderHero();
    renderQueue();
    renderRecentBar();
    if (panelTop().view === "live") refreshLive();
    if (panelTop().view === "form") updateBusyHint();
  })();
  try { await TICKING; } finally { TICKING = null; }
}
tick();
setInterval(tick, 3000);
