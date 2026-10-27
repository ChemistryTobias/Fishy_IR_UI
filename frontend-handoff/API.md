# fishy-ir — API contract (v0.2.0, current)

> This document matches `src/fishy-ir/fishy_ir/app.py` as of 2026-10-27
> (omnic-cli 2.5.2). Where it differs from the earlier dev-era draft
> (staged jobs, `/api/jobs/<id>/...`), the code below wins.
> `/api/docs` on a running service always returns the live endpoint table.

Base URL: `http://localhost:8385` (default).

## 1. Transport

* JSON in / JSON out.
* Errors: `{"ok": false, "error": "human readable text"}` + the right status
  (400 / 401 / 404 / 409).
* **Auth**: loopback → no token. LAN (`--host 0.0.0.0 --token auto`) →
  `X-Fishy-Token: <token>` header **or** `?token=<token>` on every `/api/*`
  (except `/health` and `GET /` — the UI handles the token via a prompt +
  `localStorage`, no code needed).
* **Concurrency rule (single session):** at most ONE measurement is in flight.
  A second start is **409** `{"ok":false,"busy":true,"current":"<running-job>"}`.
  The UI must show this in-band; there is no server queue retry.

## 2. Health / meta

```
GET /health
→ { "ok": true, "service": "fishy_ir", "version": "0.2.0",
    "connected": true|false,          // engine session alive
    "busy":      true|false,          // measurement in flight
    "phase":     "collecting"|"decoding"|"pushing"|"idle"|null,
    "background": { "ok": bool, "measuredAt": str|null, "ageHours": 8.2,
                    "maxAgeHours": 24, "warning": "…" | null },
    "failure":   "…" | null }         // last engine error, safe to display
```

```
GET /api/docs            → live endpoint table + detector codes
GET /openapi.yaml        → machine-readable spec (this folder's copy)
```

## 3. Instrument

```
GET  /api/instrument/status
→ { "ok": true, "connected": true, "phase": "idle", "time": "2026-10-27 …",
    "background": { "ok": true, "measuredAt": "…", "ageHours": 3.1,
                    "maxAgeHours": 24, "warning": null } }

POST /api/instrument/stop        → 202 {ok:true}  |  409 "nothing is running"
```

## 4. Measurements (queue)

### 4.1 List
```
GET /api/queue
→ { "ok": true, "queue": [
    { "id": "ab12…", "kind": "background", "name": "background 20261027_1230",
      "status": "staged|running|finished|failed|aborted",
      "kind": "background"|"sample",
      "created": "...", "started": "...|null", "finished": "...|null",
      "reason": "…"|null, "metadata": {...}|null, "output": {...}|null,
      "output_status": {"path":..., "push": "sent|failed|…"} | null,
      "result": { "title","unit","n","xMin","xMax","interferogram",
                  "stats": {"min","max","mean","std"},
                  "peaks": [{"x","y","prominence"}…8],
                  "sourceFile": "omnic-data\\…_DataVectorXml.xml" } | null }
  ] }
```

### 4.2 Enqueue (the only way to add work)
```
POST /api/queue
body:
{
  "kind": "background" | "sample",
  "name": "optional label (default: '<kind> <ymdhms>_<ms>')",
  "start_now": true | false,          // default true
  "params": {                         // optional wire params (see §4.4)
     "scans": 32, "resolution": 4, "format": "Transmittance",
     "start": 4000, "end": 600, "detector": "TGSA", "background": "None"
  },
  "metadata": { "operator": "cb" },   // optional, round-trips untouched
  "output": {                         // optional per-job extras (never fail the run)
    "path": "C:\\shared",             // copy result files here
    "push": "https://lab/api/spectra" // HTTP POST the payload here
  }
}
→ 201 { ok, queue, job }   |   409 { ok:false, busy:true, current }
```

* `params: {}` is exactly the same as omitting `params`.
* Job-level keys (`kind`, `name`, `start_now`, `params`, `metadata`, `output`)
  **never** reach the wire — only `params.*` does.

### 4.3 Job control
```
GET    /api/jobs/<id>          → { job }                    (404 if unknown)
PATCH  /api/jobs/<id>          body {name|kind|params|metadata|output}  — only while "staged"
DELETE /api/jobs/<id>          — only while "staged"
POST   /api/instrument/stop    — stop whatever is running (≈8 s, ends "aborted")
```

