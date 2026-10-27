# fishy_ir — backend requests from the UI

The redesigned UI (`ui/`) lets an operator attach **optional metadata** to a
measurement and choose **where the result goes** (a save-to path and/or an
API endpoint with custom headers). The current API contract (`API.md`,
`openapi.yaml`) has no fields for this. As `README.md` asks, these are raised
here as product decisions instead of being invented in the UI.

Everything else in the UI works with today's contract unchanged.

---

## What the UI does today (works with the current service)

Until the service supports the fields below, the UI packs them into the job's
existing free-text `notes` field as a small JSON envelope:

```json
{
  "fishy_ui": 1,
  "metadata":     { "sample": { "material": "PMMA", "thickness_um": 80 }, "operator": "TT" },
  "metadataText": "sample:\n  material: PMMA\n  thickness_um: 80\noperator: TT",
  "output": {
    "path": "D:\\data\\ftir\\2026\\pmma\\",
    "push": { "url": "https://eln.example.org/api/v1/ftir", "method": "POST",
              "headers": { "Authorization": "Bearer …", "X-Project": "ssr-ftir" } }
  }
}
```

The data stays with the job and is shown again in the UI, but the service
treats it as plain text:

* metadata is **not** in the result files or the push payload;
* the result is **not** saved to `output.path`;
* nothing is sent to `output.push`;
* header values (possibly secrets) can be read by anyone who can list jobs.

The UI says this in the form (a "Needs a service update" note).

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
