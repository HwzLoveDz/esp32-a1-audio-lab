import {takePrompt,assertResponse,identifyCLI} from './core.mjs';

export class A1Serial {
 constructor({onData=()=>{},onDisconnect=()=>{},timeout=7000}={}){this.onData=onData;this.onDisconnect=onDisconnect;this.timeout=timeout;this.port=null;this.reader=null;this.writer=null;this.pending=null;this.ready=false;this.closed=true;this.session=0;this.lastLatencyMs=null;this.connecting=false;}
 async connect(serial=globalThis.navigator?.serial){
  if(!serial)throw Error('此浏览器未提供 Web Serial。请使用桌面 Chrome 或 Edge');
  if(this.port||this.connecting||this.disconnecting)throw Error('请先断开现有串口');
  this.connecting=true;let port;
  try{port=await serial.requestPort();}catch(e){this.connecting=false;throw e;} // User chooses the actual EV Board.
  try{
   await port.open({baudRate:115200,bufferSize:32768});this.port=port;this.closed=false;this.session++;this.ready=false;
   this.writer=port.writable.getWriter();this.reader=port.readable.getReader();
  this.pump=this.readLoop(this.session,this.reader);
   await this.exchange('');
   const help=await this.exchange('help',{accept:s=>/\biic_rd\b|(?:Error:|command not found)/i.test(s)});this.capabilities=identifyCLI(help);this.ready=true;
   return {info:port.getInfo?.()??{},capabilities:[...this.capabilities]};
  }catch(e){if(this.port)await this.disconnect();else try{await port.close();}catch{}throw e;}finally{this.connecting=false;}
 }
 async readLoop(session,reader){
  const decoder=new TextDecoder();
  try{
   while(!this.closed&&session===this.session){const {value,done}=await reader.read();if(done)break;if(!value)continue;if(session!==this.session||this.closed)break;
    const chunk=decoder.decode(value,{stream:true});this.onData(chunk);
    const p=this.pending;
    if(p&&p.session===session){p.raw+=chunk;if(p.raw.length>262144){this.failPending(Error('设备应答超出 256 KiB，连接需重新建立'));this.ready=false;continue;}
     let part;while((part=takePrompt(p.raw))){if(!p.accept||p.accept(part.response)){clearTimeout(p.timer);this.pending=null;p.resolve(part.response);break;}p.raw=part.rest;}
    }
   }
  }catch(e){if(!this.closed&&session===this.session)this.failPending(Error('串口读取中断：'+e.message));}
  finally{if(!this.closed&&session===this.session){this.closed=true;this.ready=false;this.failPending(Error('设备已断开'));this.onDisconnect();}}
 }
 failPending(e){if(this.pending){clearTimeout(this.pending.timer);const p=this.pending;this.pending=null;p.reject(e);}}
 async exchange(command,{timeout=this.timeout,accept=null}={}){
  if(!this.port||this.closed)throw Error('串口未连接');
  if(this.pending)throw Error('上一条命令仍在执行');
  if(/[\r\n\x00-\x1f\x7f]/.test(command))throw Error('命令包含非法控制字符');
  const started=performance.now();
  const response=new Promise((resolve,reject)=>{const p={resolve:value=>{this.lastLatencyMs=Math.round(performance.now()-started);resolve(value);},reject,raw:'',session:this.session,accept};p.timer=setTimeout(()=>{
   if(this.pending!==p)return;this.pending=null;this.ready=false;this.closed=true;
   reject(Error('设备应答超时；连接已停用，请断开后重连，避免把迟到应答配给下一条命令'));this.onDisconnect();
  },timeout);this.pending=p;});
  const request=this.pending;
  const failed=e=>{if(this.pending!==request)return;this.ready=false;this.closed=true;this.failPending(e);this.onDisconnect();};
  try{Promise.resolve(this.writer.write(new TextEncoder().encode(command+'\r'))).catch(failed);}catch(e){failed(e);}
  return response;
 }
 async command(command,options){
  if(!this.ready)throw Error('尚未识别兼容的 a1_cli，不能发送控制命令');
  const name=command.split(/\s+/)[0];
  if(!this.capabilities.has(name))throw Error('当前固件未提供命令：'+name);
  return assertResponse(await this.exchange(command,options));
 }
 async disconnect(){
  if(this.disconnecting)return this.disconnecting;
  const cleanup=this.cleanup();this.disconnecting=cleanup;
  try{return await cleanup;}finally{this.disconnecting=null;}
 }
 async cleanup(){
  const reader=this.reader,writer=this.writer,port=this.port,pump=this.pump;
  this.closed=true;this.ready=false;this.session++;this.failPending(Error('已断开连接'));
  const bounded=async fn=>{let timer;try{return await Promise.race([Promise.resolve().then(fn).then(()=>true,()=>false),new Promise(r=>timer=setTimeout(()=>r(false),400))]);}finally{clearTimeout(timer);}};
  await Promise.all([bounded(()=>reader?.cancel()),bounded(()=>writer?.abort())]);
  await bounded(()=>pump);
  try{reader?.releaseLock();}catch{}
  try{writer?.releaseLock();}catch{}
  const clean=await bounded(()=>port?.close());
  this.reader=null;this.writer=null;this.port=null;this.onDisconnect();
  return clean;
 }
}
