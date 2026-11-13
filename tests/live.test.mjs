import test from 'node:test';
import assert from 'node:assert/strict';
import {newActual,applySnapshot,telemetry,validateWave,assertResponse,mergeDeviceConfig,DEFAULTS,clone,zoomVertical} from '../core.mjs';
const state=()=>({type:'state',version:'0.2.0',uptime_ms:12345,i2s:true,adc:true,dac:false,adcMute:false,dacMute:null,rate:48000,bits:24,channels:4,volume:null,reference:false,referenceChannel:1,vad:true,vadOutput:true,speech:false,triggers:3,sd:false,recording:false,playing:false,scope:true,gainRegisters:[128,140,0,126]});
test('完整设备快照替换旧状态，关闭通路不再保留上次点亮结果',()=>{const a=newActual();applySnapshot(a,state());assert.equal(a.gains[1],6);assert.equal(a.vad,true);const next={...state(),i2s:false,adc:false,vad:false,vadOutput:false,speech:null,scope:false};applySnapshot(a,next);assert.equal(a.adc,false);assert.equal(a.vad,false);assert.equal(a.speech,null);assert.ok(a.syncAt>0);});
test('损坏状态整帧拒绝，不允许局部状态污染',()=>{const a=newActual(),before=JSON.stringify(a);assert.throws(()=>applySnapshot(a,{...state(),adc:'true'}),/字段无效/);assert.equal(JSON.stringify(a),before);assert.throws(()=>applySnapshot(a,{...state(),gainRegisters:[128,256,0,0]}));});
test('波形只接受有新鲜时间戳的有界 PCM，拒绝陈旧有效帧及伪造点',()=>{const w={type:'wave',source:'adc',channel:0,rate:48000,seq:5,age_ms:20,valid:true,samples:[-32768,0,32767]};assert.equal(validateWave(w),w);for(const bad of [{age_ms:600},{samples:[40000]},{samples:[]},{rate:999},{channel:8}])assert.throws(()=>validateWave({...w,...bad}));assert.equal(validateWave({...w,valid:false,samples:[],age_ms:-1}).valid,false);});
test('遥测包解析支持控制日志，但损坏和重复消息不冒充应答',()=>{const line='@A1 '+JSON.stringify(state());assert.equal(telemetry('I (1) note\n'+line+'\nesp32_a1 > ','state').type,'state');assert.throws(()=>telemetry(line+'\n'+line,'state'));assert.throws(()=>telemetry('@A1 {oops}\n','state'));});

test('只在 ADC 成功应答中容忍已确认的共享 ISR 重复安装提示',()=>{
 const known='E (7) gpio: gpio_install_isr_service(568): GPIO isr service already installed\n';
 assert.doesNotThrow(()=>assertResponse(known+'ADC on via esp_codec_dev\nesp32_a1 > '));
 assert.throws(()=>assertResponse(known+'esp32_a1 > '));
 assert.throws(()=>assertResponse(known+'E (8) A1: I2C failed\nADC on via esp_codec_dev\nesp32_a1 > '));
});

test('设备值自动同步，但不覆盖待写入草稿或静音前的增益设置',()=>{
 const c=clone(DEFAULTS),a=newActual();applySnapshot(a,state());c.volume=60;mergeDeviceConfig(c,a,new Set(['volume']));assert.equal(c.volume,60);assert.equal(c.gains[1],6);assert.equal(c.vad,true);a.adcMute=true;a.gains=[-64,-64,-64,-64];mergeDeviceConfig(c,a);assert.equal(c.gains[1],6);
});

test('长时间窗必须有一致的真实包络、采样跨度与能量',()=>{
 const w={type:'wave',source:'adc',channel:0,rate:48000,seq:1,age_ms:10,valid:true,samples:[0,5],min:[-20,0],max:[20,10],duration_ms:50,spanFrames:2400,rms:10/32768,peak:20/32768};assert.equal(validateWave(w).duration_ms,50);
 for(const bad of [{spanFrames:24000},{min:[1,0]},{max:[20]},{rms:.3},{duration_ms:1000}])assert.throws(()=>validateWave({...w,...bad}));
 const fractional={...w,rate:44100,duration_ms:4.989,spanFrames:220};assert.doesNotThrow(()=>validateWave(fractional));
});

test('纵轴滚轮缩放保持鼠标锚点，范围始终有效',()=>{
 const before={min:-.5,max:.5},anchor=.3,fixed=before.max-anchor*(before.max-before.min);
 const after=zoomVertical(before.min,before.max,-120,anchor);assert.ok(after.max-after.min<1);assert.ok(Math.abs(after.max-anchor*(after.max-after.min)-fixed)<1e-12);
 const out=zoomVertical(after.min,after.max,120,anchor);assert.ok(Math.abs(out.min-before.min)<1e-12);
 assert.throws(()=>zoomVertical(1,1,0));assert.throws(()=>zoomVertical(0,1,NaN));
 const tiny=zoomVertical(-1,1,-1e9);assert.ok(tiny.max-tiny.min>=1/32768);
});
test('设备上报的 10 秒能力与长时间窗数据有界',()=>{
 const a=newActual();applySnapshot(a,{...state(),scope_max_ms:10000});assert.equal(a.maxWindowMs,10000);assert.throws(()=>applySnapshot(a,{...state(),scope_max_ms:10001}));
 const w={type:'wave',source:'adc',channel:0,rate:48000,seq:1,age_ms:10,valid:true,samples:[0],min:[-20],max:[20],duration_ms:10000,spanFrames:480000,rms:10/32768,peak:20/32768};assert.equal(validateWave(w).duration_ms,10000);assert.throws(()=>validateWave({...w,duration_ms:10001}));
});
