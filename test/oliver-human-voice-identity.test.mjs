import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('window.NitrosOliverSpeech=(()=>{'),html.indexOf('// v10.12.7AP:'));

test('10.12.53 defines Oliver as the permanent professional Nitros voice identity',()=>{
  for(const marker of ['Oliver — the voice of Nitros','experienced-master-automotive-diagnostic-technician','human','calm','confident','professional','patient','friendly','clear','conversational'])assert.match(source,new RegExp(marker));
  for(const marker of ['robotic','raspy','monotone','metallic','rushed','overacted'])assert.match(source,new RegExp(marker));
});

test('highest available neural or natural English voice wins deterministically',()=>{
  assert.match(source,/premiumName=\/\\b\(neural\|natural\|premium\|enhanced\|online\)/);
  assert.match(source,/voiceScore\(b\)-voiceScore\(a\)/);
  assert.match(source,/highest-available-neural-or-natural/);
  assert.match(source,/best-available-browser-voice/);
});

test('professional delivery uses conservative human pacing and subtle variation',()=>{
  assert.match(source,/pace:'smooth-natural'/);
  assert.match(source,/emphasis:'subtle'/);
  assert.match(source,/thoughtPauses:'sentence-punctuation'/);
  assert.match(source,/responseShape:'one-next-action-or-question'/);
  assert.match(source,/Math\.max\(\.89,Math\.min\(\.94,rate\)\)/);
  assert.match(source,/Math\.max\(\.975,Math\.min\(\.995,pitch\)\)/);
});

test('developer diagnostics expose selected voice and quality tier',()=>{
  for(const marker of ['nitrosOliverVoiceIdentity','nitrosOliverVoiceDiagnostic','selectedVoice','qualityTier'])assert.match(html,new RegExp(marker));
});
