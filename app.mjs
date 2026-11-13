import {VERSION,DEFAULTS,RATES,REGISTERS,clone,validateConfig,newActual,planFor,validateStep,parseState,maskedWrite,hex,stripTerminal,telemetry,applySnapshot,validateWave,mergeDeviceConfig,zoomVertical} from './core.mjs';
import {A1Serial} from './serial.mjs';
import {FIELD_LABELS,editDraft,pendingDraft,moduleFields,revertDraft,formatSetting,explainFailure} from './workbench.mjs';
import {installLanguage} from './i18n.mjs';
import {renderGraph} from './graph.mjs';
import {GraphViewport} from './viewport.mjs';

const $=s=>document.querySelector(s);
document.title='ESP32-A1 Audio Lab · v'+VERSION;$('.version').textContent='v'+VERSION;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dirtyFields=new Set();
let lastOperation={text:'',error:false},highlightPath=true;
try{const saved=localStorage.getItem('a1-lab-mode');if(saved==='pro')queueMicrotask(()=>{mode='pro';draw();});}catch{}
let yAutomatic=true,yBounds={min:-1,max:1};
let timeWindowMs=50;try{const saved=Number(localStorage.getItem("a1-scope-window"));if(saved>=5&&saved<=10000)timeWindowMs=Math.round(saved);}catch{}
let monitor=null,pollTimer=null,lastSync=0,polling=false,waveFrame=null,waveAt=0;
let config=clone(DEFAULTS),actual=newActual(),mode='simple',source='draft',selected='',applyKind='',gainIndex=0,busy=false,logs=[],partial='',registerAddress=0x67;
const graphView=new GraphViewport($('#graphScroll'),$('#graph'),{overlays:[$('#inspector'),$('#wavePanel')],onChange:(view,auto)=>{$('#zoomText').textContent=Math.round(view.scale*100)+'%';$('#fit').setAttribute('aria-pressed',String(auto));}});
const serial=new A1Serial({onData:receive,onDisconnect:()=>{monitor=null;waveFrame=null;clearTimeout(pollTimer);actual=newActual();setConnection(false);paintWave('设备已断开');draw();}});
function log(text,kind='device'){
 logs.push({time:new Date().toISOString(),kind,text});if(logs.length>500)logs.shift();
 if(selected==='log')$('#serialLog').textContent=logText();
}
const logText=()=>logs.map(x=>`${x.time.slice(11,23)} ${x.kind==='send'?'→':'←'} ${x.text}`).join('\n');
function receive(text){
 const clean=stripTerminal(text);if(!clean.includes('@A1 ')&&clean.length<1024)log(clean);
 partial=(partial+clean).slice(-32768);const end=partial.lastIndexOf('\n');
 if(end>=0){const lines=partial.slice(0,end+1);partial=partial.slice(end+1);if(!lines.includes('@A1 ')){try{parseState(actual,'',lines);}catch{}draw();}}
}
function status(text,error=false){
 lastOperation={text,error};$('#operationStatus').textContent=text;$('#operationStatus').classList.toggle('error',error);
 const failure=error?explainFailure(Error(text)):null;
 $('#workspaceNotice').hidden=!error;$('#workspaceNotice').dataset.state=error?'error':busy?'busy':'info';
 $('#workspaceStatus').textContent=failure?.title||text;$('#workspaceHint').textContent=failure?.hint||'';$('#workspaceLog').hidden=!error;
}
function renderDrafts(){
 const entries=pendingDraft(config,actual,dirtyFields);$('#pendingCount').textContent=entries.length;$('#pendingDraftButton').disabled=!entries.length;
 const keys=moduleFields(applyKind,gainIndex),local=entries.filter(e=>keys.includes(e.key));
 $('#moduleDraft').hidden=!local.length;
 $('#moduleDraft').innerHTML=local.length?`<div class="draft-title"><strong>待写入 · ${local.length}</strong><button id="revertModule" class="plain" ${local.some(e=>e.device!==null&&(!e.key.startsWith('gain')||Number.isInteger(e.device)))?'':'disabled'}>恢复本模块</button></div>${local.map(e=>`<div class="draft-row"><span>${esc(e.label)}</span><span>${esc(formatSetting(e.key,e.device))}<i>→</i><b>${esc(formatSetting(e.key,e.draft))}</b></span></div>`).join('')}`:'';
 if(selected==='changes')$('#panelBody').innerHTML=`<p>设备状态与草稿分开显示</p>${entries.length?entries.map(e=>`<button class="change-item" data-open="${e.key.startsWith('gain')?e.key:['rate','bits','channels'].includes(e.key)?'clock':['dac','volume','dacMute'].includes(e.key)?'dac':e.key.startsWith('reference')?'reference':e.key.startsWith('vad')?'vad':'adc'}"><strong>${esc(e.label)}</strong><span>${esc(formatSetting(e.key,e.device))} → ${esc(formatSetting(e.key,e.draft))}</span></button>`).join('')+'<button id="revertAll" class="plain">恢复为设备值</button>':'<div class="notice">没有待写入参数</div>'}`;
}

