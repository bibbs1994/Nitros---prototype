import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');

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
