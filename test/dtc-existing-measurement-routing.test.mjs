import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const knowledgeSource=readFileSync(new URL('../dtc-knowledge.js',import.meta.url),'utf8');
const knowledge=Function('globalThis','window',`${knowledgeSource};return globalThis.NitrosDtcKnowledge`)({},undefined);
const start=html.indexOf('function diagnosticGuidanceRequest'),end=html.indexOf('function semanticIntakeRouting',start);
assert.ok(start>=0&&end>start,'oil-pressure evidence routing helpers were not found');
const source=html.slice(start,end);

function harness(){
  return Function('knowledge',String.raw`${source};
    let state={id:'CASE-P06DD',vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'P06DD',dtcs:['P06DD'],dtcDefinition:'Engine Oil Pressure Control Circuit Performance / Stuck Off',affectedSystem:'Engine Lubrication / Oil Pressure Control',system:'Engine Lubrication / Oil Pressure Control',dtcClassification:'Manufacturer-Enhanced',dtcDiagnosticCategory:'Engine Oil Pressure Control',dtcResolutionStatus:'RESOLVED',dtcWorkflow:'Engine Oil Pressure Control Diagnostic',previousRepairs:'',previousTests:'',existingDiagnosticEvidence:[],conversationalGuidance:{evidence:[],measurements:[]},authoritativeDiagnosticTest:{testId:'dtc-status-configuration-establishment'},routingDiagnostics:{},stage:'status',intakeStep:'status'};
    const window={NitrosDtcKnowledge:knowledge};
    const replies=[];
    function diagnosticMeasurement(text){const match=String(text).match(/(\d+(?:\.\d+)?)\s*(psi)\b/i);return match?{value:Number(match[1]),unit:match[2].toLowerCase()}:null}
    function guidanceState(){return state.conversationalGuidance}
    function selectGuidanceTest(id,name,reason,requiredEvidence,method,routeContext){state.authoritativeDiagnosticTest={testId:id,displayName:name,reason,requiredEvidence,method,affectedSystem:routeContext.affectedSystem,diagnosticCategory:routeContext.diagnosticCategory,activeDtc:state.activeDtc};state.conversationalGuidance.selectedNextTest=state.authoritativeDiagnosticTest;return state.authoritativeDiagnosticTest}
    function ask(text){replies.push(text)}
    function diagnosticTestCompatible(){return true}
    return {state,replies,handle:handleExistingOilPressureEvidence,guidance:handleDiagnosticGuidanceRequest};
  `)(knowledge);
}

test('10.12.96 consumes an existing P06DD oil-pressure measurement and requests only missing context',()=>{
  const h=harness();
  assert.equal(h.handle('Oil filter has already been changed'),true);
  assert.match(h.state.previousRepairs,/oil filter/i);
  assert.equal(h.handle('Oil pressure test has been done, showed 18 psi'),true);
  assert.equal(h.state.activeDtc,'P06DD');
  assert.equal(h.state.dtcResolutionStatus,'RESOLVED');
  assert.equal(h.state.dtcWorkflow,'Engine Oil Pressure Control Diagnostic');
  assert.match(h.state.previousTests,/18 psi/i);
  assert.equal(h.state.existingDiagnosticEvidence.length,1);
  const evidence=h.state.existingDiagnosticEvidence[0];
  assert.deepEqual([evidence.testType,evidence.measurementType,evidence.measurementValue,evidence.measurementUnit,evidence.system,evidence.evidenceType,evidence.evidenceStatus],['Mechanical oil pressure test','MECHANICAL_OIL_PRESSURE_TEST',18,'psi','Engine Lubrication / Oil Pressure Control','VERIFIED_MEASUREMENT','AVAILABLE']);
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.evidenceAppliedToStep,'MECHANICAL_OIL_PRESSURE_MEASUREMENT');
  assert.deepEqual(h.state.missingInterpretationContext,['ENGINE_TEMPERATURE_AND_OPERATING_CONDITION']);
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'oil-pressure-measurement-context');
  assert.equal(h.state.authoritativeDiagnosticTest.affectedSystem,'Engine Lubrication / Oil Pressure Control');
  assert.equal(h.state.authoritativeDiagnosticTest.diagnosticCategory,'Engine Oil Pressure Control');
  assert.doesNotMatch(h.state.authoritativeDiagnosticTest.testId,/dtc-status|vehicle-configuration/);
  assert.match(h.replies.at(-1),/mechanical oil-pressure test at 18 psi.*hot idle, cold idle, or at a specified RPM/i);
  assert.doesNotMatch(h.replies.at(-1),/perform|repeat.*oil-pressure test|continue with the next verified measurement/i);
});

