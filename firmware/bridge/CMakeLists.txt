idf_component_register(
    SRCS "a1_web_live.c" "a1_web_usb.c" "a1_recording.c" "a1_web_files.c"
    INCLUDE_DIRS "."
    REQUIRES console esp_timer esp_driver_usb_serial_jtag vfs esp_rom esp_app_format esp_codec_dev
)
