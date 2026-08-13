import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('window.NitrosOliverSpeech=(()=>{');
const end=html.indexOf('// v10.12.7AP:',start);
assert.ok(start>=0&&end>start,'central Oliver speech controller was not found');
const controllerSource=html.slice(start,end);

function speechHarness(initialVoices=[]){
  let available=[...initialVoices],timerId=0;
  const timers=new Map(),spoken=[],listeners={};
  class Utterance{constructor(text){this.text=text;this.voice=null}}
  const synth={
    getVoices:()=>available,
    addEventListener:(name,fn)=>{listeners[name]=fn},
    cancel(){},resume(){},
    speak(utterance){spoken.push(utterance)}
  };
  const window={speechSynthesis:synth};
  const setTimer=fn=>{const id=++timerId;timers.set(id,fn);return id};
  const clearTimer=id=>timers.delete(id);
  const controller=Function('window','SpeechSynthesisUtterance','setTimeout','clearTimeout',`${controllerSource};return window.NitrosOliverSpeech`)(window,Utterance,setTimer,clearTimer);
  return {controller,spoken,setVoices(voices){available=[...voices];listeners.voiceschanged?.()},runTimers(){for(const [id,fn] of [...timers]){timers.delete(id);fn()}}};
}

const voices=[
  {name:'Ava',lang:'en-US',voiceURI:'voice-ava'},
  {name:'Daniel',lang:'en-US',voiceURI:'voice-daniel'},
  {name:'English UK',lang:'en-GB',voiceURI:'voice-uk'}
];

test('specification and completed-result replies use one locked voice without duplicate playback',()=>{
  const h=speechHarness(voices);
  h.controller.speak('Specification reply');
  h.controller.speak('Cam Sensor Ground passes');
  h.controller.speak('Cam Sensor Ground passes');
  assert.equal(h.spoken.length,2);
  assert.deepEqual(h.spoken.map(item=>item.voice.voiceURI),['voice-ava','voice-ava']);
  assert.equal(h.controller.lockedVoiceURI,'voice-ava');
});

test('delayed iOS voices resolve once and stale queued speech cannot play',()=>{
  const h=speechHarness();
  h.controller.speak('stale response');
  h.controller.speak('newest response');
  assert.equal(h.spoken.length,0);
  h.setVoices(voices);
  assert.deepEqual(h.spoken.map(item=>item.text),['newest response']);
  h.controller.speak('read last reply');
  assert.deepEqual(h.spoken.map(item=>item.voice.voiceURI),['voice-ava','voice-ava']);
  h.runTimers();
  assert.deepEqual(h.spoken.map(item=>item.text),['newest response','read last reply']);
});

test('10.12.23 applies conservative varied prosody without changing spoken diagnostic words',()=>{
  const h=speechHarness(voices),text='Ground looks good. Next, check the signal circuit and tell me what you see.';
  h.controller.speak(text,{rate:.94,pitch:.9});
  assert.equal(h.spoken[0].text,text);
  assert.ok(h.spoken[0].rate>=.89&&h.spoken[0].rate<=.94);
  assert.ok(h.spoken[0].pitch>=.975&&h.spoken[0].pitch<=.995);
  assert.equal(h.controller.provider,'browser-speech-synthesis');
});

test('all Oliver speech call sites are centralized',()=>{
  assert.equal((html.match(/new SpeechSynthesisUtterance\(/g)||[]).length,1);
  assert.equal((html.match(/speak:utterance=>synth\?\.speak\(utterance\)/g)||[]).length,1);
  assert.equal((html.match(/(?:window\.)?speechSynthesis\.speak\(/g)||[]).length,0);
  assert.match(html,/if\(state\.lastReply\)speakOliver\(state\.lastReply\)/);
  for(const call of ['oliverScheduleResponse','speakGuideText','smartOliverRead','diagReadLast','oliverHubReadLast'])assert.match(html,new RegExp(call));
});
