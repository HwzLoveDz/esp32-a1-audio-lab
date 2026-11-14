# Current validation / 当前验证记录

**PASS · 2026-11-14 · Web v0.8.3 + firmware v0.4.2**

Board: ESP32-A1 Codec + ESP32-S31 EV Board, using its four onboard microphones and an inserted microSD card. The tested standalone HTML has SHA-256 `123634e0f6eb0e455ab8604018e4c823de624ee4b96f0f9cc1295fe0f23e4d58`.

## Hardware results

| Check | Result |
| --- | --- |
| SD mount and file inventory | PASS |
| Dynamic PCM from each of four physical microphones | PASS |
| Continuous ten-second MIC window at 48 kHz, 480,000 frames | PASS |
| ADC2 +6 dB, register 0x0069 = 0x8c; other channel gains unchanged | PASS |
| ADC mute and gain-cache recovery | PASS |
| Detection-only VAD with continuing MIC PCM | PASS |
| Four MIC + stereo DAC + RE reference layout | PASS |
| Ten-second stereo recording, exact sample count and full-file CRC | PASS |
| Playback with actual DAC PCM | PASS |
| Simultaneous recording and playback | PASS |
| Manual stop finalizes captured WAV data | PASS |
| Host file transfer CRC matches board CRC | PASS |
| Stop all waits for playback before closing paths | PASS |
| Three browser-started recordings, exact frames and full-file CRC | PASS |
| Masked register write preserves other bits and restores the original value | PASS |
| Dedicated VAD FIFO: 8 kHz / 16-bit / mono, 1,024 frames, full-file CRC | PASS |

The dedicated VAD FIFO format follows the SDK frame metadata; its 8 kHz output is independent of the ordinary capture clock. The saved file contained 2,048 PCM bytes plus the WAV header.

### Browser-started continuous recording

All three files used stereo, 16 kHz, 16-bit PCM. Each completed with **zero RX overflows**. Files were read in full after finalization.

| Duration | Sample frames | WAV bytes | CRC32 | Result |
| --- | ---: | ---: | --- | --- |
| 10 s | 160,000 | 640,044 | `bd18f0e3` | PASS |
| 30 s | 480,000 | 1,920,044 | `12b19792` | PASS |
| 300 s | 4,800,000 | 19,200,044 | `b6b98a15` | PASS |

The five-minute file was then selected in the browser and played through the DAC while the page displayed actual DAC PCM.

### Browser-to-board operation

The unchanged production standalone page, serial protocol implementation and parameter modules were used. A loopback HTTP adapter connected their byte stream to the actual Windows serial device. Device state, register responses, PCM, SD progress and files came from the connected board.

The visible workflow covered Quick start, per-channel gain application and readback, the ten-second waveform window, detection-only VAD, duplex/reference setup, recording progress, file selection/playback, Stop all and disconnect. All seven current README images were captured from this run in Graphite, in English. The screenshots carry the live-board marker.

## Web and firmware regression results

| Suite | Result |
| --- | --- |
| Web/protocol regression | 83 passed |
| Production recording-buffer C tests | 7 passed |
| Input validation | 153 cases across 33 controls passed |
| Diagram entry points | 34 passed |
| Directed browser workflows | 12 passed |
| Accessibility scans | 25 scans across six themes; zero reported rule violations |
| Seeded interaction checks | 300 actions passed |
| Generated property/model runs | 7,700 passed |

The browser suite also checked English/Chinese switching, invalid and valid JSON import, native JSON export, keyboard focus and shortcuts, panel resizing, camera pan/fit, a visible 760 × 900 viewport and waveform manual/Auto scaling. Hardware interfaces are isolated in this regression fixture; hardware checks are listed separately above.

Mint remains the first-run default. All six saved theme choices take precedence, and inaccessible/invalid theme storage retains Mint. The actual inline startup script is included in the regression checks.

## Reproduce

```sh
npm ci --ignore-scripts
npm test
npm run build
sh tests/run-firmware-tests.sh
```

Run the C test command on Linux / WSL. For interactive browser checks, run `npm run test:browser` and follow the [quality plan](quality-plan.md). For board checks, connect the current firmware, run the six Quick start tasks and verify the corresponding status, PCM and files. Recordings are checked after stopping playback/recording; file inspection requires idle file tasks.

The task restored the original known audio state and gain registers, removed only its own test recordings and closed the serial connection. No firmware was flashed during this acceptance run.

Machine-readable results: [validation-v0.8.3.json](validation-v0.8.3.json).
