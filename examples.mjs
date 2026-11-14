import {DEFAULTS,clone,validateConfig,planFor,validateStep} from './core.mjs';

export const EXAMPLES=[
 {id:'microphones',title:'四路麦克风',detail:'开启四路输入并显示 ADC0 实时波形。',format:'48 kHz · 24 bit · 4 MIC · 0 dB',settings:{adc:true},scope:['adc',0]},
 {id:'voice',title:'语音与 VAD',detail:'单路输入加 6 dB，开启 VAD 仅检测，保留实时波形。',format:'16 kHz · 16 bit · 1 MIC · +6 dB',settings:{rate:16000,bits:16,channels:1,adc:true,gains:[6,0,0,0],vad:true},scope:['adc',0]},
 {id:'recording',title:'录制 10 秒',detail:'配置双路输入、挂载 SD，直接开始录音并显示进度。',format:'16 kHz · 16 bit · 2 MIC · WAV',settings:{rate:16000,bits:16,channels:2,adc:true},recordSeconds:10,sd:true,panel:'sd'},
 {id:'playback',title:'文件播放准备',detail:'配置双声道 DAC，音量设为 20，并读取 SD 文件列表。',format:'16 kHz · 16 bit · DAC · 20 / 100',settings:{rate:16000,bits:16,channels:2,dac:true,volume:20},sd:true,panel:'sd'},
 {id:'duplex',title:'双向采集与回采',detail:'开启四路 MIC、双声道 DAC 和左声道 RE 参考。',format:'48 kHz · 24 bit · 4 MIC + RE',settings:{adc:true,dac:true,reference:true,volume:20},scope:['adc',0]},
 {id:'stop',title:'停止全部音频',detail:'停止录放和监测，关闭 VAD、ADC、DAC 与 I²S。',format:'STOP',stop:true}
];

export function exampleById(id){const e=EXAMPLES.find(e=>e.id===id);if(!e)throw Error('未知示例');return e;}
export function exampleConfig(id){const e=exampleById(id);return e.stop?null:validateConfig({...clone(DEFAULTS),adc:false,dac:false,reference:false,vad:false,vadOutput:false,...clone(e.settings)});}

function preflight(capabilities,commands){
 const missing=commands.filter(c=>!capabilities.has(c));
 if(missing.length)throw Error('当前固件缺少示例所需接口：'+missing.join(', '));
}
function optionsFor(target,options){
 return ['web_status','vad_off','adc_off','adc_mute','dac_off','dac_mute','i2s_off',
  ...(!target?['rec_off','play_off']:['set_rate','set_bits','set_ch','dac_ref','i2s_on',
   ...(target.adc?['adc_on','adc_gain','iic_rd']:[]),...(target.dac?['dac_on','dac_vol']:[]),...(target.vad?['vad_on']:[])]),
  ...(options.sd?['sdcard_on','fls']:[]),...(options.recordSeconds?['rec_on','web_record_status']:[]),...(options.scope?['web_scope']:[])];
}

// The caller owns command serialization and updates getState() from actual
// device responses. Configuration values never stand in for device state.
export async function applySetup(input,{send,getState,capabilities,armed=false,onStep=()=>{},...options}){
 const target=input?validateConfig(input):null;
 if(target?.vad&&target.vadOutput&&(target.adc||target.dac))throw Error('VAD 专用输出不能与普通 ADC 或 DAC 示例混用');
 preflight(capabilities,optionsFor(target,options));
 const command=async(cmd,expect)=>{onStep(cmd);return validateStep({command:cmd,expect},await send(cmd));};
 await command('web_status');
 let state=getState();
 if(['i2s','adc','dac','vad','recording','playing','sd'].some(k=>typeof state[k]!=='boolean'))throw Error('设备状态不完整，示例未执行');
 if(target&&(state.recording||state.playing||armed))throw Error('先停止当前录放或触发录音，再应用示例');
 if(!target){
  if(state.recording||armed)await command('rec_off');
  if(state.playing)await command('play_off');
  const deadline=Date.now()+10000;
  do{
   await command('web_status');state=getState();if(!state.recording&&!state.playing)break;
   if(Date.now()>=deadline)throw Error('录放尚未停止，未关闭音频通路');
   await new Promise(r=>setTimeout(r,100));
  }while(true);
 }
 if(capabilities.has('web_scope'))await command('web_scope stop');
 if(state.vad)await command('vad_off',/VAD stopped|VAD not initialized/);
 if(state.adc){await command('adc_mute 1',/ADC mute = 1/);await command('adc_off',/ADC off via/);}
 if(state.dac){await command('dac_mute 1',/DAC mute = 1/);await command('dac_off',/DAC off via/);}
 if(state.i2s)await command('i2s_off',/I2S channels down/);
 await command('web_status');state=getState();
 if(state.i2s||state.adc||state.dac||state.vad||state.recording||state.playing)throw Error('音频通路未完全停止，未继续写入配置');
 if(!target)return {state};
 const apply=async(kind,index=0)=>{for(const step of planFor(kind,target,getState(),index)){onStep(step.command);validateStep(step,await send(step.command));}};
 await apply('clock');await apply('reference');
 if(target.adc)await apply('adc');
 if(target.dac)await apply('dac');
 if(target.vad)await apply('vad');
 if(target.adc)for(let i=0;i<target.channels;i++)await apply('gain',i);
 if(options.sd)await command('sdcard_on',/SD card (?:already )?mounted/);
 await command('web_status');state=getState();
 if(state.i2s!==!!(target.adc||target.dac||target.vad))throw Error('示例配置读回不一致：I²S');
 for(const key of ['rate','bits','channels','reference','referenceChannel','adc','dac','vad'])if(state[key]!==target[key])throw Error('示例配置读回不一致：'+key);
 if(target.adc&&state.adcMute!==target.adcMute||target.dac&&(state.dacMute!==target.dacMute||state.volume!==target.volume)||target.vad&&state.vadOutput!==target.vadOutput||options.sd&&!state.sd)throw Error('示例配置读回不一致：开关或音量');
 if(target.adc&&!target.adcMute)for(let i=0;i<target.channels;i++)if(state.gains[i]!==target.gains[i])throw Error('示例配置读回不一致：增益');
 return {config:target,state};
}

export async function applyExample(id,options){const example=exampleById(id);return {...await applySetup(exampleConfig(id),{...options,sd:example.sd,scope:example.scope,recordSeconds:example.recordSeconds}),example};}