test('10.12.96 applies later measurement context without discarding the stored reading',()=>{
  const h=harness();
  h.handle('Oil pressure test has been done, showed 18 psi');
  assert.equal(h.handle('That was measured at hot idle with a mechanical gauge'),true);
  assert.equal(h.state.existingDiagnosticEvidence[0].measurementValue,18);
  assert.deepEqual(h.state.existingDiagnosticEvidence[0].measurementContext,{temperature:'HOT / OPERATING_TEMPERATURE',operatingCondition:'IDLE',rpm:null,method:'MECHANICAL_GAUGE',location:'UNKNOWN'});
  assert.deepEqual(h.state.missingInterpretationContext,['ENGINE_CONFIGURATION']);
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'engine-configuration-for-oil-pressure-interpretation');
  assert.match(h.replies.at(-1),/Which engine.*4\.3L, 5\.3L, or 6\.2L/i);
});

test('10.12.96 checks existing P06DD evidence before generic status intake',()=>{
  const process=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  assert.ok(process.indexOf("handleExistingOilPressureEvidence(text)")<process.indexOf("if(state.intakeStep==='status')"));
  for(const label of ['Existing Diagnostic Evidence','Measurement Type','Measurement Value','Measurement Unit','Measurement Context','Evidence Consumed','Evidence Applied To Step','Missing Interpretation Context'])assert.match(html,new RegExp(`${label}:`));
});

test('10.12.96 classifies next-test intent and advances forward without storing the question',()=>{
  const h=harness();
  h.state.vehicle.engine='5.3L';
  h.state.complaint='MIL on and low oil pressure';
  h.state.previousRepairs='Oil filter screen';
  h.handle('Oil pressure test has been done, showed 18 psi');
  h.handle('Measured at hot idle with a mechanical gauge');
  const evidence=h.state.existingDiagnosticEvidence[0];
  h.state.vehicle.engine='5.3L';
  const before={previousTests:h.state.previousTests,previousRepairs:h.state.previousRepairs,complaint:h.state.complaint,evidence:JSON.stringify(h.state.existingDiagnosticEvidence),guidanceEvidence:JSON.stringify(h.state.conversationalGuidance.evidence),measurements:JSON.stringify(h.state.conversationalGuidance.measurements)};
  const question='What would be the least intrusive test other than the mechanical oil pressure test at hot idle? What should be my next test?';
  assert.equal(h.guidance(question),true);
  assert.equal(h.state.guidanceRequest,'YES');
  assert.equal(h.state.guidanceIntent,'NEXT_TEST');
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.repeatMechanicalPressureTest,'NO');
  assert.equal(h.state.routeDirection,'FORWARD');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'oil-pressure-control-command-feedback-review');
  assert.equal(h.state.authoritativeDiagnosticTest.affectedSystem,'Engine Lubrication / Oil Pressure Control');
  assert.equal(h.state.authoritativeDiagnosticTest.diagnosticCategory,'Engine Oil Pressure Control');
  assert.equal(h.state.diagnosticConclusionState,'UNCONFIRMED');
  assert.deepEqual({previousTests:h.state.previousTests,previousRepairs:h.state.previousRepairs,complaint:h.state.complaint,evidence:JSON.stringify(h.state.existingDiagnosticEvidence),guidanceEvidence:JSON.stringify(h.state.conversationalGuidance.evidence),measurements:JSON.stringify(h.state.conversationalGuidance.measurements)},before);
  assert.equal(evidence.measurementValue,18);
  assert.equal(evidence.measurementContext.temperature,'HOT / OPERATING_TEMPERATURE');
  assert.equal(evidence.measurementContext.operatingCondition,'IDLE');
  assert.doesNotMatch(JSON.stringify(h.state.conversationalGuidance),new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(h.replies.at(-1),/do not repeat.*least intrusive next step.*oil-pressure control command\/feedback review/i);
  assert.doesNotMatch(h.replies.at(-1),/vehicle intake|identify P06DD|mechanical oil-pressure test again/i);
});

