import {clone,validateConfig} from './core.mjs';

export const FIELD_LABELS={rate:'采样率',bits:'音频位深',channels:'输入通道',adc:'ADC 通路',adcMute:'ADC 静音',dac:'DAC 通路',dacMute:'DAC 静音',volume:'播放音量',reference:'DAC 回采',referenceChannel:'参考声道',vad:'VAD 检测',vadOutput:'VAD 滤波输出',gain0:'ADC0 增益',gain1:'ADC1 增益',gain2:'ADC2 增益',gain3:'ADC3 增益'};

export function draftValue(config,key){return /^gain[0-3]$/.test(key)?config.gains[+key.at(-1)]:config[key];}
export function deviceValue(actual,key){
 if(/^gain[0-3]$/.test(key))return actual.adcMute===true?null:actual.gains[+key.at(-1)];
 return actual[key]??null;
}
export function editDraft(config,actual,dirty,key,value){
 if(!Object.hasOwn(FIELD_LABELS,key))throw Error('未知设置字段');
 const next=clone(config);
 if(/^gain[0-3]$/.test(key))next.gains[+key.at(-1)]=value;else next[key]=value;
 validateConfig(next);
 if(/^gain[0-3]$/.test(key))config.gains[+key.at(-1)]=value;else config[key]=value;
 if(deviceValue(actual,key)!==null&&deviceValue(actual,key)===value)dirty.delete(key);else dirty.add(key);
}
export function pendingDraft(config,actual,dirty){
 return Object.keys(FIELD_LABELS).filter(key=>dirty.has(key)).filter(key=>deviceValue(actual,key)===null||deviceValue(actual,key)!==draftValue(config,key)).map(key=>({key,label:FIELD_LABELS[key],draft:draftValue(config,key),device:deviceValue(actual,key)}));
}
export function moduleFields(kind,index=0,config=null){
 const groups={clock:['rate','bits','channels'],adc:config?.adc===false?['adc']:['adc','adcMute'],dac:config?.dac===false?['dac']:['dac','dacMute','volume'],gain:['gain'+index],adcMute:['adcMute'],volume:['volume','dacMute'],reference:['reference','referenceChannel'],vad:config?.vad===false?['vad']:['vad','vadOutput']};
 return groups[kind]||[];
}
// Capture the user's intent before waiting for a poll or device response.
export function moduleSubmission(kind,config,index=0){
 const submitted=validateConfig(clone(config));
 return {kind,index,config:submitted,keys:moduleFields(kind,index,submitted)};
}
export function completeSubmission(config,dirty,submission){
 for(const key of submission.keys)if(draftValue(config,key)===draftValue(submission.config,key))dirty.delete(key);else dirty.add(key);
}
export function revertDraft(config,actual,dirty,keys=Object.keys(FIELD_LABELS)){
 for(const key of keys){const value=deviceValue(actual,key);if(value===null)continue;const trial=clone(config);if(/^gain[0-3]$/.test(key))trial.gains[+key.at(-1)]=value;else trial[key]=value;try{validateConfig(trial);}catch{continue;}if(/^gain[0-3]$/.test(key))config.gains[+key.at(-1)]=value;else config[key]=value;dirty.delete(key);}
 return config;
}
export function formatSetting(key,value){
 if(value===null||value===undefined)return '未读取';
 if(typeof value==='boolean')return value?'开启':'关闭';
 if(/^gain/.test(key))return value+' dB';
 if(key==='rate')return value/1000+' kHz';
 if(key==='bits')return value+' bit';
 if(key==='channels')return value+' MIC';
 if(key==='referenceChannel')return value===2?'DAC 右声道':'DAC 左声道';
 return String(value);
}
export function explainFailure(error){
 const detail=String(error?.message||error);
 if(/BG DTUNE|0x108/i.test(detail))return {title:'Codec 初始化失败',hint:'检查固件的 Codec 复位配置。保留错误记录，避免连续重试写入。',detail};
 if(/0x106|clocks do not match/i.test(detail))return {title:'收发格式不一致',hint:'先关闭通路，再核对共享 TDM 帧宽和采样格式。',detail};
 if(/超时|timeout/i.test(detail))return {title:'设备通信超时',hint:'断开后重新连接，并确认串口未被其他程序占用。',detail};
 if(/NotFoundError|No port selected|user.*cancel/i.test(detail))return {title:'已取消设备选择',hint:'点击连接后，选择实际开发板串口。',detail,cancelled:true};
 if(/NetworkError|AccessDenied|拒绝访问|Failed to open/i.test(detail))return {title:'无法打开串口',hint:'关闭其他串口程序后再连接。',detail};
 return {title:detail.split('\n')[0],hint:'查看通信记录中的完整应答，确认设备当前状态后再操作。',detail};
}

// Follow ancestors and descendants independently. A selected MIC branch does
// not turn backwards through the shared TDM hub into every other microphone.
export function traceConnections(edges,selected){
 const nodeIds=new Set(selected?[selected]:[]),edgeIds=new Set();
 for(const forward of [false,true]){
  const queue=selected?[selected]:[],visited=new Set();
  while(queue.length){const node=queue.shift();if(visited.has(node))continue;visited.add(node);
   for(const edge of edges){const from=forward?edge.from:edge.to,to=forward?edge.to:edge.from;if(from!==node||!to)continue;
    if(!edge.enabled&&node!==selected)continue;
    edgeIds.add(edge.id);nodeIds.add(to);if(edge.enabled)queue.push(to);
   }
  }
 }
 return {nodeIds,edgeIds};
}
