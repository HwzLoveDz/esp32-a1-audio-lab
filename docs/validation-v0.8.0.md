# v0.8.0 example checks

Test date: 2026-11-14. ESP32-A1 Codec + ESP32-S31 EV Board, firmware v0.4.2, web v0.8.0 and inserted SD card.

The production `examples.mjs` runner configured four-MIC capture, single-MIC detection-only VAD, duplex with RE, stereo recording preparation, stereo playback preparation and Stop all on the connected board. Capture cases returned valid PCM windows; register readbacks matched configured gains. A ten-second stereo 16 kHz / 16-bit recording contained exactly 160000 frames and 640044 WAV bytes, with an on-board full-file CRC read. Playback returned valid DAC PCM. Stop all waited for active playback before closing dependent paths.

The distributed standalone web application was loaded through a localhost adapter connected to the same serial device. Browser clicks exercised microphone and voice examples, ten-second recording, SD file selection/playback and Stop all. The browser-created recording also contained exactly 160000 frames / 640044 bytes and passed the full-file read. The quick-start entry remained reachable with floating windows open. Chinese/light and English/ocean layouts were inspected.

Editing the ADC enable control without applying left the actual ADC route off; Undo cleared the local change. Offline example buttons were disabled. The six example sequences and imported configurations share preflight checks, dependency ordering and final device readback. Seven example tests cover running/armed tasks, missing interfaces, asynchronous stopping, injected command failure, inconsistent readback and custom configurations. The complete web suite passes 72 tests.

Task-created recordings were removed by exact path, previous format/reference and idle state restored, and serial connections closed. This update uses the existing v0.4.2 firmware.

## Current screenshots and layout

The images retained in the [v0.8.0 board gallery](board-gallery-v0.8.0.md) were captured from the connected board with web v0.8.0 and firmware v0.4.2. They show the professional four-MIC overview, ADC2 +6 dB register readback, detection-only VAD with a real ten-second PCM window, the simplified duplex/reference layout at DAC volume 20, a ten-second stereo SD recording in progress, and the example picker. The new recording finalized as 160000 frames / 640044 WAV bytes and passed the on-board full-file read. Its task-owned file was removed and the prior device format/reference state restored.

Both diagrams align VAD above TDM and the DAC reference below it. Filtered output, playback-reference input and reference return use vertical branches; the playback row has additional vertical spacing. Switching inspector modules starts at the top of the new panel.

The SDK emits its routine `0x04 VAD` interrupt notification at error log level. The response parser now recognizes that exact notification without aborting valid PCM responses. A regression test keeps real driver errors and combined interrupt/error conditions failing normally. The full web suite passes 72 tests.
