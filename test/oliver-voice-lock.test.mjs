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
  {name:'Daniel',lang:'en-GB',voiceURI:'voice-daniel'},
  {name:'Alex',lang:'en-US',voiceURI:'voice-alex'},
  {name:'English UK',lang:'en-GB',voiceURI:'voice-uk'}
];

test('specification and completed-result replies use one locked voice without duplicate playback',()=>{
  const h=speechHarness(voices);
  h.controller.speak('Specification reply');
  h.controller.speak('Cam Sensor Ground passes');
  h.controller.speak('Cam Sensor Ground passes');
  assert.equal(h.spoken.length,2);
  assert.deepEqual(h.spoken.map(item=>item.voice.voiceURI),['voice-alex','voice-alex']);
  assert.equal(h.controller.lockedVoiceURI,'voice-alex');
  assert.equal(h.controller.diagnostics.accentTarget,'neutral-General-American');
});

test('delayed iOS voices resolve once and stale queued speech cannot play',()=>{
  const h=speechHarness();
  h.controller.speak('stale response');
  h.controller.speak('newest response');
  assert.equal(h.spoken.length,0);
  h.setVoices(voices);
  assert.deepEqual(h.spoken.map(item=>item.text),['newest response']);
  h.controller.speak('read last reply');
  assert.deepEqual(h.spoken.map(item=>item.voice.voiceURI),['voice-alex','voice-alex']);
  h.runTimers();
  assert.deepEqual(h.spoken.map(item=>item.text),['newest response','read last reply']);
});

test('10.12.64 applies stable natural prosody without changing ordinary spoken diagnostic words',()=>{
  const h=speechHarness(voices),text='Ground looks good. Next, check the signal circuit and tell me what you see.';
  h.controller.speak(text,{rate:.94,pitch:.9});
  assert.equal(h.spoken[0].text,text);
  assert.ok(h.spoken[0].rate>=.90&&h.spoken[0].rate<=1);
  assert.ok(h.spoken[0].pitch>=.98&&h.spoken[0].pitch<=1.02);
  assert.equal(h.spoken[0].volume,.88);
  assert.equal(h.controller.provider,'browser-speech-synthesis');
});

test('phrase analysis varies pacing by response shape while retaining one continuous utterance',()=>{
  const h=speechHarness(voices),technical='Engine speed is currently 2,167 RPM. Minimum is 742 RPM, and maximum is 2,384 RPM. Those values are internally consistent.';
  h.controller.speak(technical);
  assert.equal(h.spoken.length,1);
  assert.equal(h.spoken[0].text,technical.replaceAll('RPM','R P M'));
  assert.ok(h.controller.diagnostics.phraseCount>=4);
  assert.equal(h.controller.diagnostics.pauseProsodyMode,'semantic-thought-boundary-conversational');
  assert.ok(h.controller.diagnostics.requestedRate<.94);
  h.controller.speak('Exactly.',{force:true});
  assert.ok(h.controller.diagnostics.requestedRate>.94);
});

test('speech-safe pronunciation preserves displayed content while clarifying codes, units, and negatives',()=>{
  const h=speechHarness(voices),visible='P0340 measured -6.25% at 12.6 V and 40 mV.';
  h.controller.speak(visible);
  assert.equal(visible,'P0340 measured -6.25% at 12.6 V and 40 mV.');
  assert.equal(h.spoken[0].text,'P zero three forty measured negative 6.25 percent at 12.6 volts and 40 millivolts.');
  assert.equal(h.spoken.length,1);
});

