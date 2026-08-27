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
  condition={...condition,connectionAssessments:(condition.connectionAssessments||[]).map(item=>({
    ...item,
    findingType:item.findingType||(item.seatingStatus==='SEPARATION_OR_GAP_VISIBLE'?'CLEAR_DEFECT':item.seatingStatus==='NOT_RELIABLY_VISIBLE'?'SEATING_NOT_RELIABLY_VISIBLE':item.seatingStatus==='NO_GAP_OR_SEPARATION_VISIBLE'?'NO_DEFECT_VISIBLE':'POSSIBLE_CONCERN'),
    severity:item.severity||(item.seatingStatus==='SEPARATION_OR_GAP_VISIBLE'?'HIGH':item.seatingStatus==='NOT_RELIABLY_VISIBLE'?'UNDETERMINED':item.seatingStatus==='NO_GAP_OR_SEPARATION_VISIBLE'?'LOW':'MODERATE'),
    findingConfidence:item.findingConfidence??72,
    recommendedVerification:item.recommendedVerification||'Physically inspect this connection before repair authorization.',
    safetyDrivabilityImpact:item.safetyDrivabilityImpact??null
  }))};
  const body={transactionId:'visual-condition-test',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  let call=0;const originalInfo=console.info;console.info=()=>{};
  try { return await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async()=>response([classifier,component,condition][call++])}); }
  finally { console.info=originalInfo; }
}

test('visual condition inspection keeps turbocharger compressor terminology and independent confidence',async()=>{
  const result=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:78,observedCondition:['The silver compressor housing is visible at the intake side of the turbocharger.','A separated charge-air connection is visible.'],possibleConcerns:[],connectionAssessments:[{location:'Lower compressor-side charge-air connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:86,visibleEvidence:'A visible gap remains between the pipe end and the coupler seating edge.',recommendedVerification:'Physically confirm full pipe engagement, clamp position and tightness, coupler damage, retaining-clip engagement, oil residue, boost-leak symptoms, and relevant DTCs/scan data.',safetyDrivabilityImpact:'Possible boost leakage may reduce power.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Silver compressor housing and lower charge-air connection are visible.','A visible gap remains at the pipe-to-coupler interface.'],recommendedVerification:['Inspect pipe seating, clamp position and tightness, coupler damage, retaining-clip engagement, oil residue, boost-leak symptoms, and relevant DTCs/scan data.'],safetyDrivabilityImpact:'Possible boost leakage may reduce power; confirm before driving under load.'});
  const inspection=result.semanticResult.visualConditionInspection;
  assert.equal(result.semanticResult.componentIdentification.primaryComponent,'Turbocharger compressor housing');
  assert.equal(inspection.normalizedConditionConfidence,78);
  assert.notEqual(inspection.normalizedConditionConfidence,result.semanticResult.componentIdentification.normalizedComponentConfidence);
  assert.match(inspection.observedCondition.join(' '),/compressor housing/i);
  assert.doesNotMatch(inspection.observedCondition.join(' '),/turbine housing/i);
  assert.equal(inspection.connectionAssessments[0].seatingStatus,'SEPARATION_OR_GAP_VISIBLE');
  assert.equal(inspection.connectionAssessments[0].severity,'HIGH');
  assert.equal(inspection.connectionAssessments[0].findingConfidence,86);
});

test('connection gap is prioritized ahead of residue and a separate seated lower clamp',async()=>{
  const result=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:84,observedCondition:['The upper turbo charge-air connection appears partially separated.','Dark residue is visible near the upper connection.'],possibleConcerns:[],connectionAssessments:[
    {location:'Lower charge-air clamp',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',visibleEvidence:'The visible lower clamp is positioned over the coupler sealing area.'},
    {location:'Upper turbo charge-air connection',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'POSSIBLE_CONCERN',severity:'MODERATE',findingConfidence:81,visibleEvidence:'The upper pipe-to-coupler interface shows uneven insertion depth and a visible gap at the mating edge.',recommendedVerification:'Check whether the connection is fully inserted, inspect the entire circumference for a gap, verify clamp or retaining-clip position, perform a gentle movement/pull check, inspect the seal or O-ring when accessible, then smoke-test or pressure-test for leakage.',safetyDrivabilityImpact:'Possible boost-air leak may affect performance.'},
    {location:'Upper turbo charge-air connection',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'RESIDUE_OR_STAINING',severity:'LOW',findingConfidence:67,visibleEvidence:'Dark residue is visible adjacent to the upper connection.',recommendedVerification:'Clean the area and check for fresh residue after the seating inspection.',safetyDrivabilityImpact:null}
  ],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Upper pipe-to-coupler gap and uneven insertion depth are visible.','Dark residue is visible adjacent to the upper connection.'],recommendedVerification:['Physically inspect the connections before repair authorization.'],safetyDrivabilityImpact:'Possible boost-air leak may affect performance.'});
  const findings=result.semanticResult.visualConditionInspection.connectionAssessments;
  assert.equal(findings[0].location,'Upper turbo charge-air connection');
  assert.equal(findings[0].severity,'MODERATE');
  assert.equal(findings.at(-1).location,'Lower charge-air clamp');
  assert.match(findings[0].recommendedVerification,/entire circumference|movement\/pull|smoke-test|pressure-test/i);
});

test('visual condition timeout retries once with the completed component context',async()=>{
  const body={transactionId:'condition-retry',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  const noDefect={status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:83,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Visible compressor outlet connection',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',severity:'LOW',findingConfidence:83,visibleEvidence:'The visible pipe lip is seated at the coupler edge.',recommendedVerification:'Physically inspect the connection before repair authorization.',safetyDrivabilityImpact:null}],noVisibleConcernMessage:NO_VISIBLE_DEFECT_MESSAGE,unableToInspectReason:null,visibleEvidence:['The visible pipe lip is seated at the coupler edge.'],recommendedVerification:['Physically inspect the connection before repair authorization.'],safetyDrivabilityImpact:null};
  let calls=0;const originalInfo=console.info;console.info=()=>{};
  try { const result=await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async(_url,options)=>{calls+=1;if(calls===3)throw Object.assign(new Error('Visual condition request timed out.'),{name:'TimeoutError'});const request=JSON.parse(options.body);if(calls===4)assert.match(request.input[0].content[0].text,/Inspect only the visible physical connections/i);return response(calls===1?classifier:calls===2?component:noDefect);}});assert.equal(calls,4);assert.equal(result.semanticResult.visualConditionInspection.status,'NO_VISIBLE_CONCERN_DETECTED');assert.equal(result.serverDiagnostic.visualConditionFirstRequestTimeout,true);assert.equal(result.serverDiagnostic.visualConditionRetryStarted,true);assert.equal(result.serverDiagnostic.visualConditionRetrySuccess,true);assert.equal(result.serverDiagnostic.visualConditionRetryFailure,false); } finally { console.info=originalInfo; }
});

