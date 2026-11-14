import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,REQUIRED,clone,validateConfig,newActual,planFor,parseState,routeState,readRegisters,registerWritePlan,maskedWrite,validateStep,identifyCLI,hasPrompt,assertResponse} from '../core.mjs';
import {A1Serial} from '../serial.mjs';
import {renderGraph} from '../graph.mjs';

test('配置导入保留边界，不接受越界增益或错误类型',()=>{
 assert.deepEqual(validateConfig(DEFAULTS),DEFAULTS);
 for(const bad of [{channels:5},{rate:96000},{bits:32},{gains:[0,0,0,64]},{volume:101},{vad:'true'},{referenceChannel:3}])assert.throws(()=>validateConfig({...DEFAULTS,...bad}));
 assert.equal(Object.hasOwn(validateConfig({...DEFAULTS,unexpected:5}),'unexpected'),false);
});
test('默认设备状态全部未知；断连后不继承草稿',()=>{
 const a=newActual(),c=clone(DEFAULTS);assert.equal(a.adc,null);assert.equal(routeState(c,a,'device').adc,false);assert.equal(routeState(c,a,'draft').adc,true);
});
test('增益命令采用通道掩码，读回实际字节',()=>{
 const c=clone(DEFAULTS),a=newActual();c.gains[2]=6;
 const p=planFor('gain',c,a,2);assert.equal(p[0].command,'adc_gain 6 0x04');assert.equal(p[1].command,'iic_rd 0x0069 1');
 validateStep(p[1],'[0x0069] = 0x8c\nesp32_a1 > ');assert.throws(()=>validateStep(p[1],'[0x0069] = 0x80\nesp32_a1 > '));
});
test('共享帧运行时不能改格式或回采',()=>{
 for(const key of ['i2s','adc','dac','vad']){const a=newActual();a[key]=true;assert.throws(()=>planFor('clock',DEFAULTS,a));assert.throws(()=>planFor('reference',DEFAULTS,a));}
 assert.equal(planFor('reference',{...DEFAULTS,reference:true})[0].command,'dac_ref 1 0x01 auto');
});

test('MIC 和播放入口先启动 I²S；已有共享总线不重启',()=>{
 for(const [kind,path] of [['adc','adc_on'],['dac','dac_on']]){
  const a=newActual();a.i2s=false;
  const cold=planFor(kind,DEFAULTS,a);assert.equal(cold[0].command,'i2s_on');assert.equal(cold[1].command,path);
  a.i2s=true;assert.equal(planFor(kind,DEFAULTS,a)[0].command,path);
  assert.equal(planFor(kind,{...DEFAULTS,[kind]:false},a).some(s=>s.command==='i2s_on'),false);
 }
 const c={...DEFAULTS,adcMute:true};
 assert.equal(planFor('adc',c).at(-1).command,'adc_mute 1');
 assert.equal(planFor('adc',{...c,adcMute:false}).at(-1).command,'adc_mute 0');
});
test('VAD 输出模式必须停机再改',()=>{
 const a=newActual();a.vad=true;a.vadOutput=false;assert.throws(()=>planFor('vad',{...DEFAULTS,vad:true,vadOutput:true},a));
 assert.throws(()=>validateStep(planFor('vad',{...DEFAULTS,vad:true},newActual()).at(-1),'VAD is already running\nesp32_a1 > '),/没有生效/);
});

test('VAD 默认仅检测；专用输出不能覆盖正在采集的 MIC',()=>{
 assert.equal(DEFAULTS.vadOutput,false);
 const a=newActual();a.i2s=false;a.adc=false;a.dac=false;
 const p=planFor('vad',{...DEFAULTS,vad:true},a);assert.equal(p[0].command,'i2s_on');assert.equal(p.at(-1).command,'vad_on out=0');
 a.i2s=true;a.adc=true;assert.throws(()=>planFor('vad',{...DEFAULTS,vad:true,vadOutput:true},a),/替换普通采集流/);
 assert.equal(planFor('vad',{...DEFAULTS,vad:true},a).at(-1).command,'vad_on out=0');
 a.vad=true;a.vadOutput=true;assert.throws(()=>planFor('adc',DEFAULTS,a),/接管采集流/);
 assert.equal(planFor('vad',{...DEFAULTS,vad:false},a)[0].command,'vad_off');
 a.vad=false;a.adc=false;assert.equal(planFor('vad',{...DEFAULTS,vad:true,vadOutput:true},a).at(-1).command,'vad_on out=1');
});

