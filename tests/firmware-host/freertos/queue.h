#pragma once
#include "FreeRTOS.h"
typedef struct host_queue *QueueHandle_t;
QueueHandle_t xQueueCreate(unsigned count, unsigned item_bytes);
int xQueueReceive(QueueHandle_t q, void *out, unsigned timeout_ms);
int xQueueSend(QueueHandle_t q, const void *item, unsigned timeout_ms);
unsigned uxQueueMessagesWaiting(QueueHandle_t q);
void vQueueDelete(QueueHandle_t q);
