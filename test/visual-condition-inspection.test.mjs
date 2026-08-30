import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { analyzeSemanticImage, NO_VISIBLE_DEFECT_MESSAGE, STRICT_OUTPUT_SCHEMAS, assertStrictOutputSchema, normalizeVehicleAnalysisContext, normalizeVisualConditionConsistency } from '../semantic-analyzer-core.mjs';

const bytes = Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a,0]);
const response = payload => ({ok:true,status:200,async json(){return {output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(payload)}]}]}}});
const drivetrain = {applicable:false,candidateType:'OTHER',engineConnection:'UNKNOWN',transmissionConnection:'UNKNOWN',longitudinalShafts:'UNKNOWN',lateralAxleOutputs:'UNKNOWN',axleTubes:'UNKNOWN',location:'UNKNOWN',powerFlowRole:'UNKNOWN',distinguishingFeaturesComplete:false,evidence:[],competingCandidate:null};
const component = {status:'IDENTIFIED',primaryComponent:'Turbocharger compressor housing',componentConfidence:91,system:'Forced induction',secondaryComponents:['charge-air connection'],supportingEvidence:['silver compressor housing and charge-air connection are visible'],possibleAlternatives:[],uncertaintyReason:null,drivetrainDiscrimination:drivetrain};
const classifier = {category:'AUTOMOTIVE_COMPONENT_OR_VEHICLE',confidence:96,objects:['turbocharger'],evidence:['silver compressor housing is visible'],description:'Turbocharger intake-side view.',automotiveEvidence:['silver compressor housing and a charge-air connection are visible'],graphEvidence:[],documentEvidence:[]};

test('every OpenAI strict-output schema requires every declared object property',()=>{
  for(const schema of Object.values(STRICT_OUTPUT_SCHEMAS)) assert.doesNotThrow(()=>assertStrictOutputSchema(schema));
  assert.throws(()=>assertStrictOutputSchema({type:'object',additionalProperties:false,required:['present'],properties:{present:{type:'string'},missing:{type:'string'}}}),/missing: missing/);
  assert.ok(STRICT_OUTPUT_SCHEMAS.automotiveComponentSchema.required.includes('likelyConnectionsOrDestinations'));
});

test('visual consistency repair corrects unassessable concerns and confidence contradictions without weakening confirmed findings',()=>{
  const noAssessable=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:88,possibleConcerns:[],connectionAssessments:[],visibleEvidence:[]});
  assert.equal(noAssessable.normalized.status,'UNABLE_TO_INSPECT');
  assert.match(noAssessable.corrections[0],/no specific visible condition or assessable connection/i);
  const capped=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:91,visibleEvidence:['Uneven connector seating is visible.'],possibleConcerns:[{location:'Connector',appearance:'Uneven seating is visible.',physicalConfirmationRequired:true,recommendedVerification:'Inspect connector seating.'}],connectionAssessments:[{location:'Center-right beside the visible connector',findingType:'POSSIBLE_CONCERN',findingConfidence:46,seatingStatus:'POSSIBLE_IMPROPER_SEATING',visibleEvidence:'Uneven connector seating is visible.'}]});
  assert.equal(capped.normalized.conditionConfidence,46);
  assert.match(capped.corrections[0],/capped from 91% to 46%/);
  for(const findingType of ['CLEAR_DEFECT','NO_DEFECT_VISIBLE']){
    const confirmed=normalizeVisualConditionConsistency({status:findingType==='CLEAR_DEFECT'?'OBSERVED_CONDITION':'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:82,visibleEvidence:[findingType==='CLEAR_DEFECT'?'A visible separation gap is present.':'The complete mating interface is fully seated and no abnormal gap is visible.'],possibleConcerns:[],connectionAssessments:[{location:'Upper-left area of image',findingType,findingConfidence:82,seatingStatus:findingType==='CLEAR_DEFECT'?'SEPARATION_OR_GAP_VISIBLE':'NO_GAP_OR_SEPARATION_VISIBLE',matingComponentVisible:findingType==='NO_DEFECT_VISIBLE',visibleEvidence:findingType==='CLEAR_DEFECT'?'A visible separation gap is present.':'The complete mating interface is fully seated and no abnormal gap is visible.'}]});
    assert.equal(confirmed.normalized.status,findingType==='CLEAR_DEFECT'?'OBSERVED_CONDITION':'NO_VISIBLE_CONCERN_DETECTED');
    assert.equal(confirmed.corrections.length,0);
  }
  const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
  assert.match(analyzer,/Component-identification confidence/);
  assert.match(analyzer,/Overall visual-inspection confidence/);
  assert.match(analyzer,/Finding confidence/);
  assert.match(analyzer,/Image\/category routing confidence/);
  assert.match(analyzer,/Likely connection or destination \(not confirmed\)<\/strong>\$\{list\(component\.likelyConnectionsOrDestinations\)\}<\/div><div class="condition-field"><strong>Secondary visible components/);
  assert.match(analyzer,/'<p class="condition-empty">None<\/p>'/);
});