### 4.4 Allowed `params` (wire params, validated)
| key | meaning | example |
|---|---|---|
| `scans` | number of scans | 32 |
| `resolution` | cm⁻¹ | 1, 2, 4, 8 |
| `format` | spectral format | `Transmittance` (default) |
| `start` / `end` | range limits, cm⁻¹ | 4000 / 600 |
| `detector` | code or name (see `/api/docs → params.detectors`) | `TGSA` (iS20 DTGS) |
| `background` | `None`(0) \| `BeforeCollect`(2) | `None` |
| `resolution` | cm⁻¹ (1, 2, 4, 8) | 4 |
| `velocity` | cm/s — **must hit the driver table exactly** | 0.4747 (see Settings) |
| + | `beamsplitter source format apodization phase gain zeroFill resetServo` + raw wire keys pass through | |

Valid name sets today: format `SingleBeam`, beamsplitter `Ge_KBr`, source
`Globar`, apodization `Norton_Beer_Strong`, phase `Phase_Mertz`, background
`None`/`BeforeCollect`. Unknown keys are passed through untouched (the
engine validates and reports back — invalid values surface as the job's
`reason`). **Prefer not to expose `velocity` in the UI** — show it from
`/api/settings/optimal` and send `detector` + `background` only.

## 5. Results

```
GET /api/finished                                        → all finished (rows like §4.1)
GET /api/finished/<id>?spectrum=1                        → row + decoded spectrum
```

`?spectrum=1` adds (only when a decodable file exists):

```json
"result": { …,
  "x": [4000, 3996, …],              // wavenumbers, cm⁻¹, ≤ 15000 pts
  "y": [97.8, 97.5, …],              // intensity
  "sourceFile": "omnic-data\\…_DataVectorXml.xml"
}
```
* no spectrum (all files undecodable): `"spectrumError": "…"` on the row —
  show it, don't alert.
* download: `GET /api/finished/<id>/file/<filename>` (raw bytes; filename =
  last path segment of an entry in the job's `files`; 404 if rotated out).

**Where files live on the instrument PC**
* engine working set (XML + CSV): `<service base>\omnic-data\`
* finished copies (XML + CSV):   `<service base>\measurements\<8-char-id>-<name>\`
  (always created for finished jobs since 0.2.0/2.5.2)

## 6. Settings (read-only)

All endpoints return the engine's current values — **read-only by design**;
changes are made in OMNIC, not here.

```
GET /api/settings/params
→ { params: { backgroundStatus: "valid|stale", changes: [], … } }

GET /api/settings/optimal?detector=TGSA
→ { detector: "TGSA", velocity: 0.4747, startFrequency: 2152800.0,
    endFrequency: 1076400.0 }        // driver table — use for display only

GET /api/settings/constraints
→ { settings: { OpticalVelocity: { valid: [0.4747, 0.4747], step: 0,
                                   name: "…", label: "…", description: "…" }, … } }

GET /api/settings/instrumentxml     → { xml: "<…driver config XML…>", file: "…" }
```
Detector codes: `TGSA TGSB TGSC TGSD MCTA MCTB PBSE INGAAS INSB SI PBS GE
HIGHDCT HIGHDMCT`.
(On iS20 DTGS the working code is `TGSA`; velocity `0.4747` cm/s — the
collect uses it automatically.)

## 7. UI structure (what you're improving)

One desktop page plus a slide-in panel (no tabs):

* **Main page:** status block (Running / Stopping / Idle / Error / Offline,
  background with "Measure now", instrument, queue size) · **queue** (running
  and staged jobs only) · "+ New measurement" · **Recent activity** bar ·
  footer (sticky).
* **Panel** (`#panel`, *Back* / Esc): new or staged job form (`f-*`) · follow
  the running job (`lv-*`) · recent activity (`rc-*`) · result + spectrum
  (`rd-*`, `rd-canvas`) · settings (`st-*` instrument, `cfg-*` / `d-*`
  connection & defaults, API tab).

* `ui/index.html`: DOM skeleton
* `ui/style.css`: all styles; design tokens are CSS vars at the top (MPG palette)
* `ui/app.js`: client. All fetches go through `API.req(path[, opts])`
  (token, JSON, errors); the queue endpoints go through `listJobs()` /
  `enqueue()` / `startJob()`. API base = `API.base` (`?base=…`, or
  *Settings → Connection & defaults*).

**Hard requirements (keep):** no framework, no CDN, no build step. The UI
must work on an air-gapped Windows PC from plain files.

## 8. Open items (from the instrument-UI session, 2026-10-27)

See `KNOWN_ISSUES.md` — it separates *fixed-in-0.2.0/2.5.2* from *still open*.
The UI redesign asks (header text, footer, button size) are **open** and are
styling-only — none of them change this contract.
