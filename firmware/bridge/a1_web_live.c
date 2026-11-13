// SPDX-FileCopyrightText: 2026 Harvey (HwzLoveDz)
// SPDX-License-Identifier: MIT
/* Local debug telemetry: no SD writes and no fabricated audio. */
#include <stdio.h>
#include <math.h>
#include <stdatomic.h>
#include "esp_heap_caps.h"
#include <assert.h>
#include "esp_err.h"
#include <stdlib.h>
#include <string.h>
#include <inttypes.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_console.h"
#include "esp_timer.h"
#include "a1_web_live.h"
#include "a1_web_files.h"
#include "a1_recording.h"

#define POINTS 128
#define HISTORY_FRAMES 24000
#define SUMMARY_BINS 10000
typedef struct { int16_t low, high; int32_t sum; uint64_t squares; } bin_stat_t;
typedef struct { int16_t pcm[5][POINTS]; int channels, rate, count; uint32_t seq; int64_t at; int16_t *history; int stride; size_t head, stored; uint32_t overflows; bin_stat_t *bins; uint16_t *bin_counts; bin_stat_t pending[5]; size_t bin_head, bin_stored, bin_frames; uint32_t phase; uint16_t pending_count; } preview_t;
static preview_t rx_preview, tx_preview;
static SemaphoreHandle_t rx_lock, cache_lock;
static atomic_bool active, reading;
static atomic_uint_fast32_t lease;
static uint8_t rx_buffer[512 * 5 * 3] __attribute__((aligned(64)));
static atomic_int rx_error;

static void reset_history(preview_t *p)
{
    p->head = 0; p->stored = 0; p->bin_head = 0; p->bin_stored = 0;
    p->bin_frames = 0; p->phase = 0; p->pending_count = 0;
}

static void feed(preview_t *dst, const void *buffer, size_t size, int bits, int channels, int rate)
{
    int bytes = bits / 8;
    if ((bits != 16 && bits != 24) || channels < 1 || channels > 5) return;
    size_t frames = size / (bytes * channels);
    if (!frames) return;
    int count = frames < POINTS ? frames : POINTS;
    const uint8_t *p = (const uint8_t *)buffer + (frames - count) * bytes * channels;
    xSemaphoreTake(cache_lock, portMAX_DELAY);
    for (int i = 0; i < count; i++) for (int ch = 0; ch < channels; ch++) {
        const uint8_t *s = p + (i * channels + ch) * bytes;
        /* Packed little-endian PCM, matching the SDK's WAV recording format. */
        dst->pcm[ch][i] = bits == 16 ? (int16_t)(s[0] | (s[1] << 8)) : (int16_t)(s[1] | (s[2] << 8));
    }
    bool gap = false;
    if (dst == &rx_preview) {
        uint32_t overflows = a1_cli_i2s_rx_overflow_count();
        if (dst->overflows != overflows) { reset_history(dst); dst->overflows = overflows; gap = true; }
    }
    if (dst->channels != channels || dst->rate != rate) { reset_history(dst); }
    if (dst->history && !gap) {
        const uint8_t *raw = buffer;
        for (size_t i = 0; i < frames; i++) {
            for (int ch = 0; ch < channels; ch++) {
                const uint8_t *v = raw + (i * channels + ch) * bytes;
                int n = bits == 16 ? (int16_t)(v[0] | (v[1] << 8)) : (int16_t)(v[1] | (v[2] << 8));
                dst->history[dst->head * dst->stride + ch] = n;
                if (dst->bins && dst->bin_counts) {
                    bin_stat_t *b = &dst->pending[ch];
                    if (!dst->pending_count) { b->low = n; b->high = n; b->sum = 0; b->squares = 0; }
                    if (n < b->low) b->low = n;
                    if (n > b->high) b->high = n;
                    b->sum += n; b->squares += (int64_t)n*n;
                }
            }
            if (dst->bins && dst->bin_counts) {
                dst->pending_count++; dst->phase += 1000;
                if (dst->phase >= (uint32_t)rate) {
                    dst->phase -= rate;
                    if (dst->bin_stored == SUMMARY_BINS) dst->bin_frames -= dst->bin_counts[dst->bin_head];
                    else dst->bin_stored++;
                    dst->bin_counts[dst->bin_head] = dst->pending_count;
                    dst->bin_frames += dst->pending_count;
                    memcpy(&dst->bins[dst->bin_head * dst->stride], dst->pending, channels * sizeof(bin_stat_t));
                    dst->bin_head = (dst->bin_head + 1) % SUMMARY_BINS;
                    dst->pending_count = 0;
                }
            }
            dst->head = (dst->head + 1) % HISTORY_FRAMES;
            if (dst->stored < HISTORY_FRAMES) dst->stored++;
        }
    }
    dst->channels = channels; dst->rate = rate; dst->count = count;
    dst->at = esp_timer_get_time(); dst->seq++;
    xSemaphoreGive(cache_lock);
}

