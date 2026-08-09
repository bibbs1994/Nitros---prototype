import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('AP captures normalized GPS metadata independently of EXIF',()=>{
  for(const field of ['attempted','status','latitude','longitude','accuracyMeters','capturedAt','errorCode','errorMessage'])assert.ok(html.includes(field),`missing GPS field ${field}`);
  assert.match(html,/navigator\.geolocation\.getCurrentPosition/);
  assert.match(html,/enableHighAccuracy:true,timeout:TIMEOUT_MS,maximumAge:0/);
  assert.match(html,/Promise\.all\(\[compressPhoto\(file\),window\.NitrosGpsEvidence\.capture\(\)\]\)/);
});

test('GPS failures remain evidence records and have visible nonblank labels',()=>{
  for(const value of ['verified','unavailable','permission-denied','timeout/error','not-captured'])assert.ok(html.includes(value),`missing GPS status ${value}`);
  for(const label of ['GPS Verified','GPS Unavailable','Permission Denied','GPS Timeout/Error','Not captured'])assert.ok(html.includes(label),`missing visible label ${label}`);
  assert.match(html,/await photoDbPut\(entry\)/);
});

test('GPS persists in the shared photo store and record copies',()=>{
  assert.match(html,/const entry=\{[^\n]+capturedAt,gps,/);
  assert.match(html,/const copy=\{\.\.\.item,\.\.\.identity,key:/);
  assert.match(html,/NitrosGpsEvidence\.html\(items\[index\]\?\.gps/);
});

test('Developer Mode and deployment identify AP',()=>{
  assert.match(html,/id="nitrosGpsDiagnostic"/);
  assert.match(html,/v10127ap-build-identity/);
  assert.match(html,/GPS Evidence Metadata \+ Verification/);
  assert.match(sw,/const VERSION = '10\.12\.7AP'/);
});
