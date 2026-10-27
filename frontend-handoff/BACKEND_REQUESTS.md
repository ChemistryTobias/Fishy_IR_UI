# fishy_ir — backend requests from the UI

Request log between the UI and the service. Status as of **2026-10-27**
(service v0.2.0):

| § | Request | Status |
|---|---|---|
| 1–3 | `metadata`, `output.path`, `output.push` on jobs | ✅ implemented in v0.2.0. The UI sends them as first-class fields. |
| 4 | error shape | ✅ |
| 5 | `features: ["job.extras"]` flag | superseded: no longer needed, the UI assumes v0.2.0 |
| 6 | **contract mismatches between `API.md` and `openapi.yaml`** | 🔧 **open, please confirm** |
| 7 | **editable service configuration** (KNOWN_ISSUES #6) | 🔧 **open, new** |
| 8 | instrument model for the header (KNOWN_ISSUES #4, optional) | 🔧 open, optional |

Jobs created by UI builds from before v0.2.0 carry their extras inside
`notes` as a `{"fishy_ui": 1, …}` JSON envelope. The UI still reads those.

---

## Requested additions

### 1. `metadata` on jobs

| Where | Change |
|---|---|
| `POST /api/jobs` | new optional field `metadata`: a JSON **object** (any nesting). The UI accepts YAML or JSON from the operator and always sends JSON. |
| `PATCH /api/jobs/<id>` | `metadata` editable while `status == "staged"` (same rule as `params`). |
| Job object (`GET /api/jobs`, `/api/jobs/<id>`, `/api/finished*`) | returns `metadata` (or `null`). |
| Result files | write it next to the measurement, e.g. `metadata.json`, and/or include it in `*.summary.json`. |
| Push payload (API.md §6) | add `"metadata": {…}`. |
| Validation | `400 {ok:false,error}` if it is not an object or exceeds a size limit (suggested 64 KB). Never pass it to the engine. |

### 2. `output.path`: save to a file path

| Where | Change |
|---|---|
| `POST` / `PATCH` (staged only) | new optional `output.path` (string): a directory on the instrument PC. |
| Behaviour | after a successful run, **copy** the result files (CSV, raw XML, summary, metadata) into `output.path`. `resultsDir` stays the authoritative store (as for the push). |
| Safety | only allow paths under configured roots (e.g. `output.allowedRoots` in the config); otherwise `400` "path not allowed". Reject `..` and invalid names; create missing directories. |
| Discoverability | expose the allowed roots (e.g. in `/health` or `/api/docs`) so the UI can show them as a hint. |
| Status | on the job/measurement: `output_status: { path: "copied" | "failed" | null, pathError: "…" }`. A failed copy must **not** fail the measurement (same rule as the push). |

### 3. `output.push`: send the result to a per-job API endpoint

| Where | Change |
|---|---|
| `POST` / `PATCH` (staged only) | new optional `output.push = { url, method, headers }`. `method` ∈ `POST | PUT | PATCH` (default `POST`); `headers` is a string→string map. |
| Behaviour | after the run, send the same payload as the global push (API.md §6, plus `metadata`) to this URL, **in addition to** the configured `push.url`. |
| Status | report it separately, e.g. `output_status.push: "sent" | "failed"` plus `pushHttpStatus` / `pushError`. The UI shows it as a badge like `push_status`. |
| Security | (a) allow-list of target hosts or URL prefixes in the config (prevents the service being used to reach internal hosts); (b) store header values server-side and **never return them** in GET responses: return header names only, or `"***"` values; (c) a reasonable timeout and no automatic redirects. |
| Optional | `POST /api/jobs/<id>/push/test` to try a job's endpoint once before measuring (mirrors `POST /api/push/test`). |

### 4. Errors

Use the existing shape for all new validation: `{ "ok": false, "error": "…" }`
with `400`, or `409` when editing a non-staged job. The UI shows `error`
verbatim.

### 5. Feature flag (so the UI switches on its own)

Add `features: ["job.extras"]` to `GET /health` once 1–3 are implemented.
When the UI sees it, it sends `metadata` / `output` as real fields instead of
the `notes` envelope (`FEATURES.jobExtras` in `ui/app.js`). It always reads
real fields first and falls back to the envelope, so old jobs keep displaying.

Optional migration: on start-up, the service can lift existing envelopes
(`notes` that parse as JSON with `"fishy_ui": 1`) into the new fields and
clear `notes`.

---

### 6. Contract mismatches to confirm (open)

The v0.2.0 `API.md` says "the code wins", but `openapi.yaml` was only
partly updated. The UI copes with both versions (shown in brackets below);
please confirm which is correct and align `openapi.yaml`:

| Topic | `API.md` §4 | `openapi.yaml` | What the UI does |
|---|---|---|---|
| list jobs | `GET /api/queue` → `{queue:[…]}` | `GET /api/jobs` → `{jobs:[…]}` | tries `/api/queue`, falls back to `/api/jobs` on 404 |
| add a job | `POST /api/queue` (`start_now` default **true**) | `POST /api/jobs` (`start_now` default **false**) | tries `/api/queue`, falls back on 404/405; always sends `start_now` explicitly |
| start a queued job | *not listed* | `POST /api/jobs/<id>/start` | calls it; on 404/405 it shows "this service version cannot start a queued measurement". **Without this endpoint "Add to queue" jobs can never be started**, so please keep it (or document the replacement). |
| `output.push` | a URL string | `{url, method, headers}` | **sends the object**, reads both |
| failure text | `reason` | `error` | reads `reason`, falls back to `error` |
| running job id | `/health` has no `current` | `current` | uses `current` if present, otherwise the `running` row of the queue |
| peaks | `{x, y, prominence}` | `{pos, prominence}` | reads both |
| `/health` | no `tokenRequired` / `resultsDir` / `uptime_s` | (old fields) | prompts for a token on the first 401 and shows the documented `measurements\<id>-<name>\` location |

**PATCH with redacted headers.** `GET` returns push header values as `***`.
Please define what `PATCH {output: …}` does with them. The UI avoids the
problem by leaving `output` out of a PATCH when the operator didn't touch it,
and by refusing to save a changed endpoint while values still read `***`.
Suggested rule: an omitted `output` keeps the stored one; a `***` value keeps
the stored value for that header.

### 7. Editable service configuration (open, KNOWN_ISSUES #6)

Operators asked to change the configuration (instrument endpoint etc.) in
the UI. Today it only lives in `config/fishy_ir.json` (edit the file, restart).
What the UI can already do on its own, stored in the browser:

* service address (`API.base`, same as `?base=`),
* token set / forget,
* the instrument name shown in the header,
* defaults for new measurements (scans, resolution, range, detector,
  background mode, save-to path, push URL and method; push headers are
  never stored).

For the **service** settings, please add:

```
GET   /api/config            → { ok, config: { … }, editable: ["push.url", …], restartRequired: ["host", "port", "token"] }
PATCH /api/config            body: { "<dotted.key>": value, … }  → { ok, config, restartRequired: bool }
```

* only while idle (`409` while a measurement runs), token required even on
  loopback for writes;
* validate every key (`400 {ok:false,error}`), write the file atomically,
  keep a `.bak`;
* candidate keys: default `push.url` / headers (write-only, redacted like
  §3), `output.allowedRoots`, `background.maxAgeHours`, instrument display
  name (§8), engine/OMNIC paths, `host` / `port` / `token` (restart required);
* engine and instrument parameters stay read-only, as they are today.

The UI will add an "Service configuration" form to Settings once this exists
(today the settings panel says where to change the file).

### 8. Instrument model for the header (optional, KNOWN_ISSUES #4)

The header shows "FTIR measurement service" plus an instrument name. Today
that name comes from a browser setting (default "Thermo Fisher · Nicolet
Summit X"). If `/api/instrument/status` (or `/health`) returned e.g.
`"model": "Nicolet Summit X", "vendor": "Thermo Fisher"`, every browser would
show the right instrument without configuration.

---

## OpenAPI sketch

```yaml
components:
  schemas:
    JobCreate:
      properties:
        metadata: {type: [object, "null"], additionalProperties: true}
        output:   {$ref: "#/components/schemas/JobOutput"}
    JobOutput:
      type: [object, "null"]
      properties:
        path: {type: string, description: "directory on the instrument PC, under an allowed root"}
        push:
          type: object
          required: [url]
          properties:
            url:     {type: string, format: uri}
            method:  {type: string, enum: [POST, PUT, PATCH], default: POST}
            headers: {type: object, additionalProperties: {type: string}, writeOnly: true}
    Job:
      properties:
        metadata: {type: [object, "null"]}
        output:   {$ref: "#/components/schemas/JobOutput"}   # headers redacted
        output_status:
          type: [object, "null"]
          properties:
            path:  {type: [string, "null"], enum: [copied, failed, null]}
            pathError: {type: [string, "null"]}
            push:  {type: [string, "null"], enum: [sent, failed, null]}
            pushHttpStatus: {type: [integer, "null"]}
            pushError: {type: [string, "null"]}
    Health:
      properties:
        features: {type: array, items: {type: string}, example: ["job.extras"]}
```

None of this touches the instrument: it is all bookkeeping before and after a
run, so it doesn't conflict with the "one session, one measurement" rule.
