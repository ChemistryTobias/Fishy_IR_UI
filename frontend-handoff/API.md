# fishy_ir — API description (for the UI)

The UI in `ui/` talks to a REST API. **This file and `openapi.yaml` are the
complete contract you need** — everything the backend does for the UI, with
request/response shapes. No backend code is included in this bundle.

Base URL in all examples: `http://localhost:8385` (default service port).

---

## 1. Transport rules everyone should know

### 1.1 JSON in, JSON out
All APIs are `application/json`. Errors always look like:

```json
{ "ok": false, "error": "human readable reason" }
```

with the right HTTP status (400 bad input, 401 bad/missing token,
404 not found, 409 conflict/busy). Never rely on parsing `error` text —
rely on the status code and the stable extra fields (e.g. `busy`, `current`).

### 1.2 Authentication (token flow)
* When the service is bound to **loopback only**, there is **no token** and
  every call works.
* When reachable on a **LAN**, a token is required on every `GET/POST/...`
  to `/api/*`:
  * header `X-Fishy-Token: <token>`, or
  * query `?token=<token>`.
  * The UI already implements this: it prompts once and stores the token in
    `localStorage.fishyToken` (sent as the header). A wrong token → `401`.
* `GET /health` and the UI assets are **always public** (they reveal
  nothing sensitive, and the local operator must always be able to see the
  page).

**How to get the token**: the operator runs the service on the instrument
PC and reads it from the console banner (`Token: …`) or from
`config/fishy_ir.token` next to the config. It is never returned by the API.

### 1.3 CORS & standalone (how to develop this UI)
The service answers **cross-origin** fetches (it sends
`Access-Control-Allow-Origin` for whatever origin fetches it and allows the
`X-Fishy-Token` header). So to work on this UI you do **not** need the
service code — just a service to point at:

1. **Safest / most realistic**: run the real service on the instrument PC
   (or anywhere) and point this UI at it:
   ```
   http://localhost:8400/index.html?base=http://HOST:8385
   ```
   `?base=` (or `localStorage.fishyBase` once set) in `ui/app.js` prefixes
   every API call. Without it the UI uses its own origin (the normal case).
