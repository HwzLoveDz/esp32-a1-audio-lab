import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED,DEFAULTS,clone,newActual,parseState,applySnapshot,telemetry} from '../core.mjs';
import {EXAMPLES,exampleConfig,applyExample,applySetup} from '../examples.mjs';

function device({overrides={},fail='',wrong='',capabilities=[]}={}){
 const state={type:'state',version:'TEST',uptime_ms:123,i2s:true,adc:true,dac:true,adcMute:false,dacMute:false,rate:48000,bits:24,channels:4,volume:25,reference:false,referenceChannel:1,vad:false,vadOutput:false,speech:null,triggers:0,sd:false,recording:false,playing:false,scope:true,gainRegisters:[128,128,128,128],...overrides};
 const actual=newActual(),calls=[];let stopping=0;
 const caps=new Set([...REQUIRED,'web_status','web_scope','rec_off','play_off','sdcard_on','fls','rec_on','web_record_status',...capabilities]);
 const send=async cmd=>{
  calls.push(cmd);if(cmd===fail)throw Error('injected failure');
  const [name,...a]=cmd.split(' ');let response='';
  if(name==='web_status'){
   if(stopping&&++stopping===4){state.recording=false;state.playing=false;}
   response='@A1 '+JSON.stringify({...state,...(wrong?{[wrong]:state[wrong]===true?false:19}:{})});
  }else if(name==='web_scope'){state.scope=false;response='scope stopped';}
  else if(name==='rec_off'||name==='play_off'){stopping=1;response='stop requested';}
  else if(name==='set_rate'){state.rate=+a[0];response='Rate = '+a[0];}
  else if(name==='set_bits'){state.bits=+a[0];response='Bits = '+a[0];}
  else if(name==='set_ch'){state.channels=+a[0];response='ADC channels = '+a[0];}
  else if(name==='dac_ref'){
   if(a.length){assert.equal(state.i2s,false);state.reference=!!+a[0];state.referenceChannel=+a[1];}
   response=`DAC ref${a.length?' =':':'} enable=${+state.reference} ref_dac_ch=0x${state.referenceChannel}`;
  }else if(name==='i2s_off'){assert.equal(state.adc||state.dac||state.vad||state.recording||state.playing,false);state.i2s=false;response='I2S channels down';}
  else if(name==='i2s_on'){state.i2s=true;response=`I2S up: rate=${state.rate} bits=${state.bits} slots=${state.channels}`;}
  else if(/^(adc|dac)_(on|off)$/.test(name)){const [kind,verb]=name.split('_');if(verb==='on')assert.equal(state.i2s,true);state[kind]=verb==='on';response=`${kind.toUpperCase()} ${verb} via esp_codec_dev`;}
  else if(name==='adc_mute'||name==='dac_mute'){const kind=name.slice(0,3);state[kind+'Mute']=!!+a[0];response=kind.toUpperCase()+' mute = '+a[0];}
  else if(name==='adc_gain'){for(let i=0;i<4;i++)if(+a[1]&(1<<i))state.gainRegisters[i]=128+2*(+a[0]);response='ADC gain = '+a[0];}
  else if(name==='iic_rd'){const address=+a[0];response=`[0x${address.toString(16)}] = 0x${state.gainRegisters[address-0x67].toString(16)}`;}
  else if(name==='dac_vol'){if(a.length)state.volume=+a[0];response='DAC vol = '+state.volume;}
  else if(name==='vad_on'){state.vad=true;state.vadOutput=a[0]==='out=1';response=`VAD started: rate=${state.rate} out=${state.vadOutput?'enabled':'disabled'}`;}
  else if(name==='vad_off'){state.vad=false;state.vadOutput=false;response='VAD stopped';}
  else if(name==='sdcard_on'){state.sd=true;response='SD card mounted';}
  else throw Error('Unexpected command '+cmd);
  parseState(actual,cmd,response);if(name==='web_status')applySnapshot(actual,telemetry(response,'state'));return response;
 };
 return {state,actual,calls,options:{send,getState:()=>actual,capabilities:caps}};
}

test('examples configure real command sequences from already-running paths and verify gains',async()=>{
 for(const e of EXAMPLES.filter(e=>!e.stop)){
  const d=device({overrides:{vad:true}}),result=await applyExample(e.id,d.options),target=exampleConfig(e.id);
  assert.equal(result.state.rate,target.rate);assert.equal(result.state.adc,target.adc);assert.equal(result.state.dac,target.dac);
  assert.ok(d.calls.indexOf('i2s_off')<d.calls.findIndex(c=>c.startsWith('set_rate')));
  assert.ok(d.calls.indexOf('vad_off')<d.calls.indexOf('adc_off'));
  for(let i=0;i<target.channels&&target.adc;i++)assert.equal(d.actual.gains[i],target.gains[i]);
  assert.ok(d.calls.every(c=>!c.startsWith('iic_wr')&&!c.startsWith('rec_on')&&!c.startsWith('play_on')));
 }
});
test('missing capabilities and incompatible imported modes produce no commands',async()=>{
 const d=device();d.options.capabilities.delete('web_record_status');
 await assert.rejects(()=>applyExample('recording',d.options),/缺少/);assert.deepEqual(d.calls,[]);
 await assert.rejects(()=>applySetup({...clone(DEFAULTS),vad:true,vadOutput:true},d.options),/不能/);assert.deepEqual(d.calls,[]);
});
test('running or armed file tasks block example switching after a fresh read only',async()=>{
 for(const change of [{recording:true},{playing:true},{}]){
  const d=device({overrides:change});await assert.rejects(()=>applyExample('voice',{...d.options,armed:!Object.keys(change).length}),/先停止/);
  assert.deepEqual(d.calls,['web_status']);
 }
});
test('stop all waits for asynchronous file completion before closing dependent streams',async()=>{
 const d=device({overrides:{recording:true,playing:true,vad:true,sd:true}});await applyExample('stop',d.options);
 assert.ok(d.calls.indexOf('rec_off')<d.calls.indexOf('adc_off'));assert.ok(d.calls.indexOf('play_off')<d.calls.indexOf('dac_off'));
 assert.equal(d.state.i2s||d.state.adc||d.state.dac||d.state.recording||d.state.playing||d.state.vad,false);assert.equal(d.state.sd,true);
});
test('a failed step stops the sequence before starting new paths or files',async()=>{
 const d=device({fail:'set_bits 16'});await assert.rejects(()=>applyExample('recording',d.options),/injected/);
 assert.equal(d.calls.at(-1),'set_bits 16');assert.ok(!d.calls.includes('adc_on'));assert.ok(!d.calls.includes('sdcard_on'));
});
test('final telemetry mismatch prevents reporting a successful example',async()=>{
 const d=device({wrong:'volume'});await assert.rejects(()=>applyExample('playback',d.options),/音量/);
});
test('imported configuration uses the same sequencing and readback as built-in examples',async()=>{
 const d=device(),target={...clone(DEFAULTS),rate:22050,bits:16,channels:2,gains:[3,9,0,0],volume:17,reference:true};
 const result=await applySetup(target,d.options);assert.deepEqual(result.config,target);assert.deepEqual(d.actual.gains.slice(0,2),[3,9]);assert.equal(d.actual.volume,17);
});
