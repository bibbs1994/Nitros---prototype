import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('window.NitrosOliverSpeech=(()=>{'),html.indexOf('// v10.12.7AP:'));

test('10.12.65 preserves Oliver as the permanent professional Nitros voice identity',()=>{
  for(const marker of ['Oliver — the voice of Nitros','experienced-master-automotive-diagnostic-technician','human','calm','confident','professional','patient','friendly','clear','conversational'])assert.match(source,new RegExp(marker));
  for(const marker of ['robotic','raspy','monotone','metallic','rushed','overacted'])assert.match(source,new RegExp(marker));
});

test('highest available neural or natural English voice wins deterministically',()=>{
  assert.match(source,/premiumName=\/\\b\(neural\|natural\|premium\|enhanced\|online\)/);
  assert.match(source,/voiceScore\(b\)-voiceScore\(a\)/);
  assert.match(source,/highest-available-neural-or-natural/);
  assert.match(source,/best-available-browser-voice/);
});

test('neutral General American male voices outrank British and generic voices',()=>{
  for(const marker of ['neutral-General-American','generalAmericanMaleNames','fallbackMaleNames','clean-dry-isolated-centered-overlay-ready'])assert.match(source,new RegExp(marker));
  assert.match(source,/americanMale=us&&matchesName/);
});

test('dry centered overlay contract disables spatial and dynamics processing',()=>{
  for(const marker of ['centered-mono-source','identical-dual-mono-if-required','-17 to -18 LUFS provider target','-1.0 dBTP or lower provider target','sourceLevel','stereoWidening:false','compression:false','limiting:false','automaticGainRiding:false','roomSimulation:false','ambience:false'])assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('measured low-baritone reference is explicit without claiming browser measurement',()=>{
  for(const marker of ['referencePitchCenterHz:103','referencePitchMeanHz:102.5',"primaryPitchRegionHz:'95-113'","expressiveRangeHz:'67-122'","typicalPauseMs:'250-350'","thoughtTransitionPauseMs:'400-500'",'Hz and pause milliseconds are provider targets'])assert.match(source,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(source,/Math\.max\(\.992,Math\.min\(1\.002,pitch\)\)/);
});

test('professional delivery uses conservative human pacing and subtle variation',()=>{
  assert.match(source,/pace:'smooth-natural'/);
  assert.match(source,/emphasis:'subtle'/);
  assert.match(source,/thoughtPauses:'sentence-punctuation'/);
  assert.match(source,/responseShape:'one-next-action-or-question'/);
  assert.match(source,/OLIVER_VOICE_CONFIG/);
  assert.match(source,/rate:\.94,pitch:\.995,volume:\.88,gain:\.88/);
  assert.match(source,/Math\.max\(\.90,Math\.min\(\.97,rate\)\)/);
  assert.match(source,/activePlaybackStreams/);
});

test('developer diagnostics expose voice, phrase, and prosody state',()=>{
  for(const marker of ['nitrosOliverVoiceIdentity','nitrosOliverVoiceDiagnostic','selectedVoice','voiceIdentifier','voiceLanguage','qualityTier','fallbackUsed','fallbackReason','speechState','utteranceCount','duplicateSuppressed','interruptionCount','lastPlaybackError','activePlaybackStreams','phraseCount','pauseProsodyMode','requestedRate','requestedPitch','requestedVolume'])assert.match(html,new RegExp(marker));
});