test('10.13.119 requires affirmative mating evidence before a connection can be called no visible defect',()=>{
  const base={location:'Center electrical connector',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',severity:'LOW',findingConfidence:97,matingComponentVisible:true,directDamageVisible:false,recommendedVerification:'Physically verify the connector latch and wire entry condition.'};
  const proven=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:99,visibleEvidence:['Both connector halves are fully mated; the locking tab is visibly engaged and no abnormal gap is visible.'],connectionAssessments:[{...base,visibleEvidence:'Both connector halves are fully mated, the locking tab is visibly engaged, and no abnormal gap is visible.'}]});
  assert.equal(proven.normalized.status,'NO_VISIBLE_CONCERN_DETECTED');
  assert.equal(proven.normalized.conditionConfidence,97);
  const obscured=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:97,visibleEvidence:['A connector body is visible.'],connectionAssessments:[{...base,visibleEvidence:'The connector body is visible, but the latch and mating interface are obscured.'}]});
  assert.equal(obscured.normalized.status,'UNABLE_TO_INSPECT');
  assert.equal(obscured.normalized.connectionAssessments[0].findingType,'SEATING_NOT_RELIABLY_VISIBLE');
  assert.match(obscured.normalized.unableToInspectReason,/Unable to verify from this image/i);
  assert.ok(obscured.normalized.connectionAssessments[0].findingConfidence<=50);
});

test('10.13.119 preserves positive faults and accepts only directly demonstrated hose/clamp seating',()=>{
  const hose={location:'Lower hose connection',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',severity:'LOW',findingConfidence:84,matingComponentVisible:true,directDamageVisible:false,recommendedVerification:'Physically verify hose engagement and clamp position.'};
  const seated=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:84,visibleEvidence:['The hose is fully seated on the fitting and the clamp is visibly positioned over the retention area.'],connectionAssessments:[{...hose,visibleEvidence:'The hose is fully seated on the fitting and the clamp is visibly positioned over the retention area.'}]});
  assert.equal(seated.normalized.status,'NO_VISIBLE_CONCERN_DETECTED');
  const displaced=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:98,visibleEvidence:['A displaced clamp and visible hose separation are present.'],connectionAssessments:[{...hose,seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:93,directDamageVisible:true,visibleEvidence:'The clamp is visibly displaced and a physical separation gap is present between the hose and fitting.'}]});
  assert.equal(displaced.normalized.status,'OBSERVED_CONDITION');
  assert.equal(displaced.normalized.connectionAssessments[0].findingType,'CLEAR_DEFECT');
  assert.equal(displaced.normalized.conditionConfidence,93);
});

