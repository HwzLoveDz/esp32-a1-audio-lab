import test from 'node:test';
import assert from 'node:assert/strict';
import {recordingTag,validWavPath,parseFileList,wavInfo,playbackGuard,mediaEvent,canSaveFifo,wavTransferInfo,recordingSeconds,wavDeviceInfo,recordingStatus} from '../media.mjs';
test('recording tags differ even within the same millisecond',()=>{assert.notEqual(recordingTag('web',12345),recordingTag('web',12345));assert.match(recordingTag(),/^web_[a-z0-9]+_[a-z0-9]+$/);});
test('file list accepts bounded WAV paths and rejects traversal or incomplete responses',()=>{
 const text='FLS BEGIN /sdcard\nE 128 test.wav\nE 256 ../unsafe.wav\nE 25 note.txt\nFLS END 3\n';assert.deepEqual(parseFileList(text),[{bytes:128,path:'/sdcard/test.wav'}]);assert.throws(()=>parseFileList(text.replace('FLS END 3','')));assert.equal(validWavPath('/sdcard/x/../bad.wav'),false);
});
test('WAV format comes from inspected data, not the filename',()=>{assert.deepEqual(wavInfo('  ch0 16000 Hz 16-bit 2ch, 800 frames analyzed'),{rate:16000,bits:16,channels:2});assert.throws(()=>wavInfo('unknown.wav'));});
test('playback guards prevent format drift, multichannel payloads and unopened DAC',()=>{
 const actual={rate:48000,bits:24,channels:4,adc:true,reference:true,dac:true},info={rate:48000,bits:24,channels:2};assert.doesNotThrow(()=>playbackGuard(info,actual));
 assert.throws(()=>playbackGuard({...info,rate:16000},actual));assert.throws(()=>playbackGuard({...info,channels:5},actual));assert.throws(()=>playbackGuard(info,{...actual,dac:false}));assert.throws(()=>playbackGuard(info,{...actual,reference:false}));
});
test('recording completion retains exact path, bytes and integrity status',()=>{
 assert.deepEqual(mediaEvent('Recording done: 64000 bytes -> /sdcard/x.wav (rx_ovf=0 tx_unf=0 max_write=22 us stack_free=1)'),{type:'record-done',path:'/sdcard/x.wav',bytes:64044,overflow:0});
 assert.equal(mediaEvent('I (2) A1_FILE: Rec start: 16000 Hz 16-bit 2ch -> /sdcard/x.wav').type,'record-start');assert.equal(mediaEvent('E (3) A1_FILE: rec: write failed').type,'error');
});

test('FIFO saving is unavailable in detection-only mode or without SD',()=>{const a={sd:true,vad:true,vadOutput:true};assert.equal(canSaveFifo(a),true);for(const key of Object.keys(a))assert.equal(canSaveFifo({...a,[key]:false}),false);assert.equal(canSaveFifo({}),false);});

test('short WAV metadata requires valid transfer CRC and lengths',()=>{const packet="FGET BEGIN 48 e5028da5 /sdcard/test.wav\nD UklGRigAAABXQVZFZm10IBAAAAABAAIAgD4AAAD6AAAEABAAZGF0YQQAAAAAAAAA\nFGET END\n";assert.deepEqual(wavTransferInfo(packet),{rate:16000,bits:16,channels:2});assert.throws(()=>wavTransferInfo(packet.replace('e5028da5','00000000')));assert.throws(()=>wavTransferInfo(packet.replace('FGET END','')));});

test('record duration accepts a 30-minute target and rejects invalid or excessive values',()=>{
 assert.equal(recordingSeconds('1800'),1800);assert.equal(recordingSeconds(1),1);
 for(const n of [0,-1,1801,1.5,NaN,''])assert.throws(()=>recordingSeconds(n));
});
test('board WAV metadata requires consistent size, sample count and full-scan evidence',()=>{
 const f={type:'file',rate:48000,bits:24,channels:5,bytes:1296000044,dataBytes:1296000000,frames:86400000,verified:true,crc32:'a1b2c3d4',scannedBytes:1296000044};
 const packet=f=>'@A1 '+JSON.stringify(f)+'\n';assert.deepEqual(wavDeviceInfo(packet(f)),f);
 assert.throws(()=>wavDeviceInfo(packet({...f,frames:f.frames-1})));assert.throws(()=>wavDeviceInfo(packet({...f,scannedBytes:f.bytes-1})));assert.throws(()=>wavDeviceInfo(packet({...f,crc32:'bad'})));
 assert.equal(wavDeviceInfo(packet({...f,verified:false,scannedBytes:0,crc32:'00000000'})).verified,false);
});
test('recording telemetry rejects impossible progress and leaves idle state distinguishable',()=>{
 const s={type:'record',active:true,capturedBytes:720000,writtenBytes:700000,targetBytes:1296000000,bufferBytes:1966080,peakBufferBytes:153600,rate:48000,frameBytes:15,elapsedMs:1000,error:0};const packet=s=>'@A1 '+JSON.stringify(s)+'\n';
 assert.deepEqual(recordingStatus(packet(s)),s);assert.throws(()=>recordingStatus(packet({...s,writtenBytes:800000})));assert.throws(()=>recordingStatus(packet({...s,peakBufferBytes:2000000})));assert.throws(()=>recordingStatus(packet({...s,rate:0})));assert.throws(()=>recordingStatus(packet({...s,active:false,rate:0})));
 assert.equal(recordingStatus(packet({...s,active:false,rate:0,frameBytes:0,capturedBytes:0,writtenBytes:0,targetBytes:0})).active,false);
});