test('VAD 替换输出时框图不冒充四路独立 MIC 数据',()=>{
 const a={...newActual(),i2s:true,adc:true,adcMute:false,vad:true,vadOutput:true,channels:4};
 assert.equal(routeState(DEFAULTS,a,'device').adc,false);
 for(const mode of ['simple','pro']){
  const s=renderGraph(DEFAULTS,a,{source:'device',mode});
  assert.match(s,/data-edge="vad-stream" class="edge enabled flow"/);
  assert.match(s,/VAD 滤波输出/);
  assert.match(s,new RegExp('data-edge="'+(mode==='pro'?'gain0':'adc-data')+'" class="edge disabled'));
 }
 a.vadOutput=false;assert.equal(routeState(DEFAULTS,a,'device').adc,true);
});
test('VAD 停止后不能显示旧语音活动',()=>{
 const a=newActual();a.vad=true;a.speech=true;a.vadOutput=true;parseState(a,'vad_off','VAD stopped');assert.equal(a.speech,null);assert.equal(a.vadOutput,false);
});
test('命令错误、读失败与格式错误不算成功',()=>{
 for(const s of ['E (123) A1: invalid state','Command returned non-zero error code: 0x1','  [0x0067] read failed: -1','Usage: set_rate <rate>'])assert.throws(()=>assertResponse(s));
 assert.throws(()=>validateStep({command:'dac_vol',expect:/DAC vol =/},'nothing\nesp32_a1 > '));
});
test('未识别的调试接口不能开放参数控制',()=>{
 const h=REQUIRED.map(x=>x+'\n  description').join('\n')+'\nesp32_a1 > ';assert.equal(identifyCLI(h).size,REQUIRED.length);
 assert.throws(()=>identifyCLI('UNSUPPORTED_DEVICE_STATUS connected=1'));
});
test('ANSI 与分段提示符解析',()=>{
 assert.equal(hasPrompt('\x1b[32mesp32_a1 > \x1b[0m'),true);assert.equal(hasPrompt('esp32_a1 '),false);
 assert.deepEqual(readRegisters(' [0x0067] = 0x80\n [0x0068] = 0xff'),{103:128,104:255});
});
test('增益寄存器与驱动缓存的值不混为一个来源',()=>{
 const a=newActual();parseState(a,'iic_rd','[0x0067] = 0x00\n[0x0068] = 0x88');assert.deepEqual(a.gains,[-64,4,null,null]);assert.equal(a.adcMute,null);
 parseState(a,'adc_mute 0','ADC mute = 0 via codec_dev');assert.equal(a.adcMute,false);
});
test('设备应答的回采、VAD、采样格式读取',()=>{
 const a=newActual();parseState(a,'','I2S up: rate=48000 bits=24 slots=5\nDAC ref: enable=1 ref_dac_ch=0x2 real_adc_data_ch=5\nVAD started: rate=48000 out=enabled\nhas_speech=1 triggers=3 rec=no');
 assert.equal(a.i2s,true);assert.equal(a.referenceChannel,2);assert.equal(a.vad,true);assert.equal(a.speech,true);assert.equal(a.triggers,3);
});
test('回采的开关往返；未知不能显示为启用',()=>{
 const c=clone(DEFAULTS),a=newActual();const off=renderGraph(c,a,{source:'draft'});c.reference=true;const on=renderGraph(c,a,{source:'draft'});c.reference=false;const off2=renderGraph(c,a,{source:'draft'});
 const state=s=>s.match(/data-edge="reference-return" class="([^"]+)"/)[1];assert.match(state(off),/disabled/);assert.match(state(on),/enabled/);assert.equal(state(off2),state(off));
 assert.doesNotMatch(on,/class="edge-motion"/);assert.match(state(renderGraph({...c,reference:true},a,{source:'device'})),/disabled/);
});
test('只有已确认开启且解除静音的通路会流动',()=>{
 const a=newActual();a.i2s=true;a.adc=true;a.adcMute=false;a.channels=4;
 assert.match(renderGraph(DEFAULTS,a,{source:'device'}),/class="edge-motion"/);a.adcMute=true;
 assert.doesNotMatch(renderGraph(DEFAULTS,a,{source:'device'}),/class="edge-motion"/);
});
test('低层写入只准增益地址，拒绝 eFuse、时钟和校准',()=>{
 for(const addr of [0xe6,0xe7,0,0x5e,0x804,0x89,0xe0])assert.throws(()=>registerWritePlan(addr,0,255));
 assert.equal(registerWritePlan(0x67,0x90,0x0f).mask,15);assert.throws(()=>registerWritePlan(0x67,256,255));
});
test('掩码写入不把无关位变化误判为失败',async()=>{
 const calls=[],replies=['[0x0067] = 0xa0','WR [0x0067] = 0x03: OK','[0x0067] = 0xb3'];
 const result=await maskedWrite(0x67,3,15,async cmd=>{calls.push(cmd);return replies.shift();});assert.equal(result,0xb3);assert.equal(calls.length,3);
});
test('写入失败只恢复本次掩码，保留其他位',async()=>{
 const calls=[],replies=['[0x0067] = 0xa5','WR [0x0067] = 0x03: OK','[0x0067] = 0xb4','WR [0x0067] = 0xa5: OK','[0x0067] = 0xb5'];
 await assert.rejects(()=>maskedWrite(0x67,3,15,async cmd=>{calls.push(cmd);return replies.shift();}),/已恢复/);
 assert.equal(calls[3],'iic_wr 0x0067 0xa5 0x0f');
});
test('写后读取失败也尝试掩码恢复，恢复状态不虚报',async()=>{
 let i=0;const replies=['[0x0067] = 0xa5','WR [0x0067] = 0x03: OK','E (1) A1: read failed','WR [0x0067] = 0xa5: OK','[0x0067] = 0xb5'];
 await assert.rejects(()=>maskedWrite(0x67,3,15,async()=>replies[i++]),/已恢复/);assert.equal(i,5);
});
test('原值缺失或受保护地址不会发出寄存器写入',async()=>{
 const calls=[];await assert.rejects(()=>maskedWrite(0x67,3,15,async cmd=>{calls.push(cmd);return '[0x0068] = 0x80';}),/未读到原值/);assert.equal(calls.length,1);
 await assert.rejects(()=>maskedWrite(0xe6,0,255,async()=>{throw Error('不应调用');}),/仅可读取/);
});

