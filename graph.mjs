import {routeState} from './core.mjs';
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderGraph(config,actual,{mode='simple',source='draft',selected=''}={}){
 const state=routeState(config,actual,source),pro=mode==='pro';
 const colors={record:'var(--teal)',play:'var(--amber)',vad:'var(--purple)',reference:'var(--blue)'};
 let nodes=[],edges=[];
 const n=(id,x,y,w,h,title,sub,type='record',enabled=true)=>nodes.push({id,x,y,w,h,title,sub,type,enabled});
 const e=(id,d,type,enabled,label='',lx=0,ly=0)=>edges.push({id,d,type,enabled,label,lx,ly});
 const rate=(source==='draft'?config.rate:actual.rate),bits=(source==='draft'?config.bits:actual.bits);
 const capture=state.adc||state.vadOutput,captureType=state.vadOutput?'vad':'record';
 const format=rate?`${(rate/1000).toLocaleString('en-US',{maximumFractionDigits:3})} kHz / ${bits??'—'} bit`:'格式未读取';
 if(pro){
  n('vad',615,38,180,76,'HARDWARE VAD',state.vad?'检测已选用':'ADC0 · 事件 / FIFO','vad',state.vad);
  n('interrupt',1000,38,170,76,'INT → GPIO7','S31 中断事件','vad',state.vad);
  n('clock',80,38,190,76,'40 MHz / I²S','时钟、位深与通道数','reference');
  for(let i=0;i<4;i++){
   const y=150+i*82,enabled=state.adc&&i<state.channels;
   const gain=source==='draft'?config.gains[i]:actual.gains[i];
   n('mic'+i,80,y,170,72,'MIC '+i,['ADC0 · FL','ADC1 · FR','ADC2 · BL','ADC3 · BR'][i],'record',enabled);
   n('adc'+i,330,y,150,72,'ΣΔ ADC '+i,'模拟采集','record',enabled);
   n('gain'+i,550,y,160,72,'GAIN / MUTE',gain==null?'增益未读取':gain+' dB','record',enabled);
   e('mic'+i,`M250 ${y+36} H330`,'record',enabled);
   e('adc'+i,`M480 ${y+36} H550`,'record',enabled);
   e('gain'+i,`M710 ${y+36} H810`,'record',enabled);
  }
  n('tdm',810,150,180,318,'TDM / I²S',state.vadOutput?'VAD 滤波输出':`${state.channels||'—'} MIC${(source==='draft'?config.reference:actual.reference)?' + RE':''}`,captureType,capture);
  n('host',1210,264,220,90,'ESP32-S31','USB · 主控采集',captureType,capture);
  n('sd',1210,390,220,76,'microSD WAV','板端录音 / 播放','reference',actual.sd===true||source==='draft');
  e('capture','M990 309 H1210',captureType,capture,'SDOUT',1080,293);
  e('sd','M1320 354 V390','record',source==='draft'?state.adc:actual.recording===true,'录音',1334,382);
  e('vad-input','M405 150 V76 H615','vad',state.vad,'ADC0',500,62);
  e('vad-stream','M705 114 V132 H900 V150','vad',state.vadOutput,'滤波输出',850,126);
  e('vad-event','M795 76 H1000','vad',state.vad,'检测事件',882,62);
  e('interrupt','M1170 76 H1470 V309 H1430','vad',state.vad);
  n('playback',80,550,190,80,'S31 / PLAYBACK','主控数字音频','play',state.dac);
  n('volume',370,550,180,80,'DAC VOLUME',`${source==='draft'?config.volume:actual.volume??'—'} / 100`,'play',state.dac);
  n('dac',650,550,180,80,'STEREO DAC','LEFT / RIGHT','play',state.dac);
  n('output',1130,550,230,80,'HEADPHONE / LINE','双声道模拟输出','play',state.dac);
  n('reference',910,482,190,60,'DAC REFERENCE',`${(source==='draft'?config.referenceChannel:actual.referenceChannel)===2?'右':'左'}声道 → RE`,'reference',state.reference);
  e('play-in','M270 590 H370','play',state.dac,'SDIN',315,574);
  e('play-volume','M550 590 H650','play',state.dac);
  e('play-out','M830 590 H1130','play',state.dac,'LOUT / ROUT',970,574);
  e('reference-in','M870 590 V512 H910','reference',state.reference);
  e('reference-return','M1005 482 V458 H990','reference',state.reference,'回采槽',1070,475);
 }else{
  n('mic0',80,170,200,104,'四路模拟麦克风','MIC0 / MIC1 / MIC2 / MIC3','record',state.adc);
  n('adc',390,170,220,104,'A1 · ADC',`${state.channels||'—'} 路输入 · 独立增益`,'record',state.adc);
  n('tdm',770,170,210,104,'TDM / I²S',state.vadOutput?'VAD 滤波输出':format,captureType,capture);
  n('host',1140,170,230,104,'ESP32-S31','主控采集 · microSD',captureType,capture);
  n('vad',610,20,210,84,'硬件 VAD','ADC0 检测 · FIFO','vad',state.vad);
  n('interrupt',1020,20,210,84,'INT → GPIO7','语音活动事件','vad',state.vad);
  e('input','M280 222 H390','record',state.adc);
  e('adc-data','M610 222 H770','record',state.adc,'采集数据',690,205);
  e('host-data','M980 222 H1140',captureType,capture,'SDOUT',1058,205);
  e('vad-input','M500 170 V62 H610','vad',state.vad,'ADC0',530,47);
  e('vad-stream','M715 104 V130 H875 V170','vad',state.vadOutput,'滤波输出',845,122);
  e('vad-event','M820 62 H1020','vad',state.vad);
  e('interrupt','M1230 62 H1410 V222 H1370','vad',state.vad);
  n('playback',80,480,200,104,'S31 · 数字播放','I²S 输入','play',state.dac);
  n('volume',390,480,220,104,'播放音量 / 静音',`${source==='draft'?config.volume:actual.volume??'—'} / 100`,'play',state.dac);
  n('dac',770,480,210,104,'A1 · 双声道 DAC','LEFT / RIGHT','play',state.dac);
  n('output',1140,480,230,104,'耳机 / Line Out','模拟输出','play',state.dac);
  n('reference',1000,330,230,88,'DAC 回采参考','左 / 右择一路 → RE','reference',state.reference);
  e('play-in','M280 532 H390','play',state.dac,'SDIN',335,515);
  e('play-volume','M610 532 H770','play',state.dac);
  e('play-out','M980 532 H1140','play',state.dac,'LOUT / ROUT',1060,515);
  e('reference-in','M1040 532 V418','reference',state.reference);
  e('reference-return','M1115 330 V300 H875 V274','reference',state.reference,'回采数据',1010,285);
 }
 const marker=(type,on)=>`<marker id="arrow-${type}-${on}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${on?colors[type]:'var(--off-line,#8c9ba3)'}"/></marker>`;
 const markers=Object.keys(colors).flatMap(t=>[marker(t,true),marker(t,false)]).join('');
 return `<svg id="audioGraph" viewBox="0 0 1530 ${pro?700:680}" role="img" aria-labelledby="graphTitle graphDesc"><title id="graphTitle">ESP32-A1 ${pro?'专业':'简易'}音频链路</title><desc id="graphDesc">四路 ADC、双声道 DAC、ADC0 硬件 VAD 和 DAC 回采。${source==='draft'?'当前为未下发草稿':'当前为设备应答；未知状态不点亮'}。点击模块在左侧设置。</desc><defs>${markers}</defs>
 <text class="lane-label" x="80" y="${pro?140:142}">01　模拟输入与采集</text><text class="lane-label" x="80" y="${pro?520:450}">02　播放与模拟输出</text>
 ${edges.map(x=>`<g data-edge="${x.id}" class="edge ${x.enabled?'enabled':'disabled'} ${x.enabled&&state.flow?'flow':''}" style="--path-color:${colors[x.type]}"><path class="edge-halo" d="${x.d}"/><path class="edge-line" d="${x.d}" marker-end="url(#arrow-${x.type}-${x.enabled})"/>${x.enabled&&state.flow?`<path class="edge-motion" d="${x.d}"/>`:''}${x.label?`<text class="edge-label" x="${x.lx}" y="${x.ly}" text-anchor="middle">${esc(x.label)}</text>`:''}</g>`).join('')}
 ${nodes.map(x=>`<g class="graph-node ${x.type} ${x.enabled?'on':'off'} ${selected===x.id?'selected':''}" data-node="${x.id}" role="button" tabindex="0" aria-label="设置 ${esc(x.title)}" transform="translate(${x.x} ${x.y})"><rect width="${x.w}" height="${x.h}" rx="9"/><circle class="state-mark" cx="13" cy="14" r="3"/><text class="node-title" x="${x.w/2}" y="${x.h/2-6}" text-anchor="middle">${esc(x.title)}</text><text class="node-sub" x="${x.w/2}" y="${x.h/2+18}" text-anchor="middle">${esc(x.sub)}</text></g>`).join('')}
 <text class="graph-note" x="80" y="${pro?676:646}">RE 是 DAC 回采参考，不是第五只麦克风。VAD 事件与主控算法分别处理。</text><text class="graph-note" x="1440" y="${pro?676:646}" text-anchor="end">${source==='draft'?'CONFIGURATION DRAFT':'DEVICE RESPONSE · NOT AN AUDIO METER'}</text></svg>`;
}