test('10.12.96 guidance gate precedes evidence and status handlers',()=>{
  const process=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  const guidance=process.indexOf('handleDiagnosticGuidanceRequest(text)'),evidence=process.indexOf('handleExistingOilPressureEvidence(text)'),status=process.indexOf("if(state.intakeStep==='status')");
  assert.ok(guidance>=0&&guidance<evidence&&guidance<status);
  for(const label of ['Guidance Request','Guidance Intent','Repeat Mechanical Pressure Test','Route Direction'])assert.match(html,new RegExp(`${label}:`));
});

test('10.12.96 binds warm-idle phrases to the pending 18 psi measurement instead of creating findings',()=>{
  const variants=['Hot idle','At hot idle','Engine hot at idle','Fully warmed up at idle','Operating temperature at idle'];
  for(const phrase of variants){
    const h=harness();
    h.state.vehicle.engine='5.3L';
    h.state.vehicle.configuration='Engine 5.3L';
    h.state.complaint='MIL on and low oil pressure';
    h.state.previousRepairs='Oil filter screen';
    h.state.guidanceRequest='YES';
    h.state.guidanceIntent='NEXT_TEST';
    h.state.repeatMechanicalPressureTest='NO';
    h.state.routeDirection='FORWARD';
    h.handle('Oil pressure test has been done, showed 18 psi');
    const before={previousTests:h.state.previousTests,previousRepairs:h.state.previousRepairs,complaint:h.state.complaint,evidenceCount:h.state.conversationalGuidance.evidence.length,measurementCount:h.state.conversationalGuidance.measurements.length};
    assert.equal(h.handle(phrase),true,phrase);
    const evidence=h.state.existingDiagnosticEvidence[0];
    assert.equal(evidence.measurementType,'MECHANICAL_OIL_PRESSURE_TEST',phrase);
    assert.equal(evidence.measurementValue,18,phrase);
    assert.equal(evidence.measurementUnit,'psi',phrase);
    assert.equal(evidence.measurementContext.temperature,'HOT / OPERATING_TEMPERATURE',phrase);
    assert.equal(evidence.measurementContext.operatingCondition,'IDLE',phrase);
    assert.deepEqual(h.state.missingInterpretationContext,[],phrase);
    assert.equal(h.state.evidenceConsumed,'YES',phrase);
    assert.equal(h.state.guidanceRequest,'YES',phrase);
    assert.equal(h.state.guidanceIntent,'NEXT_TEST',phrase);
    assert.equal(h.state.repeatMechanicalPressureTest,'NO',phrase);
    assert.equal(h.state.routeDirection,'FORWARD',phrase);
    assert.equal(h.state.vehicle.engine,'5.3L',phrase);
    assert.equal(h.state.vehicle.configuration,'Engine 5.3L',phrase);
    assert.equal(h.state.specificationResolutionStatus,'RESOLVED_VERIFIED_APPLICABLE_SPECIFICATION',phrase);
    assert.equal(h.state.resolvedDiagnosticSpecification.id,'GM-PIP5407-P06DD-2016',phrase);
    assert.equal(h.state.measurementInterpretation.classification,'INSUFFICIENT_EVIDENCE',phrase);
    assert.equal(h.state.measurementInterpretation.measurementValue,18,phrase);
    assert.equal(h.state.measurementInterpretation.context.temperature,'HOT / OPERATING_TEMPERATURE',phrase);
    assert.equal(h.state.authoritativeDiagnosticTest.testId,'p06dd-oil-pump-control-valve-command-response',phrase);
    assert.deepEqual({previousTests:h.state.previousTests,previousRepairs:h.state.previousRepairs,complaint:h.state.complaint,evidenceCount:h.state.conversationalGuidance.evidence.length,measurementCount:h.state.conversationalGuidance.measurements.length},before,phrase);
    assert.doesNotMatch(JSON.stringify(h.state.conversationalGuidance),new RegExp(phrase,'i'),phrase);
    assert.match(h.replies.at(-1),/bound.*existing 18 psi.*specification resolution matched.*control-valve command\/pressure response.*command the oil pump control valve/i,phrase);
    assert.doesNotMatch(h.replies.at(-1),/continue with the next verified measurement|please repeat|perform another mechanical|run another mechanical/i,phrase);
  }
});