function fakePort(respond){
 let push;let cancelled=false;
 const readable=new ReadableStream({start(c){push=c;},cancel(){cancelled=true;}});
 const writable=new WritableStream({write(bytes){const cmd=new TextDecoder().decode(bytes).trim();respond(cmd,s=>{if(!cancelled)push.enqueue(new TextEncoder().encode(s));});}});
 return {readable,writable,open:async()=>{},close:async()=>{},getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};
}
test('串口真实命令通路：分段 help、prompt、写入与错误传播',async()=>{
 const help=REQUIRED.map(x=>x+'\n  help').join('\n');
 const port=fakePort((cmd,push)=>{if(cmd==='')push('esp32_a1 > ');else if(cmd==='help'){push(help+'\nesp32_');push('a1 > ');}else if(cmd==='dac_vol')push('DAC vol = 25\nesp32_a1 > ');else push('E (1) A1: failed\nesp32_a1 > ');});
 const transport=new A1Serial();await transport.connect({requestPort:async()=>port});
 assert.equal(transport.ready,true);assert.match(await transport.command('dac_vol'),/25/);await assert.rejects(()=>transport.command('adc_on'),/failed/);await transport.disconnect();assert.equal(transport.port,null);
});
test('串口忙碌拒绝重入；超时后不能串配迟到应答',async()=>{
 let later;const port=fakePort((cmd,push)=>{if(cmd==='')push('esp32_a1 > ');else if(cmd==='help')push(REQUIRED.join('\n')+'\nesp32_a1 > ');else later=push;});
 const transport=new A1Serial({timeout:25});await transport.connect({requestPort:async()=>port});
 const first=transport.command('dac_vol');await assert.rejects(()=>transport.command('adc_on'),/上一条/);await assert.rejects(()=>first,/超时/);later('DAC vol = 10\nesp32_a1 > ');await assert.rejects(()=>transport.command('adc_on'),/尚未识别/);await transport.disconnect();
});
test('启动时缓存的旧提示符不能冒充 help 应答',async()=>{
 const port=fakePort((cmd,push)=>{if(cmd==='')push('esp32_a1 > ');else if(cmd==='help'){push('esp32_a1 > ');setTimeout(()=>push(REQUIRED.join('\n')+'\nesp32_a1 > '),5);}});
 const transport=new A1Serial();await transport.connect({requestPort:async()=>port});assert.equal(transport.ready,true);await transport.disconnect();
});

