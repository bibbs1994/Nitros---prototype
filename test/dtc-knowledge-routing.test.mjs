import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const source=readFileSync(new URL('../dtc-knowledge.js',import.meta.url),'utf8');
const knowledge=Function('globalThis','window',`${source};return globalThis.NitrosDtcKnowledge`)({},undefined);
const authority=html.indexOf("const STATE_KEY='nitros_diagnostic_case_v10120'");
const extractRaw=(startToken,endToken)=>{const start=html.indexOf(startToken,authority),end=html.indexOf(endToken,start);assert.ok(start>=0&&end>start);return html.slice(start,end).trim()};
const helpers=Function(`${html.slice(html.indexOf('const DTC_PATTERN=',authority),html.indexOf('function add(',authority))};return{parseVehicle,codes}`)();
const routingHarness=initial=>Function('initial','knowledge',`let state=JSON.parse(JSON.stringify(initial)),guidance={evidence:[],measurements:[],completedTests:[],hypotheses:[]},replies=[];const window={NitrosDtcKnowledge:knowledge};const blankGuidance=()=>({evidence:[],measurements:[],completedTests:[],hypotheses:[],selectedNextTest:null,nextTestReason:'',nextRequiredEvidence:''});function guidanceState(){return guidance=Object.assign(blankGuidance(),state.conversationalGuidance||guidance)}function diagnosticTestCompatible(test,system=state.affectedSystem||state.system,category=state.dtcDiagnosticCategory){const identity=\`${'${test?.testId||\'\'} ${test?.displayName||\'\'}'}\`.toLowerCase(),context=\`${'${system||\'\'} ${category||\'\'}'}\`.toLowerCase();return !(/blower|hvac/.test(identity)&&!/blower|hvac/.test(context))}function selectGuidanceTest(id,name,reason,evidence,method,routeContext={}){state.authoritativeDiagnosticTest={testId:id,displayName:name,status:'AWAITING_RESULT',affectedSystem:routeContext.affectedSystem||state.affectedSystem||state.system||'',diagnosticCategory:routeContext.diagnosticCategory||state.dtcDiagnosticCategory||'',activeDtc:state.activeDtc};guidance.selectedNextTest=state.authoritativeDiagnosticTest;guidance.nextTestReason=reason;guidance.nextRequiredEvidence=evidence;return state.authoritativeDiagnosticTest}function ask(text){replies.push(text)}${extractRaw('function clearIncompatibleResolvedDtcRoute','function nextRequiredIntakeStep')}return{apply:applyDtcKnowledgeResolution,manual:handleManualDtcSystemIdentification,state,get guidance(){return guidance},replies,workflowName}`)(initial,knowledge);

test('10.12.86 structured registry resolves representative generic DTCs through one resolver',()=>{
  const expected=['P0300','P0301','P0340','P0410','P0420','P0455','P0456','P0171','P0172','P0101','P0128','P0442','P0500','P0606','U0100'];
  assert.deepEqual(expected.filter(code=>knowledge.resolve(code).resolutionStatus!=='RESOLVED'),[]);
  assert.ok(Object.isFrozen(knowledge.records));
  const p0410=knowledge.resolve('p 0 4 1 0',{year:'2000',make:'Chevrolet',model:'S10'});
  assert.equal(p0410.definition,'Secondary Air Injection System Malfunction');
  assert.equal(p0410.system,'Secondary Air Injection');
  assert.equal(p0410.genericOrManufacturerSpecific,'Generic / SAE');
  assert.equal(p0410.sourceType,'INTERNAL_GENERIC_DTC_REGISTRY');
  assert.equal(knowledge.source.isOemServiceInformation,false);
});

test('10.12.86 distinguishes manufacturer-specific and unavailable generic definitions without fabrication',()=>{
  const manufacturer=knowledge.resolve('P1234',{make:'Chevrolet'}),unknown=knowledge.resolve('P2999');
  assert.equal(manufacturer.resolutionStatus,'REQUIRES_MANUFACTURER_SPECIFIC_INFORMATION');
  assert.equal(manufacturer.definition,'Requires manufacturer-specific information');
  assert.equal(unknown.resolutionStatus,'DEFINITION_UNAVAILABLE');
  assert.equal(unknown.definition,'DTC definition unavailable in current knowledge source');
  assert.equal(unknown.system,'');
});