int a1_web_adc_read(esp_codec_dev_handle_t dev, void *buf, int size)
{
    xSemaphoreTake(rx_lock, portMAX_DELAY);
    int result = esp_codec_dev_read(dev, buf, size);
    if (result == ESP_CODEC_DEV_OK) feed(&rx_preview, buf, size, a1_cli_bits(), a1_cli_adc_data_ch_count(), a1_cli_rate());
    xSemaphoreGive(rx_lock);
    return result;
}

void a1_web_dac_feed(const void *buf, size_t size, int bits, int channels, int rate)
{
    feed(&tx_preview, buf, size, bits, channels, rate);
}

static void capture_task(void *unused)
{
    (void)unused;
    for (;;) {
        if (active && (int32_t)(xTaskGetTickCount() - lease) > 0) a1_web_scope_stop();
        if (!active || !a1_cli_i2s_is_on() || !a1_cli_adc_is_on() || a1_cli_is_recording()) {
            vTaskDelay(pdMS_TO_TICKS(20)); continue;
        }
        reading = true;
        if (xSemaphoreTake(rx_lock, pdMS_TO_TICKS(100)) == pdTRUE) {
            /* Recording owns RX once prepared; its existing reader feeds the same cache. */
            if (active && !a1_cli_is_recording() && a1_cli_adc_is_on()) {
                int size = 512 * a1_cli_adc_data_ch_count() * (a1_cli_bits() / 8);
                rx_error = esp_codec_dev_read(a1_cli_get_adc_handle(), rx_buffer, size);
                if (rx_error == ESP_CODEC_DEV_OK) feed(&rx_preview, rx_buffer, size, a1_cli_bits(), a1_cli_adc_data_ch_count(), a1_cli_rate());
            }
            xSemaphoreGive(rx_lock);
        }
        reading = false;
        vTaskDelay(1);
    }
}

void a1_web_scope_stop(void)
{
    active = false;
    while (reading) vTaskDelay(1);
    if (cache_lock) { xSemaphoreTake(cache_lock, portMAX_DELAY); rx_preview.at = 0; rx_preview.count = 0; reset_history(&rx_preview); xSemaphoreGive(cache_lock); }
}

static const char *boolean(int n) { return n < 0 ? "null" : n ? "true" : "false"; }

static int status_command(int argc, char **argv)
{
    (void)argc; (void)argv;
    bool adc = a1_cli_adc_is_on(), dac = a1_cli_dac_is_on();
    bool am = false, dm = false; int volume = -1, speech = -1; unsigned triggers = 0;
    int ar = adc ? esp_codec_dev_get_in_mute(a1_cli_get_adc_handle(), &am) : -1;
    int dr = dac ? esp_codec_dev_get_out_mute(a1_cli_get_dac_handle(), &dm) : -1;
    if (dac && esp_codec_dev_get_out_vol(a1_cli_get_dac_handle(), &volume) != 0) volume = -1;
    a1_web_vad_snapshot(&speech, &triggers);
    audio_hw_dac_cfg_t cfg = {0}; a1_cli_get_dac_cfg_raw(&cfg);
    int gains[4]; const audio_codec_ctrl_if_t *ctrl = a1_cli_get_ctrl_if();
    for (int i = 0; i < 4; i++) { uint8_t v; gains[i] = ctrl && ctrl->read_reg(ctrl, 0x67+i, 2, &v, 1) == 0 ? v : -1; }
    flockfile(stdout);
    printf("@A1 {\"type\":\"state\",\"version\":\"0.4.2\",\"uptime_ms\":%" PRId64 ",\"i2s\":%s,\"adc\":%s,\"dac\":%s,\"adcMute\":%s,\"dacMute\":%s,\"rate\":%lu,\"bits\":%u,\"channels\":%u,\"volume\":",
        esp_timer_get_time()/1000, boolean(a1_cli_i2s_is_on()), boolean(adc), boolean(dac), boolean(ar == 0 ? am : -1), boolean(dr == 0 ? dm : -1), (unsigned long)a1_cli_rate(), a1_cli_bits(), a1_cli_adc_ch_count());
    if (volume < 0) printf("null"); else printf("%d", volume);
    printf(",\"reference\":%s,\"referenceChannel\":%d,\"vad\":%s,\"vadOutput\":%s,\"speech\":%s,\"triggers\":%u,\"sd\":%s,\"recording\":%s,\"playing\":%s,\"scope\":%s,\"rxOverflows\":%lu,\"gainRegisters\":[",
        boolean(cfg.ref_enable), cfg.ref_dac_ch, boolean(a1_cli_vad_is_on()), boolean(a1_web_vad_output()), boolean(speech), triggers, boolean(a1_web_sd_mounted()), boolean(a1_cli_is_capture_active()), boolean(a1_cli_is_playing()), boolean(active), (unsigned long)a1_cli_i2s_rx_overflow_count());
    for (int i = 0; i < 4; i++) { if (i) printf(","); if (gains[i] < 0) printf("null"); else printf("%d", gains[i]); }
    printf("],\"scope_max_ms\":%d}\n", rx_preview.bins && rx_preview.bin_counts ? 10000 : 500); funlockfile(stdout);
    return 0;
}

