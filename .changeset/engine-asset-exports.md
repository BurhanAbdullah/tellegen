---
"@tellegen/engine": patch
---

The package exports its two large assets: `@tellegen/engine/wasm` is the
WebAssembly binary and `@tellegen/engine/places` the populated places table. A
host that preloads or budgets them names them by export (in Vite,
`import engineWasmUrl from "@tellegen/engine/wasm?url"`) instead of reaching
into `dist/wasm-pkg/tellegen_bg.wasm` and `dist/data/populated_places.json`.
