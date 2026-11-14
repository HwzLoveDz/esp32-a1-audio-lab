# v0.8.1 UI validation

Date: 2026-11-14. This run exercised the distributed HTML through an HTTP fixture in a real browser. It used an in-memory `a1_cli` adapter; the fixture replaced Web Serial before application initialization, blocked native USB/HID/media access and served restrictive Permissions-Policy headers. No file-scheme page, physical device, firmware flashing or board audio was used.

## Flows exercised through the interface

- Connect, read state, disconnect and reconnect; connecting sent identification and state requests without control writes.
- Simple/pro diagrams, English/Chinese switching, all theme choices and settings-panel navigation.
- Edit gain, apply, switch to another channel while a response is delayed, read the application log, reject an out-of-range number and undo an edit.
- Start simulated PCM, switch channels, choose a ten-second window, use wheel scaling and restore Auto.
- Resize panels with the separator and restore their width; pan with keyboard arrows, fit with Home and close overlays with Escape. The existing right-button gesture tests also passed.
- Four-microphone, voice/VAD, duplex/reference, ten-second recording, playback preparation and Stop-all examples.
- Import valid and invalid JSON, explicitly apply an imported configuration and export it through the browser download flow.
- Select a mock SD file, start/stop playback, inspect playback PCM, follow recording progress and reject SD unmount during an active recording.
- Read-only register selection and recovery after a simulated VAD recording-preparation failure.
- A 760 × 900 viewport: starting PCM hides the settings panel so it cannot cover the waveform.

## Reproduced faults and fixes

| Fault | Reproduction and verification |
|---|---|
| Gain write moved to a newly selected channel | Submit ADC0 +6 dB, delay responses, then select ADC1. Before the fix the log showed `adc_gain 0 0x02`; after the fix it showed `adc_gain 6 0x01`. The submission now captures its channel and values before any wait. |
| Invalid number submitted an older value | Enter a value outside the control range. Apply is now disabled and the operation also checks validity before starting. |
| Clock block appeared enabled after I²S stopped | The professional diagram now uses the confirmed I²S state, including disconnected and stopped states. |
| Recording example crashed after navigation | Delay the file listing and select a gain block while the recording example is running. The example now uses its submitted duration instead of reading a removed input. The gain panel remains usable and the recording-start result is displayed without an exception. |
| Failed VAD preparation left a phantom armed task | Inject a preparation error, then unmount mock SD. The failed preparation is cleared while immediate recording events remain associated with the pending tag. |
| Narrow-window settings covered PCM | Starting monitoring at the narrow breakpoint now brings the waveform into view by closing the settings panel. |

In-flight status is retained during module navigation. Conflicting edits and example starts are disabled while a transaction is executing. Unchanged telemetry no longer replaces the SVG node tree.

## Regression evidence

The 74 Node web/protocol tests pass, including new submission-isolation and clock-state checks. Browser monkey checks use gremlins.js 2.2.0 with explicit stateful actions, recorded seeds, event traces and UI invariants. Clean 240-action runs used seeds 20261114, 20261115 and 20261116, across 1280 × 720 and 760 × 900 viewports. A fourth clean 240-action run rechecked the final SVG-retention change, bringing the total to 960 actions. During steady PCM polling the SVG replacement counter stayed unchanged, and the final stopped-state check showed the clock disabled. Initial application and fixture errors were retained in the local evidence and corrected before the clean runs.

The local audit folder retains the server, pinned test-tool dependencies, downloaded configuration, action reports and screenshots. The test fixture and tool dependencies are excluded from the production HTML. Existing firmware-module and board results remain in their original versioned records; this UI run does not repeat or extend those measurements.
