---
'@tellegen/svelte': patch
'@tellegen/engine': patch
---

Add a structured log of errors and engine findings. `app.log` records what PowerIO reported while reading a case or a geographic layer, what each solve reported, what each export's writer reported, and every `app.error`, with severity, step, source, code, file, element and buses. `DiagnosticLogView` shows it grouped by step and file with filters, Copy and Download; the default shell adds a "Log" panel, and case import notes now list their findings as rows. `Solution` carries the solve's `diagnostics` (islands, HVDC transfers), which the browser Study already returned.
