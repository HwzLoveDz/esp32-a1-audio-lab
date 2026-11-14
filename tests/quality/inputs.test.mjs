import test from 'node:test';
import assert from 'node:assert/strict';
import fc from 'fast-check';
import {DEFAULTS,clone,newActual,validateConfig,planFor,validateStep} from '../../core.mjs';
import {validWavPath,recordingSeconds} from '../../media.mjs';
import {editDraft,pendingDraft,moduleSubmission,completeSubmission,revertDraft} from '../../workbench.mjs';

const seed=2026111401;
const gains=fc.array(fc.integer({min:-64,max:63}),{minLength:4,maxLength:4});
test('quality: validated configuration owns its arrays and cannot be changed by its caller',()=>{
 fc.assert(fc.property(gains,values=>{
  const input={...clone(DEFAULTS),gains:[...values]},result=validateConfig(input),expected=[...values];
  input.gains[0]=input.gains[0]===63?-64:63;
  assert.deepEqual(result.gains,expected);
 }),{seed,numRuns:1000});
});
test('quality: arbitrary out-of-range and wrong-type settings are rejected without changing the input',()=>{
 fc.assert(fc.property(fc.oneof(fc.integer({max:-65}),fc.integer({min:64}),fc.double({noNaN:false,noDefaultInfinity:false}).filter(n=>!Number.isInteger(n)),fc.string(),fc.boolean(),fc.constant(null),fc.constant(undefined),fc.array(fc.integer()),fc.dictionary(fc.string(),fc.string())),bad=>{
  const input={...clone(DEFAULTS),gains:[bad,0,0,0]},before={...input,gains:input.gains.map(v=>Array.isArray(v)?[...v]:v&&typeof v==='object'?Object.assign(Object.create(Object.getPrototypeOf(v)),v):v)};
  assert.throws(()=>validateConfig(input));assert.deepEqual(input,before);
 }),{seed:seed+1,numRuns:2500});
});
test('quality: clock acknowledgements cannot claim success for a different applied value',()=>{
 fc.assert(fc.property(fc.constantFrom(8000,16000,44100,48000),rate=>{
  const c={...clone(DEFAULTS),rate},steps=planFor('clock',c,newActual());
  assert.doesNotThrow(()=>validateStep(steps[0],'Rate = '+rate));
  assert.throws(()=>validateStep(steps[0],'Rate = '+(rate===48000?16000:48000)));
  assert.throws(()=>validateStep(steps[1],'Bits = '+(c.bits===24?16:24)));
  assert.throws(()=>validateStep(steps[2],'ADC channels = '+(c.channels===4?1:4)));
 }),{seed:seed+2,numRuns:100});
});
test('quality: reference getter must match both enable and selected source',()=>{
 fc.assert(fc.property(fc.boolean(),fc.constantFrom(1,2),(reference,referenceChannel)=>{
  const c={...clone(DEFAULTS),reference,referenceChannel},step=planFor('reference',c,newActual())[1];
  assert.doesNotThrow(()=>validateStep(step,`DAC ref: enable=${+reference} ref_dac_ch=0x${referenceChannel}`));
  assert.throws(()=>validateStep(step,`DAC ref: enable=${+!reference} ref_dac_ch=0x${referenceChannel}`));
  assert.throws(()=>validateStep(step,`DAC ref: enable=${+reference} ref_dac_ch=0x${3-referenceChannel}`));
 }),{seed:seed+3,numRuns:100});
});
test('quality: WAV paths reject empty path components and dot traversal',()=>{
 fc.assert(fc.property(fc.array(fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/),{minLength:1,maxLength:4}),parts=>{
  assert.equal(validWavPath('/sdcard/'+parts.join('/')+'.wav'),true);
  assert.equal(validWavPath('/sdcard/'+parts.join('//')+'//.wav'),false);
  assert.equal(validWavPath('/sdcard/../'+parts.at(-1)+'.wav'),false);
  assert.equal(validWavPath('/sdcard//'+parts.at(-1)+'.wav'),false);
 }),{seed:seed+4,numRuns:1000});
});
test('quality: recording duration accepts only bounded integer seconds',()=>{
 fc.assert(fc.property(fc.integer({min:1,max:1800}),n=>assert.equal(recordingSeconds(String(n)),n)),{seed:seed+5,numRuns:1000});
 for(const bad of ['',0,-1,1801,1.5,'abc',NaN,Infinity])assert.throws(()=>recordingSeconds(bad));
});
test('quality: scheduled edits and responses cannot change a submitted channel or erase a newer edit',async()=>{
 await fc.assert(fc.asyncProperty(fc.scheduler(),fc.integer({min:0,max:3}),fc.integer({min:-64,max:63}),fc.integer({min:-64,max:63}),async(s,index,value,next)=>{
  const c=clone(DEFAULTS),dirty=new Set(['gain'+index]);c.gains[index]=value;
  const submission=moduleSubmission('gain',c,index);
  const write=s.scheduleFunction(async()=>{
   const cmd=planFor(submission.kind,submission.config,newActual(),submission.index)[0].command;
   assert.equal(cmd,`adc_gain ${value} 0x${(1<<index).toString(16).padStart(2,'0')}`);
   completeSubmission(c,dirty,submission);
  })();
  const edit=s.scheduleFunction(async()=>{c.gains[index]=next;dirty.add('gain'+index);})();
  await s.waitFor(Promise.all([write,edit]));
  assert.equal(c.gains[index],next);if(next!==value)assert.ok(dirty.has('gain'+index));
 }),{seed:seed+6,numRuns:1000});
});

