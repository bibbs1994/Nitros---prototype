import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.13.105 build and service worker advance together',()=>{
  assert.match(html,/version:'10\.13\.105'/);
  assert.match(sw,/const VERSION = '10\.13\.105'/);
});

test('VECI field capture supports capture, preview, and retake without bypassing RO evidence',()=>{
  for(const id of ['captureVeciLabel','retakeVeciLabel','photoVeciPreview','photoVeci'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/captureVeciLabel.*photoVeci/);
  assert.match(html,/retakeVeciLabel.*input\.click/);
});

test('VECI capture and evidence-gated verification remain vehicle scoped',()=>{
  for(const value of ['photoVeci','Underhood emissions / VECI label','verifyVeciWording','classifyVeciWording','emissionsVerificationStatus','emissionsEvidencePhotoReference','Unknown / Needs Verification'])assert.match(html,new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(html,/explicitBoth/);
  assert.match(html,/verified=hasVeci&&outcome\.status==="Verified"/);
  assert.match(html,/certificationSource"\)\.value=verified\?"Underhood VECI \/ Emissions Label":"Not Yet Verified"/);
  assert.match(html,/emissionsEvidenceCapturedAt=hasVeci\?activePhotoEvidence\.photoVeci\.capturedAt/);
  assert.match(html,/await Promise\.resolve\(window\.NitrosActiveRepairPersistence\?\.persistNow\?\.\(\)\)/);
});

test('emissions certification is explicit, evidence-based, and defaults safely',()=>{
  assert.match(html,/id="emissionsCertification"[\s\S]*?<option>Federal<\/option>[\s\S]*?<option>California \/ CARB<\/option>[\s\S]*?<option>50-State<\/option>[\s\S]*?<option selected>Unknown \/ Needs Verification<\/option>/);
  assert.match(html,/id="certificationSource"[\s\S]*?Underhood VECI \/ Emissions Label[\s\S]*?VIN \/ Manufacturer Build Data[\s\S]*?RPO \/ Build Data[\s\S]*?OEM Vehicle Data[\s\S]*?Technician Verified[\s\S]*?Other[\s\S]*?Not Yet Verified/);
  assert.match(html,/certificationSourceOtherNote/);
  assert.match(html,/allowedEmissionsCertification\(value\)\{return EMISSIONS_CERTIFICATIONS\.includes\(value\)\?value:"Unknown \/ Needs Verification";/);
  assert.doesNotMatch(html,/VIN[^\n]{0,160}(?:California \/ CARB|50-State|Federal)[^\n]{0,160}(?:assum|classif)/i);
});

test('emissions values are isolated in the active vehicle draft and reset for a new RO',()=>{
  assert.match(html,/selectedVehicle\.emissionsCertification=allowedEmissionsCertification/);
  assert.match(html,/selectedVehicle\.certificationSource=allowedCertificationSource/);
  assert.match(html,/selectedVehicle=\{\.\.\.vehicles\[code\]\};/);
  assert.match(html,/emissionsCertification:"Unknown \/ Needs Verification",\s*certificationSource:"Not Yet Verified"/);
  assert.match(html,/vehicleInformation:draft\.selectedVehicle/);
  assert.match(html,/draft,saveReason:reason/);
});
