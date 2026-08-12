import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('AQ reuses normalized GPS capture independently of EXIF',()=>{
  for(const field of ['attempted','status','latitude','longitude','accuracyMeters','capturedAt','errorCode','errorMessage'])assert.ok(html.includes(field),`missing GPS field ${field}`);
  assert.match(html,/navigator\.geolocation\.getCurrentPosition/);
  assert.match(html,/enableHighAccuracy:true,timeout:TIMEOUT_MS,maximumAge:0/);
  assert.match(html,/Promise\.all\(\[compressPhoto\(file\),window\.NitrosGpsEvidence\.capture\(\)\]\)/);
});

test('GPS failures remain evidence records and cards use the required fallback',()=>{
  for(const value of ['verified','unavailable','permission-denied','timeout','error','not-captured'])assert.ok(html.includes(value),`missing GPS status ${value}`);
  for(const label of ['GPS Verified','GPS Unavailable','Location Permission Denied','GPS Timeout','GPS Error','GPS Not Recorded'])assert.ok(html.includes(label),`missing visible label ${label}`);
  assert.match(html,/await photoDbPut\(entry\)/);
  assert.match(html,/INVALID_COORDINATES/);
  assert.match(html,/gps\.status!=="verified"\)return "Location: GPS Not Recorded"/);
});

test('GPS persists in the shared photo store and record copies',()=>{
  assert.match(html,/const entry=\{[^\n]+capturedAt,gps,/);
  assert.match(html,/const copy=\{\.\.\.item,\.\.\.identity,key:/);
  assert.match(html,/NitrosGpsEvidence\.html\(item\?\.gps/);
});

test('AQ GPS diagnostics remain present in the VI deployment',()=>{
  assert.match(html,/id="nitrosGpsDiagnostic"/);
  assert.match(html,/nitros-single-build-and-service-worker-authority/);
  assert.match(html,/Numeric Evidence Consistency \+ Interpretation Guard/);
  assert.match(sw,/const VERSION = '10\.12\.31'/);
});

test('check-in and RO serialization propagates each saved photo GPS snapshot',()=>{
  assert.match(html,/photoEvidence:persistedPhotos\.map\(item=>\(\{[^\n]+gps:item\.gps/);
  for(const field of ['evidenceId:item.evidenceId||item.fieldId','technicianId:item.technicianId','caseId:item.caseId','appointmentId:item.appointmentId'])assert.ok(html.includes(field),`serialized evidence missing ${field}`);
});

test('all permanent common evidence inputs use per-photo GPS capture',()=>{
  for(const field of ['photoFrontLeft','photoFrontRight','photoRearLeft','photoRearRight','photoOdometer','photoVin','technicianPhoto','photoFinalOdometer'])assert.match(html,new RegExp(`PHOTO_FIELDS=[\\s\\S]+${field}`),`${field} is not in the common evidence model`);
  assert.match(html,/\["photoFrontLeft","photoFrontRight","photoRearLeft","photoRearRight","photoOdometer","photoVin","technicianPhoto","photoFinalOdometer"\][\s\S]+savePhotoEvidence\(id,file\)/);
  assert.match(html,/maximumAge:0/);
  assert.match(html,/pendingCapturedAt=new Date\(\)\.toISOString\(\);\[originalBlob,pendingGps\]=await Promise\.all/);
});

test('every existing evidence-card view renders its record-bound GPS and diagnostics',()=>{
  assert.match(html,/appendGpsToEvidenceCards\(grid,items\)/);
  assert.match(html,/activeEvidenceTimeline[\s\S]+NitrosGpsEvidence\.html\(i\.gps,escapeText\)/);
  assert.match(html,/complete-timeline-entry[\s\S]+NitrosGpsEvidence\.html\(i\.gps,esc\)/);
  assert.match(html,/diagnoseEvidence\(shown\[index\]\)/);
  assert.match(html,/evidenceId:`\$\{ACTIVE_PHOTO_RECORD\}:\$\{fieldId\}`/);
});