static int emit_window(preview_t *cache, int channel, bool enabled, int millis, bool adc)
{
    int16_t low[POINTS], high[POINTS], values[POINTS];
    int rate, points = 0; size_t required; uint64_t squares = 0; int peak = 0;
    xSemaphoreTake(cache_lock, portMAX_DELAY);
    if (!cache->history) { xSemaphoreGive(cache_lock); printf("Error: PCM history allocation unavailable\n"); return 1; }
    rate = cache->rate ? cache->rate : a1_cli_rate();
    required = (size_t)rate * millis / 1000;
    int64_t age = cache->at ? (esp_timer_get_time() - cache->at)/1000 : -1;
    bool summary = millis > 500;
    if (summary && (!cache->bins || !cache->bin_counts)) { xSemaphoreGive(cache_lock); printf("Error: long PCM history allocation unavailable\n"); return 1; }
    bool valid = enabled && age >= 0 && age < 500 && channel < cache->channels && (summary ? cache->bin_stored >= (size_t)millis : cache->stored >= required);
    uint32_t sequence = cache->seq;
    size_t available = summary ? cache->bin_frames : cache->stored;
    if (valid && summary) {
        points = POINTS;
        size_t begin = (cache->bin_head + SUMMARY_BINS - millis) % SUMMARY_BINS;
        required = 0;
        for (int b=0; b<points; b++) {
            size_t first = (size_t)b * millis / points, end = (size_t)(b+1) * millis / points;
            int minimum = 32767, maximum = -32768; int64_t sum = 0; size_t count = 0;
            for (size_t i=first; i<end; i++) {
                size_t index = (begin+i) % SUMMARY_BINS;
                const bin_stat_t *v = &cache->bins[index * cache->stride + channel];
                if (v->low < minimum) minimum = v->low;
                if (v->high > maximum) maximum = v->high;
                sum += v->sum; squares += v->squares; count += cache->bin_counts[index];
            }
            low[b] = minimum; high[b] = maximum; values[b] = sum / (int)count;
            int magnitude = -minimum > maximum ? -minimum : maximum;
            if (magnitude > peak) peak = magnitude;
            required += count;
        }
    } else if (valid) {
        points = required < POINTS ? required : POINTS;
        size_t begin = (cache->head + HISTORY_FRAMES - required) % HISTORY_FRAMES;
        for (int b = 0; b < points; b++) {
            size_t first = (size_t)b * required / points, end = (size_t)(b+1) * required / points;
            int minimum = 32767, maximum = -32768, sum = 0;
            for (size_t i = first; i < end; i++) {
                int n = cache->history[((begin+i) % HISTORY_FRAMES) * cache->stride + channel];
                if (n < minimum) minimum = n;
                if (n > maximum) maximum = n;
                sum += n; squares += (int64_t)n * n;
                int magnitude = n < 0 ? -n : n; if (magnitude > peak) peak = magnitude;
            }
            low[b] = minimum; high[b] = maximum; values[b] = sum / (int)(end-first);
        }
    }
    xSemaphoreGive(cache_lock);
    float rms = valid ? sqrtf((float)squares / required) / 32768.0f : 0;
    flockfile(stdout);
    printf("@A1 {\"type\":\"wave\",\"source\":\"%s\",\"channel\":%d,\"rate\":%d,\"seq\":%lu,\"age_ms\":%" PRId64 ",\"valid\":%s,\"readError\":%d,\"duration_ms\":%.3f,\"spanFrames\":%u,\"available_ms\":%.3f,\"rms\":%.7f,\"peak\":%.7f,\"samples\":[", adc ? "adc":"dac", channel, rate, (unsigned long)sequence, age, boolean(valid), adc ? rx_error:0, (float)required*1000/rate, (unsigned)required, (float)available*1000/rate, rms, peak/32768.0f);
    for (int i=0;i<points;i++) printf("%s%d",i?",":"",values[i]);
    printf("],\"min\":["); for (int i=0;i<points;i++) printf("%s%d",i?",":"",low[i]);
    printf("],\"max\":["); for (int i=0;i<points;i++) printf("%s%d",i?",":"",high[i]);
    printf("]}\n"); funlockfile(stdout); return 0;
}

