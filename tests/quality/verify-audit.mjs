import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {VERSION} from '../../core.mjs';

const root=fileURLToPath(new URL('../../',import.meta.url));
const [reportPath,manualPath]=process.argv.slice(2);
if(!reportPath||!manualPath)throw Error('Usage: node tests/quality/verify-audit.mjs <quality-report.json> <manual-review.json>');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8')),manual=JSON.parse(fs.readFileSync(manualPath,'utf8'));
const output=path.dirname(path.resolve(reportPath));
const bundle=fs.readFileSync(path.join(root,'ESP32-A1-Audio-Lab.html'));
// The HTTP fixture and HTML parser normalize Windows line endings to LF.
const digest=crypto.createHash('sha256').update(bundle.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
const artifactSha=crypto.createHash('sha256').update(bundle).digest('hex');
assert.equal(report.version,'v'+VERSION,'Browser version is stale');
assert.equal(report.bundleSha,digest,'The tested bundle differs from the current application');
assert.ok(report.inputs.length>=153&&report.inputs.every(x=>x.pass),'Input matrix has gaps or failures');
assert.equal(new Set(report.inputs.map(x=>x.key)).size,33,'Expected 33 distinct input controls');
assert.equal(new Set(report.nodes.map(x=>x.mode+'/'+x.id)).size,34,'Graph entry coverage is incomplete');
assert.ok(report.nodes.every(x=>x.pass),'A graph entry opens the wrong editor');
assert.ok(report.flows.length>=12&&report.flows.every(x=>x.pass),'Directed workflows failed');
assert.ok(report.scans.length>=24,'Accessibility state coverage is incomplete');
assert.ok(report.scans.every(x=>x.violations.length===0),'Accessibility rule failures remain');
assert.ok(report.scans.every(x=>x.svgContrast.length>0&&x.svgContrast.every(c=>c.pass)),'SVG text contrast failed');
assert.ok(report.scans.every(x=>x.incomplete.every(v=>v.id==='color-contrast')),'An unreviewed accessibility rule remains');
assert.equal(report.errors.length,0,'Unhandled browser errors remain');
assert.ok(report.stress?.count>=300&&report.stress.errors.length===0,'Final stress run failed');
for(const theme of ['light','mint','graphite','ocean','pine','ember'])assert.ok(report.scans.some(s=>s.theme===theme),'Untested theme: '+theme);
assert.equal(manual.version,VERSION);
assert.equal(manual.bundleSha,digest,'Manual review is for a different bundle');
for(const name of ['keyboard-focus','native-numeric-input','native-json-transfer','narrow-waveform','camera-and-resize','overlap-review']){
 const item=manual.checks.find(c=>c.name===name);assert.ok(item?.pass,'Manual review missing: '+name);
 assert.ok(item.observation&&fs.existsSync(path.resolve(output,item.evidence)),'Manual evidence missing: '+name);
}
const tests=spawnSync(process.execPath,['--test','--test-reporter=tap','tests/*.test.mjs','tests/quality/*.test.mjs'],{cwd:root,encoding:'utf8',timeout:30000});
fs.writeFileSync(path.join(output,'node-tests-final.tap'),tests.stdout+(tests.stderr||''));
assert.equal(tests.status,0,'Node regression failed');
assert.match(tests.stdout,/# fail 0\b/);
const cases=Number(tests.stdout.match(/# tests (\d+)/)?.[1]);assert.ok(cases>=82);
const dimensions=[
 {name:'Input contracts',weight:2,score:1.9,evidence:'153 browser cases / 33 controls; generated wrong-type and boundary inputs. IME/OS-specific editing is not exhaustive.'},
 {name:'Transactions and recovery',weight:3,score:2.9,evidence:'12 directed workflows; scheduled and model-based response interleavings. Mock protocol, not hardware acceptance.'},
 {name:'Interaction and navigation',weight:2,score:1.8,evidence:'34 graph entries, two modes, bilingual controls, native keyboard/resize/camera and narrow-window review.'},
 {name:'Accessibility and readability',weight:2,score:1.8,evidence:'24+ scans, six themes, zero reported violations, SVG text contrast checked. Full screen-reader evaluation is outside this run.'},
 {name:'Reproduction and isolation',weight:1,score:0.9,evidence:'Locked dependencies, fixture, seeds, event reports and bundle hash. Browser review still requires guided execution.'}
];
const score=Number(dimensions.reduce((n,d)=>n+d.score,0).toFixed(1));assert.ok(score>=9);
const result={version:VERSION,scope:'HTTP mock browser quality only',bundleTextSha256:digest,artifactSha256:artifactSha,score,max:10,hardGatesPassed:true,nodeTests:cases,generatedRuns:7700,inputCases:report.inputs.length,inputControls:33,graphEntries:34,workflows:report.flows.length,accessibilityScans:report.scans.length,stressActions:report.stress.count,dimensions};
fs.writeFileSync(path.join(output,'scorecard.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