class Edit {
 constructor(index,value){this.index=index;this.value=value;}
 check(){return true;}
 run(m,r){editDraft(r.config,r.actual,r.dirty,'gain'+this.index,this.value);m.draft[this.index]=this.value;checkModel(m,r);}
 toString(){return `Edit(ADC${this.index},${this.value})`;}
}
class Submit {
 constructor(index){this.index=index;}
 check(m){return !m.submission;}
 run(m,r){r.submission=moduleSubmission('gain',r.config,this.index);m.submission={index:this.index,value:m.draft[this.index]};checkModel(m,r);}
 toString(){return `Submit(ADC${this.index})`;}
}
class Complete {
 check(m){return !!m.submission;}
 run(m,r){const {index,value}=m.submission;r.actual.gains[index]=value;m.device[index]=value;completeSubmission(r.config,r.dirty,r.submission);m.submission=null;checkModel(m,r);}
 toString(){return 'Response()';}
}
class Revert {
 constructor(index){this.index=index;}
 check(){return true;}
 run(m,r){revertDraft(r.config,r.actual,r.dirty,['gain'+this.index]);m.draft[this.index]=m.device[this.index];checkModel(m,r);}
 toString(){return `Revert(ADC${this.index})`;}
}
function checkModel(m,r){
 assert.deepEqual(r.config.gains,m.draft);
 assert.deepEqual(pendingDraft(r.config,r.actual,r.dirty).map(x=>x.key).sort(),m.draft.flatMap((v,i)=>v!==m.device[i]?['gain'+i]:[]).sort());
}
test('quality: model-based draft, submit, edit, reply and revert sequences preserve intent',()=>{
 const index=fc.integer({min:0,max:3});
 const commands=fc.commands([fc.tuple(index,fc.integer({min:-64,max:63})).map(([i,v])=>new Edit(i,v)),index.map(i=>new Submit(i)),fc.constant(new Complete()),index.map(i=>new Revert(i))],{maxCommands:70});
 fc.assert(fc.property(commands,cmds=>fc.modelRun(()=>{
  const actual=newActual();actual.gains=[0,0,0,0];actual.adcMute=false;
  return {model:{draft:[0,0,0,0],device:[0,0,0,0],submission:null},real:{config:clone(DEFAULTS),actual,dirty:new Set()}};
 },cmds)),{seed:seed+7,numRuns:1000});
});