function setConnection(ready){
 $('#connectionText').innerHTML=`<i class="dot ${ready?'ready':''}"></i>${ready?'a1_cli 已识别':'未连接 / 待重新识别'}`;
 $('#connect').textContent=serial.port?'断开连接':'连接开发板';
 $('#refresh').disabled=!ready||busy;
 $('#deviceMeta').textContent='固件：'+(actual.firmwareVersion??'未读取');
 $('#liveSync').textContent=ready?(serial.capabilities?.has('web_status')?(actual.syncAt?'状态实时同步 · '+new Date(actual.syncAt).toLocaleTimeString():'正在读取设备状态'):'当前固件无实时遥测接口'):'设备未连接';
 $('#apply').disabled=!ready||busy;
 const verbs={'reg-write':'iic_wr','sd-on':'sdcard_on','sd-off':'sdcard_off','record':'rec_on','record-stop':'rec_off','play':'play_on','play-stop':'play_off','vad-save':'vad_wav','vad-prepare':'rec_prepare'};
 document.querySelectorAll('[data-scope]').forEach(b=>{b.disabled=!ready||busy||!serial.capabilities?.has('web_scope');});
 document.querySelectorAll('[data-action]').forEach(b=>{const missing=ready&&verbs[b.dataset.action]&&!serial.capabilities?.has(verbs[b.dataset.action]);b.disabled=!ready||busy||missing;b.title=missing?'当前固件未提供此命令':'';});
}
function draw(){
 const focused=document.activeElement?.closest('[data-node]')?.dataset.node;
 $('#graph').innerHTML=renderGraph(config,actual,{mode,source,selected,highlight:highlightPath});
 graphView.setSize(1530,mode==='pro'?700:680);
 const c=source==='draft'?config:actual;
 $('#formatText').textContent=`${c.rate?Number(c.rate/1000).toLocaleString('en-US',{minimumFractionDigits:1,maximumFractionDigits:3}):'—'} kHz · ${c.bits??'—'} bit · ${c.channels??'—'} MIC`;
 $('#sourceNote').textContent=source==='draft'?'配置草稿 · 修改不会自动下发':serial.ready?`设备应答 · ${actual.updated?new Date(actual.updated).toLocaleTimeString():'尚未读取'} · 未知通路不点亮`:'设备状态未知 · 请连接兼容的 a1_cli';
 document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.mode===mode));
 document.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.source===source));
 if(focused)document.querySelector(`[data-node="${focused}"]`)?.focus({preventScroll:true});
 syncPanel();renderDrafts();queueMicrotask(updateDockLayout);
}
function syncPanel(){
 document.querySelectorAll('#panelBody [data-field]').forEach(el=>{const k=el.dataset.field;const v=/^gain[0-3]$/.test(k)?config.gains[+k.at(-1)]:config[k];if(v===undefined||document.activeElement===el)return;if(el.type==='checkbox')el.checked=v;else el.value=v;const o=$('#out-'+k);if(o)o.textContent=v+' '+(el.dataset.unit||'');});
 if(source==='device')for(let i=0;i<4;i++){const b=$('[data-open="gain'+i+'"]');if(b)b.textContent='ADC'+i+'　'+(actual.gains[i]??'—')+' dB';}

 if(selected==='registers'){
  const v=$('.reg-value');if(v)v.textContent=actual.registers[registerAddress]==null?'—':hex(actual.registers[registerAddress]);
  document.querySelectorAll('[data-reg]').forEach(b=>{b.querySelector('b').textContent=actual.registers[+b.dataset.reg]==null?'—':hex(actual.registers[+b.dataset.reg]);});
  return;
 }
 const r=$('#panelBody .readout');if(!r)return;let text='';
 if(/^gain[0-3]$/.test(selected)||(/^mic[0-3]$/.test(selected)&&mode==='pro'))text='设备读回：'+(actual.gains[gainIndex]==null?'尚未读取':actual.gains[gainIndex]+' dB')+'<br>寄存器：'+hex(0x67+gainIndex,4);
 else if(selected==='adc'||selected==='mic0'||/^adc[0-3]$/.test(selected))text='ADC 通路应答：'+known(actual.adc)+'<br>静音应答：'+known(actual.adcMute);
 else if(['volume','dac','output'].includes(selected))text='设备音量：'+(actual.volume??'—')+' / 100<br>DAC 通路：'+known(actual.dac)+'<br>静音应答：'+known(actual.dacMute);
 else if(['clock','tdm'].includes(selected))text='I²S 应答：'+known(actual.i2s)+'<br>EV Board：SDA 46 / SCL 45<br>BCLK 37 / WS 1 / DOUT 35 / DIN 6<br>Codec I²C：7-bit 0x2C';
 else if(selected==='reference')text='回采配置应答：'+known(actual.reference)+'<br>草稿采集布局：'+['FL','FR','BL','BR'].slice(0,config.channels).concat(config.reference?['RE']:[]).join(' · ');
 else if(['vad','interrupt'].includes(selected))text='VAD 应答：'+known(actual.vad)+'<br>滤波音频输出：'+known(actual.vadOutput);
 else if(['host','sd','playback'].includes(selected))text='SD：'+known(actual.sd)+'<br>录音：'+known(actual.recording)+'<br>播放：'+known(actual.playing);
 if(text)r.innerHTML=text;
 if(['vad','interrupt'].includes(selected)){
  const v=$('.micro-number');if(v)v.innerHTML=`${actual.speech==null?'—':actual.speech?'检测到活动':'无活动'}<br><small>设备事件计数 ${actual.triggers??'—'}</small>`;
 }
}
function field(label,key,content){return `<label class="field"><span>${label}</span>${content}</label>`;}
function select(label,key,values,value=config[key]){return field(label,key,`<select data-field="${key}" aria-label="${label}">${values.map(([v,t])=>`<option value="${v}" ${v===value?'selected':''}>${t}</option>`).join('')}</select>`);}
function toggle(label,key){return `<label class="toggle"><span>${label}</span><input type="checkbox" data-field="${key}" ${config[key]?'checked':''} aria-label="${label}"></label>`;}
function range(label,key,min,max,value,unit=''){return `<div class="field"><label for="range-${key}">${label}<output id="out-${key}">${value} ${unit}</output></label><div class="range-number"><input id="range-${key}" type="range" min="${min}" max="${max}" step="1" value="${value}" data-field="${key}" data-unit="${unit}" aria-label="${label}"><input type="number" min="${min}" max="${max}" step="1" value="${value}" data-field="${key}" data-unit="${unit}" aria-label="${label} · 数值"></div></div>`;}
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
  body=`<p>从 DAC 左右声道选一路，作为采集流里的 RE 参考槽。RE 可供主控侧 AEC 使用。</p>${toggle('启用 DAC 回采','reference')}${select('参考声道','referenceChannel',[[1,'DAC 左声道'],[2,'DAC 右声道']])}${readout('回采配置应答：'+known(actual.reference)+'<br>采集布局：'+['FL','FR','BL','BR'].slice(0,config.channels).concat(config.reference?['RE']:[]).join(' · '))}${note('这是回采路径，不表示 A1 已执行回声消除。修改前需关闭 VAD、ADC、DAC 和 I²S；采集 RE 时需保持 DAC 数据通路工作。')}`;
 }else if(key==='vad'||key==='interrupt'){
  title='硬件 VAD';category='DETECTION / ADC0';applyKind='vad';
  body=`<p>ADC0 检测语音活动，经 A1 INT 通知 S31。录音触发需要先准备录音任务。</p>${toggle('启用 VAD 检测','vad')}${toggle('VAD 滤波输出 · 专用模式','vadOutput')}<div class="micro-number">${actual.speech==null?'—':actual.speech?'检测到活动':'无活动'}<br><small>设备事件计数 ${actual.triggers??'—'}</small></div><div class="button-row">${action('vad-status','读取 VAD 状态')}${action('vad-save','保存 FIFO 到 SD')}</div><div class="button-row">${action('vad-prepare','准备 5 秒触发录音')}</div>${readout('VAD 应答：'+known(actual.vad)+'<br>滤波音频输出：'+known(actual.vadOutput))}${note('普通 MIC 采集请关闭“VAD 滤波输出”，仅启用检测。滤波输出会接管 I²S 数据，不再是四路独立 MIC；需先停止波形、录放和 ADC / DAC。FIFO 保存也不等于连续预录音。')}`;
 }else if(key==='host'||key==='sd'||key==='playback'){
  title='录音与文件播放';category='HOST / microSD';
  body=`<p>录音和播放由开发板执行，文件保存在板上的 microSD。</p><div class="button-row">${action('sd-on','挂载 microSD')}${action('sd-off','卸载 microSD')}</div>${field('录音时长 / 秒','',`<input id="recordSeconds" type="number" min="1" max="600" value="5" aria-label="录音时长 / 秒">`)}<div class="button-row">${action('record','开始录音')}${action('record-stop','停止录音')}</div>${field('开发板 WAV 路径','',`<input id="playPath" type="text" value="/sdcard/test.wav" aria-label="开发板 WAV 路径" spellcheck="false">`)}<div class="button-row">${action('play','开始播放')}${action('play-stop','停止播放')}</div>${readout('SD：'+known(actual.sd)+'<br>录音：'+known(actual.recording)+'<br>播放：'+known(actual.playing))}${note('录音前启动 I²S 并打开 ADC；播放前准备匹配格式的 WAV。此页不把浏览器试听当作芯片播放，也不向串口直接塞 PCM。')}`;
 }else if(key==='registers'){
  title='寄存器';category='PRO / REGISTER INSPECTOR';
  const reg=REGISTERS.find(x=>x.address===registerAddress);
  body=`<p>16 位地址、8 位数据。读取会访问板上 A1；不存在或未初始化的接口会返回错误。</p>${select('寄存器','registerAddress',REGISTERS.map(r=>[r.address,hex(r.address,4)+' · '+r.name]),registerAddress)}<div class="reg-value">${actual.registers[registerAddress]==null?'—':hex(actual.registers[registerAddress])}</div><div class="button-row">${action('reg-read','读取寄存器')}</div>${reg?.writable?`${field('写入值 / hex','',`<input id="regValue" type="text" value="80" aria-label="寄存器写入值" spellcheck="false">`)}${field('位掩码 / hex','',`<input id="regMask" type="text" value="ff" aria-label="寄存器位掩码" spellcheck="false">`)}<div class="button-row">${action('reg-write','掩码写入并核对')}</div>${note('仅开放已核对的增益寄存器。直接写入会绕过驱动缓存；常规调节请使用增益模块。读回不一致时尝试恢复本次涉及的位。')}`:note('此地址只读。复位、时钟、校准、eFuse 与未核对字段不开放写入。')}<div class="reg-list">${REGISTERS.map(r=>`<button data-reg="${r.address}"><span>${hex(r.address,4)}　${esc(r.name)}</span><b>${actual.registers[r.address]==null?'—':hex(actual.registers[r.address])}</b></button>`).join('')}</div>`;
 }else if(key==='connection'){
  title='连接与板卡';category='DEVICE / ESP32-A1 EV BOARD';
  body=`<span class="chip-tag">S31 主控 → I²C / I²S → A1 Codec</span><p style="margin-top:18px">使用桌面 Chrome / Edge，连接 EV Board 的 USB 数据口，然后选择对应串口。网页会读取 help 并核对命令，再开放写入。</p>${readout('网页：v'+VERSION+'<br>固件：'+(actual.firmwareVersion??'未读取')+'<br>延迟：'+(serial.lastLatencyMs==null?'—':serial.lastLatencyMs+' ms')+'<br>协议：原厂 a1_cli / 115200 baud<br>当前：'+(serial.ready?'已识别兼容 CLI':'尚未识别')+'<br>USB：'+(serial.port?.getInfo?JSON.stringify(serial.port.getInfo()):'未选择'))}<div class="button-row"><button id="panelConnect">${serial.port?'断开连接':'连接开发板'}</button></div>${note('声音钥匙固件和 a1_cli 使用不同协议。若板上仍是声音钥匙，本页会拒绝参数写入，需要另行切换固件；网页不会自动烧录或重置开发板。')}<p>当前状态来自命令应答或寄存器读回，不代表测到了实际音频。未查询到的状态显示未知。</p>`;
 }else if(key==='changes'){title='待写入参数';category='DRAFT / DEVICE COMPARISON';body='';
 }else if(key==='log'){
  title='通信记录';category='DEVICE / COMMAND RESPONSES';
  body=`<p>保留最近 500 条通信片段。导出记录有助于定位命令失败和串口中断。</p><pre id="serialLog" class="log">${esc(logText()||'尚无通信。')}</pre><button id="downloadLog">导出通信记录</button>`;
 }else{return panel('connection');}
 const scopeTarget=/^(?:gain|mic|adc)[0-3]$/.test(key)?['adc',+key.at(-1)]:['adc','vad','interrupt','tdm'].includes(key)?['adc',0]:key==='reference'?['adc',actual.channels??config.channels]:['dac','volume','output','playback'].includes(key)?['dac',0]:null;
 if(scopeTarget){const [kind,ch]=scopeTarget;body+=`<section class="scope-entry"><span class="eyebrow">LIVE / 实板 PCM</span><h3>${kind==='adc'?(ch===actual.channels&&actual.reference?'RE 回采':'ADC'+ch+' 数字输出'):'DAC 播放数据'}</h3><p>${key==='vad'||key==='interrupt'?'显示 ADC0 参考波形，VAD 活动状态独立从芯片读取。':kind==='adc'?'点击开始后连续采集；不会向 microSD 写入文件。':'播放文件时显示实际送入 DAC 的 PCM，非模拟输出测量。'}</p><button class="primary" data-scope="${kind}" data-channel="${ch}">${kind==='adc'?'开始采集波形':'开始查看播放波形'}</button></section>`;}
 $('#panelTitle').textContent=title;$('#panelCategory').textContent=category;$('#panelBody').innerHTML=body;
 $('#apply').hidden=!applyKind;$('#apply').textContent=applyKind==='clock'?'写入格式配置':applyKind==='gain'?'写入并读回增益':applyKind==='dac'?'写入播放设置':'写入此模块';
 setConnection(serial.ready);status(serial.ready?'已连接。修改后点击写入，不会自动下发。':'修改保存在草稿中。连接兼容的 a1_cli 后可写入。');draw();
}
async function command(cmd,expect){
 if(!cmd.startsWith('web_'))log(cmd,'send');const response=await serial.command(cmd);if(expect&&!expect.test(response))throw Error('缺少预期设备应答：'+cmd);parseState(actual,cmd,response);if(cmd==='web_status'){applySnapshot(actual,telemetry(response,'state'));mergeDeviceConfig(config,actual,dirtyFields);syncTimeInputs();lastSync=Date.now();setConnection(serial.ready);}draw();return response;
}
async function run(fn){
 if(busy)return;if(!serial.ready){status('请先连接并识别兼容的 a1_cli。',true);return;}
 busy=true;setConnection(serial.ready);status('等待设备应答…');
 while(polling||serial.pending){if(!serial.ready){busy=false;setConnection(false);return;}await new Promise(r=>setTimeout(r,25));}
 try{await fn();if(serial.capabilities?.has('web_status'))await command('web_status');source='device';draw();status('操作完成。状态来自设备应答；音频效果仍需实际检查。');}
 catch(e){const message=e.message;if(serial.ready&&serial.capabilities?.has('web_status')){try{await command('web_status');source='device';draw();}catch{actual=newActual();draw();}}status(message,true);log(message,'error');}
 finally{busy=false;setConnection(serial.ready);}
}
async function apply(kind=applyKind){await run(async()=>{if(serial.capabilities?.has('web_status'))await command('web_status');const steps=planFor(kind,config,actual,gainIndex);for(const st of steps){status('执行 '+st.command);validateStep(st,await command(st.command));}const keys=moduleFields(kind,gainIndex,config);keys.forEach(k=>dirtyFields.delete(k));});}
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
async function rawWrite(){
 const parseHex=(id)=>{const v=$(id).value.trim().replace(/^0x/i,'');if(!/^[\da-f]{1,2}$/i.test(v))throw Error('请输入 1–2 位十六进制数');return parseInt(v,16);};
 await maskedWrite(registerAddress,parseHex('#regValue'),parseHex('#regMask'),command);
}
async function actionClick(id){
 if(id==='apply-mute')return apply('adcMute');if(id==='apply-dac')return apply('dac');
 return run(async()=>{
  switch(id){
   case 'i2s-on':await command('i2s_on',/I2S up:|I2S already up/);break;
   case 'i2s-off':if(actual.vad===true)throw Error('先关闭 VAD，再关闭 I²S');await command('i2s_off',/I2S channels down/);break;
   case 'read-gain':await command(`iic_rd ${hex(0x67+gainIndex,4)} 1`,/\[0x/);break;
   case 'read-gains':await command('iic_rd 0x0067 4',/\[0x/);break;
   case 'read-volume':await command('dac_vol',/DAC vol =/);break;
   case 'vad-status':await command('vad_status',/has_speech=/);break;
   case 'vad-prepare':if(actual.sd!==true)throw Error('先在录音模块挂载 microSD');await command('rec_prepare 5 web_vad',/Recording prepared:/);break;
   case 'vad-save':if(actual.sd!==true||actual.vad!==true)throw Error('需要先挂载 microSD 并启用 VAD');await command('vad_wav /sdcard/vad_'+Date.now()+'.wav',/vad_wav: saved/);break;
   case 'sd-on':await command('sdcard_on',/SD card (?:already )?mounted/);break;
   case 'sd-off':if(actual.recording===true||actual.playing===true)throw Error('先停止录音和播放，再卸载 microSD');await command('sdcard_off',/SD card (?:not mounted|unmounted)/);break;
   case 'record':{
    const sec=Number($('#recordSeconds').value);if(!Number.isInteger(sec)||sec<1||sec>600)throw Error('录音时长需为 1–600 秒');
    if(actual.i2s!==true||actual.adc!==true||actual.sd!==true)throw Error('先启动 I²S、打开 ADC，并挂载 microSD');
    await command(`rec_on ${sec} web`,/Recording prepared:|Rec start:|rec_on|record/i);break;
   }
   case 'record-stop':actual.recording=null;await command('rec_off');break;
   case 'play':{
    const path=$('#playPath').value.trim();if(!/^\/sdcard\/[a-z\d_/-]+\.wav$/i.test(path)||path.includes('..'))throw Error('使用 /sdcard/ 下无空格的 WAV 路径');
    if(actual.i2s!==true||actual.sd!==true)throw Error('先启动 I²S 并挂载 microSD');actual.playing=null;await command('play_on '+path+' 0');break;
   }
   case 'play-stop':actual.playing=null;await command('play_off',/play stop requested/);break;
   case 'reg-read':await command(`iic_rd ${hex(registerAddress,4)} 1`,/\[0x/);break;
   case 'reg-write':await rawWrite();break;
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
$('#showConnection').onclick=()=>panel('connection');$('#showRegisters').onclick=()=>panel('registers');$('#showLog').onclick=()=>panel('log');$('#exportLog').onclick=exportLog;
$('#exportConfig').onclick=()=>{download('ESP32-A1-config.json',JSON.stringify({schema:'a1-audio-lab/1',version:VERSION,config},null,2));$('#toolMenu').hidden=true;};
$('#importConfig').onclick=()=>{$('#toolMenu').hidden=true;$('#configFile').click();};
$('#configFile').onchange=async e=>{try{const file=e.target.files[0];if(!file)return;if(file.size>32768)throw Error('配置文件超过 32 KiB');const data=JSON.parse(await file.text());if(data.schema!=='a1-audio-lab/1')throw Error('不是 A1 Audio Lab 配置');config=validateConfig(data.config);Object.keys(FIELD_LABELS).forEach(k=>dirtyFields.add(k));source=serial.ready?'device':'draft';panel('clock');status('配置已导入草稿，未向设备写入。');}catch(e){panel('connection');status(e.message,true);}finally{$('#configFile').value='';}};
document.addEventListener('click',e=>{
 const scopeButton=e.target.closest('[data-scope]');if(scopeButton){startScope(scopeButton.dataset.scope,+scopeButton.dataset.channel);return;}
 const modeButton=e.target.closest('[data-mode]');if(modeButton){mode=modeButton.dataset.mode;try{localStorage.setItem('a1-lab-mode',mode);}catch{}draw();return;}
 const sourceButton=e.target.closest('[data-source]');if(sourceButton){source=sourceButton.dataset.source;draw();return;}
 const node=e.target.closest('[data-node]');if(node){panel(node.dataset.node);return;}
 const open=e.target.closest('[data-open]');if(open){panel(open.dataset.open);return;}
 const act=e.target.closest('[data-action]');if(act){actionClick(act.dataset.action);return;}
 const reg=e.target.closest('[data-reg]');if(reg){registerAddress=+reg.dataset.reg;panel('registers');return;}
 if(e.target.id==='panelConnect')connect();if(e.target.id==='downloadLog')exportLog();
});
$('#graph').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.closest('[data-node]')){e.preventDefault();panel(e.target.closest('[data-node]').dataset.node);}});
$('#panelBody').addEventListener('input',e=>{
 const key=e.target.dataset.field;if(!key)return;
 if(key==='registerAddress'){registerAddress=+e.target.value;panel('registers');return;}
 if(e.target.type==='number'&&!e.target.validity.valid)return;
 const value=e.target.type==='checkbox'?e.target.checked:Number(e.target.value);
 try{editDraft(config,actual,dirtyFields,key,value);}catch(error){status(error.message,true);return;}
 const out=$('#out-'+key);if(out)out.textContent=value+' '+e.target.dataset.unit;
 source=serial.ready?'device':'draft';draw();status(pendingDraft(config,actual,dirtyFields).length?'草稿已修改，尚未向设备写入。':'草稿与已读取的设备值一致。');
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
 await run(async()=>{
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
  $('#wavePanel').hidden=false;$('#waveTitle').textContent=kind==='adc'?(ch===actual.channels?'RE 回采 · ADC 流':'ADC'+ch+' · 数字输出'):(ch?'DAC R':'DAC L')+' · 播放数据';
  $('#waveChannel').innerHTML=Array.from({length:kind==='adc'?actual.channels+Number(actual.reference):2},(_,i)=>`<option value="${i}" ${i===ch?'selected':''}>${kind==='adc'?(i===actual.channels?'RE':'ADC '+i):(i?'右声道':'左声道')}</option>`).join('');
  $('#timeWindow').disabled=!serial.capabilities.has('web_scope_window');$('#timeNumber').disabled=$('#timeWindow').disabled;syncTimeInputs();
  $('#wavePanel').classList.toggle('playback-wave',kind==='dac');updateDockLayout();paintWave('正在等待实板 PCM…');
 });schedulePoll(20);
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
 handle.onpointerdown=e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);drag={key,x:e.clientX,width:$(key==='wave'?'#wavePanel':'#inspector').getBoundingClientRect().width};document.body.classList.add('panel-resizing');};
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
function commitTime(){const el=$('#timeNumber'),value=el.valueAsNumber,limit=actual.maxWindowMs??10000;if(!Number.isFinite(value)||value<5||value>limit){el.value=timeWindowMs;status('时间窗范围为 5–'+limit+' ms。',true);return;}changeTimeWindow(value);el.value=timeWindowMs;rememberTime();}
$('#timeNumber').onchange=commitTime;$('#timeNumber').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();commitTime();e.target.blur();}};
$('#waveCanvas').addEventListener('wheel',e=>{if(!e.deltaY)return;e.preventDefault();const r=e.currentTarget.getBoundingClientRect();yBounds=zoomVertical(yBounds.min,yBounds.max,e.deltaY,(e.clientY-r.top)/r.height);yAutomatic=false;paintWave();},{passive:false});
$('#autoScale').onclick=()=>{yAutomatic=true;paintWave();};
const canvasObserver=new ResizeObserver(()=>{const canvas=$('#waveCanvas'),r=canvas.getBoundingClientRect();if(r.width<1||r.height<1)return;const dpr=window.devicePixelRatio||1,w=Math.round(r.width*dpr),h=Math.round(r.height*dpr);if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;paintWave();}});canvasObserver.observe($('#waveCanvas'));
const dockObserver=new ResizeObserver(updateDockLayout);dockObserver.observe($('.topbar'));dockObserver.observe($('.legend'));window.addEventListener('resize',updateDockLayout);updateDockLayout();

// Display-only controls. None of these send device commands.
$('#pendingDraftButton').onclick=()=>panel('changes');
$('#workspaceLog').onclick=()=>{const saved=lastOperation;panel('log');status(saved.text,saved.error);};
$('#highlightPath').onchange=e=>{highlightPath=e.target.checked;draw();};
document.addEventListener('click',e=>{
 if(e.target.id==='revertModule'||e.target.id==='revertAll'){
  revertDraft(config,actual,dirtyFields,e.target.id==='revertModule'?moduleFields(applyKind,gainIndex):Object.keys(FIELD_LABELS));
  draw();status('已恢复可读取的设备值。未读取的字段保留草稿。');
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