test('visual condition inspection supports visible residue, no-defect, and obstructed-image outcomes',async()=>{
  const residue=await inspect({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:74,observedCondition:['Dark wet-looking residue is visible below the hose connection.'],possibleConcerns:[{location:'Below the visible hose connection',appearance:'Residue may indicate seepage, but the image does not confirm the source or a disconnected pipe.',physicalConfirmationRequired:true,recommendedVerification:'Clean the area and inspect for fresh seepage.'}],connectionAssessments:[{location:'Visible hose connection',seatingStatus:'NOT_RELIABLY_VISIBLE',visibleEvidence:'The joint is partly obscured.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Dark wet-looking residue is visible below the connection.'],recommendedVerification:['Clean the area and physically determine the fluid source before repair.'],safetyDrivabilityImpact:null});
  assert.equal(residue.semanticResult.visualConditionInspection.status,'POSSIBLE_CONCERN_DETECTED');
  assert.match(residue.semanticResult.visualConditionInspection.observedCondition[0],/residue/i);
  assert.doesNotMatch(residue.semanticResult.visualConditionInspection.possibleConcerns[0].appearance,/confirmed disconnected/i);
  const noDefect=await inspect({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:88,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Compressor housing outlet joint',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',visibleEvidence:'The visible pipe lip is fully seated against the coupler edge.'}],noVisibleConcernMessage:'different wording is ignored',unableToInspectReason:null,visibleEvidence:['Compressor housing exterior is visible.'],recommendedVerification:['Inspect the component physically before making a repair decision.'],safetyDrivabilityImpact:null});
  assert.equal(noDefect.semanticResult.visualConditionInspection.noVisibleConcernMessage,NO_VISIBLE_DEFECT_MESSAGE);
  const obstructed=await inspect({status:'UNABLE_TO_INSPECT',conditionConfidence:22,observedCondition:[],possibleConcerns:[],connectionAssessments:[],noVisibleConcernMessage:'',unableToInspectReason:'The connection area is obscured and out of focus.',visibleEvidence:[],recommendedVerification:['Obtain a focused image with the connection exposed from another angle.'],safetyDrivabilityImpact:null});
  assert.equal(obstructed.semanticResult.visualConditionInspection.status,'UNABLE_TO_INSPECT');
  assert.match(obstructed.semanticResult.visualConditionInspection.unableToInspectReason,/obscured/i);
});

