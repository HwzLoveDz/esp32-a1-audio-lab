# Changelog

## 0.8.3

- Use Mint on first launch and when theme storage is unavailable or invalid. Keep explicitly saved Light and dark themes, and apply the initial palette before the main application loads.
- Add startup-theme regression coverage; the full web/protocol suite passes 83 tests.

## 0.8.2

- Require explicit values in numeric gain/volume controls, retain useful invalid-input feedback and reject fractional waveform-window lengths.
- Check actual clock/reference acknowledgement values, clone validated arrays and preserve later draft edits after a submitted response.
- Reject empty WAV path components.
- Improve light/Mint text contrast, waveform heading order, keyboard focus and scrollable communication logs.
- Add locked fast-check/axe/gremlins development dependencies, a portable fail-closed HTTP fixture, guided input/node/workflow coverage and an evidence-gated quality scorecard.
- Refresh both READMEs and four v0.8.2 interface screenshots; retain v0.8.0 board captures in a separate gallery. Add an isolated interactive HTTP preview without audit controls.

## 0.8.1

- Freeze the target channel, address and parameter values when submitting a module operation, before waiting for device responses.
- Disable conflicting edits during a write and block application of invalid numeric inputs; keep in-flight status when viewing another module.
- Keep the recording example independent of whichever panel is visible, and clear a failed VAD preparation without losing immediate recording events.
- Show the shared clock as enabled only when I²S is confirmed running; retain SVG nodes when telemetry has not changed the graph.
- Open waveform monitoring above the settings panel on narrow windows.
- Add the optional light Mint theme and expand the isolated browser fixture. UI validation uses mocked interfaces only; firmware is unchanged.

## 0.8.0

- Align VAD, TDM and DAC reference blocks with straight vertical branches in both diagrams.
- Keep routine SDK VAD interrupt notifications from stopping live PCM monitoring.
- Refresh the independent project introduction and current board screenshots.

- Add six one-click board examples with ordered shutdown, setup and readback, including a ten-second SD recording and Stop all.
- Add full configuration application after JSON import.
- Keep unapplied edits local to each module; remove the global draft/device view switch and draft list. The map always follows device state.
- Keep Quick start in the top bar, clear of floating panels; capture examples close the example picker and open live PCM.
- Add example sequencing and failure-path tests plus [board and browser results](docs/validation-v0.8.0.md).

## 0.7.0

- Separate I²S capture from SD writes with a bounded PSRAM queue, fixing sample loss during card-write stalls. Use exact sample-count targets and drain captured data on manual stop.
- Add up to 30-minute recording targets, device-reported progress and readable file sizes. Require the buffered recording backend for SD recording.
- Add fast WAV header inspection and optional on-board full-file read/CRC32 commands. Refuse dependent stream shutdown during file tasks.
- Complete a 30-minute high-rate board run and five-minute simultaneous recording/playback with zero recording-interval RX overflows; add C concurrency/error-path regression tests. See [board results](docs/validation-v0.7.0.md).
- Keep SD/record/play state updates bound to their own readout when progress and filename cards are present.
- Refresh bilingual documentation around current operating steps and measured results.


## 0.6.0

- Give each recording a unique name, refresh the SD file list after completion, and select the new file for playback.
- Check WAV metadata and the shared audio format before playback; verify CRC32 and RIFF bounds for short-file transfers. Keep multichannel recordings separate from mono/stereo playback.
- Restrict FIFO saving to mounted SD and confirmed VAD filtered-output mode; block unmount while recording or playing.
- Recognize a command prompt followed by asynchronous recording logs in the same packet, preventing false serial timeouts. Filter complete telemetry and audio-data lines out of exported text logs.
- Validate SD recording, manual stop, stereo DAC PCM, simultaneous recording/playback and dedicated VAD FIFO saving on ESP32-A1/S31 with existing v0.4.1 firmware; no reflash required. See [validation](docs/validation-v0.6.0.md).

## 0.5.3

- Pan the diagram by holding the right mouse button and dragging, or using arrow keys, with bounded movement in all directions. The wheel only zooms, anchored at the pointer. Left click selects a module; the diagram suppresses the browser context menu.
- Fit and center the diagram in the visible canvas area beside floating panels, using the new icon next to zoom controls or Home.
- Preserve manual camera placement across device-state refreshes; distinguish node clicks from dragging.

## 0.5.0

- Default to English on first launch; add persistent Chinese/English switching across diagrams, settings, status, waveform controls and errors; preserve raw serial logs.
- Separate pending edits from confirmed device state, with module comparisons and selective reversion.
- Apply DAC path, volume readback and mute from one primary action.
- Trace the selected signal path without changing disabled states or lighting sibling MIC inputs.
- Bound serial write timeouts and disconnect cleanup; preserve SVG keyboard focus during state refresh.
- Recheck the updated web controls on ESP32-A1/S31 hardware with debug firmware v0.4.1, and replace the README illustration with four live-board screenshots.

## 0.4.1

- Start I²S before MIC/DAC enable, refresh device state before writes and after errors.
- Document and verify the Codec reset-pin and shared TDM-frame fixes required in firmware.
- Default VAD to detection-only; distinguish dedicated filtered output from independent MIC capture.
- Show explicit mute/disabled-path messages and synchronize the visible runtime version.
- Verify six capture/duplex configurations, 18 MIC reopen cycles and four-channel 0 dB capture with VAD detection toggles and RE on/off.
- Publish bilingual documentation, telemetry extensions, 33 host tests and reproducible single-file builds.

## 0.4.0

- Add a linear 5–10000 ms time slider and numeric input.
- Add automatic vertical scaling, wheel-controlled manual scaling and Auto reset.
- Use short raw PCM history and longer per-millisecond statistics for real envelopes, RMS and peak.

## 0.3.x

- Add four dark themes, resizable panels and viewport-aware heights.
- Add continuous-window telemetry and serial monitoring lease expiry.

## 0.2.x

- Add complete state snapshots and real ADC/DAC PCM preview interfaces.
- Synchronize confirmed device values while preserving unwritten drafts.

## 0.1.x

- Introduce the standalone Web Serial workbench, simple/professional routing diagrams and module controls.
