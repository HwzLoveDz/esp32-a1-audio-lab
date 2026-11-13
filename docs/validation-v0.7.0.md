# v0.7.0 board test record

Test date: 2026-11-14. ESP32-A1 Codec + ESP32-S31 EV Board, debug firmware v0.4.2, web v0.7.0, Windows host, inserted 8 GB SDHC card on a 4-bit / 20 MHz bus. Test commands used the production serial/core modules; browser controls loaded the distributed standalone application through a loopback serial adapter.

## Continuous recording

| Item | Result |
| --- | --- |
| Format | 48 kHz / packed 24-bit / four MIC channels plus RE |
| Continuous target | 1800 seconds |
| PCM frames | 86400000 |
| PCM bytes | 1296000000 |
| Finalized WAV bytes | 1296000044 |
| Measured wall time | 1800.393 seconds |
| Recording-interval RX overflows | 0 |
| Longest SD write | 246268 microseconds |
| Queue peak / capacity | 184320 / 1966080 bytes |
| Live monitored windows | 1770 valid 50 ms PCM windows |
| Full-file scan | 1296000044 bytes, CRC32 `a35bb143` |
| Full-file scan time | 1197.291 seconds |

The full-file CRC is an optional on-board sequential scan. Normal playback uses fast header-only inspection and does not perform that scan.

Recording stayed active through the complete interval and device uptime remained monotonic. WAV metadata, file size and exact sample count agree. The onboard reader also sought to the start, 600 s, 1200 s and 1798 s and analyzed all four MIC channels.

## Other operating cases

- Five-minute 16 kHz / 16-bit stereo recording with staged loop playback active: 19200044 finalized WAV bytes and zero interval RX overflows.
- Five one-second recording/reopen cycles: 16000 frames and 64044 WAV bytes per file, followed by full-file reads.
- A short-file CRC matched the independently framed `fget` USB transfer CRC.
- Manual stop drained captured blocks and finalized a readable WAV.
- VAD recording preparation/cancellation completed; dedicated FIFO saving produced 1024 mono frames at 8 kHz / 16-bit with a matching 2092-byte WAV.

## Regression tests and implementation

64 Node.js web/protocol tests pass. Seven host C tests compile the production recorder with a POSIX task/queue shim: a 250 ms stalled writer, queue exhaustion, write failure, read failure, cancellation, allocation failure and oversized WAV targets. They check byte order, sample counts, bounded error completion and resource reclamation.

The recorder separates one RX producer from one file writer with a roughly 2 MiB PSRAM queue. Positive durations use sample counts. Error conditions propagate to the owning application, which finalizes headers from the successful write count. The UI checks the advertised buffered-recording capability, displays device progress, and blocks dependent stream teardown during file tasks.

The firmware update wrote only the application partition; bootloader, partition table and non-application data-region digests matched before and after the write. Test files are tracked by exact path for cleanup; user files and SDK build caches are preserved. Private captured audio and raw device identifiers stay outside this repository.

## Standalone browser controls

The distributed application recorded 60-second and 30-second high-rate WAV files, refreshed the file list and selected the completed path. Progress and live SD/record/play readouts updated together. Attempts to unmount SD or close ADC during recording were rejected before a teardown command was sent. A large five-slot WAV passed fast header inspection and was correctly routed to the channel-extraction guidance for mono/stereo playback.

A further 10-second capture ran while the browser polled the live 50 ms waveform: 75 valid windows were received during capture, the device reported no recording error, and the finalized file contained exactly 480000 five-slot frames (7200044 WAV bytes). The three browser-created files all passed on-device header and sample-count checks.

The file-panel state readout uses its own DOM target so adding progress/file cards cannot redirect state updates into another card. The added SD screenshot is a direct capture from this board session.