test('10.12.87 resolves all primary DTC families while retaining safe unresolved chassis state',()=>{
  const chassis=knowledge.resolve('C0035',{year:'2012',make:'Chevrolet',model:'Silverado'});
  assert.equal(chassis.dtcFamily,'Chassis');
  assert.equal(chassis.resolutionStatus,'RESOLVED_MANUFACTURER_SPECIFIC');
  assert.match(chassis.definition,/left front wheel speed sensor circuit/i);
  assert.equal(chassis.system,'ABS / Electronic Brake Control');
  assert.equal(chassis.subsystem,'Left Front Wheel Speed Sensor / Circuit');
  assert.equal(chassis.workflow,'Code-Specific Diagnostic');
  assert.equal(chassis.sourceType,'INTERNAL_MANUFACTURER_DTC_REGISTRY');
  assert.equal(knowledge.resolve('P0410').dtcFamily,'Powertrain');
  assert.equal(knowledge.resolve('B1234').dtcFamily,'Body');
  assert.equal(knowledge.resolve('U9999').dtcFamily,'Network / Communication');
  const unknown=knowledge.resolve('C9999',{year:'2012',make:'Chevrolet',model:'Silverado'});
  assert.equal(unknown.dtcFamily,'Chassis');
  assert.equal(unknown.resolutionStatus,'DEFINITION_UNAVAILABLE');
  assert.equal(unknown.system,'');
});

test('10.12.86 accepts S10 in a complete utterance and as a model-only follow-up',()=>{
  assert.deepEqual(helpers.parseVehicle('2000 Chevrolet S10 with a P0410.'),{year:'2000',make:'Chevrolet',model:'S10',engine:''});
  const current={year:'2000',make:'Chevrolet',model:'',engine:''},followup=helpers.parseVehicle('S10');
  assert.deepEqual({...current,...Object.fromEntries(Object.entries(followup).filter(([,value])=>value))},{year:'2000',make:'Chevrolet',model:'S10',engine:''});
});

