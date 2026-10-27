# DESIGN.md — MPI-FKF Software & UI Design Reference

Source of truth: *Max-Planck-Gesellschaft Corporate-Design-Manual, Version 1.2 (19.07.2022)*, adapted here for **online use and software/UI projects** at the **Max Planck Institute for Solid State Research (MPI-FKF)** — color, type, logo handling, layout logic, and component styling translated from the brand system for screens.

---

## 1. Institute identity

- **Name:** Max Planck Institute for Solid State Research (MPI-FKF)
- **Parent org:** Max-Planck-Gesellschaft (MPG)
- **Logo model:** MPI-FKF uses its own name set in the standard Max Planck wordmark style, paired with the Minerva bildmarke ("Variante 1 / 2" in the CD manual — institute name + Minerva). MPG leadership's stated preference is Variante 1 (name only, no separate institute logo) — don't design a standalone FKF logo/mark for a tool; use "MPI-FKF" or "Max Planck Institute for Solid State Research" as a text wordmark instead.
- **Minerva:** the profile-head bildmarke is MPG/institute IP. Don't reproduce, recolor, or redraw it in an app — if a UI needs a mark, use text (institute name/initialism) or a neutral, non-Minerva glyph instead.

---

## 2. Color

Official MPG specs, given here as sRGB hex for direct screen use.

### Primary (header bars, primary buttons, active nav state)

| Name | Hex | Notes |
|---|---|---|
| MPG green | `#006C66` | primary brand color, preferred logo/accent color |
| MPG green dark | `#005555` | secondary brand color, strong accent |

### Neutrals (text, chrome, borders)

| Name | Hex |
|---|---|
| Black | `#000000` |
| MPG grey dark | `#777777` |
| MPG grey | `#A7A7A8` |
| MPG grey light | `#EEEEEE` |
| White | `#FFFFFF` |

### Accents (charts, tags, status indicators — never the dominant UI color)

| Name | Hex |
|---|---|
| MPG green light | `#C6D325` |
| MPG blue dark | `#29485D` |
| MPG blue light | `#00B1EA` |
| MPG orange | `#EF7C00` |

**Rules that still apply on screen:**
- Max **4 MPG colors** in one view; of those, max **2** as large fill/background colors (prefer colors from one family, e.g. green + green light).
- With MPG green dark present, use **no more than 3** accent colors at once.
- **MPG blue dark** (`#29485D`) is the officially sanctioned institute-variant color (mirrors the blue set MPG uses for institutes on its web CMS) — good as a secondary accent or dark-mode surface for FKF-branded tools.
- Accent colors (green light, blue light, orange) are reserved for large fills only in "younger audience" contexts (IMPRS) — use them as small UI accents (tags, chart series, badges), not as dominant backgrounds.

### Suggested UI tokens

```
--color-primary:        #006C66;   /* MPG green — primary actions, links */
--color-primary-dark:   #005555;   /* MPG green dark — headers, hover/active */
--color-accent-alt:     #29485D;   /* MPG blue dark — institute variant, dark mode */
--color-text:           #000000;
--color-text-secondary: #777777;   /* MPG grey dark */
--color-border:         #A7A7A8;   /* MPG grey */
--color-surface-muted:  #EEEEEE;   /* MPG grey light */
--color-bg:             #FFFFFF;

--color-chart-1: #006C66;
--color-chart-2: #C6D325;
--color-chart-3: #00B1EA;
--color-chart-4: #EF7C00;
--color-chart-5: #29485D;
```

---

## 3. Typography

MPG deliberately uses free/open fonts so institutes aren't blocked by licensing.

- **Roboto** — the primary typeface family.
  - Headlines: **Roboto Bold**, tracking +50…+100 (generous letterspacing on headings/all-caps)
  - Body/intro text: **Roboto Light**, tracking +25…+40
  - Subheads: **Roboto Bold**, uppercase, tracking +25
  - Get it: https://fonts.google.com/specimen/Roboto
- **Merriweather** — secondary/editorial typeface, contrast face for research/human-interest content (article headlines, pull quotes, italic captions). Only relevant for narrative/editorial screens (e.g. a research-news reader), not for tool UI.
  - Get it: https://fonts.google.com/specimen/Merriweather
- **Fallback:** Arial.
- **Self-host fonts.** Loading Roboto/Merriweather from Google's CDN requires user consent (cookie banner) under GDPR — self-host the font files in any web app instead of linking fonts.googleapis.com.

### Suggested UI type scale

```
--font-display: "Roboto", system-ui, sans-serif;   /* weight 700, letter-spacing 0.02–0.05em for headings */
--font-body:    "Roboto", system-ui, sans-serif;   /* weight 300–400 for body text */
--font-mono:    ui-monospace, "SFMono-Regular", monospace; /* for data/code — not in the source manual */
```
Text sets left-aligned (ragged-right) — don't justify body text.

---

