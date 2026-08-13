import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('window.NitrosOliverSpeech=(()=>{'),html.indexOf('// v10.12.7AP:'));

test('10.12.56 preserves Oliver as the permanent professional Nitros voice identity',()=>{
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
  for(const marker of ['neutral-General-American','generalAmericanMaleNames','fallbackMaleNames','clean-dry-isolated-overlay-ready'])assert.match(source,new RegExp(marker));
  assert.match(source,/americanMale=us&&matchesName/);
});

test('professional delivery uses conservative human pacing and subtle variation',()=>{
  assert.match(source,/pace:'smooth-natural'/);
  assert.match(source,/emphasis:'subtle'/);
  assert.match(source,/thoughtPauses:'sentence-punctuation'/);
  assert.match(source,/responseShape:'one-next-action-or-question'/);
  assert.match(source,/OLIVER_VOICE_CONFIG/);
  assert.match(source,/rate:\.94,pitch:1,volume:1,gain:1/);
  assert.match(source,/Math\.max\(\.90,Math\.min\(1,rate\)\)/);
  assert.match(source,/activePlaybackStreams/);
});

test('developer diagnostics expose voice, phrase, and prosody state',()=>{
  for(const marker of ['nitrosOliverVoiceIdentity','nitrosOliverVoiceDiagnostic','selectedVoice','voiceIdentifier','voiceLanguage','qualityTier','fallbackUsed','fallbackReason','speechState','utteranceCount','duplicateSuppressed','interruptionCount','lastPlaybackError','activePlaybackStreams','phraseCount','pauseProsodyMode','requestedRate','requestedPitch','requestedVolume'])assert.match(html,new RegExp(marker));
});
