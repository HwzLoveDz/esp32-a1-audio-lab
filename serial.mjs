import {hasPrompt,stripTerminal,assertResponse,identifyCLI} from './core.mjs';

export class A1Serial {
 constructor({onData=()=>{},onDisconnect=()=>{},timeout=7000}={}){this.onData=onData;this.onDisconnect=onDisconnect;this.timeout=timeout;this.port=null;this.reader=null;this.writer=null;this.pending=null;this.ready=false;this.closed=true;this.session=0;}
 async connect(serial=globalThis.navigator?.serial){
  if(!serial)throw Error('此浏览器未提供 Web Serial。请使用桌面 Chrome 或 Edge');
  if(this.port)throw Error('请先断开现有串口');
  const port=await serial.requestPort(); // User chooses the actual EV Board.
  try{
   await port.open({baudRate:115200,bufferSize:32768});this.port=port;this.closed=false;this.session++;this.ready=false;
   this.writer=port.writable.getWriter();this.reader=port.readable.getReader();
   this.pump=this.readLoop(this.session);
   await this.exchange('');
   const help=await this.exchange('help',{accept:s=>/\biic_rd\b|(?:Error:|command not found)/i.test(s)});this.capabilities=identifyCLI(help);this.ready=true;
   return {info:port.getInfo?.()??{},capabilities:[...this.capabilities]};
  }catch(e){if(this.port)await this.disconnect();else try{await port.close();}catch{}throw e;}
 }
 async readLoop(session){
  const decoder=new TextDecoder();
  try{
   while(!this.closed&&session===this.session){const {value,done}=await this.reader.read();if(done)break;if(!value)continue;
    const chunk=decoder.decode(value,{stream:true});this.onData(chunk);
    const p=this.pending;
    if(p&&p.session===session){p.raw+=chunk;if(p.raw.length>262144){this.failPending(Error('设备应答超出 256 KiB，连接需重新建立'));this.ready=false;continue;}
     if(hasPrompt(p.raw)){const clean=stripTerminal(p.raw);if(!p.accept||p.accept(clean)){clearTimeout(p.timer);this.pending=null;p.resolve(clean);}else if(/^esp32_a1\s*>\s*$/.test(clean.trim()))p.raw="";}
    }
   }
  }catch(e){if(!this.closed)this.failPending(Error('串口读取中断：'+e.message));}
  finally{if(!this.closed&&session===this.session){this.closed=true;this.ready=false;this.failPending(Error('设备已断开'));this.onDisconnect();}}
 }
 failPending(e){if(this.pending){clearTimeout(this.pending.timer);const p=this.pending;this.pending=null;p.reject(e);}}
 async exchange(command,{timeout=this.timeout,accept=null}={}){
  if(!this.port||this.closed)throw Error('串口未连接');
  if(this.pending)throw Error('上一条命令仍在执行');
  if(/[\r\n\x00-\x1f\x7f]/.test(command))throw Error('命令包含非法控制字符');
  const response=new Promise((resolve,reject)=>{const p={resolve,reject,raw:'',session:this.session,accept};p.timer=setTimeout(()=>{
   if(this.pending!==p)return;this.pending=null;this.ready=false;this.closed=true;
   reject(Error('设备应答超时；连接已停用，请断开后重连，避免把迟到应答配给下一条命令'));this.onDisconnect();
  },timeout);this.pending=p;});
  try{await this.writer.write(new TextEncoder().encode(command+'\r'));}catch(e){this.failPending(e);}
  return response;
 }
 async command(command,options){
  if(!this.ready)throw Error('尚未识别兼容的 a1_cli，不能发送控制命令');
  const name=command.split(/\s+/)[0];
  if(!this.capabilities.has(name))throw Error('当前固件未提供命令：'+name);
  return assertResponse(await this.exchange(command,options));
 }
 async disconnect(){
  this.closed=true;this.ready=false;this.session++;this.failPending(Error('已断开连接'));
  try{await this.reader?.cancel();}catch{}
  try{await this.pump;}catch{}
  try{this.reader?.releaseLock();}catch{}
  try{this.writer?.releaseLock();}catch{}
  try{await this.port?.close();}catch{}
  this.reader=null;this.writer=null;this.port=null;this.onDisconnect();
 }
}
