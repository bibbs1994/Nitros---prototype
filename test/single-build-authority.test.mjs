import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.12.92 has one canonical build authority',()=>{
  assert.match(html,/window\.NitrosBuild=Object\.freeze\(\{[\s\S]+version:'10\.12\.92',[\s\S]+release:'Measurement Context Binding \+ Forward Guidance Completion',[\s\S]+buildDate:'2026-08-14'/);
  assert.match(html,/const \{version:VERSION,buildDate:BUILD,release:RELEASE\}=window\.NitrosBuild/);
  assert.match(html,/Authoritative Diagnostic State — v\$\{VERSION\}/);
  assert.match(html,/build:window\.NitrosBuild\.version/);
});

test('production has exactly one unversioned service-worker registration',()=>{
  const registrations=[...html.matchAll(/navigator\.serviceWorker\.register\(/g)];
  assert.equal(registrations.length,1);
  assert.match(html,/navigator\.serviceWorker\.register\('\.\/sw\.js',\{updateViaCache:'none'\}\)/);
  assert.doesNotMatch(html,/serviceWorker\.register\([^\n]+sw\.js\?v=/);
  assert.match(html,/await registration\.update\(\)/);
  assert.match(html,/controllerchange/);
  assert.match(html,/sessionStorage\.getItem\(RELOAD_KEY\)==='1'/);
});

test('runtime verification exposes service-worker support, control, URL, and state',()=>{
  for(const id of ['nitrosRuntimeAppBuild','nitrosRuntimeSwSupported','nitrosRuntimeSwControlled','nitrosRuntimeSwUrl','nitrosRuntimeSwState'])assert.match(html,new RegExp(`id="${id}"`));
});

test('service worker uses 10.12.92 version and preserves safe navigation caching',()=>{
  assert.match(sw,/const VERSION = '10\.12\.92'/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  assert.match(sw,/fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(sw,/STATIC_ASSETS = new Set\(\[new URL\('\.\/image-analysis-ad\.js'/);
  assert.match(sw,/cache\.put\(isVersionedStaticAsset \? request : APP_SHELL/);
  assert.match(sw,/caches\.match\(isVersionedStaticAsset \? request : APP_SHELL, \{ cacheName: CACHE_NAME \}\)/);
  assert.doesNotMatch(sw,/caches\.clear|localStorage|indexedDB/i);
});

test('legacy persistence identifiers remain unchanged',()=>{
  assert.match(html,/STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.match(html,/DB_NAME='NitrosRepairOrders'/);
  assert.match(html,/PHOTO_DB_NAME="nitros_photo_evidence_v1"/);
});
