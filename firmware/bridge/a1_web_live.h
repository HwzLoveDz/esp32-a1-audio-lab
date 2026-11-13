// SPDX-FileCopyrightText: 2026 Harvey (HwzLoveDz)
// SPDX-License-Identifier: MIT
#pragma once
#include "a1_web_port.h"
#include <stddef.h>
void a1_web_live_register(void);
void a1_web_scope_stop(void);
int a1_web_adc_read(esp_codec_dev_handle_t dev, void *buf, int size);
void a1_web_dac_feed(const void *buf, size_t size, int bits, int channels, int rate);
bool a1_web_sd_mounted(void);
bool a1_web_vad_output(void);
void a1_web_vad_snapshot(int *speech, unsigned *triggers);
