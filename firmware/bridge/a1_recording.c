/* SPDX-License-Identifier: MIT */
#include "a1_recording.h"
#include "a1_web_live.h"
#include <limits.h>
#include <string.h>
#include "esp_err.h"
#include "esp_console.h"
#include "esp_heap_caps.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/queue.h"
#include "freertos/task.h"

#define BUFFER_BUDGET (2 * 1024 * 1024)
#define MAX_BLOCKS 128
static atomic_bool recording_active;
static atomic_uint_fast32_t record_captured, record_written, record_target;
static atomic_uint_fast32_t record_capacity, record_peak, record_rate, record_frame_bytes;
static atomic_uint_fast32_t record_start_ms, record_elapsed_ms;
static atomic_int record_error;

static int record_status(int argc, char **argv)
{
    (void)argc; (void)argv;
    bool active = atomic_load(&recording_active);
    uint32_t written = atomic_load(&record_written), captured = atomic_load(&record_captured);
    uint32_t elapsed = active ? (uint32_t)(esp_timer_get_time() / 1000) - atomic_load(&record_start_ms)
                              : atomic_load(&record_elapsed_ms);
    flockfile(stdout);
    printf("@A1 {\"type\":\"record\",\"active\":%s,\"capturedBytes\":%lu,\"writtenBytes\":%lu,"
           "\"targetBytes\":%lu,\"bufferBytes\":%lu,\"peakBufferBytes\":%lu,\"rate\":%lu,"
           "\"frameBytes\":%lu,\"elapsedMs\":%lu,\"error\":%d}\n",
           active ? "true" : "false", (unsigned long)captured, (unsigned long)written,
           (unsigned long)atomic_load(&record_target), (unsigned long)atomic_load(&record_capacity),
           (unsigned long)atomic_load(&record_peak), (unsigned long)atomic_load(&record_rate),
           (unsigned long)atomic_load(&record_frame_bytes), (unsigned long)elapsed, atomic_load(&record_error));
    funlockfile(stdout); return 0;
}

void a1_record_register(void)
{
    const esp_console_cmd_t command = {.command = "web_record_status",
        .help = "Read buffered recording progress and write status", .func = record_status};
    ESP_ERROR_CHECK(esp_console_cmd_register(&command));
}
typedef struct { unsigned index; size_t bytes; } packet_t;
typedef struct {
    esp_codec_dev_handle_t dev;
    QueueHandle_t free_blocks, ready;
    uint8_t *memory;
    size_t block_bytes, stride;
    uint64_t limit;
    atomic_bool *run;
    atomic_bool stop, done;
    atomic_int error;
    unsigned peak_blocks;
} capture_t;

static void capture(void *arg)
{
    capture_t *c = arg;
    uint64_t captured = 0;
    while (atomic_load(c->run) && !atomic_load(&c->stop) && captured < c->limit) {
        unsigned index;
        if (xQueueReceive(c->free_blocks, &index, pdMS_TO_TICKS(100)) != pdTRUE) {
            atomic_store(&c->error, ESP_ERR_NO_MEM);
            break;
        }
        size_t size = c->limit - captured < c->block_bytes
                        ? (size_t)(c->limit - captured) : c->block_bytes;
        int ret = a1_web_adc_read(c->dev, c->memory + index * c->stride, (int)size);
        if (ret != ESP_CODEC_DEV_OK) {
            atomic_store(&c->error, ret);
            break;
        }
        atomic_store(&record_captured, (uint32_t)(captured + size));
        packet_t p = {.index = index, .bytes = size};
        if (xQueueSend(c->ready, &p, 0) != pdTRUE) {
            atomic_store(&c->error, ESP_ERR_INVALID_STATE);
            break;
        }
        unsigned queued = uxQueueMessagesWaiting(c->ready) + 1;
        if (queued > c->peak_blocks) c->peak_blocks = queued;
        uint32_t peak = c->peak_blocks * c->block_bytes;
        uint32_t capacity = atomic_load(&record_capacity);
        atomic_store(&record_peak, peak > capacity ? capacity : peak);
        captured += size;
    }
    atomic_store(&c->done, true);
    /* No further access to c: the writer may now reclaim queues and memory. */
    vTaskDelete(NULL);
}

