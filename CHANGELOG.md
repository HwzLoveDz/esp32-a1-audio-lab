# Changelog

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