test('10.12.96 resolves the verified 2016 Silverado 5.3L P06DD criterion from structured knowledge',()=>{
  const resolved=knowledge.resolveSpecification({code:'P06DD',vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'5.3L'},measurementContext:{temperature:'HOT / OPERATING_TEMPERATURE',operatingCondition:'IDLE'}});
  assert.equal(resolved.resolutionStatus,'RESOLVED_VERIFIED_APPLICABLE_SPECIFICATION');
  assert.equal(resolved.id,'GM-PIP5407-P06DD-2016');
  assert.equal(resolved.numericPressureThreshold,null);
  assert.equal(resolved.staticPressureInterpretation,'INSUFFICIENT_EVIDENCE');
  assert.equal(resolved.nextTest.id,'p06dd-oil-pump-control-valve-command-response');
  assert.match(resolved.nextTest.instruction,/command the oil pump control valve on and off.*pressure response/i);
  assert.match(resolved.sourceReference,/PIP5407/i);
});

test('10.12.96 engine follow-up immediately resolves, interprets, and advances the stored hot-idle result',()=>{
  const h=harness();
  h.state.complaint='MIL on and low oil pressure';
  h.state.previousRepairs='Oil filter and filter screen checked';
  assert.equal(h.handle('Mechanical oil pressure test already taken, 18 psi at hot idle'),true);
  const evidenceBefore=JSON.stringify(h.state.existingDiagnosticEvidence[0]);
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'engine-configuration-for-oil-pressure-interpretation');
  assert.equal(h.handle('5.3L'),true);
  assert.equal(h.state.vehicle.engine,'5.3L');
  assert.equal(h.state.vehicle.configuration,'5.3L');
  assert.equal(h.state.activeDtc,'P06DD');
  assert.equal(h.state.existingDiagnosticEvidence[0].measurementValue,18);
  assert.equal(h.state.existingDiagnosticEvidence[0].measurementContext.temperature,'HOT / OPERATING_TEMPERATURE');
  assert.equal(h.state.existingDiagnosticEvidence[0].measurementContext.operatingCondition,'IDLE');
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.repeatMechanicalPressureTest,'NO');
  assert.equal(h.state.specificationResolutionStatus,'RESOLVED_VERIFIED_APPLICABLE_SPECIFICATION');
  assert.equal(h.state.measurementInterpretation.classification,'INSUFFICIENT_EVIDENCE');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p06dd-oil-pump-control-valve-command-response');
  assert.equal(JSON.parse(evidenceBefore).measurementContext.temperature,h.state.existingDiagnosticEvidence[0].measurementContext.temperature);
  assert.match(h.replies.at(-1),/specification resolution matched.*PIP5407.*command the oil pump control valve on and off/i);
  assert.doesNotMatch(h.replies.at(-1),/load the specification|provide the oil-pressure specification|please repeat|perform another mechanical|run another mechanical/i);
});

