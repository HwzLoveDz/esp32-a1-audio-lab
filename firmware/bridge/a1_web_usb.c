// SPDX-FileCopyrightText: 2026 Harvey (HwzLoveDz)
// SPDX-License-Identifier: MIT
/* Native USB transport for the local A1 web debugger. */
#include <stdio.h>
#include <stdlib.h>
#include "hal/usb_serial_jtag_ll.h"
#include <stdint.h>
#include <stdbool.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/reent.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "driver/usb_serial_jtag.h"
#include "esp_console.h"
#include "esp_app_desc.h"
#include "esp_err.h"
#include "esp_vfs.h"
#include "a1_web_port.h"

static FILE *usb_output;
static char usb_stdio_buffer[256];
static int usb_open(const char *path, int flags, int mode) { (void)path; (void)flags; (void)mode; return 0; }
static int usb_close(int fd) { (void)fd; return 0; }
static int usb_fstat(int fd, struct stat *st) { (void)fd; st->st_mode = S_IFCHR; return 0; }
static ssize_t usb_write(int fd, const void *data, size_t size)
{
    (void)fd;
    int n = usb_serial_jtag_write_bytes(data, size, pdMS_TO_TICKS(500));
    if (n < 0) errno = EIO;
    return n;
}

void a1_web_usb_init(void)
{
    usb_serial_jtag_driver_config_t cfg = { .tx_buffer_size = 8192, .rx_buffer_size = 1024, .intr_priority = 0 };
    ESP_ERROR_CHECK(usb_serial_jtag_driver_install(&cfg));
    const esp_vfs_t vfs = { .flags = ESP_VFS_FLAG_DEFAULT, .open = usb_open, .close = usb_close, .write = usb_write, .fstat = usb_fstat };
    ESP_ERROR_CHECK(esp_vfs_register("/dev/a1usb", &vfs, NULL));
    usb_output = fopen("/dev/a1usb", "w");
    if (!usb_output) abort();
    setvbuf(usb_output, usb_stdio_buffer, _IOLBF, sizeof(usb_stdio_buffer));
    /* New tasks inherit the global streams. Async VAD / recording messages
     * and synchronous command responses therefore use the same USB output. */
    _GLOBAL_REENT->_stdout = usb_output;
    _GLOBAL_REENT->_stderr = usb_output;
    stdout = usb_output;
    stderr = usb_output;
    printf("\r\nA1_WEB_DEBUG %s native USB ready\r\n", esp_app_get_description()->version);
}

void a1_web_usb_run(void)
{
    esp_console_config_t cfg = ESP_CONSOLE_CONFIG_DEFAULT();
    cfg.max_cmdline_length = 256;
    cfg.max_cmdline_args = 16;
    ESP_ERROR_CHECK(esp_console_init(&cfg));
    ESP_ERROR_CHECK(esp_console_register_help_command());
    a1_cli_register_cmds();
    char line[256];
    size_t length = 0;
    bool overflow = false, last_cr = false;
    printf("esp32_a1 > ");
    fflush(stdout);
    for (;;) {
        uint8_t ch;
        if (usb_serial_jtag_read_bytes(&ch, 1, pdMS_TO_TICKS(50)) != 1) continue;
        if (ch == '\n' && last_cr) { last_cr = false; continue; }
        last_cr = ch == '\r';
        if (ch == '\r' || ch == '\n') {
            printf("\r\n");
            line[length] = 0;
            if (overflow) printf("Error: command line exceeds 255 bytes\r\n");
            else if (length) {
                int result = 0;
                esp_err_t err = esp_console_run(line, &result);
                if (err == ESP_ERR_NOT_FOUND) printf("Error: command not found\r\n");
                else if (err != ESP_OK) printf("Error: command dispatch failed: %s\r\n", esp_err_to_name(err));
                else if (result != 0) printf("Command returned non-zero error code: 0x%x\r\n", result);
            }
            length = 0; overflow = false;
            fflush(stdout);
            printf("esp32_a1 > ");
    fflush(stdout);
        } else if (ch == 8 || ch == 127) {
            if (!overflow && length) length--;
        } else if (ch >= 0x20) {
            if (length < sizeof(line) - 1 && !overflow) line[length++] = ch;
            else overflow = true;
        }
    }
}
