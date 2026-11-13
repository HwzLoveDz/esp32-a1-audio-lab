/* Host-side concurrency tests for the production recording module.
 * POSIX threads emulate queues/tasks; no target timing or DMA is simulated. */
#define _POSIX_C_SOURCE 200809L
#include <assert.h>
#include <errno.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include "a1_recording.h"
#include "esp_console.h"
#include "esp_err.h"
#include "freertos/queue.h"
#include "freertos/task.h"

static atomic_int allocations, queues, tasks;
static bool fail_alloc;
static unsigned write_calls, read_calls, pause_ms, fail_write_at, fail_read_at;
static uint64_t captured;
static int (*status_fn)(int, char **);
static void delay_ms(unsigned ms)
{
    struct timespec t = {.tv_sec = ms / 1000, .tv_nsec = (ms % 1000) * 1000000L};
    while (nanosleep(&t, &t) && errno == EINTR) {}
}
int64_t esp_timer_get_time(void)
{
    struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
    return (int64_t)t.tv_sec * 1000000 + t.tv_nsec / 1000;
}
void *heap_caps_aligned_alloc(size_t alignment, size_t bytes, unsigned caps)
{
    (void)caps; void *p = NULL;
    if (!fail_alloc && !posix_memalign(&p, alignment, bytes)) atomic_fetch_add(&allocations, 1);
    return p;
}
void heap_caps_free(void *p) { if (p) { free(p); atomic_fetch_sub(&allocations, 1); } }
int esp_console_cmd_register(const esp_console_cmd_t *cmd) { status_fn = cmd->func; return 0; }

struct host_queue {
    unsigned count, size, head, tail, used;
    unsigned char *data;
    pthread_mutex_t lock;
    pthread_cond_t changed;
};
QueueHandle_t xQueueCreate(unsigned count, unsigned size)
{
    QueueHandle_t q = calloc(1, sizeof(*q)); assert(q);
    q->data = calloc(count, size); assert(q->data); q->count = count; q->size = size;
    pthread_mutex_init(&q->lock, NULL); pthread_cond_init(&q->changed, NULL);
    atomic_fetch_add(&queues, 1); return q;
}
static struct timespec deadline(unsigned ms)
{
    struct timespec t; clock_gettime(CLOCK_REALTIME, &t);
    t.tv_nsec += (ms % 1000) * 1000000L; t.tv_sec += ms / 1000 + t.tv_nsec / 1000000000L;
    t.tv_nsec %= 1000000000L; return t;
}
int xQueueReceive(QueueHandle_t q, void *out, unsigned ms)
{
    struct timespec end = deadline(ms); pthread_mutex_lock(&q->lock);
    while (!q->used) {
        if (!ms || pthread_cond_timedwait(&q->changed, &q->lock, &end) == ETIMEDOUT) {
            pthread_mutex_unlock(&q->lock); return 0;
        }
    }
    memcpy(out, q->data + q->head * q->size, q->size);
    q->head = (q->head + 1) % q->count; q->used--;
    pthread_cond_broadcast(&q->changed); pthread_mutex_unlock(&q->lock); return 1;
}
int xQueueSend(QueueHandle_t q, const void *in, unsigned ms)
{
    struct timespec end = deadline(ms); pthread_mutex_lock(&q->lock);
    while (q->used == q->count) {
        if (!ms || pthread_cond_timedwait(&q->changed, &q->lock, &end) == ETIMEDOUT) {
            pthread_mutex_unlock(&q->lock); return 0;
        }
    }
    memcpy(q->data + q->tail * q->size, in, q->size);
    q->tail = (q->tail + 1) % q->count; q->used++;
    pthread_cond_broadcast(&q->changed); pthread_mutex_unlock(&q->lock); return 1;
}
unsigned uxQueueMessagesWaiting(QueueHandle_t q)
{
    pthread_mutex_lock(&q->lock); unsigned used = q->used; pthread_mutex_unlock(&q->lock); return used;
}
void vQueueDelete(QueueHandle_t q)
{
    pthread_mutex_destroy(&q->lock); pthread_cond_destroy(&q->changed);
    free(q->data); free(q); atomic_fetch_sub(&queues, 1);
}
typedef struct { void (*fn)(void *); void *arg; } start_t;
static void *task_start(void *arg)
{
    start_t start = *(start_t *)arg; free(arg); start.fn(start.arg); abort();
}
int xTaskCreate(void (*fn)(void *), const char *name, unsigned stack, void *arg, unsigned priority, void *handle)
{
    (void)name; (void)stack; (void)priority; (void)handle;
    start_t *s = malloc(sizeof(*s)); assert(s); *s = (start_t){fn, arg};
    pthread_t thread; atomic_fetch_add(&tasks, 1);
    assert(!pthread_create(&thread, NULL, task_start, s)); pthread_detach(thread); return pdPASS;
}
void vTaskDelete(void *handle) { (void)handle; atomic_fetch_sub(&tasks, 1); pthread_exit(NULL); }

