import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULTS,clone,newActual,planFor,validateStep,REQUIRED} from '../core.mjs';
import {editDraft,pendingDraft,revertDraft,moduleFields,traceConnections,explainFailure} from '../workbench.mjs';
import {translate,setLanguage,getLanguage,preferredLanguage} from '../i18n.mjs';
import {renderGraph} from '../graph.mjs';
import {A1Serial} from '../serial.mjs';
import {readFileSync} from 'node:fs';

test('draft changes are validated, tracked and removed when equal to confirmed values',()=>{
 const c=clone(DEFAULTS),a=newActual(),dirty=new Set();a.volume=25;
 editDraft(c,a,dirty,'volume',31);assert.equal(pendingDraft(c,a,dirty)[0].draft,31);assert.equal(a.volume,25);
 assert.throws(()=>editDraft(c,a,dirty,'volume',NaN));assert.equal(c.volume,31);
 editDraft(c,a,dirty,'volume',25);assert.equal(dirty.size,0);
});
test('reverting preserves unknown or unrepresentable values and pre-mute gain',()=>{
 const c=clone(DEFAULTS),a=newActual(),dirty=new Set(['volume','gain0','gain1','rate']);
 a.volume=45;a.gains=[.5,12,0,0];revertDraft(c,a,dirty);assert.equal(c.volume,45);assert.ok(dirty.has('gain0'));assert.ok(dirty.has('rate'));assert.equal(c.gains[1],12);
 a.adcMute=true;dirty.add('gain1');c.gains[1]=6;revertDraft(c,a,dirty);assert.equal(c.gains[1],6);assert.ok(dirty.has('gain1'));
});
test('DAC main action covers volume verification and mute; off clears only applied fields',()=>{
 const c=clone(DEFAULTS);c.dac=true;c.volume=42;c.dacMute=true;
 const steps=planFor('dac',c,newActual());assert.deepEqual(steps.map(s=>s.command),['i2s_on','dac_on','dac_vol 42','dac_vol','dac_mute 1']);
 assert.throws(()=>validateStep(steps[3],'DAC vol = 41'),/读回不一致/);
 c.dac=false;assert.deepEqual(planFor('dac',c).map(s=>s.command),['dac_off']);assert.deepEqual(moduleFields('dac',0,c),['dac']);
});
test('path tracing follows one microphone through TDM without lighting sibling microphones',()=>{
 const edges=[{id:'a',from:'mic0',to:'tdm',enabled:true},{id:'b',from:'mic1',to:'tdm',enabled:true},{id:'c',from:'tdm',to:'host',enabled:true},{id:'d',from:'host',to:'sd',enabled:false},{id:'e',from:'sd',to:'next',enabled:true}];
 const t=traceConnections(edges,'mic0');assert.deepEqual([...t.edgeIds],['a','c']);assert.ok(!t.nodeIds.has('mic1'));assert.ok(!t.nodeIds.has('next'));
 assert.ok(traceConnections(edges,'host').edgeIds.has('d'));
});
test('selection emphasis never changes disabled state or animation',()=>{
 const c=clone(DEFAULTS),a=newActual();const svg=renderGraph(c,a,{source:'device',selected:'vad'});
 assert.match(svg,/data-edge="vad-input" class="edge disabled[^\"]*related/);assert.ok(!svg.includes('edge-motion'));
 assert.match(svg,/aria-pressed="true"/);
});
test('locale changes preserve technical names and do not modify device plans',()=>{
 const c=clone(DEFAULTS),a=newActual(),before=JSON.stringify(planFor('dac',c,a));
 setLanguage('en');assert.equal(getLanguage(),'en');assert.equal(translate('写入播放设置'),'Apply playback settings');assert.equal(translate('ADC0 · 输入增益'),'ADC0 · Input gain');
 assert.equal(translate('iic_wr 0x0067 0x80 0xff'),'iic_wr 0x0067 0x80 0xff');assert.equal(JSON.stringify(planFor('dac',c,a)),before);
 setLanguage('zh');assert.equal(translate('写入播放设置'),'写入播放设置');assert.equal(explainFailure(Error('BG DTUNE 0x108')).title,'Codec 初始化失败');
});
test('stalled native writes still time out and teardown is bounded',async()=>{
 let push,stalled=false;const readable=new ReadableStream({start(c){push=c;}});
 const writable=new WritableStream({write(b){const command=new TextDecoder().decode(b).trim();if(stalled)return new Promise(()=>{});push.enqueue(new TextEncoder().encode((command==='help'?REQUIRED.join('\n'):'')+'\nesp32_a1 > '));}});
 const port={open:async()=>{},close:async()=>{},readable,writable};const s=new A1Serial({timeout:25});
 await s.connect({requestPort:async()=>port});stalled=true;
 await assert.rejects(()=>s.command('dac_vol'),/超时/);assert.equal(s.ready,false);
 const start=performance.now();await s.disconnect();assert.ok(performance.now()-start<1400);assert.equal(s.port,null);
});
test('port chooser cancellation can be retried without stale connecting state',async()=>{
 const s=new A1Serial();await assert.rejects(()=>s.connect({requestPort:async()=>{throw Error('No port selected');}}));assert.equal(s.connecting,false);assert.equal(s.port,null);
});
test('plain Chinese UI messages and validation errors have English catalogue coverage',()=>{
 for(const file of ['../app.mjs','../core.mjs','../media.mjs','../examples.mjs']){
  const source=readFileSync(new URL(file,import.meta.url),'utf8');
  for(const match of source.matchAll(/(['"])([^'"\n]*[\u4e00-\u9fff][^'"\n]*)\1/g)){
   const text=match[2];if(text.includes('<')||text.length>=180)continue;
   assert.ok(!/[\u4e00-\u9fff]/.test(translate(text,'en')),`Missing English: ${text}`);
  }
 }
});

test('English is the first-run default while an explicit Chinese choice is preserved',()=>{assert.equal(preferredLanguage(null),'en');assert.equal(preferredLanguage(undefined),'en');assert.equal(preferredLanguage('unexpected'),'en');assert.equal(preferredLanguage('zh'),'zh');assert.equal(preferredLanguage('en'),'en');});
