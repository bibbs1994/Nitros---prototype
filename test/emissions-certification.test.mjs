import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.13.119 build and service worker advance together',()=>{
  assert.match(html,/version:'10\.13\.119'/);
  assert.match(sw,/const VERSION = '10\.13\.119'/);
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
  assert.match(html,/certificationSource:verified\?"Underhood VECI \/ Emissions Label":"Not Yet Verified"/);
  assert.match(html,/evidenceCapturedAt:hasVeci\?evidence\.capturedAt/);
  assert.match(html,/await Promise\.resolve\(window\.NitrosActiveRepairPersistence\?\.persistNow\?\.\(\)\)/);
});

test('emissions certification is explicit, evidence-based, and defaults safely',()=>{
  assert.match(html,/id="emissionsCertification"[\s\S]*?<option>Federal<\/option>[\s\S]*?<option>California \/ CARB<\/option>[\s\S]*?<option>50-State<\/option>[\s\S]*?<option selected>Unknown \/ Needs Verification<\/option>/);
  assert.match(html,/id="certificationSource"[\s\S]*?Underhood VECI \/ Emissions Label[\s\S]*?VIN \/ Manufacturer Build Data[\s\S]*?RPO \/ Build Data[\s\S]*?OEM Vehicle Data[\s\S]*?Technician Verified[\s\S]*?Other[\s\S]*?Not Yet Verified/);
  assert.match(html,/certificationSourceOtherNote/);
  assert.match(html,/allowedEmissionsCertification\(value\)\{return EMISSIONS_CERTIFICATIONS\.includes\(value\)\?value:"Unknown \/ Needs Verification";/);
  const decoderClassifier=html.match(/function classifyDecoderEmissions\(result\)\{([\s\S]*?)\n  \}/)?.[1]||'';
  assert.doesNotMatch(decoderClassifier,/Plant(?:City|State|Country)|ModelYear|DisplacementL|GPS/i);
});

test('emissions values are isolated in the active vehicle draft and reset for a new RO',()=>{
  assert.match(html,/selectedVehicle\.emissionsRecord=record/);
  assert.match(html,/selectedVehicle\.emissionsCertification=record\.certification/);
  assert.match(html,/selectedVehicle=\{\.\.\.vehicles\[code\]\};/);
  assert.match(html,/emissionsCertification:"Unknown \/ Needs Verification",\s*certificationSource:"Not Yet Verified"/);
  assert.match(html,/vehicleInformation:draft\.selectedVehicle/);
  assert.match(html,/draft,saveReason:reason/);
});

test('VIN decoder uses only explicit emissions/certification fields and never replaces verified VECI data',()=>{
  assert.match(html,/function classifyDecoderEmissions\(result\)/);
  assert.match(html,/\(emission\|certif\|carb\)/i);
  assert.match(html,/function hasVerifiedVeci\(vehicle\)/);
  assert.match(html,/preservedEmissions\|\|\{emissionsCertification:decoderEmissions\.classification/);
  assert.match(html,/VIN\/build data inconclusive — Check underhood emissions label/);
  assert.match(html,/decoderEmissions=classifyDecoderEmissions\(result\)[\s\S]*?await Promise\.resolve\(window\.NitrosActiveRepairPersistence\?\.persistNow\?\.\(\)\)/);
});

test('accepted VECI evidence writes one canonical vehicle emissions record before active RO persistence',()=>{
  assert.match(html,/function writeVehicleEmissions\(next=\{\},reason="vehicle update"\)/);
  assert.match(html,/selectedVehicle\.emissionsRecord=record/);
  assert.match(html,/"accepted VECI evidence"/);
  assert.match(html,/verificationSource:verified\?"Underhood emissions label":"Not Yet Verified"/);
  assert.match(html,/\[Nitros Emissions\] active RO persisted/);
});
