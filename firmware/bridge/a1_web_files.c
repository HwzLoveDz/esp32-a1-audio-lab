/* SPDX-License-Identifier: MIT */
#include "a1_web_files.h"
#include "a1_web_live.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include "esp_console.h"
#include "esp_err.h"
#include "esp_heap_caps.h"
#include "esp_rom_crc.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static uint16_t u16(const uint8_t *p) { return p[0] | (uint16_t)p[1] << 8; }
static uint32_t u32(const uint8_t *p) { return p[0] | (uint32_t)p[1] << 8 | (uint32_t)p[2] << 16 | (uint32_t)p[3] << 24; }

static int file_info(int argc, char **argv)
{
    if (argc < 2 || argc > 3 || strncmp(argv[1], "/sdcard/", 8) ||
        strstr(argv[1], "..") || (argc == 3 && strcmp(argv[2], "1") && strcmp(argv[2], "0")))
        return ESP_ERR_INVALID_ARG;
    if (a1_cli_is_recording() || a1_cli_is_playing()) {
        printf("Error: stop recording and playback before inspecting files\n");
        return ESP_ERR_INVALID_STATE;
    }
    struct stat st;
    if (stat(argv[1], &st) || !S_ISREG(st.st_mode) || st.st_size < 44) return ESP_ERR_INVALID_SIZE;
    FILE *fp = fopen(argv[1], "rb");
    if (!fp) return ESP_FAIL;
    int result = ESP_ERR_INVALID_SIZE;
    uint8_t head[16];
    uint32_t rate = 0, data = 0; uint16_t channels = 0, bits = 0, align = 0;
    if (fread(head, 1, 12, fp) != 12 || memcmp(head, "RIFF", 4) ||
        memcmp(head + 8, "WAVE", 4) || (uint64_t)u32(head + 4) + 8 != st.st_size) goto close;
    while (ftell(fp) + 8 <= st.st_size && fread(head, 1, 8, fp) == 8) {
        uint32_t length = u32(head + 4); long body = ftell(fp);
        if (body < 0 || (uint64_t)body + length > st.st_size) goto close;
        if (!memcmp(head, "fmt ", 4)) {
            if (length < 16 || fread(head, 1, 16, fp) != 16 || u16(head) != 1) goto close;
            channels = u16(head + 2); rate = u32(head + 4);
            align = u16(head + 12); bits = u16(head + 14);
            if (!channels || !rate || (bits != 16 && bits != 24) ||
                align != channels * (bits / 8) || u32(head + 8) != rate * align) goto close;
        } else if (!memcmp(head, "data", 4)) {
            if (!align || data || length % align) goto close;
            data = length;
        }
        uint64_t next = (uint64_t)body + length + (length & 1);
        if (next > st.st_size || fseek(fp, (long)next, SEEK_SET)) goto close;
    }
    if (!data || ftell(fp) != st.st_size) goto close;
    bool verify = argc == 3 && !strcmp(argv[2], "1");
    uint32_t crc = 0, scanned = 0;
    if (verify) {
        uint8_t *buffer = heap_caps_malloc(16384, MALLOC_CAP_8BIT);
        if (!buffer) { result = ESP_ERR_NO_MEM; goto close; }
        rewind(fp);
        size_t n; unsigned blocks = 0;
        while ((n = fread(buffer, 1, 16384, fp)) > 0) {
            crc = esp_rom_crc32_le(crc, buffer, n); scanned += n;
            if (!(++blocks % 32)) vTaskDelay(1);
        }
        bool failed = ferror(fp) || scanned != st.st_size;
        heap_caps_free(buffer);
        if (failed) { result = ESP_FAIL; goto close; }
    }
    flockfile(stdout);
    printf("@A1 {\"type\":\"file\",\"rate\":%lu,\"bits\":%u,\"channels\":%u,"
           "\"bytes\":%lu,\"dataBytes\":%lu,\"frames\":%lu,\"verified\":%s,"
           "\"crc32\":\"%08lx\",\"scannedBytes\":%lu}\n",
           (unsigned long)rate, bits, channels, (unsigned long)st.st_size,
           (unsigned long)data, (unsigned long)(data / align), verify ? "true" : "false",
           (unsigned long)crc, (unsigned long)scanned);
    funlockfile(stdout); result = ESP_OK;
close:
    fclose(fp); return result;
}

void a1_web_files_register(void)
{
    const esp_console_cmd_t command = {.command = "web_file_info",
        .help = "Inspect PCM WAV metadata: /sdcard/path.wav [1 = full read + CRC32]", .func = file_info};
    ESP_ERROR_CHECK(esp_console_cmd_register(&command));
}