test('录音异步日志紧跟提示符时仍完成命令，不误超时',async()=>{
 const port=fakePort((cmd,push)=>{if(cmd==='')push('esp32_a1 > ');else if(cmd==='help')push(REQUIRED.concat(['rec_on']).join('\n')+'\nesp32_a1 > ');else push('Recording user_str=web_unique\nesp32_a1 > I (1) A1_FILE: Rec start: 16000 Hz\n');});
 const s=new A1Serial({timeout:100});try{await s.connect({requestPort:async()=>port});assert.match(await s.command('rec_on 1 web_unique'),/Recording user_str/);assert.equal(s.ready,true);}finally{await s.disconnect();}
});

 test('日志按完整行筛选，遥测与录音数据不会因串口分包混入导出记录',async()=>{const {serialLogLines}=await import('../core.mjs');assert.deepEqual(serialLogLines('esp32_a1 > @A1 {"type":"state"}\nD QUJDRA==\nFGET END\nRecording done: 4 bytes\n'),['FGET END','Recording done: 4 bytes']);});

test('active file tasks prevent closing their ADC or DAC path',()=>{
 const c=clone(DEFAULTS);c.adc=false;c.dac=false;
 assert.throws(()=>planFor('adc',c,{...newActual(),recording:true}),/停止录音/);
 assert.throws(()=>planFor('dac',c,{...newActual(),playing:true}),/停止播放/);
 assert.deepEqual(planFor('adc',c,{...newActual(),recording:false}).map(s=>s.command),['adc_off']);
 assert.deepEqual(planFor('dac',c,{...newActual(),playing:false}).map(s=>s.command),['dac_off']);
});

test('normal SDK VAD notifications do not abort a valid response; real errors still fail',()=>{
 const notification='E (756785) ESP32_A1_INT: Interrupt status: 0x04 VAD\n';
 const reply='@A1 {"type":"state"}\nesp32_a1 > ';
 assert.match(assertResponse(notification+reply),/@A1/);
 assert.throws(()=>assertResponse(notification+'E (756786) A1: read failed\n'+reply));
 assert.throws(()=>assertResponse('E (756785) ESP32_A1_INT: Interrupt status: 0x05 CODEC VAD\n'+reply));
 assert.throws(()=>assertResponse('E (756785) ESP32_A1_INT: Receive interrupt notification failed\n'+reply));
});
