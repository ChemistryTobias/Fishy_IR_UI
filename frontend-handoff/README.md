# fishy_ir — frontend handoff (UI + API contract)

This folder is **everything needed to work on the UI**: the three UI
files, the API description, and the OpenAPI spec — and *nothing* from the
backend (engine integration, message bus, spectrum decoding, storage,
auth/queue internals). You do not need any of that; the UI is a contract.

```
frontend-handoff/
├── README.md        ← you are here
├── API.md           ← **the contract, human-readable (start here)**
├── openapi.yaml     ← same contract, machine-readable
└── ui/
    ├── index.html   ← DOM (5 views: queue / live / results / settings / api)
    ├── app.js       ← client (vanilla JS, no deps, no build step)
    └── style.css    ← theme (design tokens = CSS vars at the top)
```

## 5-minute run loop

The UI is plain static files — any static server works:

```bash
# Linux/macOS
(cd ui && python3 -m http.server 8400)
```
```bat
:: Windows  (double-clickable alternative)
serve.bat
```

Then open:

```
http://localhost:8400/
```

If the real service is running on the same machine: **done** (or just use
its own `:8385` — identical page). If it runs somewhere else, point the UI
at it once:

```
http://localhost:8400/?base=http://HOST:8385
```

(`?base=` is read in `app.js`; it only changes the fetch URL — you may
remove it from your fork, but keeping it means the same file works both
standalone and embedded.) When a token is required (LAN), the UI itself
prompts once and stores it — no code needed.

**Nothing here can hurt the measurement:** the UI only reads/writes through
the documented endpoints; the dangerous parts (the instrument) are entirely
inside the service.

## What the UI must keep doing (regression contract)

1. **Concurrency UX** — starting a second measurement while one runs returns
   `409 {busy:true, current}` → show it in-band and highlight the running
   job; *adding* to the queue must always stay possible.
2. **Background rule banner** — when `/health` says
   `background.ok=false` show `background.warning` + "Measure background
   now" (which is just a background job).
3. **Token prompt** — when `/health` says `tokenRequired`, ask once, store
   in `localStorage.fishyToken`, send as `X-Fishy-Token`, clear on 401.
4. **Stop** — `POST /api/jobs/<id>/stop` (or `/api/instrument/stop`);
   expect the job to become `aborted` within ~8 s; treat `aborted` as a
   distinct, non-red state (user intent, not a fault).
5. **Errors** — every non-2xx body is `{"ok":false,"error":...}`; show the
   `error` text as-is (it is user-facing by design), never crash the page.
6. **Offline-safe** — no CDN, no framework, no build step; the page must
   open and look right before any API is reachable.

## What changes here should NOT be asked of the backend

* new colours/components/wording — pure UI, fine;
* reordering tabs, new views that only read existing endpoints — fine;
* anything implying **new endpoints, new fields, edits to engine settings,
  or writes during a measurement** — raise it; those are product decisions
  with real instrument consequences (one session, one measurement at a time,
  GUI must be closed).

## Hand back

Return the three files in `ui/`. Drop them into the service's `ui/` folder
(same names) and every feature of the shipped service keeps working — the
service already serves exactly these, same-origin, with CORS enabled for
your remote dev loop (see API.md §1.3).

## Design (MPI-FKF)

The UI follows `DESIGN.md` (Max Planck corporate design adapted for screens):
MPG green header with a text wordmark top-left (no Minerva), Roboto embedded
in `style.css` (self-hosted, no Google CDN, works air-gapped), flat 2px-radius
buttons with uppercase tracked labels, accent colours only at small scale.
Desktop only (min. width 1200 px). All tokens are CSS variables at the top of
`style.css`.

**Layout:** one main page and one slide-in panel.

* **Main page:** current status (Running / Stopping / Idle / Error / Offline,
  background freshness, instrument, queue size), the queue (running and
  not-yet-started jobs only), *New measurement*, and a *Recent activity* bar.
* **Panel** (slides in from the right; *Back* steps back, Esc too):
  new / queued measurement form (editable until it starts) · follow the
  running measurement · recent activity (finished, failed, aborted, including
  backgrounds) · result with spectrum · settings (instrument, service, API).

**Metadata & output:** the form takes optional YAML/JSON metadata, a save-to
path and an API endpoint with headers. These are **not in the API contract
yet**. See `BACKEND_REQUESTS.md` for what the service needs to add. Until
then they are kept in the job's `notes`.
