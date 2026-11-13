/* SPDX-License-Identifier: MIT */
#pragma once
#include <stdio.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdatomic.h>
#include "esp_codec_dev.h"

typedef struct {
    uint32_t bytes;
    uint32_t max_write_us;
    uint32_t buffer_bytes;
    uint32_t peak_buffer_bytes;
} a1_record_stats_t;

/* One RX producer, one file writer. Returns only after both have stopped.
 * The caller owns FILE and the WAV header. A positive duration is sample-count
 * based; zero records until run becomes false, subject to the WAV size bound. */
int a1_record_to_file(esp_codec_dev_handle_t dev, FILE *fp, size_t block_bytes,
                      int rate, int frame_bytes, int seconds,
                      atomic_bool *run, a1_record_stats_t *stats);

void a1_record_register(void);
