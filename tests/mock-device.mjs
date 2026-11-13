// Browser-only integration fixture. Never imported by the production build.
import {REQUIRED} from '../core.mjs';
const state={type:'state',version:'SIMULATED-0.4.1',uptime_ms:12345,i2s:true,adc:true,dac:true,adcMute:false,dacMute:false,rate:48000,bits:24,channels:4,volume:25,reference:false,referenceChannel:1,vad:false,vadOutput:false,speech:null,triggers:0,sd:false,recording:false,playing:false,scope:true,scope_max_ms:10000,gainRegisters:[128,128,128,128]};
let calls=[];
const badge=document.createElement('div');badge.id='simulationBadge';badge.textContent='SIMULATED DEVICE · UI TEST ONLY';badge.style.cssText='position:fixed;bottom:75px;right:20px;z-index:1000;background:#8c3e00;color:#fff;padding:10px;font:12px monospace';document.body.append(badge);
const count=document.createElement('output');count.id='commandCount';badge.append(count);
Object.defineProperty(navigator,'serial',{value:{requestPort:async()=>{
 let controller,closed=false,seq=0;
 const readable=new ReadableStream({start(c){controller=c;},cancel(){closed=true;}});
 const writable=new WritableStream({write(bytes){const cmd=new TextDecoder().decode(bytes).trim();calls.push(cmd);count.textContent=' · '+calls.filter(c=>c&&c!=='help'&&!c.startsWith('web_')).length+' control commands';
  let response='';const a=cmd.split(/\s+/);
  if(cmd==='help')response=[...REQUIRED,'web_status','web_scope','web_scope_window'].join('\n');
  else if(cmd==='web_status')response='@A1 '+JSON.stringify({...state,uptime_ms:Date.now()%100000});
  else if(a[0]==='dac_vol'){if(a[1])state.volume=+a[1];response='DAC vol = '+state.volume;}
  else if(a[0]==='dac_mute'){state.dacMute=!!+a[1];response='DAC mute = '+a[1];}
  else if(cmd==='dac_on'||cmd==='dac_off'){state.dac=cmd==='dac_on';response='DAC '+(state.dac?'on':'off')+' via esp_codec_dev';}
  else if(a[0]==='web_scope'&&a[1]==='stop')response='scope stopped';
  else if(a[0]==='web_scope_window'||a[0]==='web_scope'){
   const ms=+(a[3]||50),samples=Array.from({length:100},(_,i)=>Math.round(10000*Math.sin(i*.2+seq*.2)));
   response='@A1 '+JSON.stringify({type:'wave',source:a[1],channel:+a[2],seq:++seq,rate:state.rate,age_ms:1,valid:true,samples});
  }
  else if(a[0]==='adc_gain'){for(let i=0;i<4;i++)if(+a[2]&(1<<i))state.gainRegisters[i]=128+(+a[1])*2;response='ADC gain = '+a[1];}
  else if(a[0]==='iic_rd'){const addr=+a[1];response=`[0x${addr.toString(16).padStart(4,'0')}] = 0x${(state.gainRegisters[addr-0x67]??128).toString(16)}`;}
  else if(cmd)response='Error: simulated unsupported command';
  if(!closed)controller.enqueue(new TextEncoder().encode(response+'\nesp32_a1 > '));
 }});
 return {readable,writable,open:async()=>{},close:async()=>{closed=true;},getInfo:()=>({usbVendorId:0x303a,usbProductId:0x1001})};
}}});
await import('../app.mjs');