## 4. Layout logic

- **Consistent corner placement for identity:** MPG anchors the logo top-right in print but mirrors it to top-left for web (its own web style guide does this because the menu occupies the top-right online). Follow that: put the institute/product identity top-left in a nav bar, and keep the space around it clear — no other elements crowding it (the manual's "Logoschutzzone" principle).
- **Modular content blocks** ("Hauptfläche" / "Nebenfläche"): the brand system composes views from one dominant content area plus smaller supporting blocks (text, color fields, small images/stats). Maps directly onto dashboard/card layouts — one primary panel, secondary panels for metadata/status/actions.
- **Generous whitespace, asymmetric composition:** favor left-aligned, module-based layouts over centered/symmetric ones.
- **Circles & Lines motif:** the manual's signature decorative system is a grid of small circles (4 circles per square module) and tapering vertical lines, used as watermark-like texture behind headlines/numbers. Good optional flourish for a landing/splash screen; keep it out of dense data views where it would compete with content.

---

## 5. Buttons & interactive elements

The brand system has no explicit screen-component spec (it's a print manual), so the following extrapolates its stated visual principles — **flat, geometric, no gloss/gradient finishes, sharp typography with wide tracking, restrained accent use** — into concrete button rules.

### Shape

- **Corner radius: sharp to minimally rounded.** The brand's core motif is squares and circles used as pure geometric fields (Quadrateraster grid, Circles), never soft blends between the two — so buttons should read as clean rectangles, not pill-shaped. Use `0–4px` radius; `4px` is the practical ceiling for a "soft but still geometric" feel. Avoid fully rounded/pill buttons — they contradict the square-grid identity.
- **Fill, not outline, for primary actions.** The manual explicitly rejects glossy/gradient print finishes ("von Glanzlack-Veredelungen raten wir ab") in favor of flat, matte color — translate that to flat, single-color fills with no gradient, no drop shadow, no inner glow. A 1–2px flat border in the same hue (darker shade) is acceptable for secondary/outline buttons.
- **No skeuomorphism.** No 3D bevels, no glossy highlight, no soft elevation shadows on hover — state changes should be communicated by flat color shift and/or a thin focus ring, not by depth effects.

### Sizing & spacing

- Padding: generous horizontal padding relative to height (the manual's textboxes consistently favor width over height — "Kasten nicht ganz mit Text ausfüllen"), e.g. `10–12px vertical / 20–24px horizontal` for a standard button.
- Label type: **Roboto Bold, uppercase, tracking ~+50–80** (matching the manual's headline/label tracking spec) for primary and secondary buttons — this is one of the more distinctive, transferable pieces of the brand voice. Reserve sentence-case/no-tracking labels for low-emphasis tertiary/text-only buttons, where all-caps would be visually too loud.

### Color by state

| State | Primary button | Secondary button |
|---|---|---|
| Default | fill `#006C66`, text `#FFFFFF` | transparent fill, 1–2px border `#006C66`, text `#006C66` |
| Hover | fill `#005555` | fill `#EEEEEE`, border/text unchanged |
| Active/pressed | fill `#005555`, slightly reduced padding or 1px inset border in black at 10% opacity (flat, not a shadow) | fill `#A7A7A8` at low opacity |
| Disabled | fill `#A7A7A8`, text `#FFFFFF` at reduced opacity | border/text `#A7A7A8` |
| Focus (keyboard) | 2px solid focus ring in `#00B1EA` (MPG blue light) offset ~2px from the button edge — bright enough to be clearly visible against both green and white | same |

Destructive actions: don't invent a new red — none exists in the MPG palette. If you need a warning/destructive color, treat it as a deliberate one-off exception (a standard accessible red, e.g. `#C0392B`-class) rather than trying to force-fit MPG orange (`#EF7C00`), which reads as "warning/attention" but not "destructive" to most users.

### Icon buttons / tags / chips

- Same flat-fill, sharp-corner logic as buttons.
- Status chips/tags are a good home for the accent colors (green light, blue light, orange) at small scale — this matches how the manual scopes those colors to illustrations, charts, and small-scale use rather than large fills.

---

## 6. Quick reference — do / don't

**Do:**
- Use MPG green (`#006C66`) as the primary interactive color; MPG green dark (`#005555`) for emphasis/headers/hover states.
- Set headings and button labels in Roboto Bold with increased letter-spacing.
- Keep buttons flat-filled, sharp-to-minimally-rounded, with no gradients or shadows.
- Keep the institute name as a text wordmark; don't invent a new FKF logo mark.
- Self-host fonts.

**Don't:**
- Redraw, recolor, or stylize the Minerva bildmarke.
- Use more than ~4 MPG colors in one screen, or the bright accent colors as dominant backgrounds.
- Use pill-shaped/fully-rounded buttons, gradients, glossy highlights, or soft drop-shadow elevation — none of these are part of the brand's flat, geometric visual language.
