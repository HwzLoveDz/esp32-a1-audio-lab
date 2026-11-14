# v0.8.2 browser quality review

Date: 2026-11-14. Web version: 0.8.2. The browser and protocol checks in [the quality plan](quality-plan.md) passed using an isolated HTTP fake device.

## Changes verified

- Blank numeric fields cannot silently become zero or submit a previous value. Number controls and waveform windows require valid integers, with actionable English and Chinese feedback.
- Clock acknowledgements must match the requested sample rate, width and channel count. DAC reference verification checks both its enable state and selected source. A mismatch stops the remaining transaction.
- Validated configuration arrays are independent of the caller. A later response preserves drafts that differ from the submitted value. WAV paths reject empty and traversal segments.
- Improved secondary-text and SVG contrast across the six themes, keyboard focus, log-region access and heading structure. Clicking a resize separator now gives it keyboard focus; End expands it and double-click restores its default width.
- The existing submission/navigation, recording-preparation recovery and narrow-screen waveform fixes remain covered.

## Results

| Check | Result |
|---|---|
| Node regression | 82 passed, zero failures |
| Property and model generation | 7,700 runs, fixed seeds |
| Browser input matrix | 153 cases across 33 controls |
| Diagram entry navigation | 34 entries across simple/pro modes |
| Directed workflows | 12 passed, including delayed responses, incorrect readback and failure/retry |
| Accessibility | 25 scans, six themes, zero reported rule violations; independent SVG contrast checks passed |
| Supplemental stress | 300 seeded actions with UI-state assertions, zero recorded errors |
| Native browser review | Numeric edit/shortcut, keyboard focus, JSON chooser/download, resize/pan/fit and 760 × 900 waveform layout passed |

Native JSON import rejected a wrong schema without writes; loading a valid draft also sent no control writes. The downloaded JSON matched the loaded schema, version and values. At the narrow breakpoint, capture brought the waveform forward and hid settings. Wheel input selected manual scale; Auto restored automatic scale.

axe contrast results requiring human review were retained rather than counted as passes. Visual overlap review and computed SVG foreground/background checks supplemented them. Full screen-reader and OS/IME coverage were not part of this run.

## Reproduction and evidence

Use the locked development dependencies and HTTP fixture described in [the quality plan](quality-plan.md). Run the full audit, complete native review, then run `tests/quality/verify-audit.mjs`. It rejects incomplete coverage, failed assertions and a browser/manual report for a different distribution bundle, then reruns Node tests before writing its scorecard.

The runner saves its JSON reports to the directory selected by `--reports`. The verifier records both the LF-normalized served bundle hash and the raw distribution-file hash. Fixed property-test seeds are included in `tests/quality/inputs.test.mjs`. Current interface screenshots are linked from the README and are explicitly marked as simulated.

All browser work used an isolated HTTP fake device with native device/media APIs blocked. No file-scheme webpage, firmware flashing or physical-device test was used. Test tabs and the loopback server were closed. Firmware was unchanged; earlier hardware measurements retain their original versions.
