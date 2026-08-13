import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

function extractedFunction(name,nextName){
  const start=html.indexOf(`function ${name}(`),end=html.indexOf(`function ${nextName}(`,start);
  assert.ok(start>=0&&end>start,`could not extract ${name}`);
  return Function(`return (${html.slice(start,end).trim()})`)();
}

const naturalVehicle=extractedFunction('naturalVehicle','naturalCodes');

test('free-form Phase 1 examples extract year, make, and model',()=>{
  assert.deepEqual(naturalVehicle("I've got a P0340 on a 2014 Toyota Camry."),{year:'2014',make:'Toyota',model:'Camry',engine:''});
  assert.deepEqual(naturalVehicle('2017 Ford F150 P0302.'),{year:'2017',make:'Ford',model:'F-150',engine:''});
  assert.deepEqual(naturalVehicle('Got a Chevy Silverado with a P0011.'),{year:'',make:'Chevrolet',model:'Silverado',engine:''});
  assert.deepEqual(naturalVehicle('Working on a 2018 Honda Accord. It has P0171.'),{year:'2018',make:'Honda',model:'Accord',engine:''});
});

test('natural diagnostic session stores required lightweight state',()=>{
  for(const field of ['complaint','currentQuestion','latestAnswer','confirmedFindings','assumptions'])assert.match(html,new RegExp(`${field}:`),`missing ${field}`);
  assert.match(html,/caseData\.latestAnswer=raw/);
  assert.match(html,/I recorded \$\{raw\} as the verified answer/);
});

test('new case and different vehicle clear conversational state without resetting permanent diagnostic data',()=>{
  assert.match(html,/different vehicle\)\[\.!\?\\s\]\*\$\/i\.test\(text\)\)\{resetNaturalCase\(\)/);
  assert.match(html,/isNewNaturalContext\(text\)\)\{resetNaturalCase\(\);window\.NitrosDiagnosticV10120\?\.reset\(\)\}/);
  assert.match(html,/caseData=emptyNaturalCase\(\);history=\[\];loadedImage='';lastOliver=''/);
});

test('plain text DTC entry remains text-first and starts one relevant decision',()=>{
  assert.match(html,/code==='P0340'.+Is the engine running, cranking with a no-start, or running normally with the code set/);
  assert.match(html,/P030\[0-8\].+When is the misfire present/);
  assert.match(html,/code==='P0171'.+short- and long-term fuel trims/);
  assert.match(html,/if\(activeMode==='general'&&!serviceUrl\(\)\)\{const reply=localGeneralAnswer\(text\)/);
  assert.match(html,/window\.NitrosOliverNaturalEntry\.openAndSend\(text\)/);
  assert.match(html,/openAndSend:text=>\{openMode\('general'\);setTimeout\(\(\)=>send\(text\),100\)\}/);
});

test('10.12.64 build identity is visible without removing AR Oliver or AQ GPS implementation',()=>{
  assert.match(html,/10\.12\.64/);
  assert.match(html,/NitrosOliverNaturalEntry/);
  assert.match(html,/window\.NitrosGpsEvidence/);
  assert.match(html,/photoEvidence:persistedPhotos\.map\(item=>\(\{[^\n]+gps:item\.gps/);
});