test('10.13.120 derives independent electrical connection states and lets visible geometry override a normal claim',()=>{
  const base={location:'EGR-area electrical connector',severity:'LOW',findingConfidence:90,matingComponentVisible:true,directDamageVisible:false,missingContext:null,recommendedVerification:'Inspect the connector and mating receptacle.'};
  const disconnected=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:90,visibleEvidence:['The loose harness plug is beside an empty component-side receptacle with an air gap.'],connectionAssessments:[{...base,seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',visibleEvidence:'The loose harness plug is beside an empty component-side receptacle with an air gap between the connector housing and mating socket.'}]});
  assert.equal(disconnected.normalized.status,'OBSERVED_CONDITION');
  assert.equal(disconnected.normalized.connectionAssessments[0].findingType,'CLEAR_DEFECT');
  const states=[
    ['NO_GAP_OR_SEPARATION_VISIBLE','NO_DEFECT_VISIBLE','Both connector halves are fully mated and the locking tab is visibly engaged.','CONNECTED_VERIFIED'],
    ['SEPARATION_OR_GAP_VISIBLE','CLEAR_DEFECT','A visible air gap separates the plug from the empty component-side receptacle.','DISCONNECTED_VERIFIED'],
    ['POSSIBLE_IMPROPER_SEATING','POSSIBLE_CONCERN','The connector is partly inserted with uneven insertion depth.','PARTIALLY_SEATED_OR_SUSPECTED'],
    ['NO_GAP_OR_SEPARATION_VISIBLE','NO_DEFECT_VISIBLE','The connector body is fully seated, but the CPA secondary lock is not visible.','CONNECTED_BUT_RETENTION_NOT_VERIFIABLE'],
    ['NOT_RELIABLY_VISIBLE','SEATING_NOT_RELIABLY_VISIBLE','The connector mating interface is hidden behind the harness.','UNABLE_TO_DETERMINE_FROM_IMAGE']
  ];
  for(const [seatingStatus,findingType,visibleEvidence,connectionState] of states){const result=normalizeVisualConditionConsistency({status:findingType==='CLEAR_DEFECT'?'OBSERVED_CONDITION':findingType==='NO_DEFECT_VISIBLE'?'NO_VISIBLE_CONCERN_DETECTED':'POSSIBLE_CONCERN_DETECTED',conditionConfidence:75,visibleEvidence:[visibleEvidence],possibleConcerns:findingType==='POSSIBLE_CONCERN'?[{location:base.location,appearance:visibleEvidence,physicalConfirmationRequired:true,recommendedVerification:base.recommendedVerification}]:[],connectionAssessments:[{...base,seatingStatus,findingType,visibleEvidence}]});const item=result.normalized.connectionAssessments[0];assert.equal(item.connectionState,connectionState);}
  assert.match(readFileSync(new URL('../semantic-analyzer-core.mjs',import.meta.url),'utf8'),/PROXIMITY IS NOT CONNECTION|not evidence that it is connected/i);
});

test('visual consistency repair preserves precise image-relative locations and rejects vague or unsupported vehicle-side claims',()=>{
  const normalized=normalizeVisualConditionConsistency({status:'UNVERIFIED_CONDITION',conditionConfidence:42,visibleEvidence:['Connector and cable are visible.'],possibleConcerns:[],connectionAssessments:[
    {location:'center, near visible harness',findingType:'UNVERIFIED_CONDITION',findingConfidence:42,seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'},
    {location:'driver side beside the cable',findingType:'UNVERIFIED_CONDITION',findingConfidence:42,seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'},
    {location:'center-right beside the large cable',findingType:'UNVERIFIED_CONDITION',findingConfidence:42,seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE'}
  ]});
  assert.equal(normalized.normalized.connectionAssessments[0].location,'Image-relative location cannot be determined reliably.');
  assert.equal(normalized.normalized.connectionAssessments[1].location,'Image-relative location cannot be determined reliably.');
  assert.equal(normalized.normalized.connectionAssessments[2].location,'center-right beside the large cable');
  assert.equal(normalized.corrections.length,2);
  assert.match(normalized.corrections[0],/location normalized/i);
});

test('one directly visible disconnected connector is retained while ordinary visible hoses and cables create no secondary defect',()=>{
  const normalized=normalizeVisualConditionConsistency({status:'OBSERVED_CONDITION',conditionConfidence:89,visibleEvidence:['A gray connector has a visible separation gap and exposed terminals.'],possibleConcerns:[{location:'Lower-left hose',appearance:'A hose is visible at an unfamiliar angle.',physicalConfirmationRequired:true,recommendedVerification:'Inspect the hose.'}],connectionAssessments:[
    {location:'Center-right gray electrical connector',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:91,visibleEvidence:'A physical separation gap and exposed metal terminals are visible at the gray connector.',recommendedVerification:'Inspect the connector body, terminals, lock, and mating half before reconnecting.'},
    {location:'Lower-left hose and cable',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'POSSIBLE_CONCERN',severity:'MODERATE',findingConfidence:82,visibleEvidence:'A hose and cable are visible along the normal-looking route.',recommendedVerification:'Inspect routing.'}
  ]});
  assert.equal(normalized.normalized.connectionAssessments.length,1);
  assert.equal(normalized.normalized.connectionAssessments[0].findingType,'CLEAR_DEFECT');
  assert.equal(normalized.normalized.possibleConcerns.length,0);
  assert.equal(normalized.normalized.status,'OBSERVED_CONDITION');
  assert.match(normalized.corrections.join(' '),/secondary visual finding.*omitted/i);
});

test('a primary disconnected connector survives while route-only secondary candidates are all omitted',()=>{
  const result=normalizeVisualConditionConsistency({status:'OBSERVED_CONDITION',conditionConfidence:94,visibleEvidence:['A gray connector has exposed terminals and a visible separation gap.'],possibleConcerns:[],connectionAssessments:[
    {location:'Center-right gray connector',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:94,visibleEvidence:'Exposed metal terminals and a physical separation gap are visible.',matingComponentVisible:true,directDamageVisible:true,recommendedVerification:'Inspect the terminals and mating half before reconnecting.'},
    {location:'Lower-left hose',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'POSSIBLE_CONCERN',severity:'MODERATE',findingConfidence:79,visibleEvidence:'The hose is visible along its normal route.',recommendedVerification:'Inspect hose routing.'},
    {location:'Upper-center cable',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'POSSIBLE_CONCERN',severity:'MODERATE',findingConfidence:78,visibleEvidence:'A cable is visible at an unfamiliar angle.',recommendedVerification:'Inspect cable routing.'},
    {location:'Lower-right clamp',seatingStatus:'POSSIBLE_IMPROPER_SEATING',findingType:'POSSIBLE_CONCERN',severity:'MODERATE',findingConfidence:76,visibleEvidence:'The clamp is only partly visible.',recommendedVerification:'Inspect clamp seating.'}
  ]});
  assert.equal(result.normalized.status,'OBSERVED_CONDITION');
  assert.equal(result.normalized.connectionAssessments.length,1);
  assert.equal(result.normalized.connectionAssessments[0].findingType,'CLEAR_DEFECT');
  assert.equal(result.normalized.connectionAssessments[0].findingConfidence,94);
  assert.match(result.corrections.join(' '),/3 secondary visual findings omitted/i);
});

async function inspect(condition){
  condition={...condition,connectionAssessments:(condition.connectionAssessments||[]).map(item=>({
    ...item,
    findingType:item.findingType||(item.seatingStatus==='SEPARATION_OR_GAP_VISIBLE'?'CLEAR_DEFECT':item.seatingStatus==='NOT_RELIABLY_VISIBLE'?'SEATING_NOT_RELIABLY_VISIBLE':item.seatingStatus==='NO_GAP_OR_SEPARATION_VISIBLE'?'NO_DEFECT_VISIBLE':'POSSIBLE_CONCERN'),
    severity:item.severity||(item.seatingStatus==='SEPARATION_OR_GAP_VISIBLE'?'HIGH':item.seatingStatus==='NOT_RELIABLY_VISIBLE'?'UNDETERMINED':item.seatingStatus==='NO_GAP_OR_SEPARATION_VISIBLE'?'LOW':'MODERATE'),
    findingConfidence:item.findingConfidence??72,
    matingComponentVisible:item.matingComponentVisible??true,
    directDamageVisible:item.directDamageVisible??false,
    missingContext:item.missingContext??(item.seatingStatus==='NOT_RELIABLY_VISIBLE'?'The mating component or connection context is not visible.':null),
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
  const noDefect={status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:83,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Visible compressor outlet connection',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',severity:'LOW',findingConfidence:83,visibleEvidence:'The pipe is fully seated on the coupler and the complete mating interface shows no abnormal gap.',matingComponentVisible:true,directDamageVisible:false,missingContext:null,recommendedVerification:'Physically inspect the connection before repair authorization.',safetyDrivabilityImpact:null}],noVisibleConcernMessage:NO_VISIBLE_DEFECT_MESSAGE,unableToInspectReason:null,visibleEvidence:['The pipe is fully seated on the coupler and the complete mating interface shows no abnormal gap.'],recommendedVerification:['Physically inspect the connection before repair authorization.'],safetyDrivabilityImpact:null};
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
  assert.match(unsupported.semanticResult.visualConditionInspection.unableToInspectReason,/lacks required physical verification|invalid|no connection or defect can be reliably assessed/i);
  const unassessedNoDefect=await inspect({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:90,observedCondition:[],possibleConcerns:[],connectionAssessments:[{location:'Charge-air connection',seatingStatus:'NOT_RELIABLY_VISIBLE',visibleEvidence:'The connection is partly hidden.'}],noVisibleConcernMessage:NO_VISIBLE_DEFECT_MESSAGE,unableToInspectReason:null,visibleEvidence:['A portion of the connection is visible.'],recommendedVerification:['Obtain a closer image from another angle.'],safetyDrivabilityImpact:null});
  assert.equal(unassessedNoDefect.semanticResult.visualConditionInspection.status,'UNABLE_TO_INSPECT');
  assert.match(unassessedNoDefect.semanticResult.visualConditionInspection.unableToInspectReason,/mating and retention relationship|fully assembled/i);
  const duplicates=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:81,observedCondition:['A visible pipe gap is present.','A visible pipe gap is present.'],possibleConcerns:[],connectionAssessments:[{location:'Charge-air pipe connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',visibleEvidence:'A visible gap is present at the pipe edge.'},{location:'Charge-air pipe connection',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',visibleEvidence:'A visible gap is present at the pipe edge.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['A visible gap is present at the pipe edge.','A visible gap is present at the pipe edge.'],recommendedVerification:['Inspect pipe seating.'],safetyDrivabilityImpact:null});
  assert.equal(duplicates.semanticResult.visualConditionInspection.connectionAssessments.length,1);
  assert.equal(duplicates.semanticResult.visualConditionInspection.observedCondition.length,1);
  const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
  assert.match(analyzer,/<h3>VISUAL CONDITION INSPECTION<\/h3>/);
  assert.match(analyzer,/condition-finding-cards/);
  assert.match(analyzer,/condition-field/);
  assert.match(analyzer,/Findings/);
  assert.match(analyzer,/Missing context/);
  assert.match(analyzer,/Recommended technician verification/);
  assert.ok(analyzer.indexOf('VISUAL CONDITION INSPECTION')>analyzer.indexOf('SPECIFIC COMPONENT IDENTIFICATION'));
});

test('starter wiring, repair context, loose connector, turbo separation, obscuration, and ambiguity remain evidence-calibrated',async()=>{
  const starterWiring={...component,status:'IDENTIFIED',primaryComponent:'Starter motor',componentConfidence:94,system:'Starting system',secondaryComponents:['positive battery cable','small electrical connector'],supportingEvidence:['A heavy-gauge positive cable and a smaller electrical connector are visible near the bellhousing.'],possibleAlternatives:[],uncertaintyReason:null};
  const starterRemoved={status:'UNVERIFIED_CONDITION',conditionConfidence:42,observedCondition:['A heavy-gauge positive cable and smaller electrical connector are visible near the bellhousing.'],possibleConcerns:[],connectionAssessments:[{location:'Bellhousing-area wiring',seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE',findingType:'UNVERIFIED_CONDITION',severity:'UNDETERMINED',findingConfidence:42,visibleEvidence:'The cable ends are visible, but no mating starter housing or terminal is visible.',matingComponentVisible:false,directDamageVisible:false,missingContext:'The starter or corresponding component may be removed or outside the image.',recommendedVerification:'Is the corresponding component currently removed or outside the image?',safetyDrivabilityImpact:null}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Heavy-gauge cable and smaller electrical connector are visible.'],recommendedVerification:['Is the corresponding component currently removed or outside the image?'],safetyDrivabilityImpact:null};
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
    assert.equal(inspection.status,'UNVERIFIED_CONDITION');
    assert.equal(inspection.connectionAssessments[0].findingType,'UNVERIFIED_CONDITION');
    assert.equal(inspection.connectionAssessments[0].severity,'UNDETERMINED');
    assert.equal(inspection.connectionAssessments[0].safetyDrivabilityImpact,null);
    assert.match(inspection.connectionAssessments[0].recommendedVerification,/Is the corresponding component currently removed or outside the image\?/);
  } finally { console.info=originalInfo; }
  const analyzer=readFileSync(new URL('../semantic-analyzer-core.mjs',import.meta.url),'utf8');
  for(const scenario of ['If a starter is installed and its housing','Do not automatically classify disconnected wiring as a defect when active repair or disassembly is plausible','loose connectors, broken parts, missing fasteners, separated intake/turbo pipes','removed, outside the frame, or obscured']) assert.match(analyzer,new RegExp(scenario.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
});

test('uncertain drivetrain identity remains one cautious label while a separate connector defect keeps its own confidence',async()=>{
  const uncertainDrivetrain={status:'UNCERTAIN',primaryComponent:'Transmission housing',componentConfidence:82,system:'Drivetrain',secondaryComponents:['gray electrical connector'],supportingEvidence:['A cast housing and gray connector are visible, but no defining transmission features are visible.'],possibleAlternatives:['Engine block'],likelyConnectionsOrDestinations:[],uncertaintyReason:'Exact assembly cannot be confirmed.',drivetrainDiscrimination:{...drivetrain,applicable:true,candidateType:'TRANSMISSION',evidence:['Cast housing is visible'],distinguishingFeaturesComplete:false}};
  const clearConnector={status:'OBSERVED_CONDITION',conditionConfidence:91,observedCondition:['A disconnected gray electrical connector is visible.'],possibleConcerns:[],connectionAssessments:[{location:'Center-right beside the large cable',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:94,visibleEvidence:'A physical separation gap and exposed metal terminals are visible at the gray connector.',matingComponentVisible:true,directDamageVisible:true,missingContext:null,recommendedVerification:'Inspect the connector body, terminals, locking tab, and mating half before reconnecting.',safetyDrivabilityImpact:'Possible impact is not established until the circuit and intended connection are verified.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['The gray connector has a visible separation gap and exposed terminals.'],recommendedVerification:['Physically inspect the connector before repair authorization.'],safetyDrivabilityImpact:null};
  const body={transactionId:'identity-and-defect-test',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  let call=0;const originalInfo=console.info;console.info=()=>{};
  try {
    const result=await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async()=>response([classifier,uncertainDrivetrain,clearConnector][call++])});
    const identified=result.semanticResult.componentIdentification, finding=result.semanticResult.visualConditionInspection.connectionAssessments[0];
    assert.equal(identified.primaryComponent,'Drivetrain housing — exact assembly not confirmed');
    assert.ok(identified.componentConfidence<=45);
    assert.equal(finding.findingType,'CLEAR_DEFECT');
    assert.equal(finding.findingConfidence,94);
    assert.ok(finding.findingConfidence>identified.componentConfidence);
    assert.doesNotMatch(identified.primaryComponent,/engine block|transmission housing/i);
  } finally { console.info=originalInfo; }
});

test('context-aware wiring findings preserve visible leads without converting them into unsupported defects',()=>{
  const starterRemoved=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:58,visibleEvidence:['A heavy-gauge positive cable terminal and a smaller exciter connector are visible.'],possibleConcerns:[],connectionAssessments:[{location:'Center-right wiring area',seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE',findingType:'UNVERIFIED_CONDITION',severity:'UNDETERMINED',findingConfidence:58,visibleEvidence:'A heavy-gauge positive cable terminal and a smaller exciter connector are visible without their mating component.',missingContext:'The starter is not visible in the photographed area and may be removed or outside the frame.',recommendedVerification:'Widen the image to include the starter mounting location and verify whether the starter is installed before classifying the loose connections as a defect.'}]});
  assert.equal(starterRemoved.normalized.status,'UNVERIFIED_CONDITION');
  assert.equal(starterRemoved.normalized.connectionAssessments.length,1);

  const starterInstalledLeadsDisconnected=normalizeVisualConditionConsistency({status:'OBSERVED_CONDITION',conditionConfidence:92,visibleEvidence:['Both installed starter terminals are visibly exposed and their leads are separated.'],possibleConcerns:[],connectionAssessments:[{location:'Lower-center starter terminals',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:94,visibleEvidence:'Both mating starter terminals are visible with exposed terminal ends and a physical separation gap.',recommendedVerification:'Inspect terminal damage and reconnect using the specified retention hardware.'}]});
  assert.equal(starterInstalledLeadsDisconnected.normalized.connectionAssessments[0].findingType,'CLEAR_DEFECT');

  const starterInstalledConnected=normalizeVisualConditionConsistency({status:'NO_VISIBLE_CONCERN_DETECTED',conditionConfidence:84,visibleEvidence:['Both visible starter leads are fully seated on their terminals and retention hardware is visible.'],possibleConcerns:[],connectionAssessments:[{location:'Lower-center starter terminals',seatingStatus:'NO_GAP_OR_SEPARATION_VISIBLE',findingType:'NO_DEFECT_VISIBLE',severity:'LOW',findingConfidence:84,matingComponentVisible:true,visibleEvidence:'Both visible leads are fully seated on the installed starter terminals and the retention hardware is visibly engaged.',recommendedVerification:'Confirm terminal tightness during normal physical inspection.'}]});
  assert.equal(starterInstalledConnected.normalized.status,'NO_VISIBLE_CONCERN_DETECTED');

  const unusedOutsideFrame=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:39,visibleEvidence:['A small unused connector is visible.'],possibleConcerns:[],connectionAssessments:[{location:'Upper-center connector',seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE',findingType:'UNVERIFIED_CONDITION',severity:'UNDETERMINED',findingConfidence:39,visibleEvidence:'A small connector is visible, but its destination is outside the image.',missingContext:'The destination is outside the photographed area.',recommendedVerification:'Widen the image and identify the connector destination.'}]});
  assert.equal(unusedOutsideFrame.normalized.status,'UNVERIFIED_CONDITION');

  const ambiguousNoDestination=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:30,visibleEvidence:['Several wires are visible.'],possibleConcerns:[],connectionAssessments:[]});
  assert.equal(ambiguousNoDestination.normalized.status,'UNABLE_TO_INSPECT');
});

test('component starter-connection context is carried into an unverified inspection when the condition response omits it',async()=>{
  const starterContext={status:'UNCERTAIN',primaryComponent:'Starter motor',componentConfidence:61,system:'Starting system',secondaryComponents:['positive battery cable','starter exciter connector'],supportingEvidence:['A heavy-gauge positive cable terminal and a smaller exciter connector are visible in the lower-center area.'],possibleAlternatives:[],likelyConnectionsOrDestinations:['The visible leads may normally connect to the starter solenoid, but the destination is not confirmed.'],uncertaintyReason:'No starter housing is visible.',drivetrainDiscrimination:drivetrain};
  const emptyCondition={status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:55,observedCondition:[],possibleConcerns:[],connectionAssessments:[],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['Visible wiring is present.'],recommendedVerification:[],safetyDrivabilityImpact:null};
  const body={transactionId:'starter-context-carry-forward',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64')};
  let call=0;const originalInfo=console.info;console.info=()=>{};
  try {
    const result=await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async()=>response([classifier,starterContext,emptyCondition][call++])});
    const inspection=result.semanticResult.visualConditionInspection;
    assert.equal(inspection.status,'UNVERIFIED_CONDITION');
    assert.equal(inspection.connectionAssessments.length,1);
    assert.match(inspection.connectionAssessments[0].visibleEvidence,/heavy-gauge positive cable terminal/i);
    assert.match(inspection.connectionAssessments[0].recommendedVerification,/Widen the image to include the starter mounting location/i);
  } finally { console.info=originalInfo; }
});

test('active RO vehicle context orients a likely starter connection without overriding the visible evidence gate',async()=>{
  const contextAwareComponent={status:'UNCERTAIN',primaryComponent:'Starter connection area — exact component not confirmed',componentConfidence:38,system:'Starting system',secondaryComponents:['heavy-gauge positive cable terminal','smaller electrical connector'],supportingEvidence:['A heavy-gauge cable terminal and smaller connector are visible near a drivetrain housing.'],possibleAlternatives:['starter motor connection'],likelyConnectionsOrDestinations:['The visible leads are consistent with starter-solenoid connections for this vehicle configuration, but the destination is not visually confirmed.'],uncertaintyReason:'The starter housing and its mating terminals are not visible in this frame.',drivetrainDiscrimination:drivetrain};
  const relationship={status:'READY',vehicleAreaLocation:'Engine/transmission junction area — likely bellhousing/transmission-side region',locationConfidence:72,locationEvidence:['Cast drivetrain housing and nearby starting-system wiring are visible in the lower-center portion of the image.'],vehicleContextSupport:['2009 Honda CR-V 2.4L context narrows the visible area to a plausible engine/drivetrain service region but does not identify the connector.'],primaryVisibleAssembly:'Engine/transmission junction area — exact assembly not confirmed',observedItems:[{observedItem:'Unconnected electrical connector and heavy-gauge cable terminal',itemLocationInImage:'Lower-center beside the large cable',nearestIdentifiableAssembly:'Engine/transmission junction area — exact assembly not confirmed',likelyRelationshipOrDestination:'Based on location and surrounding components, the leads may service a component in this area, but the mating component is not visible and the exact destination cannot be confirmed from this image.',relationshipConfidence:58,visibleEvidence:'The connector and cable terminal are visible without a shown mating component.',vehicleContextEvidence:'Honda CR-V configuration provides non-visual regional context only.',whatCannotBeConfirmed:'Whether the connection is intentionally disconnected for service, removed, or routed to an out-of-frame component.',recommendedNextPhotoVerification:'Take a wider photo approximately 12–18 inches farther back showing the connector and surrounding engine/transmission area.'}],whatPreventsConfirmation:'The mating component and complete harness route are cropped out of the image.',recommendedNextPhotoVerification:'Take a second photo from the left side of the connector showing where the harness routes and the nearby mounting points.'};
  const contextAwareCondition={status:'UNVERIFIED_CONDITION',conditionConfidence:58,observedCondition:['A heavy-gauge cable terminal and smaller electrical connector are visibly unattached in the photographed area.'],possibleConcerns:[],connectionAssessments:[{location:'Lower-center beside the large cable',seatingStatus:'COMPONENT_OR_CONNECTION_CONTEXT_NOT_VISIBLE',findingType:'UNVERIFIED_CONDITION',severity:'UNDETERMINED',findingConfidence:58,visibleEvidence:'The cable terminal and connector are visible, but their mating component and terminals are outside the visible frame.',matingComponentVisible:false,directDamageVisible:false,missingContext:'The corresponding component is not visible; active repair, removal, or out-of-frame routing cannot be distinguished from this image.',recommendedVerification:'Widen the image to include the starter mounting location and verify whether the starter is installed before classifying the loose connections as a defect.',safetyDrivabilityImpact:null}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['The visible wiring ends are not attached to a component shown in the image.'],recommendedVerification:['Widen the image to include the starter mounting location and verify whether the starter is installed before classifying the loose connections as a defect.'],safetyDrivabilityImpact:null};
  const body={transactionId:'honda-context-test',imageHash:createHash('sha256').update(bytes).digest('hex'),mimeType:'image/png',imageBase64:bytes.toString('base64'),vehicleContext:{year:'2009',make:'Honda',model:'CR-V',engine:'2.4L',configuration:'Active repair order',activeCaseId:'CASE-HONDA-2009',repairOrderId:'RO-2009-CRV',source:'ACTIVE_REPAIR_ORDER'}};
  const prompts=[];let call=0;const originalInfo=console.info;console.info=()=>{};
  try {
    const result=await analyzeSemanticImage(body,{apiKey:'test-key',fetchImpl:async(_url,options)=>{prompts.push(JSON.parse(options.body).input[0].content[0].text);return response([classifier,contextAwareComponent,relationship,contextAwareCondition][call++]);}});
    const componentResult=result.semanticResult.componentIdentification, finding=result.semanticResult.visualConditionInspection.connectionAssessments[0];
    assert.match(prompts[1],/2009 · Honda · CR-V · 2\.4L/i);
    assert.match(prompts[2],/distinct location-reasoning stage/i);
    assert.match(prompts[3],/vehicle context.*never proof/i);
    assert.equal(componentResult.status,'UNCERTAIN');
    assert.match(componentResult.primaryComponent,/cannot be confirmed/i);
    assert.equal(finding.findingType,'UNVERIFIED_CONDITION');
    assert.notEqual(finding.findingType,'CLEAR_DEFECT');
    assert.equal(finding.safetyDrivabilityImpact,null);
    assert.equal(result.semanticResult.vehicleContextApplied.available,true);
    assert.match(result.semanticResult.vehicleContextApplied.summary,/Honda · CR-V/i);
    assert.doesNotMatch(JSON.stringify(result.semanticResult),/EcoSport|Ford/i);
    assert.deepEqual(result.semanticResult.vehicleContextBinding,{year:'2009',make:'Honda',model:'CR-V',engine:'2.4L',vin:'',activeCaseId:'CASE-HONDA-2009',repairOrderId:'RO-2009-CRV',vehicleId:'',contextVersion:'',source:'ACTIVE_REPAIR_ORDER'});
    assert.equal(result.semanticResult.vehicleAreaRelationshipAnalysis.status,'READY');
    assert.match(result.semanticResult.vehicleAreaRelationshipAnalysis.vehicleAreaLocation,/engine\/transmission junction/i);
    assert.equal(result.semanticResult.vehicleAreaRelationshipAnalysis.observedItems[0].relationshipConfidence,58);
    assert.match(result.semanticResult.vehicleAreaRelationshipAnalysis.recommendedNextPhotoVerification,/12–18 inches|left side/i);
  } finally { console.info=originalInfo; }
});

test('vehicle context integrity requires a complete active vehicle identity and retains its case binding',()=>{
  assert.equal(normalizeVehicleAnalysisContext({year:'2009',make:'Honda'}),null);
  assert.deepEqual(normalizeVehicleAnalysisContext({year:'2009',make:'Honda',model:'CR-V',activeCaseId:'CASE-1',repairOrderId:'RO-1',source:'ACTIVE_REPAIR_ORDER'}),{year:'2009',make:'Honda',model:'CR-V',engine:'',fuelType:'',drivetrain:'',configuration:'',vin:'',activeCaseId:'CASE-1',repairOrderId:'RO-1',vehicleId:'',contextVersion:'',source:'ACTIVE_REPAIR_ORDER'});
  const analyzer=readFileSync(new URL('../image-analysis-ad.js',import.meta.url),'utf8');
  assert.match(analyzer,/Validating active vehicle context…/);
  assert.match(analyzer,/Vehicle context mismatch…/);
  assert.match(analyzer,/stale vehicle-aware result was blocked/i);
  assert.match(analyzer,/Possible item relationship observed; exact connection and destination cannot be confirmed/i);
});

test('Honda disconnected-terminal regression retains the visible separation ahead of normal component descriptions',async()=>{
  const result=await inspect({status:'OBSERVED_CONDITION',conditionConfidence:96,observedCondition:['Positive battery terminal appears physically disconnected from the battery post.'],possibleConcerns:[],connectionAssessments:[{location:'Upper-left battery area',seatingStatus:'SEPARATION_OR_GAP_VISIBLE',findingType:'CLEAR_DEFECT',severity:'HIGH',findingConfidence:96,visibleEvidence:'The positive terminal clamp is visibly displaced from the battery post with a clear air gap between the mating surfaces.',matingComponentVisible:true,directDamageVisible:false,missingContext:null,recommendedVerification:'Inspect the post and clamp for damage or corrosion, then reconnect and verify clamp retention before further no-crank diagnosis.',safetyDrivabilityImpact:'A disconnected positive battery terminal can directly prevent cranking or starting.'}],noVisibleConcernMessage:'',unableToInspectReason:null,visibleEvidence:['The positive terminal clamp is visibly displaced from the battery post.'],recommendedVerification:['Verify the battery connection before deeper diagnosis.'],safetyDrivabilityImpact:'A disconnected positive battery terminal can directly prevent cranking or starting.'});
  const inspection=result.semanticResult.visualConditionInspection;
  assert.equal(inspection.status,'OBSERVED_CONDITION');
  assert.match(inspection.observedCondition[0],/positive battery terminal appears physically disconnected/i);
  assert.equal(inspection.connectionAssessments[0].seatingStatus,'SEPARATION_OR_GAP_VISIBLE');
  assert.equal(inspection.connectionAssessments[0].findingType,'CLEAR_DEFECT');
  assert.doesNotMatch(JSON.stringify(inspection),/terminals appear secure/i);
});

test('10.13.100 visual sweep requires affirmative mating evidence and keeps obscured areas uncertain',()=>{
  const analyzer=readFileSync(new URL('../semantic-analyzer-core.mjs',import.meta.url),'utf8');
  for(const rule of ['OBVIOUS VISUAL DEFECT SWEEP','SEE → LOCATE → IDENTIFY → VERIFY PHYSICAL STATE → DETECT ABNORMALITY → APPLY VEHICLE CONTEXT → REASON → DIAGNOSE','not evidence that it is connected, secure, intact, or installed','Unable to verify from this image']) assert.match(analyzer,new RegExp(rule.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  const obscured=normalizeVisualConditionConsistency({status:'POSSIBLE_CONCERN_DETECTED',conditionConfidence:33,visibleEvidence:['A terminal is partly obscured.'],possibleConcerns:[],connectionAssessments:[{location:'Battery area',seatingStatus:'NOT_RELIABLY_VISIBLE',findingType:'SEATING_NOT_RELIABLY_VISIBLE',severity:'UNDETERMINED',findingConfidence:33,visibleEvidence:'The terminal-to-post mating area is obscured.',recommendedVerification:'Obtain a closer image showing the terminal and battery post.'}]});
  assert.equal(obscured.normalized.status,'UNABLE_TO_INSPECT');
});