static int scope_command(int argc, char **argv)
{
    if (argc == 2 && strcmp(argv[1], "stop") == 0) { a1_web_scope_stop(); printf("Scope stopped\n"); return 0; }
    if ((argc != 3 && argc != 4) || (strcmp(argv[1], "adc") && strcmp(argv[1], "dac")) || strlen(argv[2]) != 1 || argv[2][0] < '0' || argv[2][0] > '4') {
        printf("Usage: web_scope adc|dac channel0..4 OR web_scope stop\n"); return 1;
    }
    int window_ms = 0;
    if (argc == 4) { char *end; long value = strtol(argv[3], &end, 10); if (!argv[3][0] || *end || value < 5 || value > 10000) { printf("Error: time window must be 5..10000 ms\n"); return 1; } window_ms = value; }
    bool adc = strcmp(argv[1], "adc") == 0; int channel = argv[2][0] - '0';
    if ((!adc && channel > 1) || (adc && channel >= a1_cli_adc_data_ch_count())) { printf("Error: channel not configured\n"); return 1; }
    bool enabled = a1_cli_i2s_is_on() && (adc ? a1_cli_adc_is_on() : a1_cli_dac_is_on() && a1_cli_is_playing());
    if (adc) { active = enabled; lease = xTaskGetTickCount() + pdMS_TO_TICKS(2000); }
    else a1_web_scope_stop();
    preview_t *cache = adc ? &rx_preview : &tx_preview;
    if (window_ms) return emit_window(cache, channel, enabled, window_ms, adc);
    int16_t pcm[POINTS]; int count, rate; uint32_t seq; int64_t age;
    xSemaphoreTake(cache_lock, portMAX_DELAY);
    age = cache->at ? (esp_timer_get_time() - cache->at)/1000 : -1;
    bool valid = enabled && age >= 0 && age < 500 && channel < cache->channels;
    count = valid ? cache->count : 0; rate = cache->rate; seq = cache->seq;
    if (valid) memcpy(pcm, cache->pcm[channel], count * sizeof(int16_t));
    xSemaphoreGive(cache_lock);
    flockfile(stdout);
    printf("@A1 {\"type\":\"wave\",\"source\":\"%s\",\"channel\":%d,\"rate\":%d,\"seq\":%lu,\"age_ms\":%" PRId64 ",\"valid\":%s,\"readError\":%d,\"samples\":[", adc ? "adc" : "dac", channel, rate, (unsigned long)seq, age, boolean(valid), adc ? rx_error : 0);
    for (int i = 0; i < count; i++) printf("%s%d", i ? "," : "", pcm[i]);
    printf("]}\n"); funlockfile(stdout); return 0;
}

void a1_web_live_register(void)
{
    a1_web_files_register();
    a1_record_register();
    rx_lock = xSemaphoreCreateMutex(); cache_lock = xSemaphoreCreateMutex();
    assert(rx_lock && cache_lock);
    rx_preview.stride = 5; tx_preview.stride = 2;
    rx_preview.history = heap_caps_calloc(HISTORY_FRAMES * 5, sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    tx_preview.history = heap_caps_calloc(HISTORY_FRAMES * 2, sizeof(int16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    rx_preview.bins = heap_caps_calloc(SUMMARY_BINS * 5, sizeof(bin_stat_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    tx_preview.bins = heap_caps_calloc(SUMMARY_BINS * 2, sizeof(bin_stat_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    rx_preview.bin_counts = heap_caps_calloc(SUMMARY_BINS, sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    tx_preview.bin_counts = heap_caps_calloc(SUMMARY_BINS, sizeof(uint16_t), MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    assert(xTaskCreate(capture_task, "web_pcm", 4096, NULL, 4, NULL) == pdPASS);
    const esp_console_cmd_t status = {.command="web_status", .help="Read complete live device state without changing audio", .func=status_command};
    const esp_console_cmd_t scope = {.command="web_scope", .help="Read live PCM preview; ADC capture expires after 2 seconds without polling", .func=scope_command};
    const esp_console_cmd_t window = {.command="web_scope_window", .help="Read continuous PCM min/max envelope: adc|dac channel 5..10000 milliseconds", .func=scope_command};
    ESP_ERROR_CHECK(esp_console_cmd_register(&window));
    ESP_ERROR_CHECK(esp_console_cmd_register(&status)); ESP_ERROR_CHECK(esp_console_cmd_register(&scope));
}
