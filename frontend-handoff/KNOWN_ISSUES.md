# Known issues & open items (status: 2026-10-27)

From the instrument-PC session (`production_test_out2/UI_issues.txt`) and the
fix round that followed. Status key: ✅ fixed (this build) · 🔧 backend-side ·
🎨 styling/UI-only.

---

## UI requests (from the user, verbatim intent)

| # | Ask | Status | Notes |
|---|-----|--------|-------|
| 1 | "No decodable spectrum" on background & sample results | 🔧→🎨 | **Two separate bugs, both fixed in 0.2.0 + omnic-cli 2.5.1/2.5.2:** (a) `VecStore.SaveAll` returned the *last* vector — for sample events that is the interferogram, not the spectrum → C# now prefers `DataVectorXml` > `BackgroundDataVectorXml` > last (v2.5.1+); (b) `app.py` requires `result.sourceFile` to decode for the UI, but the engine never set it → engine now sets **`sourceFile`** (v0.2.0 engine patch). **Still to verify on the PC** after copying `omnic-cli/omnic-cli.exe` (≥ v2.5.1) **and** `fishy_ir/engine.py`. If it fails again, the service log now prints the per-file decode error instead of staying silent. |
| 2 | Files should land in `C:\fishy-ir\measurements` | 🔧✅ | Engine working set stays in `omnic-data\` (never touched). Since this round every **finished** job also gets its XML+CSV copied to `measurements\<8-char-id>-<name>\`. `push` (`output.push`) additionally POSTs the payload where configured. |
| 3 | "Measure background now" too large | 🎨 open | Suggestion: keep 1-line label, `max-width: 220px`, `white-space: normal`, `padding: 8px 12px`, font 13px — or split label into a button group. Pure `style.css` + `index.html` work. |
| 4 | Header: remove "Max Planck Institute"; show **"FTIR measurement service"** + instrument name ("Thermo Fischer · Nicolet Summit X") | 🎨 open | The header text lives in `ui/index.html` (static) — the service does not return an instrument model, so keep the line static or add it to `/api/instrument/status` (🔧 optional). |
| 5 | Footer: remove the "…one session, one measurement at a time" sentence; keep footer at bottom of the page | 🎨 (half ✅) | Sticky-bottom is **already done** in this build (`margin-top: auto`). What remains: delete that sentence from the `footer` block in `ui/index.html`. |
| 6 | Configuration (instrument endpoint etc.) not changeable in UI | 🎨 open | Settings view is **deliberately read-only** (values come from the live driver; settings never sync to the GUI). To make *service* settings editable you need new endpoints (🔧) — not yet built; config today is `config/fisy_ir.json` (edit the file, restart the service). |
| 7 | Settings tab: "Optimal velocity / Constraints / Instrument XML" all failed `OmnicError` | 🔧✅ | **Root cause (confirmed in code):** the C# `serve` dispatcher passed the positional list **including the command word** into `DoSetting` (`what` became `"setting"` → usage error on every settings call), while the one-shot path never did. Fixed in **omnic-cli 2.5.2** (`if (spos.Count>0 && spos[0]==cmd) spos.RemoveAt(0)`). No Python change needed — **copy the new `omnic-cli.exe` (v2.5.2) to the PC and restart the service.** |
| 8 | (recurring) "instrument busy" when clicking Measure background | by design | Single instrument session — see `API.md §1`. The hero already surfaces the running job; 409 is correct. |

## Fixed in this round (engine/protocol, no UI change required)

`502e550` + `25c5cd1` + this round (omnic-cli 2.5.2, fishy_ir 0.2.0 engine patch):

* ❌ `background() got multiple values for keyword argument 'name'` — fixed.
* ❌ `unknown option: --kind` — fixed (`kind`/`start_now` are reserved, dropped
  before wiring in three layers: `app.py`, `params.py`, `engine.py`).
* ❌ Sample decodes to interferogram — fixed (spectrum priority, v2.5.1).
* ❌ No `sourceFile` in result → UI couldn't decode — fixed (engine now sets it).
* ❌ Decode failures silently swallowed — now logged per file
  (`decode skipped <file>: <err>` in the service log).
* ❌ Settings endpoints broken under `serve` — fixed (v2.5.2).
* ❌ Results not in `measurements\` — fixed (copy-on-finish).
* ❌ Footer not sticky, legacy `run.bat`/`make-exe.bat` syntax errors — fixed.

## How to reproduce on the instrument PC

```text
1. Copy  fishy_ir/            →  C:\fishy-ir\fishy_ir\       (all .py)
   Copy  omnic-cli/omnic-cli.exe  →  C:\fishy-ir\omnic-cli\  (v2.5.2)
2. Close the service window, re-run  C:\fishy-ir\start.bat
3. UI:  Measure background now → must succeed
        Sample (default params)   → result must show spectrum + peaks
        Settings tab              → all three endpoints must answer
        Files:  C:\fishy-ir\measurements\<id>-<name>\
```
