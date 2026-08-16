import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.13.03 has one canonical build authority',()=>{
  assert.match(html,/window\.NitrosBuild=Object\.freeze\(\{[\s\S]+version:'10\.13\.03',[\s\S]+release:'Diagnostic Validation Series',[\s\S]+buildDate:'2026-08-16'/);
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

test('service worker uses 10.13.03 version and preserves safe navigation caching',()=>{
  assert.match(sw,/const VERSION = '10\.13\.03'/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  assert.match(sw,/fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(sw,/STATIC_ASSETS = new Set\(\[new URL\('\.\/image-analysis-ad\.js'/);
  assert.match(sw,/cache\.put\(isVersionedStaticAsset \? request : APP_SHELL/);
  assert.match(sw,/caches\.match\(isVersionedStaticAsset \? request : APP_SHELL, \{ cacheName: CACHE_NAME \}\)/);
  assert.doesNotMatch(sw,/caches\.clear|localStorage|indexedDB/i);
});

test('10.12.99 contains long diagnostic output inside the mobile viewport',()=>{
  assert.match(html,/#oliverDiagnosticMode\{max-width:100vw;overflow-x:hidden;overscroll-behavior-x:none\}/);
  assert.match(html,/\.diag-message\{width:min\(900px,100%\);overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
  assert.match(html,/#nitrosAuthoritativeStatus,#nitrosAuthoritativeStatus \*\{max-width:100%;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
});

test('10.12.99 gives Oliver Hub header and scrolling content separate mobile layout regions',()=>{
  assert.match(html,/\.oliver-hub-card\{display:flex;flex-direction:column;min-height:0;overflow:hidden\}/);
  assert.match(html,/\.oliver-hub-head\{position:relative;z-index:2;flex:none\}/);
  assert.match(html,/\.oliver-hub-body\{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;flex:1;scroll-padding-top:1px\}/);
  assert.match(html,/padding-top:max\(8px,env\(safe-area-inset-top\)\)/);
});

test('legacy persistence identifiers remain unchanged',()=>{
  assert.match(html,/STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.match(html,/DB_NAME='NitrosRepairOrders'/);
  assert.match(html,/PHOTO_DB_NAME="nitros_photo_evidence_v1"/);
});