test('10.12.96 combined P06DD intake consumes inline prior pressure evidence before returning',()=>{
  const process=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  assert.match(process,/if\(found\.length&&dtcResolution\?\.resolutionStatus==='RESOLVED'&&typeof handleExistingOilPressureEvidence==='function'&&handleExistingOilPressureEvidence\(text\)\)return/);
  for(const label of ['Specification Resolution Status','Resolved Diagnostic Specification','Measurement Interpretation','Interpretation Reason'])assert.match(html,new RegExp(`${label}:`));
});

test('10.12.96 completes and advances an inline 5.3L hot-idle P06DD measurement',()=>{
  for(const phrase of ['18 psi hot idle','18 psi at hot idle','18 psi @ hot idle','18 psi hot idol','18 psi engine hot at idle']){
    const h=harness();
    h.state.vehicle.engine='5.3L';
    h.state.vehicle.configuration='Engine 5.3L';
    assert.equal(h.handle(`Mechanical oil pressure test already completed, ${phrase}`),true,phrase);
    const evidence=h.state.existingDiagnosticEvidence[0];
    assert.equal(evidence.evidenceStatus,'COMPLETED',phrase);
    assert.equal(evidence.workflowStatus,'COMPLETED',phrase);
    assert.equal(evidence.measurementContext.temperature,'HOT / OPERATING_TEMPERATURE',phrase);
    assert.equal(evidence.measurementContext.operatingCondition,'IDLE',phrase);
    assert.equal(h.state.mechanicalOilPressureMeasurementStatus,'COMPLETED',phrase);
    assert.equal(h.state.conversationalGuidance.completedTests.length,1,phrase);
    assert.equal(h.state.evidenceConsumed,'YES',phrase);
    assert.equal(h.state.repeatMechanicalPressureTest,'NO',phrase);
    assert.equal(h.state.routeDirection,'FORWARD',phrase);
    assert.equal(h.state.specificationResolutionStatus,'RESOLVED_VERIFIED_APPLICABLE_SPECIFICATION',phrase);
    assert.equal(h.state.authoritativeDiagnosticTest.testId,'p06dd-oil-pump-control-valve-command-response',phrase);
    assert.notEqual(h.state.authoritativeDiagnosticTest.testId,'oil-pressure-measurement-context',phrase);
  }
});

test('10.12.96 isolates blower-only status fields from a P06DD workflow',()=>{
  assert.match(html,/blowerWorkflow=state\.componentTestState\?\.workflowId==='hvac-blower-speed-control'/);
  assert.match(html,/if\(!box\|\|state\.componentTestState\?\.workflowId!=='hvac-blower-speed-control'\)return;const output=/);
});

test('10.12.96 promotes accepted 5.3L case history before P06DD configuration routing',()=>{
  const h=harness();
  h.state.previousTests='2016 Chevy Silverado 5.3 P06DD current MIL on; mechanical test already completed.';
  assert.equal(h.handle('Mechanical oil pressure test shows 18 psi at hot idle'),true);
  assert.equal(h.state.vehicle.engine,'5.3L');
  assert.equal(h.state.vehicle.configuration,'5.3L');
  assert.equal(h.state.routingDiagnostics.engineConfigurationPromotion,'ACCEPTED_EVIDENCE');
  assert.equal(h.state.existingDiagnosticEvidence[0].evidenceStatus,'COMPLETED');
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.repeatMechanicalPressureTest,'NO');
  assert.equal(h.state.specificationResolutionStatus,'RESOLVED_VERIFIED_APPLICABLE_SPECIFICATION');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p06dd-oil-pump-control-valve-command-response');
  assert.doesNotMatch(h.replies.at(-1),/which engine|4\.3L, 5\.3L, or 6\.2L/i);
});
