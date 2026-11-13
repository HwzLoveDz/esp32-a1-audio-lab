// SPDX-FileCopyrightText: 2026 Harvey (HwzLoveDz)
// SPDX-License-Identifier: MIT
#pragma once
#include <stdbool.h>
#include <stdint.h>
#include "esp_codec_dev.h"
#include "audio_codec_ctrl_if.h"
#include "audio_codec_hw_cfg.h"

/* Bind these functions to the owning application's real Codec/CLI state.
 * The bridge never infers an enable state from the presence of a handle. */
void a1_cli_register_cmds(void);
uint32_t a1_cli_rate(void);
uint8_t a1_cli_bits(void);
uint8_t a1_cli_adc_ch_count(void);
uint8_t a1_cli_adc_data_ch_count(void);
bool a1_cli_adc_is_on(void);
bool a1_cli_dac_is_on(void);
bool a1_cli_i2s_is_on(void);
bool a1_cli_vad_is_on(void);
bool a1_cli_is_recording(void);
bool a1_cli_is_capture_active(void);
bool a1_cli_is_playing(void);
uint32_t a1_cli_i2s_rx_overflow_count(void);
esp_codec_dev_handle_t a1_cli_get_adc_handle(void);
esp_codec_dev_handle_t a1_cli_get_dac_handle(void);
const audio_codec_ctrl_if_t *a1_cli_get_ctrl_if(void);
void a1_cli_get_dac_cfg_raw(audio_hw_dac_cfg_t *cfg);
