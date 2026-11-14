import {VERSION,DEFAULTS,RATES,REGISTERS,clone,validateConfig,newActual,planFor,validateStep,parseState,maskedWrite,hex,stripTerminal,serialLogLines,telemetry,applySnapshot,validateWave,mergeDeviceConfig,zoomVertical} from './core.mjs';
import {EXAMPLES,applyExample,applySetup} from './examples.mjs';
import {A1Serial} from './serial.mjs';
import {FIELD_LABELS,editDraft,pendingDraft,moduleFields,moduleSubmission,completeSubmission,revertDraft,formatSetting,explainFailure} from './workbench.mjs';
import {installLanguage} from './i18n.mjs';
import {renderGraph} from './graph.mjs';
import {GraphViewport} from './viewport.mjs';
import {recordingTag,validWavPath,parseFileList,wavInfo,wavTransferInfo,playbackGuard,mediaEvent,canSaveFifo,recordingSeconds,wavDeviceInfo,recordingStatus,fileSize} from './media.mjs';

const $=s=>document.querySelector(s);
document.title='ESP32-A1 Audio Lab · v'+VERSION;$('.version').textContent='v'+VERSION;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dirtyFields=new Set();
const media={files:[],playPath:'',recordSeconds:5,pending:null,lastRecording:null,needsList:false,error:null,recordStatus:null};
let lastOperation={text:'',error:false},highlightPath=true,importedConfig=null,lastExampleName='',renderedGraph='';
try{const saved=localStorage.getItem('a1-lab-mode');if(saved==='pro')queueMicrotask(()=>{mode='pro';draw();});}catch{}
let yAutomatic=true,yBounds={min:-1,max:1};
let timeWindowMs=50;try{const saved=Number(localStorage.getItem("a1-scope-window"));if(saved>=5&&saved<=10000)timeWindowMs=Math.round(saved);}catch{}
let monitor=null,pollTimer=null,lastSync=0,polling=false,waveFrame=null,waveAt=0;
let config=clone(DEFAULTS),actual=newActual(),mode='simple',source='device',selected='',applyKind='',gainIndex=0,busy=false,logs=[],partial='',registerAddress=0x67;
const graphView=new GraphViewport($('#graphScroll'),$('#graph'),{overlays:[$('#inspector'),$('#wavePanel')],onChange:(view,auto)=>{$('#zoomText').textContent=Math.round(view.scale*100)+'%';$('#fit').setAttribute('aria-pressed',String(auto));}});
const serial=new A1Serial({onData:receive,onDisconnect:()=>{media.recordStatus=null;media.pending=null;monitor=null;waveFrame=null;clearTimeout(pollTimer);actual=newActual();setConnection(false);paintWave('设备已断开');draw();}});
function log(text,kind='device'){
 logs.push({time:new Date().toISOString(),kind,text});if(logs.length>500)logs.shift();
 if(selected==='log')$('#serialLog').textContent=logText();
}
const logText=()=>logs.map(x=>`${x.time.slice(11,23)} ${x.kind==='send'?'→':'←'} ${x.text}`).join('\n');
function receive(text){
 const clean=stripTerminal(text);
 partial=(partial+clean).slice(-32768);const end=partial.lastIndexOf('\n');
 if(end>=0){const lines=serialLogLines(partial.slice(0,end+1)).join('\n');partial=partial.slice(end+1);if(lines.trim()){log(lines);
  for(const line of lines.split('\n')){const event=mediaEvent(line);
   if(event?.type==='record-start'&&media.pending&&event.path.includes(media.pending.tag)){media.lastRecording=event.path;media.recordStatus=null;media.pending.armed=false;}
   if(event?.type==='record-done'){media.needsList=true;media.lastRecording=event.path;if(media.pending&&event.path.includes(media.pending.tag)){if(media.playPath===media.pending.previousPath)media.playPath=event.path;media.pending=null;}if(event.overflow){media.error='录音发生 RX 溢出，请检查通信记录；文件不能视为完整采样。';status(media.error,true);}}
   if(event?.type==='error'){media.error=event.message;status(event.message,true);}
  }
  try{parseState(actual,'',lines);}catch{}draw();syncMediaPanel();
 }}
}
function status(text,error=false){
 lastOperation={text,error};$('#operationStatus').textContent=text;$('#operationStatus').classList.toggle('error',error);
 const failure=error?explainFailure(Error(text)):null;
 $('#workspaceNotice').hidden=!error;$('#workspaceNotice').dataset.state=error?'error':busy?'busy':'info';
 $('#workspaceStatus').textContent=failure?.title||text;$('#workspaceHint').textContent=failure?.hint||'';$('#workspaceLog').hidden=!error;
}
function renderDrafts(){
 const entries=pendingDraft(config,actual,dirtyFields),keys=moduleFields(applyKind,gainIndex),local=entries.filter(e=>keys.includes(e.key));
 $('#moduleDraft').hidden=!local.length;
 $('#moduleDraft').innerHTML=local.length?`<div class="draft-title"><strong>有未应用更改 · ${local.length}</strong><button id="revertModule" class="plain" ${local.some(e=>e.device!==null)?'':'disabled'}>撤销修改</button></div>`:'';
}

