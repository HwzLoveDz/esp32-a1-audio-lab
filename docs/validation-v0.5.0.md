# v0.5.0 validation

Test date: 2026-11-13. Web v0.5.0, ESP32-A1 Codec + ESP32-S31 EV Board, debug firmware v0.4.1, Windows host.

## Host and browser

- 43 host tests pass: protocol and telemetry validation, write/readback, waveform bounds, draft/device comparison, directional path highlighting, English catalogue coverage, English-first defaults, timeout and disconnect cleanup.
- Production source modules and the standalone HTML load without browser console errors. English/Chinese round trips preserve edited settings; a saved Chinese choice remains Chinese. A first launch without a preference uses English.
- Browser interactions with the live board use production app/core/serial modules through a local native serial adapter. Commands and PCM originate from the connected board.

## Live board

| Check | Result |
| --- | --- |
| ADC enable | The primary action starts I²S and enables capture without a firmware reflash |
| Four MIC channels | Every channel produces changing 50 ms PCM; each window spans 2400 frames at 48 kHz |
| Per-channel gain | ADC2 +6 dB is written and verified as 0x8c at 0x0069 |
| Mute | Mute sets hardware gains to zero; unmute restores ADC2 +6 dB. In the UI, active capture edges change from 3 to 0 and back to 3 in simple mode |
| VAD | Detection-only enable/disable is confirmed with independent MIC capture continuing; filtered output remains off |
| DAC primary action | DAC enable, volume 0 → 12 → 0, getter verification and mute complete successfully |
| Continuous windows | 50, 1000 and 10000 ms validate against real min/max envelopes, RMS, peak and frame counts; the ten-second window spans 480000 frames |
| Streaming stability | After stream startup, the RX overflow counter stays unchanged for 72 seconds during continuous browser monitoring |
| Cleanup | Audio paths and I²S are stopped, all four gains return to 0 dB, the original format and RE selection are preserved, and the serial handle is closed |

The RX overflow counter increases while ADC is enabled without a consumer, before waveform monitoring starts. The stability check compares the settled active-monitor interval; recording uses its own interval counters.

## Screenshots

All four PNG files are direct browser captures from this live-board session. No synthetic waveform is used. The small LIVE BOARD badge belongs to the local test adapter.

1. `01-capture-routing.png`: four-channel capture active; DAC disabled.
2. `02-gain-live-pcm.png`: ADC2 +6 dB readback with a real 50 ms PCM window.
3. `03-vad-long-window.png`: VAD detection-only enabled, filtered output off, with a real ten-second MIC window.
4. `04-duplex-dac.png`: ADC/DAC enabled, volume readback at 12/100, and the DAC reference path configured. No WAV is playing in this capture.

## Test setup

This run covers control/readback and digital PCM. It used production host modules and a native serial adapter. The broader six-format / 18-reopen matrix is the historical v0.4.1 result. Firmware, flash partitions and SD files were unchanged in this run.

SD recording and DAC file-playback checks are recorded in [v0.6.0](validation-v0.6.0.md). Buffered long recording is recorded in [v0.7.0](validation-v0.7.0.md).

## Earlier v0.4.1 format baseline

The v0.4.1 suite passed 33 host tests, produced dynamic PCM in six format/start-order combinations and completed 18 MIC reopen cycles. Four channels remained dynamic with RE on/off and before/after detection-only VAD toggles. Window checks covered 5, 50, 500, 1000, 2501 and 10000 ms; the 48 kHz ten-second window contained 480000 frames.
