import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('function diagnosticGuidanceRequest'),end=html.indexOf('function semanticIntakeRouting',start);
assert.ok(start>=0&&end>start,'oil-pressure evidence routing helpers were not found');
const source=html.slice(start,end);

function harness(){
  return Function(String.raw`${source};
    let state={id:'CASE-P06DD',vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'',configuration:''},activeDtc:'P06DD',dtcs:['P06DD'],dtcDefinition:'Engine Oil Pressure Control Circuit Performance / Stuck Off',affectedSystem:'Engine Lubrication / Oil Pressure Control',system:'Engine Lubrication / Oil Pressure Control',dtcClassification:'Manufacturer-Enhanced',dtcDiagnosticCategory:'Engine Oil Pressure Control',dtcResolutionStatus:'RESOLVED',dtcWorkflow:'Engine Oil Pressure Control Diagnostic',previousRepairs:'',previousTests:'',existingDiagnosticEvidence:[],conversationalGuidance:{evidence:[],measurements:[]},authoritativeDiagnosticTest:{testId:'dtc-status-configuration-establishment'},routingDiagnostics:{},stage:'status',intakeStep:'status'};
    const replies=[];
    function diagnosticMeasurement(text){const match=String(text).match(/(\d+(?:\.\d+)?)\s*(psi)\b/i);return match?{value:Number(match[1]),unit:match[2].toLowerCase()}:null}
    function guidanceState(){return state.conversationalGuidance}
    function selectGuidanceTest(id,name,reason,requiredEvidence,method,routeContext){state.authoritativeDiagnosticTest={testId:id,displayName:name,reason,requiredEvidence,method,affectedSystem:routeContext.affectedSystem,diagnosticCategory:routeContext.diagnosticCategory,activeDtc:state.activeDtc};state.conversationalGuidance.selectedNextTest=state.authoritativeDiagnosticTest;return state.authoritativeDiagnosticTest}
    function ask(text){replies.push(text)}
    function diagnosticTestCompatible(){return true}
    return {state,replies,handle:handleExistingOilPressureEvidence,guidance:handleDiagnosticGuidanceRequest};
  `)();
}

test('10.12.91 consumes an existing P06DD oil-pressure measurement and requests only missing context',()=>{
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

test('10.12.91 applies later measurement context without discarding the stored reading',()=>{
  const h=harness();
  h.handle('Oil pressure test has been done, showed 18 psi');
  assert.equal(h.handle('That was measured at hot idle with a mechanical gauge'),true);
  assert.equal(h.state.existingDiagnosticEvidence[0].measurementValue,18);
  assert.deepEqual(h.state.existingDiagnosticEvidence[0].measurementContext,{temperature:'HOT',operatingCondition:'IDLE',rpm:null,method:'MECHANICAL_GAUGE',location:'UNKNOWN'});
  assert.deepEqual(h.state.missingInterpretationContext,['ENGINE_CONFIGURATION']);
  assert.equal(h.state.evidenceConsumed,'YES');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'engine-configuration-for-oil-pressure-interpretation');
  assert.match(h.replies.at(-1),/Which engine.*4\.3L, 5\.3L, or 6\.2L/i);
});

test('10.12.91 checks existing P06DD evidence before generic status intake',()=>{
  const process=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  assert.ok(process.indexOf("handleExistingOilPressureEvidence(text)")<process.indexOf("if(state.intakeStep==='status')"));
  for(const label of ['Existing Diagnostic Evidence','Measurement Type','Measurement Value','Measurement Unit','Measurement Context','Evidence Consumed','Evidence Applied To Step','Missing Interpretation Context'])assert.match(html,new RegExp(`${label}:`));
});

test('10.12.91 classifies next-test intent and advances forward without storing the question',()=>{
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
  assert.equal(evidence.measurementContext.temperature,'HOT');
  assert.equal(evidence.measurementContext.operatingCondition,'IDLE');
  assert.doesNotMatch(JSON.stringify(h.state.conversationalGuidance),new RegExp(question.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'));
  assert.match(h.replies.at(-1),/do not repeat.*least intrusive next step.*oil-pressure control command\/feedback review/i);
  assert.doesNotMatch(h.replies.at(-1),/vehicle intake|identify P06DD|mechanical oil-pressure test again/i);
});

test('10.12.91 guidance gate precedes evidence and status handlers',()=>{
  const process=html.slice(html.indexOf('function process('),html.indexOf('function renderTranscript('));
  const guidance=process.indexOf('handleDiagnosticGuidanceRequest(text)'),evidence=process.indexOf('handleExistingOilPressureEvidence(text)'),status=process.indexOf("if(state.intakeStep==='status')");
  assert.ok(guidance>=0&&guidance<evidence&&guidance<status);
  for(const label of ['Guidance Request','Guidance Intent','Repeat Mechanical Pressure Test','Route Direction'])assert.match(html,new RegExp(`${label}:`));
});