2. Any static file server works (`python -m http.server`, VS Code "Live
   Server", `npx serve`…).
3. When you embed the improved UI back into the service's `ui/` folder, the
   `?base=` mechanism simply stays inert (same-origin default).

> If you want a zero-setup playground without any real instrument, ask the
> service owner for a small mock — do not invent response shapes yourself;
> use the examples in § below (they are taken verbatim from the service).

---

## 2. Jobs (the measurement queue)

### 2.1 Add a job   `POST /api/jobs`
Adding **always** succeeds (even while another measurement runs) — the job
lands in the queue as `staged`.

```http
POST /api/jobs
{ "name": "pellet-01", "kind": "sample",
  "params": { "scans": 10, "resolution": 4, "start": 400, "end": 4000 } }
```
→ `201` `{ "job": {...} }`

* `kind`: `"sample"` (default) or `"background"`.
* `params` accepts **friendly aliases** (validated here, not by the engine):
  `scans`, `resolution`, `start`, `end` (cm⁻¹), `velocity`, `detector`,
  `beamsplitter`, `source`, `format`, `apodization`, `phase`, `background`.
  Unknown keys pass through untouched (power users).
* Bad params → `400` with a helpful message, e.g.
  `detector must be one of: TGSA, TGSB, … (current: DTGS)`.

### 2.2 List jobs    `GET /api/jobs?status=<status>&limit=<n>`
`status` filter: `staged | running | finished | failed | aborted` (omit =
all). → `200 { "jobs": [ ... ] }`

A **job object** (used everywhere):
```json
{
  "id": "9f2c…", "name": "pellet-01", "kind": "sample",
  "status": "staged",                 // staged | running | finished | failed | aborted
  "params": { "scans": 10, "resolution": 4.0, "start": 400, "end": 4000 },
  "paramsSummary": "scans=10 resolution=4 start=400 end=4000",
  "attempts": 0, "createdAt": "2026-…", "started": null, "finished": null,
  "error": null,
  "result": null                      // see §3 — present after a finished run
}
```

### 2.3 Get / edit / delete one job
```
GET    /api/jobs/<id>                 → { "job": {...} }          (404 if unknown)
PATCH  /api/jobs/<id>                 body: {name?, kind?, params?}
                                         only while status == "staged",
                                         else 409 "job is running or done (edit only staged jobs)"
DELETE /api/jobs/<id>                 202 while staged; 409 while running
```

### 2.4 Start / stop
```
POST /api/jobs/<id>/start    202 {job:{status:"running"}}   | 409 busy (see below)
POST /api/jobs/<id>/stop     202 (stop queued)              | 409 "nothing is running"
```
**Concurrency rule (the one rule that matters):**
```http
POST /api/jobs/<id>/start    (while another measurement is running)
→ 409 { "ok": false, "error": "instrument busy — waiting for the running measurement",
        "busy": true, "current": "<id of the running job>" }
```
The UI must show this in-band (toast/inline), **not** as a global alert, and
ideally highlight the job that is currently running (`current`).

`stop` is honored within ~8 seconds in any phase and the job ends as
`aborted` (distinct from `failed`). `POST /api/instrument/stop` is the same
thing without a job id (the big Stop button).

---

## 3. Results

### 3.1 List finished        `GET /api/finished`
→ `200 { "ok": true, "measurements": [ {...job object, status:"finished" or "failed" or "aborted", with result...} ] }`

### 3.2 One result + decoded spectrum
`GET /api/finished/<id>?spectrum=1`

```json
{
  "ok": true,
  "measurement": {
    "id": "…", "name": "pellet-01", "kind": "sample", "status": "finished",
    "started": "…", "finished": "…",
    "files": ["measurements/pellet-01_2026…_sample/sample.csv"],
    "result": {
      "title": "pellet-01_2026…_sample",
      "unit": "%T",
      "n": 2001,
      "xMin": 400.0, "xMax": 4000.0,
      "x": [400, …],            // wavenumbers (cm⁻¹) — only when ?spectrum=1
      "y": [98.2, …],           // intensity — only when ?spectrum=1
      "stats": { "min": 2.1, "mean": 87.4, "max": 100.2, "n": 2001 },
      "peaks": [ { "pos": 3285.5, "prominence": 41.2 }, … ],
      "sourceFile": "measurements/…/sample.raw.xml"
    },
    "push_status": "not_configured"   // | sent | failed
  }
}
```
* `x`/`y` are plain arrays (the UI already draws them on `<canvas>`).
* A **failed/aborted** measurement has the same shape but `result: null`
  and `error: "…"` (human readable, safe to show as-is).

### 3.3 Download raw files
The UI's "file" links are plain `GET`s (so they work as an `<a href>`):

```
GET /api/finished/<id>/file/<filename>      → raw bytes, Content-Type by
                                               extension (csv → text/csv, etc.)
```
Filename is the last path segment of the entry in `result.files`. 404 if the
file no longer exists on disk (results dir was cleaned) — the UI then hides
the link, which you can keep.

---

## 4. Instrument (read-only)

```
GET /health
  → { ok, service, version, uptime_s,
      busy, current,          // null when idle — drive the top status pill
      phase,                  // idle | connecting | collecting | processing | pushing
      connected,              // false when never connected (UI shows "offline")
      tokenRequired,          // true → show the token prompt
      resultsDir,             // show as read-only text on the settings view
      background: { ok, maxAgeHours, measuredAt, ageHours, job, warning } }
```

The **background warning** is the one you must surface prominently (it has
its own rule): when `background.ok == false`, show `background.warning`
verbatim in a yellow banner and offer "Measure background now" (which is
just `POST /api/jobs {"kind":"background","params":{...user choice...}}`).

```
GET /api/instrument/status
  → if busy:  { instrument: { busy: true, current: <id> } }
  → if idle:  { instrument: { readyState, description, session, background } }

GET /api/instrument/time
  → { "time": "2026-10-22T18:14:48" }          (instrument clock; null if unreachable)
```

---

## 5. Engine settings (read-only)

These are snapshots of what the engine currently has configured — **never
editable** through this API (that is a hard product rule; the UI already
treats them as read-only, keep it that way).

```
GET /api/settings/constraints
  → { settings: { param: { valid: [lo,hi], step, unit, name, label, description }, … } }

GET /api/settings/optimal?detector=TGSA
  → { optimal: { detector, detectorTable, optimalVelocity, range } }

GET /api/settings/instrumentxml
  → { instrumentxml: { benchType, benchTypeName, benchInfo, benchSerial, … } }

GET /api/settings/params
  → { params: { "<ParamName>": { name, description, values, … }, … } }
```
All four fail (→ JSON error + ≥500 or 400) when the engine cannot be
reached; the UI already degrades gracefully to "instrument offline" — keep
that behaviour, don't make these 500s fatal to the page.

`detector` for `/api/settings/optimal?detector=` is a **code** (e.g.
`TGSA`, `TGSB`, `MCTA`, `INBA`, …) — the UI may present the human name
(`Instrument Settings` values are the *names*; map by display only, always
send the code you are given in the constraints/params `name`).

---

## 6. Push (informational for the UI)

If the operator configures `push.url`, every finished measurement is POSTed
to it with:
```json
{ "source": "fishy_ir", "job": "<id>", "name": "…", "kind": "…",
  "params": {…}, "started": "…", "finished": "…",
  "files": ["…"], "result": { "title","n","stats","peaks",… } }
```
* `push.status` on each measurement: `not_configured | sent | failed`.
* `POST /api/push/test` → sends a fixed stub payload so the operator can
  verify the sink; UI already has a "Test push" button (`#btn-pushtest`).
* A refused push **never** fails the measurement — the local files are
  authoritative. The UI should reflect `push_status: "failed"` as a
  yellow/red badge on that row, not as a global error.

---

## 7. Reference endpoint (for the UI's own "API" tab)

```
GET /api/docs
  → { service, version, auth, "openapi": "/openapi.yaml",
      params: {aliases: […], note: "…", detectors: […]},
      endpoints: [ {method, path, description}, … ] }
```
The current `ui/app.js` renders this directly into the **API** view — you
can keep it as the source of truth (it always matches the running service),
or hard-code your own copy; both are fine. `openapi.yaml` in this folder is
the machine-readable version of the same contract.

---

## 8. UI structure cheat-sheet (what you're improving)

Five views (tabs in `#nav`): **queue / live / results / settings / api**.

* `index.html`  — DOM; each view is a `<section id="view-*">`
* `style.css`   — all styles; design tokens are CSS vars at the top:
  `--bg --panel --panel2 --line --text --muted --accent --accent2 --ok
   --warn --err --mono`
* `app.js`      — the client; the **only** API entry point is `API.req(path, opts)`.
  Every fetch goes through there (auth header, JSON, error handling).
  The API base lives in `API.base` (see §1.3).

Key ids you'll touch:
`status-line` (global pill) · `q-form / btn-add / btn-addstart` ·
`q-table` (queue rows) · `lv-*` (live banner, phase, stop button) ·
`res-table / res-detail / rd-canvas` (spectrum) · `bg-banner` (background
rule) · `tk-prompt / tk-input` (token) · `toasts`.

Conventions in the existing code: **no framework, no build step, no CDN**
(must keep working offline / air-gapped). Keep it that way.
