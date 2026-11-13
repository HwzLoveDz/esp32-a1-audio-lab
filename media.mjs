import {telemetry,RATES} from './core.mjs';
// SD metadata and playback guards. Does not write to the device or card.
let sequence=0;
export function recordingTag(prefix='web',now=Date.now()){
 return `${prefix}_${now.toString(36)}_${(++sequence).toString(36)}`;
}
export function validWavPath(path){return typeof path==='string'&&/^\/sdcard\/[a-z\d_/-]+\.wav$/i.test(path)&&!path.includes('..');}
export function parseFileList(text){
 if(!/^FLS BEGIN \/sdcard\s*$/m.test(text)||!/^FLS END \d+\s*$/m.test(text))throw Error('未收到完整的 SD 文件列表');
 return [...text.matchAll(/^E (\d+) ([^\r\n]+)$/gm)].map(m=>({bytes:Number(m[1]),path:'/sdcard/'+m[2].trim()})).filter(f=>Number.isSafeInteger(f.bytes)&&f.bytes>=0&&validWavPath(f.path));
}
export function wavInfo(text){
 const m=text.match(/ch0\s+(\d+) Hz (\d+)-bit (\d+)ch, (\d+) frames analyzed/);
 if(!m)throw Error('无法读取 WAV 格式');return {rate:+m[1],bits:+m[2],channels:+m[3]};
}
export function wavTransferInfo(text){
 const begin=text.match(/FGET BEGIN (\d+) ([0-9a-f]{1,8}) /i);
 if(!begin||!/^FGET END\s*$/m.test(text))throw Error('WAV 传输不完整');
 const parts=[...text.matchAll(/^D ([A-Za-z0-9+/=]+)\s*$/gm)].map(m=>Uint8Array.from(atob(m[1]),c=>c.charCodeAt(0)));
 const length=parts.reduce((n,p)=>n+p.length,0);if(length!==+begin[1]||length<44||length>180000)throw Error('WAV 传输长度无效');
 const bytes=new Uint8Array(length);let pos=0;for(const part of parts){bytes.set(part,pos);pos+=part.length;}
 let crc=0xffffffff;for(const b of bytes){crc^=b;for(let i=0;i<8;i++)crc=crc&1?(crc>>>1)^0xedb88320:crc>>>1;}
 if(((crc^0xffffffff)>>>0)!==parseInt(begin[2],16))throw Error('WAV CRC32 核对失败');
 const word=offset=>String.fromCharCode(...bytes.slice(offset,offset+4)),view=new DataView(bytes.buffer);
 if(word(0)!=='RIFF'||word(8)!=='WAVE'||view.getUint32(4,true)+8!==length)throw Error('WAV 文件头无效');
 let info;
 for(let offset=12;offset+8<=length;){const id=word(offset),size=view.getUint32(offset+4,true),start=offset+8;if(start+size>length)throw Error('WAV 文件头无效');
  if(id==='fmt '&&size>=16){if(view.getUint16(start,true)!==1)throw Error('只支持 PCM WAV');info={rate:view.getUint32(start+4,true),channels:view.getUint16(start+2,true),bits:view.getUint16(start+14,true)};}
  if(id==='data'&&info)return info;offset=start+size+(size%2);
 }
 throw Error('WAV 文件头无效');
}
export function playbackGuard(info,actual){
 if(info.channels<1||info.channels>2)throw Error('回放需要单声道或双声道 WAV；多通道录音请先选择并导出播放声道');
 if(info.rate!==actual.rate||info.bits!==actual.bits)throw Error('WAV 格式与当前共享格式不一致，请先在时钟模块调整采样率和位深');
 if(actual.adc&&!actual.reference&&info.channels!==actual.channels)throw Error('回放声道数与正在采集的通路不一致，请先停止 ADC 或调整通道数');
 if(!actual.dac)throw Error('请先在 DAC 模块开启通路并写入设置');
}
export function mediaEvent(text){
 const done=text.match(/Recording done: (\d+) bytes -> (\/sdcard\/\S+\.wav) \(rx_ovf=(\d+)/);
 if(done&&validWavPath(done[2]))return {type:'record-done',path:done[2],bytes:+done[1]+44,overflow:+done[3]};
 const start=text.match(/Rec start:.*? -> (\/sdcard\/\S+\.wav)/);
 if(start&&validWavPath(start[1]))return {type:'record-start',path:start[1]};
 if(/(?:^|\n)E \(\d+\) A1_FILE:|(?:^|\n)E \(\d+\).*\brec:|(?:^|\n)E \(\d+\).*\bplay:/m.test(text))return {type:'error',message:text.trim()};
 return null;
}

export function canSaveFifo(actual){return actual.sd===true&&actual.vad===true&&actual.vadOutput===true;}

export function recordingSeconds(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>1800)throw Error('录音时长需为 1–1800 秒');return n;}
export function wavDeviceInfo(text){
 const f=telemetry(text,'file');
 const ints=['rate','bits','channels','bytes','dataBytes','frames','scannedBytes'];
 if(ints.some(k=>!Number.isSafeInteger(f[k])||f[k]<0)||!RATES.includes(f.rate)||![16,24].includes(f.bits)||f.channels<1||f.channels>5||f.bytes>2147483647||f.bytes<f.dataBytes+44||f.dataBytes!==f.frames*f.channels*(f.bits/8)||typeof f.verified!=='boolean'||!/^([a-f0-9]{8})$/i.test(f.crc32)||f.scannedBytes!==(f.verified?f.bytes:0))throw Error('WAV 文件信息无效');
 return f;
}
export function recordingStatus(text){
 const s=telemetry(text,'record'),ints=['capturedBytes','writtenBytes','targetBytes','bufferBytes','peakBufferBytes','rate','frameBytes','elapsedMs'];
 if(typeof s.active!=='boolean'||ints.some(k=>!Number.isSafeInteger(s[k])||s[k]<0||s[k]>2147483647)||!Number.isInteger(s.error)||s.writtenBytes>s.capturedBytes||s.targetBytes&&s.capturedBytes>s.targetBytes||s.peakBufferBytes>s.bufferBytes||(s.active||s.capturedBytes||s.frameBytes)&&(!RATES.includes(s.rate)||s.frameBytes<1||s.frameBytes>15)||s.active&&!s.bufferBytes)throw Error('录音进度应答无效');
 return s;
}

export function fileSize(bytes){
 const units=['B','KiB','MiB','GiB'];let value=bytes,index=0;
 while(value>=1024&&index<units.length-1){value/=1024;index++;}
 return value.toFixed(index?1:0)+' '+units[index];
}
