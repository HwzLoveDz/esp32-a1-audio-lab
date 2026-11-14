export const VERSION='0.8.0';
export const RATES=[8000,11025,12000,16000,22050,24000,32000,44100,48000];
export const DEFAULTS={rate:48000,bits:24,channels:4,gains:[0,0,0,0],adc:true,dac:true,adcMute:false,dacMute:false,volume:25,reference:false,referenceChannel:1,vad:false,vadOutput:false};
export const REQUIRED=['iic_rd','adc_on','adc_off','dac_on','dac_off','adc_gain','dac_vol','adc_mute','dac_mute','set_rate','set_bits','set_ch','i2s_on','i2s_off','dac_ref','vad_on','vad_off','vad_status'];
export const REGISTERS=[
 [0x0000,'SOC_CLK_SRC_CFG',false],[0x005e,'ADC_CALI_CONTROL',false],
 [0x0067,'ADC_CH0_GAIN',true],[0x0068,'ADC_CH1_GAIN',true],[0x0069,'ADC_CH2_GAIN',true],[0x006a,'ADC_CH3_GAIN',true],
 [0x0070,'DAC_CHL_GAIN',true],[0x0071,'DAC_CHR_GAIN',true],[0x0072,'DAC_REF_SIG',false],
 [0x0089,'VAD_CONTROL',false],[0x008a,'VAD_OUT_CH_CONF',false],[0x008b,'VAD_GAIN',false],
 [0x00e0,'I2S_CONFIG_0',false],[0x0804,'ULP / INITIALIZATION CHECK',false]
].map(([address,name,writable])=>({address,name,writable}));
export const hex=(n,width=2)=>'0x'+n.toString(16).padStart(width,'0');
export const clone=v=>JSON.parse(JSON.stringify(v));
export function validateConfig(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('配置格式不正确');
 const c=clone(DEFAULTS);
 for(const k of Object.keys(c))if(Object.hasOwn(input,k))c[k]=input[k];
 if(!RATES.includes(c.rate)||![16,24].includes(c.bits)||![1,2,3,4].includes(c.channels))throw Error('采样率、位深或通道数不受当前 SDK 支持');
 if(!Array.isArray(c.gains)||c.gains.length!==4||c.gains.some(x=>!Number.isInteger(x)||x< -64||x>63))throw Error('ADC 增益需为 −64 至 +63 dB 的整数');
 if(!Number.isInteger(c.volume)||c.volume<0||c.volume>100||![1,2].includes(c.referenceChannel))throw Error('音量或回采通道无效');
 for(const k of ['adc','dac','adcMute','dacMute','reference','vad','vadOutput'])if(typeof c[k]!=='boolean')throw Error('开关配置无效：'+k);
 return c;
}
export function newActual(){return {i2s:null,adc:null,dac:null,adcMute:null,dacMute:null,vad:null,vadOutput:null,rate:null,bits:null,channels:null,volume:null,gains:[null,null,null,null],reference:null,referenceChannel:null,sd:null,recording:null,playing:null,speech:null,triggers:null,registers:{},updated:0};}
export const stripTerminal=s=>s.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g,'').replace(/\r/g,'').replace(/[^\x08]\x08/g,'');
export const hasPrompt=s=>/esp32_a1\s*>\s*$/.test(stripTerminal(s));
export function serialLogLines(text){return text.split('\n').filter(line=>line.trim()&&!line.includes('@A1 ')&&!/(?:^|> )D [A-Za-z0-9+/=]+\s*$/.test(line));}
export function takePrompt(s){const clean=stripTerminal(s),m=/(?:^|\n)esp32_a1[ \t]*>[ \t]*/.exec(clean);if(!m)return null;const end=m.index+m[0].length;return {response:clean.slice(0,end),rest:clean.slice(end)};}
export function assertResponse(s){
 let clean=stripTerminal(s);
 // The SDK emits this normal VAD interrupt notification at error log level.
 // Keep genuine driver errors and other interrupt bits subject to normal checks.
 clean=clean.replace(/^E \(\d+\) ESP32_A1_INT: Interrupt status: 0x04 VAD[ \t]*(?:\n|$)/gm,'');
 // The vendor CLI explicitly accepts ESP_ERR_INVALID_STATE for this shared ISR service.
 // Only suppress its exact idempotency diagnostic when this same response confirms success.
 if(/(?:ADC|DAC) on via esp_codec_dev/.test(clean))clean=clean.replace(/^E \(\d+\) gpio: gpio_install_isr_service\(\d+\): GPIO isr service already installed\n/gm,'');
 if(/(?:^|\n)\s*(?:E\s+\(\d+\)|Error:|Usage:|Command returned non-zero|Unrecognized command|command not found)/i.test(clean)||/\bread failed:|\bwrite failed:|\bWR .*failed:/i.test(clean))throw Error(clean.split('\n').filter(x=>/failed|Error|Usage|non-zero|not found|^E\s/i.test(x)).join('\n')||'设备返回错误');
 return clean;
}
export function identifyCLI(s){
 const clean=assertResponse(s);
 const supported=[...REQUIRED,'iic_wr','set_adc_mon','sdcard_on','sdcard_off','rec_prepare','rec_on','rec_off','play_on','play_off','vad_wav','fls','fget','fsnr','web_file_info','web_record_status','help','web_status','web_scope','web_scope_window'];
 const found=new Set();
 // Only bind known CLI verbs; descriptions are not capabilities.
 for(const name of supported)if(new RegExp('(?:^|\\n)[ \\t]*'+name+'(?=[ \\t\\r\\n]|$)').test(clean))found.add(name);
 const missing=REQUIRED.filter(x=>!found.has(x));
 if(missing.length)throw Error('当前串口未识别为兼容的 a1_cli。缺少：'+missing.join(', ')+'。不会发送参数写入。');
 return found;
}
export function readRegisters(s){
 const out={};for(const m of assertResponse(s).matchAll(/\[0x([\da-f]{1,4})\]\s*=\s*0x([\da-f]{1,2})/ig))out[parseInt(m[1],16)]=parseInt(m[2],16);return out;
}
export function parseState(a,command,response){
 const s=assertResponse(response);let m;
 Object.assign(a.registers,readRegisters(s));
 for(let ch=0;ch<4;ch++)if(Object.hasOwn(a.registers,0x67+ch)&&Object.hasOwn(readRegisters(s),0x67+ch))a.gains[ch]=(a.registers[0x67+ch]-128)/2;
 if((m=s.match(/\bBits = (16|24)/)))a.bits=+m[1];
 if((m=s.match(/ADC channels = (\d)/)))a.channels=+m[1];
 if((m=s.match(/Rate = (\d+)/)))a.rate=+m[1];
 if((m=s.match(/I2S up: rate=(\d+) bits=(\d+) slots=(\d+)/))){a.i2s=true;a.rate=+m[1];a.bits=+m[2];}
 if(/I2S already up/.test(s))a.i2s=true;
 if(/I2S channels down/.test(s)){a.i2s=false;a.adc=false;a.dac=false;}
 if(/ADC on via esp_codec_dev/.test(s))a.adc=true;
 if(/ADC off via esp_codec_dev/.test(s))a.adc=false;
 if(/DAC on via esp_codec_dev/.test(s))a.dac=true;
 if(/DAC off via esp_codec_dev/.test(s))a.dac=false;
 if((m=s.match(/ADC mute = ([01])/)))a.adcMute=!!+m[1];
 if((m=s.match(/DAC mute = ([01])/)))a.dacMute=!!+m[1];
 if((m=s.match(/DAC vol = (\d+)/)))a.volume=+m[1];
 if((m=s.match(/DAC ref\s*(?:=|:)\s*enable[=:](\d)\s+ref_dac_ch[=:]0x([12])/))){a.reference=!!+m[1];a.referenceChannel=+m[2];}
 if((m=s.match(/ADC monitor = ([01])/)))a.reference=!!+m[1];
 if((m=s.match(/VAD started: rate=(\d+) out=(enabled|disabled)/))){a.vad=true;a.vadOutput=m[2]==='enabled';}
 if(/VAD is already running/.test(s))a.vad=true;
 if(/VAD stopped|VAD not initialized/.test(s)){a.vad=false;a.vadOutput=false;a.speech=null;}
 if((m=s.match(/has_speech=([01]) triggers=(\d+)/))){a.vad=true;a.speech=!!+m[1];a.triggers=+m[2];}
 if(/SD card (?:already )?mounted/.test(s))a.sd=true;
 if(/SD card unmounted|SD card not mounted/.test(s))a.sd=false;
 if(/Rec start:/.test(s))a.recording=true;
 if(/Recording done:|Recording cancelled/.test(s))a.recording=false;
 if(/play start:/.test(s))a.playing=true;
 if(/play done|play stopped/i.test(s))a.playing=false;
 a.updated=Date.now();return a;
}
function step(command,expect,verify){return {command,expect,verify};}
export function planFor(kind,c,a=newActual(),index=0){
 c=validateConfig(c);
 switch(kind){
 case 'clock':
  if(a.i2s===true||a.adc===true||a.dac===true||a.vad===true)throw Error('先关闭 VAD、ADC、DAC 和 I²S，再调整共享格式');
  return [step('set_rate '+c.rate,/Rate =/),step('set_bits '+c.bits,/Bits =/),step('set_ch '+c.channels,/ADC channels =/)];
 case 'adc':
  if(!c.adc&&a.recording===true)throw Error('先停止录音，再关闭 ADC');
  if(!c.adc&&a.vad===true)throw Error('先关闭 VAD，再关闭 ADC');
  if(c.adc&&a.vad===true&&a.vadOutput===true)throw Error('VAD 滤波输出正在接管采集流。先关闭 VAD，或改为仅检测，再开启独立 MIC 采集');
  return c.adc?[...(a.i2s===true?[]:[step('i2s_on',/I2S up:|I2S already up/)]),step('adc_on',/ADC on via/),step('adc_mute '+Number(c.adcMute),/ADC mute =/)]:[step('adc_off',/ADC off via/)];
 case 'dac':if(!c.dac&&a.playing===true)throw Error('先停止播放，再关闭 DAC');return c.dac?[...(a.i2s===true?[]:[step('i2s_on',/I2S up:|I2S already up/)]),step('dac_on',/DAC on via/),...planFor('volume',c,a)]:[step('dac_off',/DAC off via/)];
 case 'gain':{
  if(!Number.isInteger(index)||index<0||index>3)throw Error('ADC 通道无效');
  return [step(`adc_gain ${c.gains[index]} ${hex(1<<index)}`,/ADC gain =/),step(`iic_rd ${hex(0x67+index,4)} 1`,/\[0x/,r=>{
   const v=readRegisters(r)[0x67+index],expected=a.adcMute===true?0:128+c.gains[index]*2;
   if(v!==expected)throw Error(`ADC${index} 读回 ${v==null?'缺失':hex(v)}，期望 ${hex(expected)}。检查 ADC 静音或其他主机改写；未自动恢复旧参数。`);
  })];}
 case 'adcMute':return [step('adc_mute '+Number(c.adcMute),/ADC mute =/)];
 case 'volume':return [step('dac_vol '+c.volume,/DAC vol =/),step('dac_vol',/DAC vol =/,r=>{if(!new RegExp('DAC vol = '+c.volume+'(?:\\D|$)').test(r))throw Error('DAC 音量读回不一致');}),step('dac_mute '+Number(c.dacMute),/DAC mute =/)];
 case 'reference':
  if(a.i2s===true||a.adc===true||a.dac===true||a.vad===true)throw Error('回采会改变 TDM 帧宽；请先关闭 VAD、ADC、DAC 和 I²S');
  return [step(`dac_ref ${Number(c.reference)} ${hex(c.referenceChannel)} auto`,/DAC ref =/),step('dac_ref',/DAC ref:/)];
 case 'vad':
  if(c.vad&&a.vad===true&&a.vadOutput!==c.vadOutput)throw Error('VAD 已运行；先关闭，再改变 FIFO 数据输出设置');
  if(c.vad&&c.vadOutput&&(a.adc!==false||a.dac!==false||a.recording===true||a.playing===true||a.scope===true))throw Error('VAD 滤波输出会替换普通采集流。请先停止波形、录放和 ADC / DAC；四路 MIC 采集请保持此选项关闭');
  return [...(c.vad&&a.i2s!==true?[step('i2s_on',/I2S up:|I2S already up/)]:[]),step(c.vad?'vad_on out='+Number(c.vadOutput):'vad_off',c.vad?/VAD started:|VAD is already running/:/VAD stopped|VAD not initialized/,r=>{if(c.vad&&/VAD is already running/.test(r))throw Error('VAD 已在运行，本次输出配置没有生效。先关闭 VAD，再写入新设置。');})];
 default:throw Error('未知设置模块');
 }
}
export function validateStep(st,response){const s=assertResponse(response);if(st.expect&&!st.expect.test(s))throw Error('没有收到预期设备应答：'+st.command);st.verify?.(s);return s;}
export function registerWritePlan(address,value,mask){
 if(!REGISTERS.some(r=>r.address===address&&r.writable))throw Error('该地址仅可读取。低层写入只开放已核对的 ADC/DAC 增益寄存器');
 if(!Number.isInteger(value)||value<0||value>255||!Number.isInteger(mask)||mask<1||mask>255)throw Error('值和掩码必须是 8 位数，掩码不能为零');
 return {address,value,mask};
}
export const maskedWrite=async(address,value,mask,execute)=>{
 const w=registerWritePlan(address,value,mask);
 const send=async(cmd,expect)=>validateStep(step(cmd,expect),await execute(cmd));
 const rd=()=>send(`iic_rd ${hex(w.address,4)} 1`,/\[0x/);
 const old=readRegisters(await rd())[w.address];if(old==null)throw Error('写入前未读到原值，已停止');
 await send(`iic_wr ${hex(w.address,4)} ${hex(w.value)} ${hex(w.mask)}`,/: OK/);
 let after;try{after=readRegisters(await rd())[w.address];}catch{}
 if(after!=null&&(after&w.mask)===(w.value&w.mask))return after;
 let restored=false;
 try{
  await send(`iic_wr ${hex(w.address,4)} ${hex(old)} ${hex(w.mask)}`,/: OK/);
  const v=readRegisters(await rd())[w.address];restored=v!=null&&(v&w.mask)===(old&w.mask);
 }catch{}
 throw Error('寄存器读回不一致。'+(restored?'本次掩码涉及的位已恢复。':'恢复未确认；请检查设备状态。'));
};
export function routeState(c,a,source){
 const vadOutput=source==='draft'?c.vad&&c.vadOutput:a.vad===true&&a.vadOutput===true;
 if(source==='draft')return {adc:c.adc&&!c.adcMute&&!vadOutput,dac:c.dac&&!c.dacMute,vad:c.vad,vadOutput,reference:c.reference&&c.adc&&c.dac&&!vadOutput,channels:c.channels,flow:false,unknown:false};
 return {adc:a.i2s===true&&a.adc===true&&a.adcMute===false&&!vadOutput,dac:a.i2s===true&&a.dac===true&&a.dacMute===false,vad:a.vad===true,vadOutput,reference:a.reference===true&&a.i2s===true&&a.adc===true&&a.dac===true&&!vadOutput,channels:a.channels??0,flow:true,unknown:a.i2s==null};
}

export function telemetry(response,type){
 const found=[];
 for(const line of stripTerminal(response).split('\n'))if(line.startsWith('@A1 ')){
  let value;try{value=JSON.parse(line.slice(4));}catch{throw Error('设备遥测帧损坏');}
  if(value?.type===type)found.push(value);
 }
 if(found.length!==1)throw Error('缺少或重复的设备遥测帧：'+type);
 return found[0];
}
export function applySnapshot(actual,s){
 const booleans=['i2s','adc','dac','reference','vad','vadOutput','sd','recording','playing','scope'];
 const nullable=['adcMute','dacMute','speech'];
 if(s.type!=='state'||booleans.some(k=>typeof s[k]!=='boolean')||nullable.some(k=>s[k]!==null&&typeof s[k]!=='boolean')||!RATES.includes(s.rate)||![16,24].includes(s.bits)||![1,2,3,4].includes(s.channels)||![1,2].includes(s.referenceChannel)||!(s.volume===null||Number.isInteger(s.volume)&&s.volume>=0&&s.volume<=100)||!Number.isInteger(s.uptime_ms)||s.uptime_ms<0||!Number.isInteger(s.triggers)||s.triggers<0||!Array.isArray(s.gainRegisters)||s.gainRegisters.length!==4||s.gainRegisters.some(v=>v!==null&&(!Number.isInteger(v)||v<0||v>255)))throw Error('设备状态帧字段无效');
 if(s.scope_max_ms!==undefined&&(!Number.isInteger(s.scope_max_ms)||s.scope_max_ms<5||s.scope_max_ms>10000))throw Error('设备时间窗范围无效');
 if(s.version!==undefined&&(typeof s.version!=='string'||s.version.length>64))throw Error('固件版本字段无效');
 const next={maxWindowMs:s.scope_max_ms??500,firmwareVersion:s.version??null};for(const k of [...booleans,...nullable,'rate','bits','channels','referenceChannel','volume','triggers'])next[k]=s[k];
 next.gains=s.gainRegisters.map(v=>v===null?null:(v-128)/2);
 next.syncAt=Date.now();next.updated=next.syncAt;next.uptime=s.uptime_ms;
 Object.assign(actual,next);for(let i=0;i<4;i++){if(s.gainRegisters[i]===null)delete actual.registers[0x67+i];else actual.registers[0x67+i]=s.gainRegisters[i];}
 return actual;
}
export function validateWave(w){
 if(w.type!=='wave'||!['adc','dac'].includes(w.source)||!Number.isInteger(w.channel)||w.channel<0||w.channel>(w.source==='dac'?1:4)||typeof w.valid!=='boolean'||!Number.isInteger(w.seq)||w.seq<0||!Number.isInteger(w.age_ms)||w.age_ms< -1||!Array.isArray(w.samples)||w.samples.length>128||w.samples.some(n=>!Number.isInteger(n)||n< -32768||n>32767)||w.valid&&(!RATES.includes(w.rate)||w.samples.length<1||w.age_ms<0||w.age_ms>=500)||!w.valid&&w.samples.length)throw Error('设备波形帧字段无效');
 if(w.duration_ms!==undefined){
  const validPCM=v=>Number.isInteger(v)&&v>=-32768&&v<=32767;
  if(!Number.isFinite(w.duration_ms)||w.duration_ms<4.8||w.duration_ms>10000.1||!Number.isInteger(w.spanFrames)||w.spanFrames<1||w.spanFrames>480000||Math.abs(w.spanFrames-w.duration_ms*w.rate/1000)>1||!Number.isFinite(w.rms)||w.rms<0||w.rms>1||!Number.isFinite(w.peak)||w.peak<w.rms-0.000001||w.peak>1||!Array.isArray(w.min)||!Array.isArray(w.max)||w.min.length!==w.samples.length||w.max.length!==w.samples.length||w.samples.some((v,i)=>!validPCM(w.min[i])||!validPCM(w.max[i])||w.min[i]>v||w.max[i]<v))throw Error('连续时间窗包络字段无效');
  if(w.valid&&Math.abs(w.peak-Math.max(...w.min.map(Math.abs),...w.max.map(Math.abs))/32768)>0.000002)throw Error('包络峰值与电平不一致');
 }
 return w;
}

export function mergeDeviceConfig(config,actual,dirty=new Set()){
 for(const key of ['rate','bits','channels','adc','dac','adcMute','dacMute','volume','reference','referenceChannel','vad','vadOutput'])if(actual[key]!=null&&!dirty.has(key))config[key]=actual[key];
 for(let i=0;i<4;i++)if(actual.adcMute!==true&&Number.isInteger(actual.gains[i])&&actual.gains[i]>=-64&&actual.gains[i]<=63&&!dirty.has('gain'+i))config.gains[i]=actual.gains[i];
 return config;
}

export function zoomVertical(min,max,delta,anchor=.5){
 if(![min,max,delta,anchor].every(Number.isFinite)||min>=max)throw Error('纵轴范围无效');
 anchor=Math.max(0,Math.min(1,anchor));
 const range=Math.max(1/32768,Math.min(8,(max-min)*Math.exp(Math.max(-1000,Math.min(1000,delta))*.0015)));
 const fixed=max-anchor*(max-min),upper=fixed+anchor*range;
 return {min:upper-range,max:upper};
}
