import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {VERSION} from './core.mjs';
const dir=path.dirname(fileURLToPath(import.meta.url));
const read=name=>fs.readFileSync(path.join(dir,name),'utf8');
const modules=['core.mjs','workbench.mjs','i18n.mjs','serial.mjs','graph.mjs','viewport.mjs','media.mjs','examples.mjs'];
const bundle=modules.map((name,i)=>{
 const source=read(name),names=[...source.matchAll(/^export (?:async )?(?:const|function|class) (\w+)/gm)].map(m=>m[1]);
 const body=source.replace(/^import .*?;\s*$/gm,'').replace(/^export /gm,'');
 return `const {${names.join(',')}}=(()=>{${body}\nreturn {${names.join(',')}};})();`;
}).join('\n')+'\n(()=>{'+read('app.mjs').replace(/^import .*?;\s*$/gm,'')+'\n})();';
const html=read('index.html').replace(/v\d+\.\d+\.\d+(?:-[\w.]+)?/g,'v'+VERSION)
 .replace('<link rel="stylesheet" href="style.css">',()=>`<style>${read('style.css')}</style>`)
 .replace('<script type="module" src="app.mjs"></script>',()=>`<script type="module">${bundle.replace(/<\/script/gi,'<\\/script')}</script>`);
fs.writeFileSync(path.join(dir,'ESP32-A1-Audio-Lab.html'),html);
fs.writeFileSync(path.join(dir,'tests/ui-fixture.html'),read('index.html').replace('href="style.css"','href="../style.css"').replace('src="app.mjs"','src="mock-device.mjs"'));
console.log(`Built ESP32-A1-Audio-Lab.html (${Buffer.byteLength(html)} bytes)`);
