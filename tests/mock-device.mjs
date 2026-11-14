// Browser-only integration fixture. Never imported by the production build.
import {REQUIRED} from '../core.mjs';
const state={type:'state',version:'SIMULATED-0.4.2',uptime_ms:12345,i2s:true,adc:true,dac:true,adcMute:false,dacMute:false,rate:48000,bits:24,channels:4,volume:25,reference:false,referenceChannel:1,vad:false,vadOutput:false,speech:null,triggers:0,sd:false,recording:false,playing:false,scope:false,scope_max_ms:10000,gainRegisters:[128,128,128,128]};
const calls=[],errors=[],gainCache=[128,128,128,128];
const fixture={state,calls,errors,delayMs:80,failNext:false,ports:0,connected:false};
Object.defineProperty(window,'__A1_UI_TEST__',{value:fixture});
window.addEventListener('error',e=>errors.push(String(e.error?.stack||e.message)));
window.addEventListener('unhandledrejection',e=>errors.push(String(e.reason?.stack||e.reason)));
const files=new Map([['/sdcard/demo_16k_stereo.wav',{rate:16000,bits:16,channels:2,frames:160000}]]);
let record=null,recordTimer=null;
const report=(type,data)=>'@A1 '+JSON.stringify({type,...data});
const finishRecord=()=>{if(!record)return '';clearTimeout(recordTimer);state.recording=false;record.frames=Math.min(record.frames,Math.max(1,Math.floor((Date.now()-record.start)*record.rate/1000)));files.set(record.path,{...record});const message=`Recording done: ${record.frames*record.channels*(record.bits/8)} bytes -> ${record.path} (rx_ovf=0)`;record=null;return message;};
// Fail closed: the fixture replaces the only transport before app.mjs is loaded.
for(const api of ['usb','hid','bluetooth'])Object.defineProperty(navigator,api,{value:undefined,configurable:false});
if(navigator.mediaDevices)Object.defineProperty(navigator.mediaDevices,'getUserMedia',{value:async()=>{throw Error('UI fixture blocks real media capture');}});
const badge=document.createElement('div');badge.id='simulationBadge';badge.textContent='SIMULATED DEVICE · UI TEST ONLY';badge.style.cssText='position:fixed;bottom:75px;right:20px;z-index:1000;background:#8c3e00;color:#fff;padding:10px;font:12px monospace';document.body.append(badge);
const count=document.createElement('output');count.id='commandCount';badge.append(count);
Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>{
 fixture.ports++;let controller,closed=false,seq=0;
 const readable=new ReadableStream({start(c){controller=c;},cancel(){closed=true;}});
 const writable=new WritableStream({async write(bytes){const cmd=new TextDecoder().decode(bytes).trim();calls.push(cmd);count.textContent=' · '+calls.filter(c=>c&&c!=='help'&&!c.startsWith('web_')).length+' control commands';
  await new Promise(r=>setTimeout(r,fixture.delayMs+(cmd.startsWith('fls')&&location.search.includes('slow-list=1')?1500:0)));
  let response='';const a=cmd.split(/\s+/);
  if(fixture.failNext&&!['','help','web_status'].includes(cmd)){fixture.failNext=false;response='Error: SIMULATED write failure';}
  else
  if(cmd==='help')response=[...REQUIRED,'iic_wr','web_status','web_scope','web_scope_window','web_record_status','web_file_info','sdcard_on','sdcard_off','rec_on','rec_off','rec_prepare','play_on','play_off','fls','vad_wav'].join('\n');
  else if(cmd==='web_status')response='@A1 '+JSON.stringify({...state,uptime_ms:Date.now()%100000});
  else if(a[0]==='dac_vol'){if(a[1])state.volume=+a[1];response='DAC vol = '+state.volume;}
  else if(a[0]==='dac_mute'){state.dacMute=!!+a[1];response='DAC mute = '+a[1];}
  else if(cmd==='dac_on'||cmd==='dac_off'){state.dac=cmd==='dac_on';response='DAC '+(state.dac?'on':'off')+' via esp_codec_dev';}
  else if(a[0]==='web_scope'&&a[1]==='stop'){state.scope=false;response='scope stopped';}
  else if(a[0]==='web_scope_window'||a[0]==='web_scope'){
   const ms=+(a[3]||50),samples=Array.from({length:100},(_,i)=>Math.round(10000*Math.sin(i*.2+seq*.2)));
   state.scope=true;const valid=a[1]==='adc'?state.adc&&!state.adcMute:state.dac&&state.playing&&!state.dacMute;
   response='@A1 '+JSON.stringify({type:'wave',source:a[1],channel:+a[2],seq:++seq,rate:state.rate,age_ms:1,valid,samples:valid?samples:[],min:valid?samples:[],max:valid?samples:[],rms:valid?Math.sqrt(samples.reduce((n,v)=>n+v*v,0)/samples.length)/32768:0,peak:valid?Math.max(...samples.map(Math.abs))/32768:0,duration_ms:ms,spanFrames:Math.round(ms*state.rate/1000)});
  }
  else if(a[0]==='adc_gain'){for(let i=0;i<4;i++)if(+a[2]&(1<<i)){gainCache[i]=128+(+a[1])*2;state.gainRegisters[i]=state.adcMute?0:gainCache[i];}response='ADC gain = '+a[1];}
  else if(a[0]==='iic_rd'){const addr=+a[1];response=Array.from({length:+a[2]||1},(_,i)=>`[0x${(addr+i).toString(16).padStart(4,'0')}] = 0x${(state.gainRegisters[addr+i-0x67]??128).toString(16)}`).join('\n');}
  else if(a[0]==='iic_wr'){const i=+a[1]-0x67;if(i>=0&&i<4)state.gainRegisters[i]=(state.gainRegisters[i]&~+a[3])|(+a[2]&+a[3]);response='WR '+a[1]+': OK';}
  else if(cmd==='vad_status')response=`has_speech=${+!!state.speech} triggers=${state.triggers}`;
  else if(cmd==='sdcard_on'){state.sd=true;response='SD card mounted';}
  else if(cmd==='sdcard_off'){state.sd=false;response='SD card unmounted';}
  else if(a[0]==='fls')response='FLS BEGIN /sdcard\n'+[...files].map(([path,f])=>`E ${44+f.frames*f.channels*(f.bits/8)} ${path.slice(8)}`).join('\n')+`\nFLS END ${files.size}`;
  else if(a[0]==='rec_prepare')response='Recording prepared: '+a[2];
  else if(a[0]==='rec_on'){
   state.recording=true;record={path:`/sdcard/a1_${a[2]}.wav`,rate:state.rate,bits:state.bits,channels:state.channels+Number(state.reference),frames:+a[1]*state.rate,start:Date.now()};
   response='Rec start: simulated -> '+record.path;
   recordTimer=setTimeout(()=>{const line=finishRecord();if(!closed)controller.enqueue(new TextEncoder().encode(line+'\n'));},+a[1]*1000);
  }
  else if(cmd==='rec_off')response=finishRecord()||'Recording cancelled';
  else if(cmd==='web_record_status'){
   const f=record,frameBytes=f?f.channels*(f.bits/8):0,captured=f?Math.min(f.frames,Math.floor((Date.now()-f.start)/1000*f.rate))*frameBytes:0;
   response=report('record',{active:state.recording,capturedBytes:captured,writtenBytes:captured,targetBytes:f?f.frames*frameBytes:0,bufferBytes:65536,peakBufferBytes:0,rate:state.rate,frameBytes,elapsedMs:f?Date.now()-f.start:0,error:0});
  }
  else if(a[0]==='web_file_info'){
   const f=files.get(a[1]);response=f?report('file',{...f,bytes:44+f.frames*f.channels*(f.bits/8),dataBytes:f.frames*f.channels*(f.bits/8),verified:false,scannedBytes:0,crc32:'00000000'}):'Error: SIMULATED file not found';
  }
  else if(a[0]==='play_on'){state.playing=true;response='play start: '+a[1];}
  else if(cmd==='play_off'){state.playing=false;response='play stop requested\nplay stopped';}
  else if(a[0]==='vad_wav')response='vad_wav: saved';
  else if(a[0]==='set_rate'){state.rate=fixture.mismatchRate?(+a[1]===48000?16000:48000):+a[1];fixture.mismatchRate=false;response='Rate = '+state.rate;}
  else if(a[0]==='set_bits'){state.bits=+a[1];response='Bits = '+a[1];}
  else if(a[0]==='set_ch'){state.channels=+a[1];response='ADC channels = '+a[1];}
  else if(cmd==='i2s_on'){state.i2s=true;response=`I2S up: rate=${state.rate} bits=${state.bits} slots=${state.channels}`;}
  else if(cmd==='i2s_off'){state.i2s=false;state.adc=false;state.dac=false;response='I2S channels down';}
  else if(cmd==='adc_on'||cmd==='adc_off'){state.adc=cmd==='adc_on';response='ADC '+(state.adc?'on':'off')+' via esp_codec_dev';}
  else if(a[0]==='adc_mute'){state.adcMute=!!+a[1];state.gainRegisters=gainCache.map(v=>state.adcMute?0:v);response='ADC mute = '+a[1];}
  else if(a[0]==='dac_ref'){if(a.length>1){state.reference=!!+a[1];state.referenceChannel=+a[2];}response=`DAC ref${a.length>1?' =':':'} enable=${+state.reference} ref_dac_ch=0x${state.referenceChannel}`;}
  else if(cmd==='vad_off'){state.vad=false;state.vadOutput=false;response='VAD stopped';}
  else if(a[0]==='vad_on'){state.vad=true;state.vadOutput=a[1]==='out=1';response=`VAD started: rate=${state.rate} out=${state.vadOutput?'enabled':'disabled'}`;}
  else if(cmd)response='Error: simulated unsupported command';
  if(!closed)controller.enqueue(new TextEncoder().encode(response+'\nesp32_a1 > '));
 }});
 return {readable,writable,open:async()=>{fixture.connected=true;},close:async()=>{closed=true;fixture.connected=false;},getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};
}}});
await import('../app.mjs');
