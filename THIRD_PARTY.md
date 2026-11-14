# Source and dependency notes

The browser application uses native Web Serial, Canvas, SVG and browser storage APIs. The standalone build uses Node.js built-ins; development quality checks use the locked packages listed below. No JavaScript packages, remote fonts, CDN assets or analytics services are bundled.

`docs/assets/routing.svg` is generated from this project's `graph.mjs`. It is an interface diagram, not a vendor schematic.

`firmware/bridge/` contains the telemetry, PCM history, buffered recording, WAV inspection and native USB console extensions written for this project. They call external ESP-IDF and Codec/CLI interfaces. MIT applies to these files, not to their dependencies.

Integration was developed against an ESP32-A1 SDK 0.5.x environment and an ESP32-S31-capable ESP-IDF 6.2 development toolchain. Obtain a compatible SDK through a source you are entitled to use. This repository does not redistribute the vendor SDK, Codec driver, `esp_codec_dev`, board schematics, register manuals, vendor illustrations or compiled firmware containing those dependencies.

API and CLI names are described for interoperability. Preserve upstream copyright notices and license terms when integrating the extensions into a separately obtained SDK. This repository grants no license for external material.

## Development-only quality tools

The test environment installs fast-check 4.10.2 (MIT), axe-core 4.14.0 (MPL-2.0) and gremlins.js 2.2.0 (MIT) from the locked npm development dependencies. Their package licenses remain with those packages. These tools are served only by the isolated test fixture and are not embedded in the standalone application.