test('visual condition inspection rejects unsupported possible findings and renders after identification',async()=>{
  const unsupported=await inspect({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:71,observedCondition:[],possibleConcerns:[{location:'Unknown area',appearance:'A hose is disconnected.',physicalConfirmationRequired:false,recommendedVerification:''}],connectionAssessments:[],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:[],recommendedVerification:[],safetyDrivabilityImpact:null});
  assert.equal(unsupported.semanticResult.visualConditionInspection.status,'UNABLE_TO_INSPECT');
  assert.match(unsupported.semanticResult.visualConditionInspection.unableToInspectReason,/lacks required physical verification|invalid/i);
  const unassessedNoDefect=await inspect({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:90,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Charge-air connection',seatingStatus:'NOT_RELIABLY_VISIBLE',visibleEvidence:'The connection is partly hidden.'}],noVisibleConcernMessage:NO_VISIBLE_DEFECT_MESSAGE,unableToInspectReason:null,visibleEvidence:['A portion of the connection is visible.'],recommendedVerification:['Obtain a closer image from another angle.'],safetyDrivabilityImpact:null});
  assert.equal(unassessedNoDefect.semanticResult.visualConditionInspection.status,'UNABLE_TO_INSPECT');
  assert.match(unassessedNoDefect.semanticResult.visualConditionInspection.unableToInspectReason,/affirmatively assessed as seated/i);
  const duplicates=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:81,observedCondition:['A visible pipe gap is present.','A visible pipe gap is present.'],possibleConcerns:[],connectionAssessments:[{location:'Charge-air pipe connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',visibleEvidence:'A visible gap is present at the pipe edge.'},{location:'Charge-air pipe connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',visibleEvidence:'A visible gap is present at the pipe edge.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['A visible gap is present at the pipe edge.','A visible gap is present at the pipe edge.'],recommendedVerification:['Inspect pipe seating.'],safetyDrivabilityImpact:null});
  assert.equal(duplicates.semanticResult.visualConditionInspection.connectionAssessments.length,1);
  assert.equal(duplicates.semanticResult.visualConditionInspection.observedCondition.length,1);
  const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
  assert.match(analyzer,/<h3>VISUAL CONDITION INSPECTION<\/h3>/);
  assert.match(analyzer,/Confirmation by physical inspection is required/);
  assert.match(analyzer,/condition-field/);
  assert.match(analyzer,/Visible observations/);
  assert.match(analyzer,/What cannot be confirmed/);
  assert.match(analyzer,/Recommended technician verification/);
  assert.ok(analyzer.indexOf('VISUAL CONDITION INSPECTION')>analyzer.indexOf('SPECIFIC COMPONENT IDENTIFICATION'));
});

test('starter wiring, repair context, loose connector, turbo separation, obscuration, and ambiguity remain evidence-calibrated',async()=>{
  const starterWiring={...component,status:'IDENTIFIED',primaryComponent:'Starter motor',componentConfidence:94,system:'Starting system',secondaryComponents:['positive battery cable','small electrical connector'],supportingEvidence:['A heavy-gauge positive cable and a smaller electrical connector are visible near the bellhousing.'],possibleAlternatives:[],uncertaintyReason:null};
  const starterRemoved={status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:42,observedCondition:['A heavy-gauge positive cable and smaller electrical connector are visible near the bellhousing.'],possibleConcerns:[{location:'Bellhousing-area wiring',appearance:'The wiring may normally connect to the starter/starter solenoid, but the connected component is not visible and may be removed, outside the frame, or obscured.',physicalConfirmationRequired:true,recommendedVerification:'Confirm the active repair state and trace both wires to their intended destination before reconnecting.'}],connectionAssessments:[{location:'Bellhousing-area wiring',seatingStatus:'NOT_RELIABLY_VISIBLE',findingType:'SEATING_NOT_RELIABLY_VISIBLE',severity:'UNDETERMINED',findingConfidence:42,visibleEvidence:'The cable ends are visible, but no mating starter housing or terminal is visible.',recommendedVerification:'Confirm the active repair state and trace both wires to their intended destination before reconnecting.',safetyDrivabilityImpact:null}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Heavy-gauge cable and smaller electrical connector are visible.'],recommendedVerification:['Confirm whether the starter is removed, outside the frame, or obscured; do not energize or reconnect based on this image alone.'],safetyDrivabilityImpact:null};
  const body={transactionId:'starter-removed-test',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  let call=0;const originalInfo=console.info;console.info=()=>{};
  try {
    const result=await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async()=>response([classifier,starterWiring,starterRemoved][call++])});
    const identified=result.semanticResult.componentIdentification, inspection=result.semanticResult.visualConditionInspection;
    assert.equal(identified.status,'UNCERTAIN');
    assert.match(identified.primaryComponent,/cannot be confirmed/i);
    assert.ok(identified.componentConfidence<=45);
    assert.match(identified.likelyConnectionsOrDestinations.join(' '),/may normally connect/i);
    assert.doesNotMatch(inspection.observedCondition.join(' '),/starter assembly is visible/i);
    assert.match(inspection.possibleConcerns[0].appearance,/may be removed, outside the frame, or obscured/i);
    assert.equal(inspection.connectionAssessments[0].findingType,'SEATING_NOT_RELIABLY_VISIBLE');
  } finally { console.info=originalInfo; }
  const analyzer=readFileSync(new URL('../semantic-analyzer-core.mjs',import.meta.url),'utf8');
  for(const scenario of ['If a starter is installed and its housing','Do not automatically classify disconnected wiring as a defect when active repair or disassembly is plausible','loose connectors, broken parts, missing fasteners, separated intake/turbo pipes','removed, outside the frame, or obscured']) assert.match(analyzer,new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
});