function setConnection(ready){
 $('#connectionText').innerHTML=`<i class="dot ${ready?'ready':''}"></i>${ready?'a1_cli 已识别':'未连接 / 待重新识别'}`;
 $('#connect').textContent=serial.port?'断开连接':'连接开发板';
 $('#refresh').disabled=!ready||busy;
 $('#deviceMeta').textContent='固件：'+(actual.firmwareVersion??'未读取');
 $('#liveSync').textContent=ready?(serial.capabilities?.has('web_status')?(actual.syncAt?'状态实时同步 · '+new Date(actual.syncAt).toLocaleTimeString():'正在读取设备状态'):'当前固件无实时遥测接口'):'设备未连接';
 $('#showExamples').disabled=busy;$('#waveChannel').disabled=busy;$('#stopWave').disabled=busy;
 document.querySelectorAll('#panelBody input,#panelBody select,#revertModule,#importConfig').forEach(el=>{el.disabled=busy;});
 $('#apply').disabled=!ready||busy||!!$('#panelBody').querySelector('[data-field]:invalid');
 document.querySelectorAll('[data-example],#applyImported').forEach(b=>{b.disabled=!ready||busy;});
 const verbs={'reg-write':'iic_wr','sd-on':'sdcard_on','sd-off':'sdcard_off','record':'rec_on','record-stop':'rec_off','play':'play_on','play-stop':'play_off','vad-save':'vad_wav','vad-prepare':'rec_prepare','list-files':'fls'};
 document.querySelectorAll('[data-scope]').forEach(b=>{b.disabled=!ready||busy||!serial.capabilities?.has('web_scope');});
 document.querySelectorAll('[data-action]').forEach(b=>{const missing=ready&&verbs[b.dataset.action]&&!serial.capabilities?.has(verbs[b.dataset.action]);const fifoBlocked=b.dataset.action==='vad-save'&&!canSaveFifo(actual);const bufferedMissing=['record','vad-prepare'].includes(b.dataset.action)&&ready&&!serial.capabilities?.has('web_record_status');const recordBusy=b.dataset.action==='record'&&actual.recording===true;b.disabled=!ready||busy||missing||fifoBlocked||bufferedMissing||recordBusy;b.title=bufferedMissing?'SD 录音需要 v0.4.2 或更新的缓冲录音固件':recordBusy?'录音正在进行':missing?'当前固件未提供此命令':fifoBlocked?'FIFO 保存需要挂载 SD 并启用 VAD 专用滤波输出模式':'';});
}
function draw(){
 const focused=document.activeElement?.closest('[data-node]')?.dataset.node;
 const markup=renderGraph(config,actual,{mode,source,selected,highlight:highlightPath});
 if(markup!==renderedGraph){$('#graph').innerHTML=markup;renderedGraph=markup;}
 graphView.setSize(1530,mode==='pro'?820:840);
 const c=actual;
 $('#formatText').textContent=`${c.rate?Number(c.rate/1000).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:3}):'—'} kHz · ${c.bits??'—'} bit · ${c.channels??'—'} MIC`;
 $('#sourceNote').textContent=serial.ready?(lastExampleName?'已应用：'+lastExampleName:'链路跟随设备状态'):'连接设备后显示实际链路';
 document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));
 if(focused)document.querySelector(`[data-node="${focused}"]`)?.focus({preventScroll:true});
 syncPanel();renderDrafts();syncMediaPanel();setConnection(serial.ready);queueMicrotask(updateDockLayout);
}
function syncPanel(){
 document.querySelectorAll('#panelBody [data-field]').forEach(el=>{const k=el.dataset.field;const v=/^gain[0-3]$/.test(k)?config.gains[+k.at(-1)]:config[k];if(v===undefined||document.activeElement===el)return;if(el.type==='checkbox')el.checked=v;else el.value=v;const o=$('#out-'+k);if(o)o.textContent=v+' '+(el.dataset.unit||'');});
 if(source==='device')for(let i=0;i<4;i++){const b=$('[data-open="gain'+i+'"]');if(b)b.textContent='ADC'+i+'　'+(actual.gains[i]??'—')+' dB';}

 if(selected==='registers'){
  const v=$('.reg-value');if(v)v.textContent=actual.registers[registerAddress]==null?'—':hex(actual.registers[registerAddress]);
  document.querySelectorAll('[data-reg]').forEach(b=>{b.querySelector('b').textContent=actual.registers[+b.dataset.reg]==null?'—':hex(actual.registers[+b.dataset.reg]);});
  return;
 }
 const r=$(['host','sd','playback'].includes(selected)?'#mediaState':'#panelBody .readout');if(!r)return;let text='';
 if(/^gain[0-3]$/.test(selected)||(/^mic[0-3]$/.test(selected)&&mode==='pro'))text='设备读回：'+(actual.gains[gainIndex]==null?'尚未读取':actual.gains[gainIndex]+' dB')+'<br>寄存器：'+hex(0x67+gainIndex,4);
 else if(selected==='adc'||selected==='mic0'||/^adc[0-3]$/.test(selected))text='ADC 通路应答：'+known(actual.adc)+'<br>静音应答：'+known(actual.adcMute);
 else if(['volume','dac','output'].includes(selected))text='设备音量：'+(actual.volume??'—')+' / 100<br>DAC 通路：'+known(actual.dac)+'<br>静音应答：'+known(actual.dacMute);
 else if(['clock','tdm'].includes(selected))text='I²S 应答：'+known(actual.i2s)+'<br>EV Board：SDA 46 / SCL 45<br>BCLK 37 / WS 1 / DOUT 35 / DIN 6<br>Codec I²C：7-bit 0x2C';
 else if(selected==='reference')text='回采配置应答：'+known(actual.reference)+'<br>当前采集布局：'+['FL','FR','BL','BR'].slice(0,actual.channels??0).concat(actual.reference?['RE']:[]).join(' · ');
 else if(['vad','interrupt'].includes(selected))text='VAD 应答：'+known(actual.vad)+'<br>滤波音频输出：'+known(actual.vadOutput);
 else if(['host','sd','playback'].includes(selected))text='SD：'+known(actual.sd)+'<br>录音：'+known(actual.recording)+'<br>播放：'+known(actual.playing);
 if(text)r.innerHTML=text;
 if(['vad','interrupt'].includes(selected)){
  const v=$('.micro-number');if(v)v.innerHTML=`${actual.speech==null?'—':actual.speech?'检测到活动':'无活动'}<br><small>设备事件计数 ${actual.triggers??'—'}</small>`;
 }
}
async function listMedia(){if(actual.sd!==true)throw Error('先挂载 microSD');media.files=parseFileList(await command('fls /sdcard'));syncMediaPanel();}
function syncMediaPanel(){
 const list=$('#sdFiles');if(!list)return;
 const markup=media.files.length?media.files.map(f=>`<button class="media-file" data-media-path="${esc(f.path)}" aria-pressed="${f.path===media.playPath}"><span>${esc(f.path.slice(8))}</span><small>${fileSize(f.bytes)}</small></button>`).join(''):'<p>尚无 WAV 文件；可先录制，或读取 SD 文件列表。</p>';
 if(list.dataset.source!==markup){list.dataset.source=markup;list.innerHTML=markup;}
 const progress=$('#recordProgress'),rs=media.recordStatus;if(progress){progress.hidden=!rs||!rs.frameBytes;if(rs?.frameBytes){const clock=n=>`${Math.floor(n/60).toString().padStart(2,'0')}:${Math.floor(n%60).toString().padStart(2,'0')}`;const captured=rs.capturedBytes/(rs.rate*rs.frameBytes),target=rs.targetBytes/(rs.rate*rs.frameBytes);progress.innerHTML=`<span>录音进度</span> ${clock(captured)}${target?' / '+clock(target):''}<br><small>已写入 ${(rs.writtenBytes/1048576).toFixed(2)} MiB</small><progress max="1" value="${target?Math.min(1,captured/target):0}"></progress>`;}}
 const last=$('#recordFile');last.hidden=!media.lastRecording;if(media.lastRecording)last.textContent='最近录音：'+media.lastRecording;
 const input=$('#playPath');if(input&&document.activeElement!==input)input.value=media.playPath;
}
function field(label,key,content){return `<label class="field"><span>${label}</span>${content}</label>`;}
function select(label,key,values,value=config[key]){return field(label,key,`<select data-field="${key}" aria-label="${label}">${values.map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}</select>`);}
function toggle(label,key){return `<label class="toggle"><span>${label}</span><input type="checkbox" data-field="${key}" ${config[key]?'checked':''} aria-label="${label}"></label>`;}
function range(label,key,min,max,value,unit=''){return `<div class="field"><label for="range-${key}">${label}<output id="out-${key}">${value} ${unit}</output></label><div class="range-number"><input id="range-${key}" type="range" min="${min}" max="${max}" step="1" value="${value}" data-field="${key}" data-unit="${unit}" aria-label="${label}"><input type="number" required min="${min}" max="${max}" step="1" value="${value}" data-field="${key}" data-unit="${unit}" aria-label="${label} · 数值"></div></div>`;}
const action=(id,text)=>`<button data-action="${id}">${text}</button>`;
const note=s=>`<div class="notice">${s}</div>`;
const readout=s=>`<div class="readout">${s}</div>`;
const known=v=>v==null?'未知':v?'开启':'关闭';
function panel(key){
 selected=key;applyKind='';$('#inspector').hidden=false;$('#toolMenu').hidden=true;
 let title='',category='MODULE SETTINGS',body='';
 if(/^gain[0-3]$/.test(key)||(/^mic[0-3]$/.test(key)&&mode==='pro')){
  gainIndex=+key.at(-1);title='ADC'+gainIndex+' · 输入增益';category='RECORD / CHANNEL '+gainIndex;applyKind='gain';
  body=`<p>逐通道数字增益。这里的 dB 不是模拟麦克风 PGA 指标。当前 CLI 接受整数 dB。</p>${range('通道增益','gain'+gainIndex,-64,63,config.gains[gainIndex],'dB')}${readout('设备读回：'+(actual.gains[gainIndex]==null?'尚未读取':actual.gains[gainIndex]+' dB')+'<br>寄存器：'+hex(0x67+gainIndex,4))}<div class="button-row">${action('read-gain','读取通道增益')}</div>${note('写入后读取对应增益寄存器核对。ADC 静音时，硬件增益寄存器会被驱动置零。')}`;
 }else if(key==='adc'||key==='mic0'||/^adc[0-3]$/.test(key)){
  title='麦克风与四路 ADC';category='RECORD / ANALOG INPUT';applyKind='adc';
  body=`<p>四路模拟麦克风共用当前采样格式。选择通道可分别调整增益。</p>${toggle('打开 ADC 采集通路','adc')}<div class="channel-grid">${[0,1,2,3].map(i=>`<button data-open="gain${i}">ADC${i}　${config.gains[i]} dB</button>`).join('')}</div>${toggle('ADC 静音','adcMute')}<div class="button-row">${action('read-gains','读取四路增益')}</div>${readout('ADC 通路应答：'+known(actual.adc)+'<br>静音应答：'+known(actual.adcMute))}${note('先在时钟模块配置格式。写入开启 ADC 时会自动启动 I²S；静音开启时不会有麦克风信号。运行 VAD 时请先停 VAD 再关闭 ADC。')}`;
 }else if(key==='volume'||key==='dac'||key==='output'){
  title='双声道播放';category='PLAYBACK / DAC';applyKind='dac';
  body=`${range('播放音量','volume',0,100,config.volume,'/ 100')}${toggle('DAC 静音','dacMute')}${toggle('打开 DAC 通路','dac')}<div class="button-row">${action('read-volume','读取音量')}</div>${readout('设备音量：'+(actual.volume??'—')+' / 100<br>DAC 通路：'+known(actual.dac)+'<br>静音应答：'+known(actual.dacMute))}${note('音量控制同时作用于左右声道。写入音量后调用驱动 getter 核对；静音使用设备命令应答确认。')}`;
 }else if(key==='clock'||key==='tdm'){
  title='时钟与 TDM 格式';category='INTERFACE / SHARED FORMAT';applyKind='clock';
  body=`${select('采样率','rate',RATES.map(v=>[v,(v/1000)+' kHz']))}${select('音频位深','bits',[[16,'16 bit'],[24,'24 bit']])}${select('模拟输入通道','channels',[[1,'1 路 MIC'],[2,'2 路 MIC'],[3,'3 路 MIC'],[4,'4 路 MIC']])}<div class="button-row">${action('i2s-on','启动 I²S')}${action('i2s-off','关闭 I²S')}</div>${readout('I²S 应答：'+known(actual.i2s)+'<br>EV Board：SDA 46 / SCL 45<br>BCLK 37 / WS 1 / DOUT 35 / DIN 6<br>Codec I²C：7-bit 0x2C')}${note('更改格式前关闭 VAD、ADC、DAC 和 I²S。回采开启时，采集槽增加 RE；播放槽仍只覆盖自己的左右声道。外部 40 MHz 与 Host MCLK 不能混为一谈。')}<button class="plain" data-open="reference">设置 DAC 回采 →</button>`;
 }else if(key==='reference'){
  title='DAC 回采参考';category='REFERENCE / RE CHANNEL';applyKind='reference';
  body=`<p>从 DAC 左右声道选一路，作为采集流里的 RE 参考槽。RE 可供主控侧 AEC 使用。</p>${toggle('启用 DAC 回采','reference')}${select('参考声道','referenceChannel',[[1,'DAC 左声道'],[2,'DAC 右声道']])}${readout('回采配置应答：'+known(actual.reference)+'<br>采集布局：'+['FL','FR','BL','BR'].slice(0,actual.channels??0).concat(actual.reference?['RE']:[]).join(' · '))}${note('这是回采路径，不表示 A1 已执行回声消除。修改前需关闭 VAD、ADC、DAC 和 I²S；采集 RE 时需保持 DAC 数据通路工作。')}`;
 }else if(key==='vad'||key==='interrupt'){
  title='硬件 VAD';category='DETECTION / ADC0';applyKind='vad';
  body=`<p>ADC0 检测语音活动，经 A1 INT 通知 S31。录音触发需要先准备录音任务。</p>${toggle('启用 VAD 检测','vad')}${toggle('VAD 滤波输出 · 专用模式','vadOutput')}<div class="micro-number">${actual.speech==null?'—':actual.speech?'检测到活动':'无活动'}<br><small>设备事件计数 ${actual.triggers??'—'}</small></div><div class="button-row">${action('vad-status','读取 VAD 状态')}${action('vad-save','保存 FIFO 到 SD')}</div><div class="button-row">${action('vad-prepare','准备 5 秒触发录音')}</div>${readout('VAD 应答：'+known(actual.vad)+'<br>滤波音频输出：'+known(actual.vadOutput))}${note('普通 MIC 采集请关闭“VAD 滤波输出”，仅启用检测。滤波输出会接管 I²S 数据，不再是四路独立 MIC；需先停止波形、录放和 ADC / DAC。FIFO 保存只在专用滤波输出模式可用，也不等于连续预录音。')}`;
 }else if(key==='host'||key==='sd'||key==='playback'){
  title='录音与文件播放';category='HOST / microSD';
  body=`<p>录音和播放由开发板执行，文件保存在板上的 microSD。</p><div class="button-row">${action('sd-on','挂载 microSD')}${action('sd-off','卸载 microSD')}</div>${field('目标录音时长 / 秒','',`<input id="recordSeconds" type="number" required min="1" max="1800" value="${media.recordSeconds}" aria-label="目标录音时长 / 秒">`)}<div class="button-row">${action('record','开始录音')}${action('record-stop','停止录音')}</div><div id="recordProgress" class="readout" hidden></div><div id="recordFile" class="readout" hidden></div><div class="button-row">${action('list-files','读取 SD 文件列表')}</div><div id="sdFiles" class="sd-files"></div>${field('开发板 WAV 路径','',`<input id="playPath" type="text" value="${esc(media.playPath)}" aria-label="开发板 WAV 路径" spellcheck="false">`)}<div class="button-row">${action('play','开始播放')}${action('play-stop','停止播放')}</div><div id="mediaState" class="readout">SD：${known(actual.sd)}<br>录音：${known(actual.recording)}<br>播放：${known(actual.playing)}</div>${note('每次录音使用独立文件名。直接回放请录制单声道或双声道 WAV；多通道文件需先导出选取声道。缓冲录音固件按采样帧计时，单次最长 30 分钟；回放前会核对共享格式。')}`;
 }else if(key==='registers'){
  title='寄存器';category='PRO / REGISTER INSPECTOR';
  const reg=REGISTERS.find(x=>x.address===registerAddress);
  body=`<p>16 位地址、8 位数据。读取会访问板上 A1；不存在或未初始化的接口会返回错误。</p>${select('寄存器','registerAddress',REGISTERS.map(r=>[r.address,hex(r.address,4)+' · '+r.name]),registerAddress)}<div class="reg-value">${actual.registers[registerAddress]==null?'—':hex(actual.registers[registerAddress])}</div><div class="button-row">${action('reg-read','读取寄存器')}</div>${reg?.writable?`${field('写入值 / hex','',`<input id="regValue" type="text" value="80" aria-label="寄存器写入值" spellcheck="false">`)}${field('位掩码 / hex','',`<input id="regMask" type="text" value="ff" aria-label="寄存器位掩码" spellcheck="false">`)}<div class="button-row">${action('reg-write','掩码写入并核对')}</div>${note('仅开放已核对的增益寄存器。直接写入会绕过驱动缓存；常规调节请使用增益模块。读回不一致时尝试恢复本次涉及的位。')}`:note('此地址只读。复位、时钟、校准、eFuse 与未核对字段不开放写入。')}<div class="reg-list">${REGISTERS.map(r=>`<button data-reg="${r.address}"><span>${hex(r.address,4)}　${esc(r.name)}</span><b>${actual.registers[r.address]==null?'—':hex(actual.registers[r.address])}</b></button>`).join('')}</div>`;
 }else if(key==='connection'){
  title='连接与板卡';category='DEVICE / ESP32-A1 EV BOARD';
  body=`<span class="chip-tag">S31 主控 → I²C / I²S → A1 Codec</span><p style="margin-top:18px">使用桌面 Chrome / Edge，连接 EV Board 的 USB 数据口，然后选择对应串口。网页会读取 help 并核对命令，再开放写入。</p>${readout('网页：v'+VERSION+'<br>固件：'+(actual.firmwareVersion??'未读取')+'<br>延迟：'+(serial.lastLatencyMs==null?'—':serial.lastLatencyMs+' ms')+'<br>协议：原厂 a1_cli / 115200 baud<br>当前：'+(serial.ready?'已识别兼容 CLI':'尚未识别')+'<br>USB：'+(serial.port?.getInfo?JSON.stringify(serial.port.getInfo()):'未选择'))}<div class="button-row"><button id="panelConnect">${serial.port?'断开连接':'连接开发板'}</button></div>${note('连接只读取设备状态。参数在点击“应用”或运行示例时写入。')}<p>当前状态来自命令应答或寄存器读回，不代表测到了实际音频。未查询到的状态显示未知。</p>`;
 }else if(key==='examples'){
  title='常用示例';category='QUICK START';
  body=`<p>连接开发板后点击示例，自动配置通路并读回核对。切换示例会停止当前波形；录放任务运行时先停止任务。</p><div class="example-list">${EXAMPLES.map(e=>`<button class="example-card ${e.stop?'stop-example':''}" data-example="${e.id}"><span class="example-label">${e.title}<span aria-hidden="true">↗</span></span><small>${e.format}</small><span>${e.detail}</span><b>${e.stop?'停止全部':'一键应用'}</b></button>`).join('')}</div>`;
 }else if(key==='imported'){
  title='导入的配置';category='CONFIGURATION';
  body=`<p>应用后自动关闭旧通路、设置格式并恢复配置中的开关和增益。录放任务运行时先停止任务。</p><div class="readout">${Object.keys(FIELD_LABELS).map(k=>`${esc(FIELD_LABELS[k])}：${esc(formatSetting(k,/^gain/.test(k)?config.gains[+k.at(-1)]:config[k]))}`).join('<br>')}</div><button class="primary" id="applyImported">应用整套配置</button>`;
 }else if(key==='log'){
  title='通信记录';category='DEVICE / COMMAND RESPONSES';
  body=`<p>保留最近 500 条通信片段。导出记录有助于定位命令失败和串口中断。</p><pre id="serialLog" class="log" tabindex="0" role="region" aria-label="通信记录">${esc(logText()||'尚无通信。')}</pre><button id="downloadLog">导出通信记录</button>`;
 }else{return panel('connection');}
 const scopeTarget=/^(?:gain|mic|adc)[0-3]$/.test(key)?['adc',+key.at(-1)]:['adc','vad','interrupt','tdm'].includes(key)?['adc',0]:key==='reference'?['adc',actual.channels??config.channels]:['dac','volume','output','playback'].includes(key)?['dac',0]:null;
 if(scopeTarget){const [kind,ch]=scopeTarget;body+=`<section class="scope-entry"><span class="eyebrow">LIVE / 实板 PCM</span><h3>${kind==='adc'?(ch===actual.channels&&actual.reference?'RE 回采':'ADC'+ch+' 数字输出'):'DAC 播放数据'}</h3><p>${key==='vad'||key==='interrupt'?'显示 ADC0 参考波形，VAD 活动状态独立从芯片读取。':kind==='adc'?'点击开始后连续采集；不会向 microSD 写入文件。':'播放文件时显示实际送入 DAC 的 PCM，非模拟输出测量。'}</p><button class="primary" data-scope="${kind}" data-channel="${ch}">${kind==='adc'?'开始采集波形':'开始查看播放波形'}</button></section>`;}
 $('#panelTitle').textContent=title;$('#panelCategory').textContent=category;$('#panelBody').innerHTML=body;$('#panelBody').scrollTop=0;
 $('#apply').hidden=!applyKind;$('#apply').textContent=applyKind==='clock'?'应用格式':applyKind==='gain'?'应用并核对增益':applyKind==='dac'?'应用播放设置':'应用设置';
 setConnection(serial.ready);if(!busy)status(serial.ready?(key==='examples'?'点击示例即可配置设备。':key==='imported'?'查看参数后点击应用整套配置。':applyKind?'修改参数后点击应用。':'从当前面板选择操作。'):'连接开发板后可应用设置。');draw();
}
async function command(cmd,expect,options){
 if(!cmd.startsWith('web_'))log(cmd,'send');const response=await serial.command(cmd,options);if(expect&&!expect.test(response))throw Error('缺少预期设备应答：'+cmd);parseState(actual,cmd,response);if(cmd==='web_status'){applySnapshot(actual,telemetry(response,'state'));mergeDeviceConfig(config,actual,dirtyFields);syncTimeInputs();lastSync=Date.now();setConnection(serial.ready);}draw();return response;
}
async function run(fn){
 let completed=false;
 if(busy)return;if(!serial.ready){status('请先连接并识别兼容的 a1_cli。',true);return;}
 busy=true;lastExampleName='';setConnection(serial.ready);status('等待设备应答…');
 while(polling||serial.pending){if(!serial.ready){busy=false;setConnection(false);return;}await new Promise(r=>setTimeout(r,25));}
 try{media.error=null;await fn();if(serial.capabilities?.has('web_status'))await command('web_status');source='device';draw();if(media.error)status(media.error,true);else status('设备应答已收到。');completed=!media.error;}
 catch(e){const message=e.message;if(serial.ready&&serial.capabilities?.has('web_status')){try{await command('web_status');source='device';draw();}catch{actual=newActual();draw();}}status(message,true);log(message,'error');}
 finally{busy=false;setConnection(serial.ready);}
 return completed;
}
async function apply(kind=applyKind){
 const invalid=$('#panelBody').querySelector('[data-field]:invalid');if(invalid){invalid.reportValidity();return;}
 const submission=moduleSubmission(kind,config,gainIndex);
 await run(async()=>{if(serial.capabilities?.has('web_status'))await command('web_status');const steps=planFor(submission.kind,submission.config,actual,submission.index);for(const st of steps){status('执行 '+st.command);validateStep(st,await command(st.command));}completeSubmission(config,dirtyFields,submission);});
}
function setupHooks(){return {send:command,getState:()=>actual,capabilities:serial.capabilities,armed:!!media.pending?.armed,onStep:cmd=>status('执行 '+cmd)};}
async function useExample(id){
 let result;
 const ok=await run(async()=>{
  result=await applyExample(id,{...setupHooks(),onStep:cmd=>{if(cmd==='web_scope stop'){monitor=null;waveFrame=null;paintWave('已停止');}status('执行 '+cmd);}});
  monitor=null;waveFrame=null;paintWave('已停止');
  if(result.config){config=clone(result.config);dirtyFields.clear();}else{media.pending=null;dirtyFields.clear();mergeDeviceConfig(config,actual,dirtyFields);}
 });
 if(!ok)return;
 const e=result.example;
 if(!e.scope)$('#wavePanel').hidden=true;
 if(e.panel)panel(e.panel);else panel('examples');
 if(e.sd&&!await run(listMedia))return;
 if(e.recordSeconds){media.recordSeconds=e.recordSeconds;const input=$('#recordSeconds');if(input)input.value=e.recordSeconds;if(!await actionClick('record',{recordSeconds:e.recordSeconds}))return;}
 if(e.scope&&!await startScope(...e.scope))return;
 if(e.scope){$('#inspector').hidden=true;selected='';}
 lastExampleName=e.title;draw();
 status(e.stop?'音频任务已停止。':e.recordSeconds?'示例已应用，正在录制 10 秒。':e.id==='playback'?'播放通路已就绪，选择 WAV 文件后点击开始播放。':'示例已应用并核对。');
}
async function applyImported(){
 const target=clone(importedConfig),ok=await run(async()=>{await applySetup(target,{...setupHooks(),onStep:cmd=>{if(cmd==='web_scope stop'){monitor=null;waveFrame=null;paintWave('已停止');}status('执行 '+cmd);}});monitor=null;waveFrame=null;paintWave('已停止');config=target;dirtyFields.clear();importedConfig=null;});
 if(ok){lastExampleName='导入的配置';panel('examples');status('配置已应用并核对。');}
}
async function connect(){
 if(serial.port){const cleaned=await serial.disconnect();status(cleaned===false?'串口释放未完成，请关闭其他客户端或重插数据 USB。':'串口已断开；设备状态已清空。',cleaned===false);return;}
 if(busy)return;busy=true;setConnection(false);$('#connect').disabled=true;
 try{await serial.connect();actual=newActual();source='device';setConnection(true);status('已识别原厂 a1_cli。本次连接只读取状态，未修改设备参数。');await refresh(false);schedulePoll();}
 catch(e){status(e.message,true);panel('connection');status(e.message,true);}
 finally{busy=false;$('#connect').disabled=false;setConnection(serial.ready);draw();}
}
async function refresh(show=true){
 const work=async()=>{if(serial.capabilities?.has('web_status')){await command('web_status');return;}for(const cmd of ['set_bits','set_ch','dac_ref'])await command(cmd);};
 if(show)return run(work);await work();
}
async function rawWrite(address,value,mask){
 const parseHex=(input)=>{const v=input.trim().replace(/^0x/i,'');if(!/^[\da-f]{1,2}$/i.test(v))throw Error('请输入 1–2 位十六进制数');return parseInt(v,16);};
 await maskedWrite(address,parseHex(value),parseHex(mask),command);
}
async function actionClick(id,context={}){
 if(id==='apply-mute')return apply('adcMute');if(id==='apply-dac')return apply('dac');
 const channel=gainIndex,address=registerAddress,recordDuration=context.recordSeconds??$('#recordSeconds')?.value,playPath=$('#playPath')?.value,registerValue=$('#regValue')?.value,registerMask=$('#regMask')?.value;
 return run(async()=>{
  switch(id){
   case 'i2s-on':await command('i2s_on',/I2S up:|I2S already up/);break;
   case 'i2s-off':if(actual.recording===true||actual.playing===true)throw Error('先停止录音和播放，再关闭 I²S');if(actual.vad===true)throw Error('先关闭 VAD，再关闭 I²S');await command('i2s_off',/I2S channels down/);break;
   case 'read-gain':await command(`iic_rd ${hex(0x67+channel,4)} 1`,/\[0x/);break;
   case 'read-gains':await command('iic_rd 0x0067 4',/\[0x/);break;
   case 'read-volume':await command('dac_vol',/DAC vol =/);break;
   case 'vad-status':await command('vad_status',/has_speech=/);break;
   case 'vad-prepare':if(!serial.capabilities.has('web_record_status'))throw Error('SD 录音需要 v0.4.2 或更新的缓冲录音固件');if(actual.sd!==true)throw Error('先在录音模块挂载 microSD');{const tag=recordingTag('webvad'),pending={tag,previousPath:media.playPath,armed:true};media.pending=pending;try{await command('rec_prepare 5 '+tag,/Recording prepared:/);}catch(error){if(media.pending===pending&&actual.recording!==true)media.pending=null;throw error;}}break;
   case 'vad-save':if(!canSaveFifo(actual))throw Error('FIFO 保存需要挂载 SD 并启用 VAD 专用滤波输出模式');await command('vad_wav /sdcard/vad_'+Date.now()+'.wav',/vad_wav: saved/);media.needsList=true;break;
   case 'sd-on':await command('sdcard_on',/SD card (?:already )?mounted/);if(serial.capabilities.has('fls'))await listMedia();break;
   case 'list-files':await listMedia();break;
   case 'sd-off':if(serial.capabilities.has('web_status'))await command('web_status');if(actual.recording===true||actual.playing===true||media.pending?.armed)throw Error('先停止录音和播放，再卸载 microSD');await command('sdcard_off',/SD card (?:not mounted|unmounted)/);media.files=[];syncMediaPanel();break;
   case 'record':{
    const sec=recordingSeconds(recordDuration);if(!serial.capabilities.has('web_record_status'))throw Error('SD 录音需要 v0.4.2 或更新的缓冲录音固件');if(actual.recording||media.pending?.armed)throw Error('先停止当前录音或已准备的触发录音');
    if(actual.i2s!==true||actual.adc!==true||actual.sd!==true)throw Error('先启动 I²S、打开 ADC，并挂载 microSD');
    const tag=recordingTag();media.recordStatus=null;media.recordSeconds=sec;media.pending={tag,previousPath:media.playPath};await command(`rec_on ${sec} ${tag}`,/Recording prepared:|Rec start:|rec_on|record/i);break;
   }
   case 'record-stop':if(media.pending?.armed&&!actual.recording)media.pending=null;actual.recording=null;await command('rec_off');break;
   case 'play':{
    const path=playPath.trim();if(!validWavPath(path))throw Error('使用 /sdcard/ 下无空格的 WAV 路径');
    if(actual.i2s!==true||actual.sd!==true)throw Error('先启动 I²S 并挂载 microSD');let info;if(serial.capabilities.has('web_file_info'))info=wavDeviceInfo(await command('web_file_info '+path+' 0'));else{if(!serial.capabilities.has('fsnr'))throw Error('当前固件缺少 WAV 格式读取命令');const item=media.files.find(f=>f.path===path);info=item&&item.bytes<=180000&&serial.capabilities.has('fget')?wavTransferInfo(await command('fget '+path,undefined,{timeout:30000})):wavInfo(await command('fsnr '+path+' 0 0 0.52'));}await command('web_status');playbackGuard(info,actual);media.playPath=path;actual.playing=null;await command('play_on '+path+' 0');break;
   }
   case 'play-stop':actual.playing=null;await command('play_off',/play stop requested/);break;
   case 'reg-read':await command(`iic_rd ${hex(address,4)} 1`,/\[0x/);break;
   case 'reg-write':await rawWrite(address,registerValue,registerMask);break;
  }
 });
}
function download(name,contents,type='application/json'){
 const url=URL.createObjectURL(new Blob([contents],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportLog(){download('A1-Audio-Lab-log.txt',logText(),'text/plain;charset=utf-8');}
$('#connect').onclick=connect;$('#tools').onclick=()=>$('#toolMenu').hidden=!$('#toolMenu').hidden;
$('#closePanel').onclick=()=>{$('#inspector').hidden=true;selected='';draw();};
$('#apply').onclick=()=>{if(applyKind==='adc'&&!config.adc&&actual.vad===true){status('先关闭 VAD，再关闭 ADC。',true);return;}apply();};
$('#refresh').onclick=()=>{if($('#inspector').hidden)panel('connection');refresh();};
$('#showExamples').onclick=()=>panel('examples');
$('#showConnection').onclick=()=>panel('connection');$('#showRegisters').onclick=()=>panel('registers');$('#showLog').onclick=()=>panel('log');$('#exportLog').onclick=exportLog;
$('#exportConfig').onclick=()=>{download('ESP32-A1-config.json',JSON.stringify({schema:'a1-audio-lab/1',version:VERSION,config},null,2));$('#toolMenu').hidden=true;};
$('#importConfig').onclick=()=>{$('#toolMenu').hidden=true;$('#configFile').click();};
$('#configFile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>32768)throw Error('配置文件超过 32 KiB');const data=JSON.parse(await file.text());if(data.schema!=='a1-audio-lab/1')throw Error('不是 A1 Audio Lab 配置');importedConfig=validateConfig(data.config);config=clone(importedConfig);Object.keys(FIELD_LABELS).forEach(k=>dirtyFields.add(k));panel('imported');status('配置已载入，点击应用整套配置写入设备。');}catch(e){panel('connection');status(e.message,true);}finally{$('#configFile').value='';}};document.addEventListener('click',e=>{
 const example=e.target.closest('[data-example]');if(example){useExample(example.dataset.example);return;}
 if(e.target.id==='applyImported'){applyImported();return;}
 const file=e.target.closest('[data-media-path]');if(file){media.playPath=file.dataset.mediaPath;const input=$('#playPath');if(input)input.value=media.playPath;syncMediaPanel();return;}
 const scopeButton=e.target.closest('[data-scope]');if(scopeButton){startScope(scopeButton.dataset.scope,+scopeButton.dataset.channel);return;}
 const modeButton=e.target.closest('[data-mode]');if(modeButton){mode=modeButton.dataset.mode;try{localStorage.setItem('a1-lab-mode',mode);}catch{}draw();return;}
 const node=e.target.closest('[data-node]');if(node){panel(node.dataset.node);return;}
 const open=e.target.closest('[data-open]');if(open){panel(open.dataset.open);return;}
 const act=e.target.closest('[data-action]');if(act){actionClick(act.dataset.action);return;}
 const reg=e.target.closest('[data-reg]');if(reg){registerAddress=+reg.dataset.reg;panel('registers');return;}
 if(e.target.id==='panelConnect')connect();if(e.target.id==='downloadLog')exportLog();
});
$('#graph').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-node]')){e.preventDefault();panel(e.target.closest('[data-node]').dataset.node);}});
$('#panelBody').addEventListener('input',e=>{
 if(e.target.id==='playPath')media.playPath=e.target.value;if(e.target.id==='recordSeconds')media.recordSeconds=e.target.value;
 const key=e.target.dataset.field;if(!key)return;
 if(key==='registerAddress'){registerAddress=+e.target.value;panel('registers');return;}
 if(e.target.type==='number'){e.target.setAttribute('aria-invalid',String(!e.target.validity.valid));if(!e.target.validity.valid){status('请填写范围内的整数，再应用设置。');setConnection(serial.ready);return;}}
 const value=e.target.type==='checkbox'?e.target.checked:Number(e.target.value);
 try{editDraft(config,actual,dirtyFields,key,value);}catch(error){status(error.message,true);return;}
 const out=$('#out-'+key);if(out)out.textContent=value+' '+e.target.dataset.unit;
 source='device';draw();status(pendingDraft(config,actual,dirtyFields).length?'参数已修改，点击应用生效。':'参数与设备一致。');
});
$('#zoomIn').onclick=()=>graphView.zoom(1.2);$('#zoomOut').onclick=()=>graphView.zoom(1/1.2);$('#fit').onclick=()=>graphView.fit();
window.addEventListener('pagehide',()=>{monitor=null;clearTimeout(pollTimer);clearInterval(freshnessTimer);languageUI.dispose();graphView.dispose();canvasObserver.disconnect();dockObserver.disconnect();serial.disconnect();});

function schedulePoll(delay=100){clearTimeout(pollTimer);if(serial.ready)pollTimer=setTimeout(pollLive,delay);}
async function pollLive(){
 if(!serial.ready)return;
 if(busy||polling||serial.pending){schedulePoll(100);return;}
 polling=true;
 try{
  if(serial.capabilities.has('web_status')&&Date.now()-lastSync>800)await command('web_status');
  if(serial.capabilities.has('web_record_status')&&(actual.recording||media.recordStatus?.active)){media.recordStatus=recordingStatus(await serial.command('web_record_status'));syncMediaPanel();if(media.recordStatus.error)throw Error('录音已中断，请检查 SD 卡和通信记录');}
  if(media.needsList&&actual.sd&&!actual.recording&&!actual.playing&&serial.capabilities.has('fls')){media.needsList=false;await listMedia();}
  if(monitor){
   if(!serial.capabilities.has('web_scope'))throw Error('当前固件未提供波形接口');
   const target={...monitor,ms:timeWindowMs};const useWindow=serial.capabilities.has('web_scope_window');const response=await serial.command(useWindow?`web_scope_window ${target.kind} ${target.ch} ${target.ms}`:`web_scope ${target.kind} ${target.ch}`);
   const w=validateWave(telemetry(response,'wave'));
   if(w.source!==target.kind||w.channel!==target.ch)throw Error('波形通道与请求不一致');
   if(monitor?.kind===target.kind&&monitor.ch===target.ch&&timeWindowMs===target.ms){waveFrame=w;waveAt=Date.now();paintWave();}
  }
 }catch(e){monitor=null;waveFrame=null;paintWave(e.message);status(e.message,true);actual=newActual();draw();}
 finally{polling=false;schedulePoll(monitor?100:1000);}
}
async function startScope(kind,ch){
 const ok=await run(async()=>{
  if(!serial.capabilities.has('web_scope'))throw Error('需要更新带实时波形接口的固件');
  await command('web_status');
  await serial.command('web_scope stop');
  if(kind==='adc'){
   if(actual.vad===true&&actual.vadOutput===true)throw Error('VAD 滤波输出正在接管采集流；请先关闭 VAD，或改为仅检测，再监测 MIC');
   if(!Number.isInteger(ch)||ch<0||ch>=actual.channels+Number(actual.reference))throw Error('此 ADC / RE 通道尚未配置，请先设置输入通道数或回采');
   if(!actual.i2s)await command('i2s_on');
   if(!actual.adc)await command('adc_on');
  }
  monitor={kind,ch};waveFrame=null;waveAt=0;yAutomatic=true;
  $('#wavePanel').hidden=false;if(window.innerWidth<850){$('#inspector').hidden=true;selected='';}$('#waveTitle').textContent=kind==='adc'?(ch===actual.channels?'RE 回采 · ADC 流':'ADC'+ch+' · 数字输出'):(ch?'DAC R':'DAC L')+' · 播放数据';
  $('#waveChannel').innerHTML=Array.from({length:kind==='adc'?actual.channels+Number(actual.reference):2},(_,i)=>`<option value="${i}" ${i===ch?'selected':''}>${kind==='adc'?(i===actual.channels?'RE':'ADC '+i):(i?'右声道':'左声道')}</option>`).join('');
  $('#timeWindow').disabled=!serial.capabilities.has('web_scope_window');$('#timeNumber').disabled=$('#timeWindow').disabled;syncTimeInputs();
  $('#wavePanel').classList.toggle('playback-wave',kind==='dac');updateDockLayout();paintWave('正在等待实板 PCM…');
 });if(ok)schedulePoll(20);return ok;
}
async function stopScope(){
 monitor=null;waveFrame=null;paintWave('已停止');
 if(!serial.ready)return;
 await run(async()=>{if(serial.capabilities.has('web_scope'))await serial.command('web_scope stop');});
}
function formatTime(ms){return ms>=1000?(ms/1000).toFixed(2)+' s':ms.toFixed(1)+' ms';}
function paintWave(message){
 const canvas=$('#waveCanvas');if(!canvas)return;
 const ctx=canvas.getContext('2d'),ratio=window.devicePixelRatio||1,width=canvas.width/ratio,height=canvas.height/ratio;ctx.setTransform(ratio,0,0,ratio,0,0);
 ctx.clearRect(0,0,width,height);const palette=getComputedStyle(document.documentElement);ctx.strokeStyle=palette.getPropertyValue('--wave-grid').trim()||'#29474c';ctx.lineWidth=1;
 for(let i=0;i<=4;i++){ctx.beginPath();ctx.moveTo(0,height*i/4);ctx.lineTo(width,height*i/4);ctx.stroke();}
 for(let i=0;i<=8;i++){ctx.beginPath();ctx.moveTo(width*i/8,0);ctx.lineTo(width*i/8,height);ctx.stroke();}
 const vadStream=monitor?.kind==='adc'&&actual.vad===true&&actual.vadOutput===true;
 const micMuted=monitor?.kind==='adc'&&monitor.ch<actual.channels&&actual.adcMute===true;
 const inputOff=monitor?.kind==='adc'&&(actual.i2s===false||actual.adc===false);
 const fresh=monitor&&!vadStream&&!micMuted&&!inputOff&&waveFrame?.valid&&Date.now()-waveAt<700;
 $('#autoScale').setAttribute('aria-pressed',String(yAutomatic));
 $('#wavePanel').classList.toggle('is-live',!!fresh);
 if(!fresh){$('#waveMeta').textContent=message||(vadStream?'VAD 滤波输出已接管采集；请切回仅检测模式查看独立 MIC':micMuted?'MIC 已静音：请关闭 ADC 静音并写入':inputOff?'MIC 通路未开启：请在麦克风模块开启并写入':!monitor?'已停止':waveFrame?.readError?'采样读取失败':monitor.kind==='dac'?'等待设备播放音频文件…':waveFrame?.available_ms!=null?`正在积累时间窗：${formatTime(Math.min(timeWindowMs,waveFrame.available_ms))} / ${formatTime(timeWindowMs)}`:'等待采集通路数据…');$('#waveLevel').textContent='— dBFS';$('#waveScale').textContent=yAutomatic?'纵轴自动':'纵轴手动';return;}
 const values=waveFrame.samples;let peak=0,sum=0;const lo=Math.min(...(waveFrame.min||values))/32768,hi=Math.max(...(waveFrame.max||values))/32768;
 if(yAutomatic){const center=(hi+lo)/2,half=Math.max((hi-lo)*.65,1/32768);yBounds={min:center-half,max:center+half};}
 const mid=(yBounds.min+yBounds.max)/2,span=(yBounds.max-yBounds.min)/2;
 $('#waveScale').textContent=`纵轴${yAutomatic?'自动':'手动'} · ${yBounds.min.toFixed(5)} 至 ${yBounds.max.toFixed(5)} FS`;
 ctx.beginPath();ctx.lineWidth=2;ctx.strokeStyle=palette.getPropertyValue(monitor.kind==='adc'?'--wave-record':'--wave-play').trim()||(monitor.kind==='adc'?'#8fddd3':'#f2c07c');
 values.forEach((n,i)=>{const v=n/32768;peak=Math.max(peak,Math.abs(v));sum+=v*v;const x=i*width/(values.length-1),y=height/2-(v-mid)/span*height*.5;if(i)ctx.lineTo(x,y);else ctx.moveTo(x,y);});ctx.stroke();
 if(waveFrame.min){ctx.beginPath();ctx.lineWidth=Math.max(1,width/values.length*.55);for(let i=0;i<values.length;i++){const x=(i+.5)*width/values.length;ctx.moveTo(x,height/2-(waveFrame.min[i]/32768-mid)/span*height*.5);ctx.lineTo(x,height/2-(waveFrame.max[i]/32768-mid)/span*height*.5);}ctx.stroke();peak=waveFrame.peak;}
 const db=n=>n?Math.max(-96,20*Math.log10(n)).toFixed(1):'−∞';
 $('#waveLevel').textContent=db(waveFrame.rms??Math.sqrt(sum/values.length))+' dBFS';
 $('#timeAxisStart').textContent='−'+formatTime(waveFrame.duration_ms??values.length/waveFrame.rate*1000);
 $('#waveMeta').textContent=`实板 PCM · ${formatTime(waveFrame.duration_ms??values.length/waveFrame.rate*1000)} 窗口 · 峰值 ${db(peak)} dBFS · #${waveFrame.seq}${hi===lo?' · 当前窗口为固定电平':''}`;
}
$('#stopWave').onclick=stopScope;
$('#closeWave').onclick=async()=>{await stopScope();$('#wavePanel').hidden=true;};
$('#waveChannel').onchange=e=>{if(monitor)startScope(monitor.kind,+e.target.value);};
const freshnessTimer=setInterval(()=>{if(monitor&&Date.now()-waveAt>700){waveFrame=null;paintWave('等待新数据…');}if(serial.ready&&actual.syncAt&&Date.now()-actual.syncAt>3000){actual=newActual();$('#liveSync').textContent='设备状态已过期 · 等待同步';draw();}},350);
draw();setConnection(false);

const themeSelect=$('#themeSelect');themeSelect.value=document.documentElement.dataset.theme||'light';
themeSelect.onchange=()=>{const theme=themeSelect.value;if(theme==='light')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=theme;try{localStorage.setItem('a1-lab-theme',theme);}catch{}paintWave();};

// Display geometry is independent of acquisition and never sends hardware commands.
const panelWidths={inspector:380,wave:680};
try{const saved=JSON.parse(localStorage.getItem('a1-panel-widths')||'{}');for(const k of ['inspector','wave'])if(Number.isFinite(saved[k]))panelWidths[k]=saved[k];}catch{}
function updateDockLayout(){
 const root=document.documentElement,viewport=window.innerWidth;
 const top=$('.topbar').getBoundingClientRect().bottom+12,bottom=$('.legend').getBoundingClientRect().height+12;
 const leftOpen=!$('#inspector').hidden,waveOpen=!$('#wavePanel').hidden,available=Math.max(180,window.innerHeight-top-bottom);
 root.style.setProperty('--dock-top',top+'px');root.style.setProperty('--dock-bottom',bottom+'px');
 const leftMin=viewport<1000?280:320,waveMin=viewport<1000?320:400;
 const leftMax=Math.max(leftMin,Math.min(720,viewport-48-(waveOpen?waveMin+20:0)));
 const left=Math.max(leftMin,Math.min(panelWidths.inspector,leftMax));
 const rightMax=Math.max(waveMin,viewport-48-(leftOpen?left+20:0));
 const right=Math.max(waveMin,Math.min(panelWidths.wave,rightMax));
 root.style.setProperty('--inspector-width',left+'px');root.style.setProperty('--scope-width',right+'px');
 root.style.setProperty('--inspector-bottom',bottom+'px');root.style.setProperty('--scope-top',top+'px');
 if(viewport<850&&leftOpen&&waveOpen){root.style.setProperty('--inspector-bottom',(bottom+available*.48+6)+'px');root.style.setProperty('--scope-top',(top+available*.52+6)+'px');}
 document.querySelectorAll('[data-resize]').forEach(h=>{const wave=h.dataset.resize==='wave';h.setAttribute('aria-valuemin',wave?waveMin:leftMin);h.setAttribute('aria-valuemax',Math.round(wave?rightMax:leftMax));h.setAttribute('aria-valuenow',Math.round(wave?right:left));});
 graphView.layout();
}
let drag=null;
document.querySelectorAll('[data-resize]').forEach(handle=>{
 const key=handle.dataset.resize;
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.focus({preventScroll:true});handle.setPointerCapture(e.pointerId);drag={key,x:e.clientX,width:$(key==='wave'?'#wavePanel':'#inspector').getBoundingClientRect().width};document.body.classList.add('panel-resizing');};
 handle.onpointermove=e=>{if(!drag||drag.key!==key)return;const min=Number(handle.getAttribute('aria-valuemin')),max=Number(handle.getAttribute('aria-valuemax'));panelWidths[key]=Math.max(min,Math.min(max,drag.width+(e.clientX-drag.x)*(key==='wave'?-1:1)));updateDockLayout();};
 const finish=()=>{drag=null;document.body.classList.remove('panel-resizing');try{localStorage.setItem('a1-panel-widths',JSON.stringify(panelWidths));}catch{}};
 handle.onpointerup=finish;handle.onpointercancel=finish;
 handle.ondblclick=()=>{panelWidths[key]=key==='wave'?680:380;updateDockLayout();finish();};
 handle.onkeydown=e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const direction=key==='wave'?-1:1;let w=$(key==='wave'?'#wavePanel':'#inspector').getBoundingClientRect().width;w=e.key==='Home'?Number(handle.getAttribute('aria-valuemin')):e.key==='End'?Number(handle.getAttribute('aria-valuemax')):w+(e.key==='ArrowRight'?24:-24)*direction;panelWidths[key]=Math.max(Number(handle.getAttribute('aria-valuemin')),Math.min(Number(handle.getAttribute('aria-valuemax')),w));updateDockLayout();finish();};
});
function syncTimeInputs(){
 const limit=actual.maxWindowMs??10000;timeWindowMs=Math.min(timeWindowMs,limit);
 $('#timeWindow').max=limit;$('#timeNumber').max=limit;$('#timeWindow').value=timeWindowMs;
 if(document.activeElement!==$('#timeNumber'))$('#timeNumber').value=timeWindowMs;
 $('#timeWindowValue').textContent=timeWindowMs>=1000?(timeWindowMs/1000).toLocaleString('zh-CN',{maximumFractionDigits:3})+' s':timeWindowMs+' ms';
}
function changeTimeWindow(value){
 const next=Math.max(5,Math.min(actual.maxWindowMs??10000,Math.round(Number(value))));if(!Number.isFinite(next))return;
 if(next===timeWindowMs){syncTimeInputs();return;}timeWindowMs=next;syncTimeInputs();$('#timeAxisStart').textContent='−'+formatTime(timeWindowMs);waveFrame=null;paintWave('正在切换连续采样时间窗…');schedulePoll(20);
}
function rememberTime(){try{localStorage.setItem('a1-scope-window',String(timeWindowMs));}catch{}}
syncTimeInputs();
$('#timeWindow').oninput=e=>{changeTimeWindow(e.target.value);$('#timeNumber').value=timeWindowMs;};$('#timeWindow').onchange=rememberTime;
function commitTime(){const el=$('#timeNumber'),value=el.valueAsNumber,limit=actual.maxWindowMs??10000;if(!Number.isInteger(value)||value<5||value>limit){el.value=timeWindowMs;status('时间窗范围为 5–'+limit+' ms，需输入整数。',true);return;}changeTimeWindow(value);el.value=timeWindowMs;rememberTime();}
$('#timeNumber').onchange=commitTime;$('#timeNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitTime();e.target.blur();}};
$('#waveCanvas').addEventListener('wheel',e=>{if(!e.deltaY)return;e.preventDefault();const r=e.currentTarget.getBoundingClientRect();yBounds=zoomVertical(yBounds.min,yBounds.max,e.deltaY,(e.clientY-r.top)/r.height);yAutomatic=false;paintWave();},{passive:false});
$('#autoScale').onclick=()=>{yAutomatic=true;paintWave();};
const canvasObserver=new ResizeObserver(()=>{const canvas=$('#waveCanvas'),r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;const dpr=window.devicePixelRatio||1,w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;paintWave();}});canvasObserver.observe($('#waveCanvas'));
const dockObserver=new ResizeObserver(updateDockLayout);dockObserver.observe($('.topbar'));dockObserver.observe($('.legend'));window.addEventListener('resize',updateDockLayout);updateDockLayout();

// Display-only controls. None of these send device commands.
$('#workspaceLog').onclick=()=>{const saved=lastOperation;panel('log');status(saved.text,saved.error);};
$('#highlightPath').onchange=e=>{highlightPath=e.target.checked;draw();};
document.addEventListener('click',e=>{
 if(e.target.id==='revertModule'){
  revertDraft(config,actual,dirtyFields,moduleFields(applyKind,gainIndex));
  draw();status('已恢复读取到的设备值。');
 }
 if(!e.target.closest('#tools,#toolMenu'))$('#toolMenu').hidden=true;
});
document.addEventListener('keydown',e=>{
 if((e.ctrlKey||e.metaKey)&&e.key==='Enter'&&!$('#inspector').hidden&&!$('#apply').hidden&&!$('#apply').disabled){e.preventDefault();$('#apply').click();}
 if(e.key==='Escape'){
  if(!$('#toolMenu').hidden)$('#toolMenu').hidden=true;
  else if(!$('#inspector').hidden)$('#closePanel').click();
  else if(!$('#wavePanel').hidden)$('#closeWave').click();
 }
});
const languageUI=installLanguage($('#languageSelect'));
