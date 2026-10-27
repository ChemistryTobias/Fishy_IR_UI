# fishy-ir — frontend handoff (UI + API contract)

> **State as of 2026-10-27** — service **v0.2.0** + **omnic-cli 2.5.2**,
> validated on the instrument PC (`C:\fishy-ir`). Start with `KNOWN_ISSUES.md`
> if you want to know what is fixed vs. still open, then `API.md` for the
> contract.

This folder is **everything needed to work on the UI**: the current UI
files, the API contract (human + machine), the design tokens, and the
backend request log — nothing from the engine internals (message bus,
spectrum decoding, storage, auth/queue internals is *behind* the API, not
for the UI).

```
frontend-handoff/
├── README.md            ← you are here
├── API.md               ← **the contract, current (start here)**
├── KNOWN_ISSUES.md      ← open items, fixed items, PC verification steps
├── BACKEND_REQUESTS.md  ← request log (push, metadata, copy targets) — all done
├── DESIGN.md            ← visual language (tokens, layout rules)
├── openapi.yaml         ← machine-readable version of the same contract
├── serve.bat / serve.sh ← serve ui/ statically for local dev (port 8400)
└── ui/
    ├── index.html       ← DOM (hero + 5 views + footer)
    ├── app.js           ← client (vanilla JS, no deps, no build step)
    └── style.css        ← theme (design tokens = CSS vars at the top)
```

## What works today (instrument-validated)

* install (`install/install.bat`) → venv → `.omnic-cli-ready` → `start.bat`
* **background** measurement via hero button — succeeds, banner tracks it
* **sample** measurement — spectrum decoded (spectrum vector preferred over
  interferogram), stats + peaks in the result, files in
  `C:\fishy-ir\measurements\<id>-<name>\`
* **settings tab** — constraints / optimal velocity / instrument XML all
  answer (fixed in omnic-cli 2.5.2)
* 409-busy semantics, `stop` button, token flow, offline UI

## 5-minute run loop (local dev)

```bash
# Linux/macOS — serve the *static* UI from this folder:
(cd ui && python3 -m http.server 8400)      # → http://localhost:8400/
# Windows:
serve.bat
```

If the real service is running on the same machine → done (it serves the
same page on `:8385`). If it's elsewhere, point the UI at it once:
`http://localhost:8400/?base=http://HOST:8385` (read in `app.js`; token
prompt handles auth).

## Non-negotiables (design)

* **No framework, no CDN, no build step** — the UI must run on an
  air-gapped Windows PC from plain files.
* All fetches through `API.req(path[, opts])` — token, JSON, toast errors.
* 409/`busy` must be in-band (highlight the running job), never a global alert.
* Header/footer text requests are listed in `KNOWN_ISSUES.md` — styling-only.

## Copying fixes to the instrument PC

After any change: copy `src/fishy-ir/fishy_ir/**` → `C:\fishy-ir\fishy_ir\`,
copy `src/omnic-cli/omnic-cli.exe` (v2.5.2) → `C:\fishy-ir\omnic-cli\`,
restart via `C:\fishy-ir\start.bat`. No install needed.
