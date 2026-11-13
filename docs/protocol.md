# CLI and telemetry protocol

The browser sends one command at a time at 115200 baud and waits for a terminal prompt `esp32_a1 > `. Commands are terminated by CR. The transport accepts CRLF responses and removes ANSI terminal sequences. A prompt may be followed immediately by asynchronous task logs in the same serial packet; it need not be the packet suffix.

## Discovery and errors

A connection sends an empty command, then `help`. The help listing must identify `iic_rd`, `adc_on/off`, `dac_on/off`, `adc_gain`, `dac_vol`, `adc_mute`, `dac_mute`, `set_rate`, `set_bits`, `set_ch`, `i2s_on/off`, `dac_ref`, `vad_on/off` and `vad_status`. Optional features are enabled only when their command names are advertised.

Vendor error lines, non-zero command results, failed reads/writes and usage responses reject the operation. A command timeout disables the connection so a late response cannot satisfy another command. There are no retries that silently turn a failed write into success.

Only ADC gain addresses 0x0067–0x006a and DAC gain addresses 0x0070–0x0071 are writable through the UI's raw register controls. Values and masks are 8-bit. A masked-write mismatch attempts to restore only the affected bits and reports whether restoration was confirmed.

## Optional telemetry

Each telemetry command produces exactly one line containing the requested type:

```text
@A1 {"type":"state", ...}
esp32_a1 >
```

The line prefix is literal `@A1 `. JSON occupies one line. Other diagnostic lines may precede it, but duplicate or malformed matching frames are rejected. The abbreviated example above illustrates framing, not a valid complete state frame.

### web_status

Returns a complete snapshot without enabling audio. Required fields:

| Fields | Type / meaning |
| --- | --- |
| `type`, `version`, `uptime_ms` | `state`, firmware version string, non-negative monotonic milliseconds |
| `i2s`, `adc`, `dac`, `reference`, `vad`, `vadOutput` | Boolean confirmed runtime/configuration state |
| `adcMute`, `dacMute`, `speech` | Boolean or null when unavailable |
| `rate`, `bits`, `channels` | Supported rate, 16/24 bits, 1–4 physical ADC channels |
| `referenceChannel` | 1 = DAC left, 2 = DAC right |
| `volume` | Integer 0–100 or null |
| `triggers` | Non-negative VAD recording-trigger counter |
| `sd`, `recording`, `playing`, `scope` | Boolean; recording means actively capturing, not merely prepared |
| `gainRegisters` | Four gain-register bytes, each integer 0–255 or null |
| `scope_max_ms` | Optional integer 5–10000; absent means the legacy 500 ms limit |
| `rxOverflows` | Diagnostic RX overflow count in the included bridge |

ADC gain uses `(byte - 128) / 2` dB. A mute operation can set hardware gain bytes to zero while the driver's requested-gain cache remains different. Do not overwrite a user's gain draft from muted zero registers.

### web_scope adc|dac channel

Returns up to 128 recent signed 16-bit preview samples. ADC channel indices include configured physical channels and an optional RE slot. DAC channel 0/1 is left/right. RE is a reference slot, not a fifth microphone.

Fields: `type: wave`, `source: adc|dac`, `channel`, `rate`, non-negative `seq`, `age_ms`, Boolean `valid`, `readError`, and `samples`. An invalid frame has an empty samples array. A valid frame must have a supported rate, non-empty samples, and age in [0, 500) ms. The UI removes stale/disconnected display data.

ADC polling leases a continuous capture worker. DAC data is valid only while the owning application is actually playing PCM; enabling DAC alone must not synthesize a waveform. `web_scope stop` stops monitoring without stopping user audio paths.

### web_scope_window adc|dac channel milliseconds

Requests an integer window from 5 to 10000 ms, bounded by the backend's advertised capacity. The duration is a real contiguous sampling span; it is not created by stretching 128 recent samples.

Additional fields:

- `duration_ms`: actual sample duration (fractional at non-integer sample-rate/window combinations).
- `spanFrames`: number of original sample frames in the window, at most 480000.
- `available_ms`: contiguous history accumulated so far.
- `samples`, `min`, `max`: up to 128 equally grouped bins. Samples are bin means; min/max are actual extrema. Their array lengths match.
- `rms`, `peak`: normalized values in [0, 1], derived from the original samples. `peak` must agree with the envelope extrema; it is not computed from bin means.

A valid duration and frame count agree to within one original sample frame. The bridge uses per-millisecond statistics for longer windows and clears history after capture gaps, format changes or lease expiry. The page waits for enough new data instead of drawing stale history.

## Draft versus device state

Import/edit operations change only the browser draft. Apply operations send explicit commands. Successful responses and complete snapshots update confirmed state; unknown fields do not light paths. Dedicated VAD output is displayed separately from raw MIC paths. See the production validators in [core.mjs](../core.mjs) and the deterministic [tests](../tests/).

## Optional SD file commands

`fls /sdcard` returns `FLS BEGIN /sdcard`, zero or more `E <bytes> <name>` entries and `FLS END <count>`. The UI lists safe WAV paths and obtains the exact finalized recording path from asynchronous `Recording done` events.

`fsnr <path> 0 0 0.52` inspects channel 0 and reports actual WAV rate, bit depth and channel count. This duration supplies at least 4096 frames at the minimum supported 8 kHz rate. For listed files no larger than 180000 bytes, `fget` instead permits short-file inspection: `FGET BEGIN <bytes> <crc32> <path>`, base64 `D <payload>` lines and `FGET END`. The UI verifies length, CRC32 and RIFF bounds before using those metadata. Bulk audio and telemetry lines are excluded from text logs; file paths and diagnostic messages remain.

`rec_on <target_seconds> <unique_tag>` starts recording; its immediate prompt acknowledges the command, not file completion. Finalization reports data bytes, exact path and interval RX overflow count. A file's header adds 44 bytes. Legacy v0.4.1 targets are buffer-granular; the v0.4.2 buffered path uses exact sample counts. `rec_off` must finalize an active WAV and may cancel an armed recording.

Playback requires a mono/stereo PCM WAV, a matching shared format and an enabled DAC. `vad_wav` requires mounted SD and VAD dedicated filtered output; detection-only mode cannot provide this FIFO. These optional commands are enabled only when advertised by `help`. No delete or format command is exposed in the UI.

### Buffered recording: web_record_status

Firmware v0.4.2 supplies a single `@A1` JSON line with `type: record`, Boolean `active`, integer `capturedBytes`, `writtenBytes`, `targetBytes`, `bufferBytes`, `peakBufferBytes`, `rate`, `frameBytes`, `elapsedMs` and integer `error`. Target bytes are zero for manual-stop mode. Captured data enters a bounded queue; written bytes count successful file writes. The owning application's `recording` state remains true until the WAV header and close complete.

The UI accepts SD recording only when this command is advertised. It polls progress during a recording, prevents duplicate starts and refuses ADC/DAC/I²S teardown while their file tasks are active. Parameter edits still require an explicit apply action.

### WAV inspection: web_file_info

`web_file_info /sdcard/path.wav 0` checks a PCM WAV and returns one JSON line with `type: file`, `rate`, `bits`, `channels`, `bytes`, `dataBytes`, `frames`, Boolean `verified`, eight-digit hexadecimal `crc32` and `scannedBytes`. Header-only mode reports `verified: false`, zero scanned bytes and CRC `00000000`; these values explicitly distinguish metadata from a full-file scan.

Argument `1` reads every file byte and calculates standard IEEE CRC32 on the board, with a bounded 16 KiB working buffer. It reports `verified: true` only after the scanned length matches the file size. The command checks RIFF length, chunk bounds, PCM alignment and sample count, accepts trailing metadata chunks, and refuses active recording/playback. The UI uses header-only mode before playback; hardware regression runs also use full scans and cross-check short-file CRC against `fget`.