test('automotive speech copy uses natural letter names without changing response text',()=>{
  const h=speechHarness(voices),visible='Check the PCM, ECM, PID, DTC, O2 sensor, CAN bus, and 5-volt reference at 2,167 RPM.';
  h.controller.speak(visible);
  assert.equal(visible,'Check the PCM, ECM, PID, DTC, O2 sensor, CAN bus, and 5-volt reference at 2,167 RPM.');
  assert.equal(h.spoken[0].text,'Check the P C M, E C M, P I D, D T C, O two sensor, CAN bus, and 5 volt reference at 2,167 R P M.');
  assert.equal(h.controller.diagnostics.audioProcessing.signal,'clean-dry-isolated-centered-overlay-ready');
  assert.equal(h.controller.diagnostics.audioProcessing.channelMode,'centered-mono-source');
  assert.equal(h.controller.diagnostics.audioProcessing.mixing,false);
});

test('validation sequence selects distinct restrained delivery profiles',()=>{
  const h=speechHarness(voices),samples=[
    ['Hey Bobby. What are we working on?','technician-question'],
    ["Okay, I've got engine speed at twenty-one sixty-seven RPM.",'diagnostic-observation'],
    ["Hold on. Shut the ignition off before you disconnect that connector.",'safety-instruction'],
    ["Yep. That's exactly what I wanted to see.",'short-confirmation'],
    ["That changes things. We've got power and ground, so now I want to see what the signal circuit is actually doing.",'diagnostic-reasoning']
  ];
  const rates=[];
  for(const [text,profile] of samples){h.controller.speak(text,{force:true});assert.equal(h.controller.diagnostics.deliveryProfile,profile);rates.push(h.controller.diagnostics.requestedRate)}
  assert.ok(new Set(rates).size>=4);
  assert.ok(rates.every(rate=>rate>=.90&&rate<=.97));
  assert.equal(h.spoken.length,samples.length);
});

test('10.12.64 validation sample is repeatable, conversational, and below full source level',()=>{
  const h=speechHarness(voices),sample="Okay, I've got a 2016 Jeep Wrangler with the 3.6 liter. Looking at what we have so far, engine speed is sitting at about twenty-one sixty-seven RPM. That part looks normal. Before we condemn anything, let's check the evidence we already have and figure out what test actually makes sense next.";
  assert.equal(h.controller.validationSample,sample);
  assert.equal(h.controller.speakValidationSample(),true);
  assert.equal(h.spoken.length,1);
  assert.equal(h.spoken[0].text,sample.replace('RPM','R P M'));
  assert.equal(h.spoken[0].volume,.88);
  assert.equal(h.controller.diagnostics.deliveryProfile,'diagnostic-reasoning');
  assert.equal(h.controller.diagnostics.audioProcessing.sourceLevel,'reduced-from-full-scale');
  assert.equal(h.controller.validationSamples.length,6);
  for(let index=0;index<6;index++)assert.equal(h.controller.speakValidationSample(index),true);
  assert.equal(h.spoken.length,7);
  assert.equal(h.controller.diagnostics.acousticTarget.referencePitchCenterHz,103);
});

test('playback telemetry records duplicate suppression and explicit interruption',()=>{
  const h=speechHarness(voices);
  assert.equal(h.controller.speak('Check the ground circuit.'),true);
  assert.equal(h.controller.speak('Check the ground circuit.'),false);
  assert.equal(h.controller.diagnostics.duplicateSuppressed,true);
  h.controller.cancel();
  assert.equal(h.controller.diagnostics.speechState,'interrupted');
  assert.ok(h.controller.diagnostics.interruptionCount>=1);
  assert.equal(h.controller.diagnostics.playbackMode,'single-authoritative-utterance');
});

test('all Oliver speech call sites are centralized',()=>{
  assert.equal((html.match(/new SpeechSynthesisUtterance\(/g)||[]).length,1);
  assert.equal((html.match(/speak:utterance=>synth\?\.speak\(utterance\)/g)||[]).length,1);
  assert.equal((html.match(/(?:window\.)?speechSynthesis\.speak\(/g)||[]).length,0);
  assert.match(html,/if\(state\.lastReply\)speakOliver\(state\.lastReply\)/);
  for(const call of ['oliverScheduleResponse','speakGuideText','smartOliverRead','diagReadLast','oliverHubReadLast'])assert.match(html,new RegExp(call));
});
