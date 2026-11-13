# v0.5.0-dev.1 local preview validation

Date: 2026-11-13. Historical host-preview checkpoint, before real-board revalidation. Superseded by [v0.5.0 validation](validation-v0.5.0.md).

- Host suite: 42 tests covering the existing protocol/PCM guards and new draft comparison, DAC action, directional path tracing, English catalogue and bounded serial cleanup cases.
- Browser: production modules and the generated standalone HTML both loaded without console errors. Simple/pro diagrams and the ADC, gain, clock, DAC, reference, VAD, board-file, connection and register controls were checked in English.
- Locale round trip: Chinese → English → Chinese retains edited values; a reload retains the language preference. Original communication logs are excluded from translation.
- A clearly marked simulated Web Serial fixture confirmed volume 25 → 42, write/readback completion, pending-count clearance and waveform UI translation. Language toggles left its control-command count at zero. A simulated command failure remained visible after closing the inspector.
- Layout: checked at 1280×720 and 900×700. The narrow layout had no document-level horizontal overflow; the diagram has its own scroll region, zoom and explicit Fit view.
- The fake device fixture is tests/ui-fixture.html, served locally. It is not included in the production HTML and is not evidence of real audio or board operation.

No firmware was changed, no serial port was seized and no new physical-board acceptance was performed in this preview. The prior v0.4.1 hardware results remain scoped to that version.