test('10.12.86 promotes P0410 into authoritative system and architecture routing',()=>{
  const h=routingHarness({vehicle:{year:'2000',make:'Chevrolet',model:'S10',engine:'',configuration:''},activeDtc:'P0410',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(h.state.dtcDefinition,'Secondary Air Injection System Malfunction');
  assert.equal(h.state.affectedSystem,'Secondary Air Injection');
  assert.equal(h.state.system,'Secondary Air Injection');
  assert.equal(h.state.diagnosticDomain,'Engine Performance / Emissions');
  assert.equal(h.state.dtcClassification,'Generic / SAE');
  assert.equal(h.state.dtcResolutionStatus,'RESOLVED');
  assert.equal(h.workflowName(),'Code-Specific Diagnostic');
  assert.equal(h.state.stage,'circuit/system-architecture-identification');
  assert.equal(h.state.intakeStep,'complete');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'dtc-system-architecture-identification');
  assert.match(h.guidance.nextRequiredEvidence,/air pump.*fuse.*relay.*ground.*switching valve.*ECM\/PCM command/i);
  assert.equal(h.state.componentCondemned,'None');
  assert.equal(h.state.diagnosticConclusionState,'UNCONFIRMED');
});

test('10.12.87 promotes C0035 into chassis/ABS authoritative routing',()=>{
  const h=routingHarness({vehicle:{year:'2012',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'C0035',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED_MANUFACTURER_SPECIFIC');
  assert.equal(h.state.dtcFamily,'Chassis');
  assert.equal(h.state.dtcDefinition,'Left Front Wheel Speed Sensor Circuit');
  assert.equal(h.state.affectedSystem,'ABS / Electronic Brake Control');
  assert.equal(h.state.system,'ABS / Electronic Brake Control');
  assert.equal(h.state.diagnosticDomain,'Chassis / ABS / Electronic Brake Control');
  assert.equal(h.workflowName(),'Code-Specific Diagnostic');
});

test('10.12.87 resolves GM B1325 by base code without inventing a failure type',()=>{
  const base=knowledge.resolve('B1325',{year:'2014',make:'Chevrolet',model:'Silverado'}),suffix=knowledge.resolve('B1325-03',{year:'2014',make:'Chevrolet',model:'Silverado'});
  assert.equal(base.code,'B1325');
  assert.equal(base.baseCode,'B1325');
  assert.equal(base.failureTypeSuffix,'');
  assert.equal(base.dtcFamily,'Body');
  assert.equal(base.definition,'Device Power 1 Circuit');
  assert.equal(base.system,'Control Module / Device Power Supply');
  assert.equal(base.genericOrManufacturerSpecific,'Manufacturer-Specific');
  assert.equal(base.resolutionStatus,'RESOLVED_MANUFACTURER_SPECIFIC');
  assert.equal(suffix.code,'B132503');
  assert.equal(suffix.failureTypeSuffix,'03');
  assert.equal(suffix.definition,'Device Power 1 Circuit');
});

test('10.12.92 resolves Chevrolet P06DD through manufacturer-enhanced registry data',()=>{
  const resolved=knowledge.resolve('P06DD',{year:'2016',make:'Chevrolet',model:'Silverado'});
  assert.equal(resolved.code,'P06DD');
  assert.equal(resolved.dtcFamily,'Powertrain');
  assert.equal(resolved.definition,'Engine Oil Pressure Control Circuit Performance / Stuck Off');
  assert.equal(resolved.system,'Engine Lubrication / Oil Pressure Control');
  assert.equal(resolved.category,'Engine Oil Pressure Control');
  assert.equal(resolved.genericOrManufacturerSpecific,'Manufacturer-Enhanced');
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(resolved.workflow,'Engine Oil Pressure Control Diagnostic');
  assert.equal(resolved.configurationRequiredForProcedure,true);
});

test('10.12.92 binds and routes P06DD to status/configuration without selecting a measurement or condemning a component',()=>{
  const h=routingHarness({vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'P06DD',system:'',diagnosticDomain:'',stage:'vehicle',intakeStep:'vehicle',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(h.state.dtcDefinition,'Engine Oil Pressure Control Circuit Performance / Stuck Off');
  assert.equal(h.state.affectedSystem,'Engine Lubrication / Oil Pressure Control');
  assert.equal(h.state.dtcDiagnosticCategory,'Engine Oil Pressure Control');
  assert.equal(h.state.dtcClassification,'Manufacturer-Enhanced');
  assert.equal(h.workflowName(),'Engine Oil Pressure Control Diagnostic');
  assert.equal(h.state.stage,'vehicle');
  assert.equal(h.state.activeDtc,'P06DD');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'dtc-status-configuration-establishment');
  assert.equal(h.state.authoritativeDiagnosticTest.affectedSystem,'Engine Lubrication / Oil Pressure Control');
  assert.equal(h.state.authoritativeDiagnosticTest.diagnosticCategory,'Engine Oil Pressure Control');
  assert.equal(h.state.componentCondemned,'None');
});

test('10.12.92 rejects a stale blower route before committing the P06DD next test',()=>{
  const h=routingHarness({id:'CASE-P06DD',vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'P06DD',dtcs:['P06DD'],system:'HVAC',component:'Blower Motor / Blower Speed Control',diagnosticDomain:'HVAC / Blower Diagnostic',complaint:'blower only works on high',symptoms:'blower only works on high',normalizedSymptom:'HVAC blower high only',dtcResolutionStatus:'',dtcDiagnosticCategory:'HVAC Blower',stage:'diagnostic',intakeStep:'complete',authoritativeDiagnosticTest:{testId:'blower-command-response-correlation',displayName:'Blower Speed Function Confirmation',affectedSystem:'HVAC',diagnosticCategory:'HVAC Blower'},componentTestState:{workflowId:'hvac-blower-speed-control'},conversationalGuidance:{evidence:[{testId:'blower-symptom-confirmation'}],hypotheses:[{name:'blower resistor'}],selectedNextTest:{testId:'blower-command-response-correlation',displayName:'Blower Speed Function Confirmation'}},routingDiagnostics:{},componentCondemned:'None'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(h.state.activeDtc,'P06DD');
  assert.equal(h.state.system,'Engine Lubrication / Oil Pressure Control');
  assert.equal(h.state.component,'');
  assert.equal(h.state.complaint,'');
  assert.equal(h.state.componentTestState,null);
  assert.deepEqual(h.guidance.hypotheses,[]);
  assert.deepEqual(h.guidance.evidence,[]);
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'dtc-status-configuration-establishment');
  assert.doesNotMatch(JSON.stringify({test:h.state.authoritativeDiagnosticTest,system:h.state.system,component:h.state.component,complaint:h.state.complaint,guidance:h.guidance}),/blower|hvac/i);
});

test('10.12.92 binds resolved DTC state before route cleanup and next-test selection',()=>{
  const source=extractRaw('function applyDtcKnowledgeResolution','function handleManualDtcSystemIdentification');
  const bind=source.indexOf('state.activeDtc=resolved.code'),definition=source.indexOf('state.dtcDefinition=resolved.definition'),clear=source.indexOf("clearIncompatibleResolvedDtcRoute(resolved)"),select=source.indexOf('selectGuidanceTest(resolved.initialTest.id');
  assert.ok(bind>=0&&definition>bind&&clear>definition&&select>clear);
  assert.match(html,/incomingDtcCodes=codes\(text\)[\s\S]+if\(!incomingDtcCodes\.length\)\{[\s\S]+found=incomingDtcCodes/);
});

test('10.12.87 routes resolved GM B1325 without generic system fallback',()=>{
  const h=routingHarness({vehicle:{year:'2014',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'B1325',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED_MANUFACTURER_SPECIFIC');
  assert.equal(h.state.dtcDefinition,'Device Power 1 Circuit');
  assert.equal(h.state.affectedSystem,'Control Module / Device Power Supply');
  assert.equal(h.state.system,'Control Module / Device Power Supply');
  assert.equal(h.state.dtcClassification,'Manufacturer-Specific');
  assert.equal(h.state.dtcResolutionStatus,'RESOLVED_MANUFACTURER_SPECIFIC');
  assert.equal(h.workflowName(),'Code-Specific Diagnostic');
});

test('10.12.86 enriches established specialized workflows without bypassing their proven intake',()=>{
  for(const [code,workflow] of [['P0340','Camshaft Position Circuit'],['P0420','Catalyst Efficiency'],['P0308','Misfire Diagnosis']]){
    const h=routingHarness({vehicle:{year:'2014',make:'Toyota',model:'Camry',configuration:''},activeDtc:code,system:'',diagnosticDomain:'',stage:'vehicle',intakeStep:'vehicle',routingDiagnostics:{},componentCondemned:'None'}),resolved=h.apply();
    assert.equal(resolved.resolutionStatus,'RESOLVED');assert.ok(h.state.dtcDefinition);assert.ok(h.state.affectedSystem);assert.equal(h.workflowName(),workflow);assert.equal(h.state.stage,'vehicle');assert.equal(h.state.intakeStep,'vehicle');assert.equal(h.state.authoritativeDiagnosticTest,null);
  }
});

test('10.12.86 promotes a requested manual system answer while keeping definition provenance unresolved',()=>{
  const h=routingHarness({vehicle:{year:'2000',make:'Chevrolet',model:'S10',configuration:''},activeDtc:'P1234',system:'',diagnosticDomain:'',dtcResolutionStatus:'REQUIRES_MANUFACTURER_SPECIFIC_INFORMATION',stage:'system-identification',intakeStep:'system-identification',routingDiagnostics:{},componentCondemned:'None'});
  assert.equal(h.manual('Secondary air injection system.'),true);
  assert.equal(h.state.system,'Secondary Air Injection');
  assert.equal(h.state.affectedSystem,'Secondary Air Injection');
  assert.equal(h.state.dtcResolutionStatus,'SYSTEM_IDENTIFIED_BY_TECHNICIAN_DEFINITION_UNRESOLVED');
  assert.equal(h.state.stage,'circuit/system-architecture-identification');
  assert.match(h.replies.at(-1),/technician-confirmed affected system.*specific code definition remains unresolved.*no component is condemned/i);
});

test('10.12.86 production intake resolves after DTC commit and exposes developer fields',()=>{
  const processSource=html.slice(html.indexOf('function process(',authority),html.indexOf('function renderTranscript(',authority));
  assert.match(html,/src="\.\/dtc-knowledge\.js"/);
  assert.match(processSource,/const dtcResolution=state\.activeDtc&&typeof applyDtcKnowledgeResolution==='function'\?applyDtcKnowledgeResolution\(\):null/);
  assert.match(processSource,/We’ll start by identifying the \$\{state\.affectedSystem\.toLowerCase\(\)\} system architecture/);
  assert.doesNotMatch(processSource,/what does .*P0410|tell me what .*P0410 means/i);
  for(const label of ['DTC Family','DTC Definition','Affected System','DTC Classification','DTC Knowledge Source','DTC Resolution Status'])assert.match(html,new RegExp(`${label}:`));
});
