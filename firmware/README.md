# Firmware integration / 固件集成

The public repository contains the project-authored bridge sources, not a complete firmware image or vendor SDK. The bridge was integrated and tested with an ESP32-A1 Codec + ESP32-S31 EV Board, an A1 SDK 0.5.x environment, and an S31-capable ESP-IDF 6.2 development toolchain. The repository CI tests the web application; it does not build the external SDK.

本目录只包含自行编写的扩展，不能脱离兼容的 ESP-IDF、Codec 驱动和 CLI 工程单独编译。请先获得有权使用的 SDK；不要把这里的集成步骤当作通用开发板刷写教程。

## Sources and application bindings

- `bridge/a1_web_live.c`: real PCM capture, bounded history, envelope statistics and telemetry commands.
- `bridge/a1_web_live.h`: hooks for the owning application's capture/playback lifecycle.
- `bridge/a1_web_port.h`: the application state/handle contract; implement these bindings with real CLI state.
- `bridge/a1_web_usb.c`: optional native USB Serial/JTAG console with CR/CRLF handling and a stable `esp32_a1 > ` prompt.

Add the C files to the application's component sources and the bridge directory to its include path. Required APIs come from the Codec SDK plus ESP-IDF console, timer, FreeRTOS, heap, VFS and USB Serial/JTAG components. The native USB console also uses `esp_app_desc.h`. Keep external license notices in their original files.

Call `a1_web_live_register()` once, after the CLI state has been initialized and before commands can start recording. If using the USB console, call `a1_web_usb_init()` during startup and run `a1_web_usb_run()` after creating the board buses. The USB console calls the port's `a1_cli_register_cmds()`; that function must register the vendor commands and invoke `a1_web_live_register()` exactly once. Do not also run a second console on the same USB interface.

## Capture and playback hooks

Replace the recording task's input read with:

```c
int result = a1_web_adc_read(adc_device, buffer, byte_count);
```

This serializes RX access and feeds the waveform cache only after a successful read. When a recording task is prepared or active, the monitor reuses its data; it must not create a second independent reader on the same I²S stream.

After a successful DAC write, feed exactly the PCM bytes actually submitted:

```c
if (write_result == ESP_CODEC_DEV_OK) {
    a1_web_dac_feed(buffer, bytes_written, bits, payload_channels, rate);
}
```

Use the actual post-conversion payload channel count, not the full TDM slot count. The bridge expects packed little-endian 16- or 24-bit PCM. It reduces 24-bit data to signed 16-bit preview values.

Before ADC close, I²S teardown or Codec reset, call `a1_web_scope_stop()` and wait for it to return. Reset commands must reject operation while live audio handles remain: resetting behind cached handles desynchronizes software and hardware. Do not clear/free caches while a reader is using them.

Provide these snapshot hooks from the application's owning modules:

```c
bool a1_web_sd_mounted(void);
bool a1_web_vad_output(void);
void a1_web_vad_snapshot(int *speech, unsigned *triggers);
```

Use `*speech = -1` for unavailable detection state; return real trigger counts. Recording-prepared and actively-recording states are distinct in `a1_web_port.h` and must not be conflated.

## Board-specific fixes used for v0.4.1

The tested board uses SDA 46, SCL 45, BCLK 37, WS 1, MCU DOUT 35, DIN 6, INT 7, active-low A1 reset 2 and oscillator enable 38. This is a tested-board mapping, not a default for every A1 board. A1 uses its external clock with `no_mclk = true` in this integration.

1. Configure the real reset pin in the Codec configuration when creating the first shared Codec owner:

```c
.reset_cfg = {
    .reset_pin = board_a1_reset_pin,
    .reset_active_low = true,
},
```

Reuse the same Codec interface for ADC and DAC; never pulse reset while the peer stream is running. This resolved the retained-clock BG DTUNE initialization error (`0x108`) after MCU resets.

2. Keep TX/RX physical TDM frame widths equal, including when RE is disabled and DAC opens first. The DAC sample format's `channel` uses the complete ADC frame width; its `channel_mask` still covers only the one/two playback payload channels. Use the matching MCLK multiple for the physical frame. This resolved the four-input/stereo-output `0x106` startup failure.

3. Install the shared GPIO ISR service once. Remove/re-add the board handler as needed without repeatedly reinstalling the service.

4. Ordinary MIC capture uses VAD detection with filtered output disabled. Dedicated VAD filtered output replaces the stream; do not combine it with ordinary independent-channel capture. The UI enforces this separation.

## Memory and runtime behavior

The bridge keeps up to 500 ms of raw samples at 48 kHz and per-millisecond statistics for up to 10 seconds. Five RX slots and two TX slots require roughly 1.5 MiB of external RAM. If long-history allocation fails, `scope_max_ms` advertises the shorter 500 ms limit. Required task/mutex allocation failures are fatal; budget memory before integrating.

Monitoring expires approximately two seconds after polling stops. Expiry, format changes and RX overflows invalidate history. It must refill with contiguous new samples before a window becomes valid. The waveform bridge itself writes no SD files. Recording/playback commands remain the owning application's responsibility.

Use the [protocol document](../docs/protocol.md) and `core.mjs` validators when implementing another backend. No board is flashed by this repository's build or CI scripts.