int a1_record_to_file(esp_codec_dev_handle_t dev, FILE *fp, size_t block_bytes,
                      int rate, int frame_bytes, int seconds,
                      atomic_bool *run, a1_record_stats_t *stats)
{
    if (!dev || !fp || !run || !stats || rate <= 0 || frame_bytes <= 0 ||
        seconds < 0 || block_bytes < (size_t)frame_bytes ||
        block_bytes % frame_bytes || block_bytes > INT_MAX) return ESP_ERR_INVALID_ARG;
    memset(stats, 0, sizeof(*stats));
    /* Keep RIFF lengths and signed 32-bit VFS seek/stat offsets representable. */
    uint64_t max_bytes = (INT32_MAX - 44) / frame_bytes * (uint64_t)frame_bytes;
    uint64_t wanted = seconds ? (uint64_t)seconds * rate * frame_bytes : max_bytes;
    if (wanted > max_bytes) return ESP_ERR_INVALID_SIZE;
    atomic_store(&record_captured, 0); atomic_store(&record_written, 0);
    atomic_store(&record_target, seconds ? (uint32_t)wanted : 0);
    atomic_store(&record_rate, rate); atomic_store(&record_frame_bytes, frame_bytes);
    atomic_store(&record_capacity, 0); atomic_store(&record_peak, 0); atomic_store(&record_error, 0);
    atomic_store(&record_start_ms, esp_timer_get_time() / 1000); atomic_store(&record_elapsed_ms, 0);
    capture_t c = {.dev = dev, .block_bytes = block_bytes,
                   .stride = (block_bytes + 63) & ~(size_t)63,
                   .limit = wanted, .run = run};
    atomic_init(&c.stop, false); atomic_init(&c.done, false); atomic_init(&c.error, 0);
    unsigned blocks = BUFFER_BUDGET / c.stride;
    if (blocks > MAX_BLOCKS) blocks = MAX_BLOCKS;
    if (blocks < 8) return ESP_ERR_INVALID_SIZE;
    c.memory = heap_caps_aligned_alloc(64, blocks * c.stride,
                                       MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT);
    c.free_blocks = xQueueCreate(blocks, sizeof(unsigned));
    c.ready = xQueueCreate(blocks, sizeof(packet_t));
    int result = ESP_OK;
    if (!c.memory || !c.free_blocks || !c.ready) { result = ESP_ERR_NO_MEM; goto cleanup; }
    stats->buffer_bytes = blocks * block_bytes;
    atomic_store(&record_capacity, stats->buffer_bytes); atomic_store(&recording_active, true);
    for (unsigned i = 0; i < blocks; i++) xQueueSend(c.free_blocks, &i, 0);
    if (xTaskCreate(capture, "a1_rec_rx", 4096, &c, 12, NULL) != pdPASS) {
        result = ESP_ERR_NO_MEM; goto cleanup;
    }
    for (;;) {
        packet_t p;
        if (xQueueReceive(c.ready, &p, pdMS_TO_TICKS(50)) == pdTRUE) {
            if (result == ESP_OK) {
                int64_t start = esp_timer_get_time();
                size_t n = fwrite(c.memory + p.index * c.stride, 1, p.bytes, fp);
                uint32_t elapsed = (uint32_t)(esp_timer_get_time() - start);
                if (elapsed > stats->max_write_us) stats->max_write_us = elapsed;
                stats->bytes += (uint32_t)n;
                atomic_store(&record_written, stats->bytes);
                if (n != p.bytes) { result = ESP_FAIL; atomic_store(&c.stop, true); }
            }
            xQueueSend(c.free_blocks, &p.index, 0);
        } else if (atomic_load(&c.done)) {
            /* done follows the final enqueue; recheck once after acquiring it. */
            if (uxQueueMessagesWaiting(c.ready) == 0) break;
        }
    }
    if (result == ESP_OK) result = atomic_load(&c.error);
    stats->peak_buffer_bytes = (c.peak_blocks > blocks ? blocks : c.peak_blocks) * block_bytes;
    if (!seconds && stats->bytes == max_bytes && result == ESP_OK) result = ESP_ERR_INVALID_SIZE;
cleanup:
    atomic_store(&record_elapsed_ms, (uint32_t)(esp_timer_get_time() / 1000) - atomic_load(&record_start_ms));
    atomic_store(&record_error, result); atomic_store(&recording_active, false);
    if (c.free_blocks) vQueueDelete(c.free_blocks);
    if (c.ready) vQueueDelete(c.ready);
    heap_caps_free(c.memory);
    return result;
}
