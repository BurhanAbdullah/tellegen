---
"@tellegen/svelte": patch
---

The demand slider's Nearby and Full range buttons are named by their visible
text again. 0.4.2 labelled them "Nearby demand range" and "Full demand range",
which do not contain the visible "Full range", so speech input could not reach
the button by what it shows (WCAG 2.5.3, axe `label-content-name-mismatch`).
The "Demand range" group still names the pair.
