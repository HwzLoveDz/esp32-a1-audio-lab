window.addEventListener('load',()=>{
 const t=window.__A1_UI_TEST__;if(!t)throw Error('No isolated mock; quality runner stopped');
 const toolbar=document.createElement('div');toolbar.id='qaToolbar';toolbar.style.cssText='position:fixed;right:8px;bottom:56px;max-width:calc(100vw - 16px);flex-wrap:wrap;z-index:1500;display:flex;gap:6px;align-items:center;padding:6px;background:#fffbe8;border:1px solid #867730;border-radius:6px;color:#332d10;font:12px sans-serif';
 toolbar.innerHTML='<b>QA · MOCK ONLY</b><button id="qaRunAll" style="font-size:12px;padding:4px 8px">Run full audit</button><button id="qaAxe" style="font-size:12px;padding:4px 8px">Scan current</button><button id="qaAll" style="font-size:12px;padding:4px 8px">Guided accessibility</button><button id="qaFlows" style="font-size:12px;padding:4px 8px">Guided workflows</button><button id="qaInputs" style="font-size:12px;padding:4px 8px">Input matrix</button><button id="qaMonkey" style="font-size:12px;padding:4px 8px">Seeded stress</button><output id="qaResult" role="status">Ready</output>';
 document.body.append(toolbar);
 const report={version:document.querySelector('.version').textContent,bundleSha:document.querySelector('meta[name="qa-bundle-sha"]').content,viewport:{width:innerWidth,height:innerHeight},scans:[],inputs:[],nodes:[],flows:[],errors:t.errors};
 const wait=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=async()=>{let stable=0;for(let n=0;n<200;n++){stable=document.querySelector('#showExamples').disabled?0:stable+1;if(stable>=3)return;await wait(50);}throw Error('UI remained busy');};
 const click=sel=>{const e=document.querySelector(sel);if(!e)throw Error('Missing '+sel);e.dispatchEvent(new MouseEvent('click',{bubbles:true}));};
 const choose=(sel,value)=>{const e=document.querySelector(sel);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};
 const save=async kind=>fetch('/__test/report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind,...report,calls:t.calls,finalState:t.state,createdAt:new Date().toISOString()})});
 const svgReview=()=>{
  const context=document.createElement('canvas').getContext('2d',{willReadFrequently:true});
  const rgba=color=>{context.clearRect(0,0,1,1);context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
  const composite=(fg,bg)=>fg.slice(0,3).map((v,i)=>v*fg[3]/255+bg[i]*(1-fg[3]/255));
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
  const surface=rgba(getComputedStyle(document.querySelector('#graphScroll')).backgroundColor).slice(0,3);
  return [...document.querySelectorAll('#audioGraph text')].map(e=>{
   const style=getComputedStyle(e),rect=e.closest('[data-node]')?.querySelector('rect');
   const bg=rect?composite(rgba(getComputedStyle(rect).fill),surface):style.stroke!=='none'?composite(rgba(style.stroke),surface):surface;
   const fg=composite(rgba(style.fill),bg),a=luminance(fg),b=luminance(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   return {text:e.textContent,ratio:+ratio.toFixed(2),pass:ratio>=4.5};
  });
 };
 const scan=async label=>{
  await settle();const result=await axe.run({exclude:[['#qaToolbar'],['#simulationBadge']]},{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa','wcag22aa','best-practice']}});
  report.scans.push({label,theme:document.documentElement.dataset.theme||'light',lang:document.documentElement.lang,violations:result.violations,incomplete:result.incomplete,svgContrast:svgReview(),passes:result.passes.map(p=>p.id)});
  document.querySelector('#qaResult').textContent=label+' · '+result.violations.length+' rules';return result;
 };
 const run=async fn=>{for(const e of toolbar.querySelectorAll('button'))e.disabled=true;try{await fn();await save('quality');}catch(e){t.errors.push(String(e.stack||e));document.querySelector('#qaResult').textContent='FAILED '+e.message;await save('quality');}finally{for(const e of toolbar.querySelectorAll('button'))e.disabled=false;}};
 document.querySelector('#qaAxe').onclick=()=>run(()=>scan('current'));
 document.querySelector('#qaAll').onclick=()=>run(async()=>{
  if(!t.connected){click('#connect');await settle();}
  choose('#languageSelect','en');click('[data-mode="pro"]');
  for(const theme of ['light','mint','graphite','ocean','pine','ember']){choose('#themeSelect',theme);click('[data-node="gain0"]');await scan('gain-'+theme);}
  choose('#themeSelect','mint');
  for(const node of ['adc0','clock','volume','reference','vad','host']){click(`[data-node="${node}"]`);await scan(node);}
  for(const [button,label] of [['#showExamples','examples'],['#showRegisters','registers'],['#showConnection','connection'],['#showLog','log']]){click(button);await scan(label);}
  choose('#languageSelect','zh');click('[data-mode="simple"]');click('[data-node="adc"]');await scan('zh-simple-adc');
  click('[data-scope="adc"]');await settle();await wait(300);await scan('zh-waveform');
  choose('#languageSelect','en');await scan('en-waveform');
  for(const theme of ['light','graphite','ocean','pine','ember']){choose('#themeSelect',theme);await scan('wave-'+theme);}
  choose('#themeSelect','mint');
  document.querySelector('#qaResult').textContent='Done '+report.scans.length+' scans · '+report.scans.reduce((n,s)=>n+s.violations.length,0)+' rule failures';
 });
 const mutation=cmd=>!/^(?:dac_vol|dac_ref|set_rate|set_bits|set_ch)$/.test(cmd)&&/^(?:set_|adc_|dac_|i2s_|rec_|play_|sdcard_|vad_on|vad_off|vad_wav|iic_wr)/.test(cmd);
 document.querySelector('#qaInputs').onclick=()=>run(async()=>{
  if(!t.connected){click('#connect');await settle();}
  choose('#languageSelect','en');click('[data-mode="pro"]');
  for(const mode of ['pro','simple']){
   click(`[data-mode="${mode}"]`);
   for(const id of [...document.querySelectorAll('[data-node]')].map(n=>n.dataset.node)){
    const first=t.calls.filter(mutation).length;click(`[data-node="${id}"]`);
    let expected;
    if(/^(?:gain|mic)[0-3]$/.test(id)&&mode==='pro')expected=['gain'+id.at(-1)];
    else if(id==='adc'||id==='mic0'||/^adc[0-3]$/.test(id))expected=['adc','adcMute'];
    else if(['clock','tdm'].includes(id))expected=['rate','bits','channels'];
    else if(['volume','dac','output'].includes(id))expected=['volume','dac','dacMute'];
    else if(id==='reference')expected=['reference','referenceChannel'];
    else if(['vad','interrupt'].includes(id))expected=['vad','vadOutput'];
    else if(['host','sd','playback'].includes(id))expected=['#recordSeconds','#playPath'];
    else throw Error('Unmapped graph node: '+mode+'/'+id);
    const pass=expected.every(k=>document.querySelector(k.startsWith('#')?k:`[data-field="${k}"]`))&&t.calls.filter(mutation).length===first;
    report.nodes.push({mode,id,expected,title:document.querySelector('#panelTitle').textContent,pass});
   }
  }
  click('[data-mode="pro"]');
  const cases=[...Array.from({length:4},(_,i)=>({node:'gain'+i,key:'gain'+i,min:-64,max:63})),{node:'volume',key:'volume',min:0,max:100}];
  for(const c of cases){
   click(`[data-node="${c.node}"]`);
   for(const value of [String(c.min),String(c.max),'0',String(c.min-1),String(c.max+1),'','1.5']){
    const e=document.querySelector(`input[type=number][data-field="${c.key}"]`),before=t.calls.filter(mutation).length;
    e.focus();e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));await wait(20);
    const legal=value!==''&&Number.isInteger(+value)&&+value>=c.min&&+value<=c.max,disabled=document.querySelector('#apply').disabled;
    report.inputs.push({key:c.key,value,legal,disabled,writes:t.calls.filter(mutation).length-before,pass:disabled!==legal&&t.calls.filter(mutation).length===before});
   }
  }
  const checkInput=(key,value,pass,extra={})=>report.inputs.push({key,value,pass,...extra});
  const noWrite=()=>t.calls.filter(mutation).length;
  click('[data-node="clock"]');
  for(const key of ['rate','bits','channels']){
   const control=document.querySelector(`[data-field="${key}"]`),values=[...control.options].map(o=>o.value);
   for(const value of values){const before=noWrite(),header=document.querySelector('#formatText').textContent;choose(`[data-field="${key}"]`,value);await wait(20);checkInput(key,value,noWrite()===before&&document.querySelector('#formatText').textContent===header);}
  }
  click('[data-node="reference"]');for(const value of ['1','2']){const before=noWrite();choose('[data-field="referenceChannel"]',value);checkInput('referenceChannel',value,noWrite()===before);}
  for(const [key,node] of [['adc','adc0'],['adcMute','adc0'],['dac','volume'],['dacMute','volume'],['reference','reference'],['vad','vad'],['vadOutput','vad']]){
   click(`[data-node="${node}"]`);for(const value of [false,true]){const before=noWrite(),e=document.querySelector(`[data-field="${key}"]`);e.checked=value;e.dispatchEvent(new Event('input',{bubbles:true}));checkInput(key,value,noWrite()===before);}
  }
  click('[data-node="host"]');
  for(const value of ['1','1800','0','-1','1801','','1.5']){
   const before=noWrite(),e=document.querySelector('#recordSeconds');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));
   const legal=!!value&&Number.isInteger(+value)&&+value>=1&&+value<=1800;
   if(!legal){click('[data-action="record"]');await settle();}
   checkInput('recordSeconds',value,e.validity.valid===legal&&noWrite()===before);
  }
  for(const value of ['', '/sdcard/.wav','/sdcard//demo.wav','/tmp/a.wav','/sdcard/../a.wav','/sdcard/a b.wav','/sdcard/a.txt','/sdcard/a//b.wav']){
   const before=noWrite(),e=document.querySelector('#playPath');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));click('[data-action="play"]');await settle();checkInput('playPath-invalid',value,noWrite()===before&&document.querySelector('#workspaceNotice').hidden===false);
  }
  click('#showRegisters');
  for(const key of ['regValue','regMask'])for(const value of ['', 'gg','100','-1','1.5',...(key==='regMask'?['00']:[])]){
   document.querySelector('#regValue').value='80';document.querySelector('#regMask').value='ff';const before=noWrite();document.querySelector('#'+key).value=value;click('[data-action="reg-write"]');await settle();checkInput(key,value,noWrite()===before&&document.querySelector('#workspaceNotice').hidden===false);
  }
  click('[data-node="gain0"]');click('[data-scope="adc"]');await settle();
  for(const value of ['5','10000','4','10001','','1.5','0','-1']){
   const before=noWrite(),old=document.querySelector('#timeWindowValue').textContent,e=document.querySelector('#timeNumber');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));const legal=!!value&&Number.isInteger(+value)&&+value>=5&&+value<=10000;
   checkInput('timeNumber',value,noWrite()===before&&(legal?+e.value===+value:document.querySelector('#timeWindowValue').textContent===old));
  }
  for(const value of ['light','mint','graphite','ocean','pine','ember']){const before=noWrite();choose('#themeSelect',value);checkInput('theme',value,noWrite()===before);}
  for(const value of ['zh','en']){const before=noWrite();choose('#languageSelect',value);checkInput('language',value,noWrite()===before);}
  for(const c of cases){click(`[data-node="${c.node}"]`);for(const value of [c.min,0,c.max]){const before=noWrite(),e=document.querySelector(`input[type=range][data-field="${c.key}"]`);e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));checkInput(c.key+'-slider',String(value),noWrite()===before&&+document.querySelector(`input[type=number][data-field="${c.key}"]`).value===value);}}
  click('#showRegisters');
  for(const value of [...document.querySelector('[data-field="registerAddress"]').options].map(o=>o.value)){
   const before=noWrite();choose('[data-field="registerAddress"]',value);checkInput('registerAddress',value,noWrite()===before&&!!document.querySelector('#regValue')===[103,104,105,106,112,113].includes(+value));
  }
  click('[data-node="gain0"]');click('[data-scope="adc"]');await settle();
  for(const value of [...document.querySelector('#waveChannel').options].map(o=>o.value)){
   const before=noWrite();choose('#waveChannel',value);await settle();checkInput('waveChannel',value,noWrite()===before&&document.querySelector('#waveTitle').textContent.includes('ADC'+value));
  }
  for(const value of ['5','2500','10000','-1','10001']){
   const before=noWrite(),e=document.querySelector('#timeWindow');e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));checkInput('timeWindow',value,noWrite()===before&&+document.querySelector('#timeNumber').value===Math.min(10000,Math.max(5,+value)));
  }
  for(const value of [false,true]){const before=noWrite(),e=document.querySelector('#highlightPath');e.checked=value;e.dispatchEvent(new Event('change',{bubbles:true}));checkInput('highlightPath',String(value),noWrite()===before&&(document.querySelectorAll('.edge.related').length>0)===value);}
  const valid={schema:'a1-audio-lab/1',config:{rate:48000,bits:24,channels:4,gains:[0,0,0,0],adc:true,dac:false,adcMute:false,dacMute:false,volume:25,reference:false,referenceChannel:1,vad:false,vadOutput:false}};
  for(const [label,text,legal] of [['malformed','{oops',false],['schema',JSON.stringify({...valid,schema:'wrong'}),false],['oversize',' '.repeat(33000),false],['invalid-gain',JSON.stringify({...valid,config:{...valid.config,gains:[64,0,0,0]}}),false],['valid',JSON.stringify(valid),true]]){
   const before=noWrite(),dt=new DataTransfer();dt.items.add(new File([text],label+'.json',{type:'application/json'}));const input=document.querySelector('#configFile');input.files=dt.files;input.dispatchEvent(new Event('change',{bubbles:true}));await wait(100);
   checkInput('configFile',label,noWrite()===before&&(!!document.querySelector('#applyImported')===legal)&&document.querySelector('#workspaceNotice').hidden===legal);
  }
  document.querySelector('#qaResult').textContent='Done '+report.inputs.length+' inputs · '+report.inputs.filter(x=>!x.pass).length+' failures';
 });
 document.querySelector('#qaFlows').onclick=()=>run(async()=>{
  if(!t.connected){click('#connect');await settle();}
  choose('#languageSelect','en');choose('#themeSelect','mint');click('[data-mode="pro"]');
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const check=async(name,fn)=>{const first=t.calls.length;try{await fn();if(!name.includes('mismatch'))assert(document.querySelector('#workspaceNotice').hidden,'Operation ended with a visible error: '+document.querySelector('#workspaceNotice').textContent);report.flows.push({name,pass:true,calls:t.calls.slice(first)});}catch(e){report.flows.push({name,pass:false,error:e.message,calls:t.calls.slice(first)});throw e;}};
  const example=async id=>{click('#showExamples');await settle();click(`[data-example="${id}"]`);await settle();};
  const field=(key,value)=>{const e=document.querySelector(`[data-field="${key}"]`);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new Event('input',{bubbles:true}));};
  await check('ordered-stop',async()=>{await example('stop');assert(!t.state.i2s&&!t.state.adc&&!t.state.dac&&!t.state.vad,'Audio not stopped');});
  await check('clock-mismatch-blocks-following-writes',async()=>{
   click('[data-node="clock"]');field('rate',16000);t.mismatchRate=true;const first=t.calls.length;click('#apply');await settle();
   assert(document.querySelector('#workspaceNotice').textContent.includes('Sample-rate readback mismatch'),'Mismatch was not reported');
   assert(!t.calls.slice(first).some(c=>c.startsWith('set_bits')||c.startsWith('set_ch')),'Sequence continued after mismatch');
  });
  await check('capture-example',async()=>{await example('microphones');assert(t.state.channels===4&&t.state.adc&&!t.state.dac,'Capture preset state incorrect');assert(!document.querySelector('#wavePanel').hidden,'Capture waveform hidden');});
  await check('gain-channel-isolation-during-navigation',async()=>{
   click('[data-node="gain0"]');field('gain0',6);const first=t.calls.length;t.delayMs=180;click('#apply');
   assert(document.querySelector('input[data-field="gain0"]').disabled,'Editing not locked during write');click('[data-node="gain1"]');await settle();t.delayMs=80;
   assert(t.calls.slice(first).includes('adc_gain 6 0x01')&&!t.calls.slice(first).some(c=>/^adc_gain .*0x02$/.test(c)),'Submitted channel changed');
   assert(document.querySelector('#panelTitle').textContent.includes('ADC1'),'Navigation lost');
  });
  await check('voice-vad-example',async()=>{await example('voice');assert(t.state.channels===1&&t.state.vad&&!t.state.vadOutput,'Voice preset state incorrect');});
  await check('duplex-reference-example',async()=>{await example('duplex');assert(t.state.reference&&t.state.adc&&t.state.dac&&t.state.channels===4,'Duplex preset state incorrect');});
  await check('recording-start-and-unmount-guard',async()=>{
   await example('recording');assert(t.state.recording&&t.state.sd,'Recording did not start');const first=t.calls.length;click('[data-action="sd-off"]');await settle();
   assert(t.state.sd&&t.state.recording&&!t.calls.slice(first).includes('sdcard_off'),'Recording unmount guard failed');
   click('[data-action="record-stop"]');await settle();assert(!t.state.recording,'Recording failed to stop');
  });
  await check('playback-select-start-stop',async()=>{
   await example('playback');click('[data-media-path="/sdcard/demo_16k_stereo.wav"]');click('[data-action="play"]');await settle();assert(t.state.playing,'Playback did not start');
   click('[data-action="play-stop"]');await settle();assert(!t.state.playing,'Playback did not stop');
  });
  await check('preparation-failure-can-unmount',async()=>{
   await example('stop');click('[data-node="vad"]');t.failNext=true;click('[data-action="vad-prepare"]');await settle();
   click('[data-node="host"]');click('[data-action="sd-off"]');await settle();assert(!t.state.sd,'Phantom armed recording blocks unmount');
  });
  await check('write-failure-and-retry',async()=>{
   await example('microphones');click('[data-node="gain0"]');field('gain0',8);t.failNext=true;click('#apply');await settle();assert(!document.querySelector('#workspaceNotice').hidden,'Injected failure missing');
   click('#apply');await settle();assert(t.state.gainRegisters[0]===144,'Retry did not apply gain');
  });
  await check('read-only-register-and-masked-write',async()=>{
   click('#showRegisters');choose('[data-field="registerAddress"]','0');assert(!document.querySelector('#regValue'),'Protected register offers write');
   choose('[data-field="registerAddress"]','103');document.querySelector('#regValue').value='84';document.querySelector('#regMask').value='ff';click('[data-action="reg-write"]');await settle();
   assert(document.querySelector('.reg-value').textContent==='0x84','Masked readback not shown');
  });
  await check('disconnect-and-readonly-reconnect',async()=>{
   await example('stop');click('#connect');await settle();assert(document.querySelector('#apply').disabled,'Disconnected apply enabled');
   const first=t.calls.length;click('#connect');await settle();assert(!t.calls.slice(first).some(mutation),'Reconnect wrote controls');
   assert(document.querySelector('[data-node="clock"]').classList.contains('off'),'Stopped clock is lit');
  });
  document.querySelector('#qaResult').textContent='Done '+report.flows.length+' workflows · '+report.flows.filter(x=>!x.pass).length+' failures';
 });
 document.querySelector('#qaMonkey').onclick=()=>run(async()=>{
  if(!t.connected){click('#connect');await settle();}
  const seed=2026111409,actions=[];let rng=seed;
  const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const species=()=>()=>{
   const controls=[...document.querySelectorAll('[data-node],[data-mode],[data-open],[data-field],#themeSelect,#languageSelect,#closePanel,#closeWave,#zoomIn,#zoomOut,#fit,#highlightPath,#showExamples,#showRegisters,#showConnection,#showLog,#apply,[data-example],[data-scope],#stopWave,#autoScale')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.closest('[hidden]')&&!e.disabled;});
   const e=controls[Math.floor(random()*controls.length)];if(!e)return;
   const before=t.calls.filter(mutation).length,viewOnly=e.matches('[data-node],[data-mode],[data-open],#themeSelect,#languageSelect,#highlightPath,[data-field]');
   const target=e.id||e.dataset.node||e.dataset.field||e.dataset.open||e.dataset.example||e.textContent.slice(0,40);
   if(e.tagName==='SELECT'){e.selectedIndex=Math.floor(random()*e.options.length);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));}
   else if(e.type==='number'||e.type==='range'){e.value=Math.round(+e.min+random()*(+e.max-+e.min));e.dispatchEvent(new Event('input',{bubbles:true}));}
   else if(e.tagName.toLowerCase()==='g')e.dispatchEvent(new MouseEvent('click',{bubbles:true}));else e.click();
   actions.push({target,value:e.value,checked:e.checked});
   if(viewOnly&&t.calls.filter(mutation).length!==before)throw Error('Viewing/editing unexpectedly sent a control: '+target);
   if(document.querySelectorAll('[data-mode][aria-pressed=true]').length!==1)throw Error('Contradictory mode controls');
   for(const input of document.querySelectorAll('#panelBody [data-field^="gain"]'))if(!document.querySelector('#panelTitle').textContent.includes('ADC'+input.dataset.field.at(-1)))throw Error('Channel and title disagree');
  };
  await gremlins.createHorde({species:[species],mogwais:[],strategies:[gremlins.strategies.distribution({nb:300,delay:90})],logger:{log(){},info(){},warn(){},error(...args){t.errors.push(args.join(' '));}}}).unleash();
  await settle();report.stress={seed,actions,count:actions.length,errors:[...t.errors]};
  document.querySelector('#qaResult').textContent='Done '+actions.length+' stress actions · '+t.errors.length+' errors';
 });
 document.querySelector('#qaRunAll').onclick=async()=>{
  for(const id of ['qaAll','qaInputs','qaFlows','qaMonkey']){
   await document.querySelector('#'+id).onclick();
   if(t.errors.length||report.inputs.some(x=>!x.pass)||report.nodes.some(x=>!x.pass)||report.flows.some(x=>!x.pass)||report.scans.some(s=>s.violations.length||s.svgContrast.some(x=>!x.pass))){document.querySelector('#qaResult').textContent='Audit blocked: inspect report';return;}
  }
  document.querySelector('#qaResult').textContent='PASS · '+report.inputs.length+' inputs · '+report.nodes.length+' nodes · '+report.flows.length+' flows · '+report.scans.length+' scans';
 };
});
