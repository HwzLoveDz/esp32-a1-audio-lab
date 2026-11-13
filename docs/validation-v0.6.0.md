# v0.6.0 validation

Test date: 2026-11-13. Web v0.6.0, ESP32-A1 Codec + ESP32-S31 EV Board, debug firmware v0.4.1, Windows host. The inserted SDHC card reported approximately 7580 MiB on a 4-bit, 20 MHz bus. No firmware flash or card format was performed.

## Host and browser

60 host tests pass, including serial prompt/log interleaving, unique recording names, safe file-list parsing, WAV transfer CRC/length checks, playback format guards and FIFO mode eligibility. The standalone build includes the production modules.

The browser loaded application code extracted from that standalone HTML through a loopback-only native serial test adapter. Recording completed without disconnecting, refreshed the file list and selected its exact output path. Clicking a file started real board playback with nonzero DAC PCM. Unmount during recording was refused. A short 8 kHz FIFO WAV was inspected and rejected for playback against the active 16 kHz format. FIFO Save was enabled in dedicated mode and disabled with an explanation in detection-only mode.

The native browser serial permission picker was not exercised by this adapter-based test.

## Live SD checks

| Check | Observed result |
| --- | --- |
| Four MIC + RE recording | 48 kHz / 24-bit / 5 interleaved slots, 2273280 data bytes; 2273324-byte WAV; recording interval RX overflow count 0 |
| Stereo recording | 16 kHz / 16-bit / 2 channels, 92160 data bytes; 92204-byte WAV |
| Full file transfer | 92204 bytes received; CRC32 `f25ba116` matched; RIFF size, data size and PCM format checked |
| Manual stop | Active recording finalized a 46124-byte WAV with no interval RX overflow |
| DAC playback | Both channels produced nonzero real PCM; each 50 ms window contained 800 frames at 16 kHz |
| Playback completion | Manual stop cleared playback state; natural EOF invalidated expired DAC waveform data |
| Simultaneous record/play | Staged stereo loop playback continued while a 169004-byte stereo WAV was recorded; interval RX overflow count 0 |
| VAD FIFO | Dedicated output saved 2048 PCM bytes plus a 44-byte header; transfer CRC verified; 8 kHz / 16-bit / mono, 1024 frames |
| Trigger preparation | Detection-only recording preparation and cancellation completed; no speech-accuracy test was performed |
| Cleanup | Only test-owned files removed; original root-file inventory unchanged; original shared format/RE/gains restored; audio tasks stopped, SD unmounted and serial closed |

The largest observed single SD write in the final short recording run was 65281 µs. This is a measured instance, not a throughput guarantee for other cards or sustained recordings. The cumulative RX diagnostic count may increase when ADC is enabled without a consumer; the loss check above uses each recording's own interval count.

## Fixes found on hardware

- Recording logs can follow `esp32_a1 >` in the same serial packet. Requiring the prompt at the very end falsely timed out a successful recording command. The parser now separates the response from subsequent task logs, while retaining stale-prompt discovery checks.
- Reusing a fixed recording tag can overwrite an earlier same-format recording. Each UI recording now gets a distinct tag and uses the board's finalized path.
- Detection-only VAD cannot provide filtered FIFO audio. The UI now follows the confirmed mode before offering FIFO Save.
- Playback inspects file metadata rather than guessing from its name or silently changing the active shared capture format.

## Limits

Recording duration is buffer-granular: the one-second target above produced 23040 stereo frames, or 1.44 seconds at 16 kHz. Multichannel recordings require channel extraction before direct mono/stereo playback. The current UI does not add an audio-file download or editing tool.

These are digital PCM, file-integrity and control tests. Acoustic output quality, calibrated analog levels, VAD detection accuracy, power-loss recovery and long-duration continuous SD recording remain unmeasured. Private captured audio and raw device identifiers are not included in the repository.