int a1_web_adc_read(esp_codec_dev_handle_t dev, void *buf, int size)
{
    assert(dev); read_calls++;
    if (fail_read_at && read_calls == fail_read_at) return ESP_FAIL;
    delay_ms((unsigned)((uint64_t)size * 1000 / 720000));
    for (int i = 0; i < size; i++) ((uint8_t *)buf)[i] = (captured + i) % 251;
    captured += size; return 0;
}
size_t a1_test_fwrite(const void *buf, size_t size, size_t count, FILE *fp)
{
    write_calls++;
    if (write_calls == 1 && pause_ms) delay_ms(pause_ms);
    if (fail_write_at && write_calls == fail_write_at) return 0;
    return fwrite(buf, size, count, fp);
}
static void reset(void)
{
    for (int i = 0; i < 100 && atomic_load(&tasks); i++) delay_ms(1);
    assert(!atomic_load(&tasks)); assert(!atomic_load(&allocations)); assert(!atomic_load(&queues));
    read_calls = write_calls = pause_ms = fail_write_at = fail_read_at = 0; captured = 0; fail_alloc = false;
}
static void verify(FILE *fp, uint32_t bytes)
{
    fflush(fp); assert(ftell(fp) == bytes); rewind(fp);
    for (uint32_t i = 0; i < bytes; i++) assert(fgetc(fp) == (int)(i % 251));
    assert(fgetc(fp) == EOF);
}
static void *cancel(void *arg) { delay_ms(200); atomic_store((atomic_bool *)arg, false); return NULL; }
int main(void)
{
    atomic_bool run; a1_record_stats_t stats; FILE *fp;
    a1_record_register(); assert(status_fn);
    reset(); pause_ms = 250; atomic_init(&run, true); fp = tmpfile(); assert(fp);
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 3, &run, &stats) == ESP_OK);
    assert(stats.bytes == 2160000 && stats.peak_buffer_bytes > 100000 && stats.max_write_us >= 250000);
    verify(fp, stats.bytes); fclose(fp); puts("PASS 250ms stalled writer preserves exact frame count and byte order");

    reset(); pause_ms = 4000; atomic_store(&run, true); fp = tmpfile();
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 10, &run, &stats) == ESP_ERR_NO_MEM);
    assert(stats.bytes < 7200000 && stats.bytes <= stats.buffer_bytes + 15360);
    verify(fp, stats.bytes); fclose(fp); puts("PASS exhausted buffer reports failure and drains valid data without hanging");

    reset(); fail_write_at = 3; atomic_store(&run, true); fp = tmpfile();
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 1, &run, &stats) == ESP_FAIL);
    assert(stats.bytes == 30720); verify(fp, stats.bytes); fclose(fp); puts("PASS write failure cancels producer and retains only written bytes");

    reset(); fail_read_at = 3; atomic_store(&run, true); fp = tmpfile();
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 1, &run, &stats) == ESP_FAIL);
    assert(stats.bytes == 30720); verify(fp, stats.bytes); fclose(fp); puts("PASS read failure drains queued data and reports the error");

    reset(); atomic_store(&run, true); fp = tmpfile(); pthread_t t;
    assert(!pthread_create(&t, NULL, cancel, &run));
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 5, &run, &stats) == ESP_OK);
    pthread_join(t, NULL); assert(stats.bytes > 0 && stats.bytes < 720000); verify(fp, stats.bytes); fclose(fp);
    puts("PASS manual cancellation drains and joins before buffers are reclaimed");

    reset(); fail_alloc = true; atomic_store(&run, true); fp = tmpfile();
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, 1, &run, &stats) == ESP_ERR_NO_MEM);
    assert(!stats.bytes); fclose(fp); reset();
    puts("PASS allocation failure leaves no tasks, queues or heap allocations");

    atomic_store(&run, true); fp = tmpfile();
    assert(a1_record_to_file((void *)1, fp, 15360, 48000, 15, INT32_MAX, &run, &stats) == ESP_ERR_INVALID_SIZE);
    fclose(fp); reset(); puts("PASS oversized RIFF/VFS targets are rejected before capture");
    return 0;
}
