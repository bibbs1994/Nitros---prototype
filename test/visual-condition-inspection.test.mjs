import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analyzeSemanticImage, NO_VISIBLE_DEFECT_MESSAGE } from '../semantic-analyzer-core.mjs';

const bytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]);
const response = payload => ({ok:true,status:200,async json(){return {output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}});
const drivetrain = {applicable:false,candidateType:'OTHER',engineConnection:'UNKNOWN',transmissionConnection:'UNKNOWN',longitudinalShafts:'UNKNOWN',lateralAxleOutputs:'UNKNOWN',axleTubes:'UNKNOWN',location:'UNKNOWN',powerFlowRole:'UNKNOWN',distinguishingFeaturesComplete:false,evidence:[],competingCandidate:null};
const component = {status:'IDENTIFIED',primaryComponent:'Turbocharger compressor housing',componentConfidence:91,system:'Forced induction',secondaryComponents:['charge-air connection'],supportingEvidence:['silver compressor housing and charge-air connection are visible'],possibleAlternatives:[],uncertaintyReason:null,drivetrainDiscrimination:drivetrain};
const classifier = {category:'AUTOMOTIVE_COMPONENT_OR_VEHICLE',confidence:96,objects:['turbocharger'],evidence:['silver compressor housing is visible'],description:'Turbocharger intake-side view.',automotiveEvidence:['silver compressor housing and a charge-air connection are visible'],graphEvidence:[],documentEvidence:[]};

async function inspect(condition){
  const body={transactionId:'visual-condition-test',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  let call=0;const originalInfo=console.info;console.info=()=>{};
  try { return await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async()=>response([classifier,component,condition][call++])}); }
  finally { console.info=originalInfo; }
}

test('visual condition inspection keeps turbocharger compressor terminology and independent confidence',async()=>{
  const result=await inspect({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:78,observedCondition:['The silver compressor housing is visible at the intake side of the turbocharger.'],possibleConcerns:[{location:'Lower portion of the visible compressor-side charge-air connection',appearance:'A visible gap at the pipe-to-coupler interface suggests the connection appears improperly seated.',physicalConfirmationRequired:true,recommendedVerification:'Physically confirm full pipe engagement and retaining-clamp position before operating the vehicle.'}],connectionAssessments:[{location:'Lower compressor-side charge-air connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',visibleEvidence:'A visible gap remains between the pipe end and the coupler seating edge.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Silver compressor housing and lower charge-air connection are visible.','A visible gap remains at the pipe-to-coupler interface.'],recommendedVerification:['Inspect pipe seating, clamp position and tightness, coupler damage, retaining-clip engagement, oil residue, boost-leak symptoms, and relevant DTCs/scan data.'],safetyDrivabilityImpact:'Possible boost leakage may reduce power; confirm before driving under load.'});
  const inspection=result.semanticResult.visualConditionInspection;
  assert.equal(result.semanticResult.componentIdentification.primaryComponent,'Turbocharger compressor housing');
  assert.equal(inspection.normalizedConditionConfidence,78);
  assert.notEqual(inspection.normalizedConditionConfidence,result.semanticResult.componentIdentification.normalizedComponentConfidence);
  assert.match(inspection.observedCondition.join(' '),/compressor housing/i);
  assert.doesNotMatch(inspection.observedCondition.join(' '),/turbine housing/i);
  assert.equal(inspection.possibleConcerns[0].physicalConfirmationRequired,true);
  assert.equal(inspection.connectionAssessments[0].seatingStatus,'SEPARATION_OR_GAP_VISIBLE');
});

test('visual condition inspection supports visible residue, no-defect, and obstructed-image outcomes',async()=>{
  const residue=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:74,observedCondition:['Dark wet-looking residue is visible below the hose connection.'],possibleConcerns:[],connectionAssessments:[{location:'Visible hose connection',seatingStatus:'NOT_RELIABLY_VISIBLE',visibleEvidence:'The joint is partly obscured.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Dark wet-looking residue is visible below the connection.'],recommendedVerification:['Clean the area and physically determine the fluid source before repair.'],safetyDrivabilityImpact:null});
  assert.equal(residue.semanticResult.visualConditionInspection.status,'OBSERVED_CONDITION');
  assert.match(residue.semanticResult.visualConditionInspection.observedCondition[0],/residue/i);
  const noDefect=await inspect({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:88,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Compressor housing outlet joint',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',visibleEvidence:'The visible pipe lip is fully seated against the coupler edge.'}],noVisibleConcernMessage:'different wording is ignored',unableToInspectReason:null,visibleEvidence:['Compressor housing exterior is visible.'],recommendedVerification:['Inspect the component physically before making a repair decision.'],safetyDrivabilityImpact:null});
  assert.equal(noDefect.semanticResult.visualConditionInspection.noVisibleConcernMessage,NO_VISIBLE_DEFECT_MESSAGE);
  const obstructed=await inspect({status:'UNABLE_TO_INSPECT',conditionConfidence:22,observedCondition:[],possibleConcerns:[],connectionAssessments:[],noVisibleConcernMessage:'',unableToInspectReason:'The connection area is obscured and out of focus.',visibleEvidence:[],recommendedVerification:['Obtain a focused image with the connection exposed from another angle.'],safetyDrivabilityImpact:null});
  assert.equal(obstructed.semanticResult.visualConditionInspection.status,'UNABLE_TO_INSPECT');
  assert.match(obstructed.semanticResult.visualConditionInspection.unableToInspectReason,/obscured/i);
});

test('visual condition inspection rejects unsupported possible findings and renders after identification',async()=>{
  const unsupported=await inspect({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:71,observedCondition:[],possibleConcerns:[{location:'Unknown area',appearance:'A hose is disconnected.',physicalConfirmationRequired:false,recommendedVerification:''}],connectionAssessments:[],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:[],recommendedVerification:[],safetyDrivabilityImpact:null});
  assert.equal(unsupported.semanticResult.visualConditionInspection.status,'FAILED');
  assert.match(unsupported.semanticResult.visualConditionInspection.unableToInspectReason,/lacks required physical verification|invalid/i);
  const unassessedNoDefect=await inspect({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:90,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Charge-air connection',seatingStatus:'NOT_RELIABLY_VISIBLE',visibleEvidence:'The connection is partly hidden.'}],noVisibleConcernMessage:NO_VISIBLE_DEFECT_MESSAGE,unableToInspectReason:null,visibleEvidence:['A portion of the connection is visible.'],recommendedVerification:['Obtain a closer image from another angle.'],safetyDrivabilityImpact:null});
  assert.equal(unassessedNoDefect.semanticResult.visualConditionInspection.status,'FAILED');
  assert.match(unassessedNoDefect.semanticResult.visualConditionInspection.unableToInspectReason,/affirmatively assessed as seated/i);
  const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
  assert.match(analyzer,/<h3>VISUAL CONDITION INSPECTION<\/h3>/);
  assert.match(analyzer,/Confirmation by physical inspection is required/);
  assert.match(analyzer,/condition-field/);
  assert.match(analyzer,/Exact visible evidence/);
  assert.ok(analyzer.indexOf('VISUAL CONDITION INSPECTION')>analyzer.indexOf('SPECIFIC COMPONENT IDENTIFICATION'));
});
