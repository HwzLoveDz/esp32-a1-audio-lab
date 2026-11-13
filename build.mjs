import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const dir=path.dirname(fileURLToPath(import.meta.url));
let html=fs.readFileSync(path.join(dir,'index.html'),'utf8');
const css=fs.readFileSync(path.join(dir,'style.css'),'utf8');
const js=['core.mjs','serial.mjs','graph.mjs','app.mjs'].map(name=>fs.readFileSync(path.join(dir,name),'utf8').replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'')).join('\n');
html=html.replace('<link rel="stylesheet" href="style.css">',`<style>${css}</style>`).replace('<script type="module" src="app.mjs"></script>',()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);
// Modules each own their helper names; keep them in lexical wrappers when bundled.
const core=fs.readFileSync(path.join(dir,'core.mjs'),'utf8');
const names=[...core.matchAll(/^export (?:const|function) (\w+)/gm)].map(m=>m[1]);
const moduleBody=name=>fs.readFileSync(path.join(dir,name),'utf8').replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
const bundle=`const Core=(()=>{${moduleBody('core.mjs')}\nreturn {${names.join(',')}};})();\nconst {${names.join(',')}}=Core;\nconst Serial=(()=>{${moduleBody('serial.mjs')}\nreturn A1Serial;})();\nconst A1Serial=Serial;\nconst Graph=(()=>{${moduleBody('graph.mjs')}\nreturn renderGraph;})();\nconst renderGraph=Graph;\n(()=>{${moduleBody('app.mjs')}\n})();`;
html=html.replace(/<script type="module">[\s\S]*?<\/script>/,()=>`<script type="module">${bundle.replace(/<\/script/gi,'<\\/script')}</script>`);
fs.writeFileSync(path.join(dir,'ESP32-A1-Audio-Lab.html'),html);
console.log('Built ESP32-A1-Audio-Lab.html ('+Buffer.byteLength(html)+' bytes)');
