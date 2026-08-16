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
const p0704EvidenceHarness=initial=>Function('initial',`let state=JSON.parse(JSON.stringify(initial)),guidance={evidence:[],measurements:[],completedTests:[],hypotheses:[]},replies=[];function guidanceState(){return guidance}function selectGuidanceTest(id,name,reason,evidence,method,routeContext={}){state.authoritativeDiagnosticTest={testId:id,displayName:name,status:'AWAITING_RESULT',affectedSystem:routeContext.affectedSystem||state.affectedSystem||'',diagnosticCategory:routeContext.diagnosticCategory||state.dtcDiagnosticCategory||'',activeDtc:state.activeDtc};guidance.selectedNextTest=state.authoritativeDiagnosticTest;guidance.nextTestReason=reason;guidance.nextRequiredEvidence=evidence;return state.authoritativeDiagnosticTest}function ask(text){replies.push(text)}${extractRaw('function p0704ArchitectureFromEvidence','function process')}return{handle:handleP0704ArchitectureDiscriminationEvidence,state,get guidance(){return guidance},replies}`)(initial);

const p0704ArchitectureGateHarness=initial=>{const start=html.indexOf('function p0704ArchitectureFromEvidence',authority),end=html.indexOf('const processAuthoritativeEntry=process;',start);assert.ok(start>=0&&end>start);return Function('initial',`let state=JSON.parse(JSON.stringify(initial)),guidance={evidence:[],measurements:[],completedTests:[],hypotheses:[]},replies=[];function guidanceState(){return guidance}function selectGuidanceTest(id,name,reason,evidence,method,routeContext={}){state.authoritativeDiagnosticTest={testId:id,displayName:name,status:'AWAITING_RESULT',affectedSystem:routeContext.affectedSystem||state.affectedSystem||state.system||'',diagnosticCategory:routeContext.diagnosticCategory||state.dtcDiagnosticCategory||'',activeDtc:state.activeDtc};guidance.selectedNextTest=state.authoritativeDiagnosticTest;guidance.nextTestReason=reason;guidance.nextRequiredEvidence=evidence;return state.authoritativeDiagnosticTest}function ask(text){replies.push(text)}${html.slice(start,end)}return{handle:handleP0704ArchitectureDiscriminationEvidence,state,get guidance(){return guidance},replies}`)(initial)};

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

test('10.12.99 resolves Chevrolet P06DD through manufacturer-enhanced registry data',()=>{
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

test('10.12.99 binds and routes P06DD to status/configuration without selecting a measurement or condemning a component',()=>{
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

test('10.12.99 rejects a stale blower route before committing the P06DD next test',()=>{
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

test('10.12.99 binds resolved DTC state before route cleanup and next-test selection',()=>{
  const source=extractRaw('function applyDtcKnowledgeResolution','function handleManualDtcSystemIdentification');
  const bind=source.indexOf('state.activeDtc=resolved.code'),definition=source.indexOf('state.dtcDefinition=resolved.definition'),clear=source.indexOf("clearIncompatibleResolvedDtcRoute(resolved)"),select=source.indexOf('selectGuidanceTest(resolved.initialTest.id');
  assert.ok(bind>=0&&definition>bind&&clear>definition&&select>clear);
  assert.match(html,/incomingDtcCodes=codes\(text\)[\s\S]+if\(!incomingDtcCodes\.length\)\{[\s\S]+found=incomingDtcCodes/);
});

test('10.12.99 resolves Phase-1 multi-system registry records without using engine routing',()=>{
  const vehicle={year:'2016',make:'Chevrolet',model:'Silverado',engine:'5.3L'};
  const cases=[
    ['P0750','Transmission / Transaxle Diagnostic','Transmission / Transaxle Control','Transmission Control Module (TCM) / PCM'],
    ['C0035','Code-Specific Diagnostic','ABS / Electronic Brake Control','Vehicle Control Module',{...vehicle,year:'2012'}],
    ['B1325','Code-Specific Diagnostic','Control Module / Device Power Supply','Vehicle Control Module',{...vehicle,year:'2014'}],
    ['U0100','Network / Module Communication Diagnostic','Controller Area Network Communication','Gateway / Communicating Modules'],
    ['C0327','Transfer Case / 4WD Diagnostic','Transfer Case / 4WD Control','Transfer Case Control Module (TCCM)'],
    ['C0407','Differential / Driveline Diagnostic','Differential / Driveline Control','Differential / Driveline Control Module']
  ];
  for(const [code,workflow,system,module,applicableVehicle=vehicle] of cases){
    const resolved=knowledge.resolve(code,applicableVehicle);
    assert.ok(/^RESOLVED/.test(resolved.resolutionStatus),code);
    assert.equal(resolved.workflow,workflow,code);
    assert.equal(resolved.system,system,code);
    assert.equal(resolved.controllingModule,module,code);
    assert.ok(resolved.requiredEvidence,code);
    assert.ok(resolved.nextTestCategory,code);
  }
});

test('10.12.99 resolves P0741 to a scan-tool-first TCC workflow without fabricating a reporting module',()=>{
  const vehicle={year:'2015',make:'Chevrolet',model:'Silverado',engine:'5.3L'},resolved=knowledge.resolve('P0741',vehicle);
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(resolved.dtcFamily,'Powertrain');
  assert.equal(resolved.definition,'Torque Converter Clutch Circuit Performance / Stuck Off');
  assert.equal(resolved.system,'Transmission / Torque Converter Clutch');
  assert.equal(resolved.subsystem,'Torque Converter Clutch / TCC');
  assert.equal(resolved.category,'Transmission / Torque Converter Clutch Performance');
  assert.equal(resolved.genericOrManufacturerSpecific,'Generic / SAE');
  assert.equal(resolved.controllingModule,'');
  assert.equal(resolved.workflow,'Code-Specific Diagnostic');
  assert.equal(resolved.initialTest.id,'p0741-tcc-command-slip-response');
  assert.match(resolved.initialTest.requiredEvidence,/bidirectional.*TCC commanded state.*TCC slip RPM/i);
  const h=routingHarness({vehicle:{...vehicle,configuration:'5.3L'},activeDtc:'P0741',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),bound=h.apply();
  assert.equal(bound.code,'P0741');
  assert.equal(h.state.dtcReportingModule,'');
  assert.equal(h.state.stage,'diagnostic-testing');
  assert.equal(h.state.intakeStep,'complete');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0741-tcc-command-slip-response');
  assert.equal(h.state.componentCondemned,'None');
});

test('10.12.99 consumes inline DTC status and MIL state before direct next-test routing',()=>{
  assert.match(html,/inlineStatus=diagnosticStatus\(text\),inlineMilStatus=milStatus\(text\)/);
  assert.match(html,/state\.status=inlineStatus\|\|'';state\.milStatus=inlineMilStatus\|\|''/);
  assert.match(html,/function milStatus\(text\)\{[\s\S]+check\[- \]engine light[\s\S]+return'ON'/);
  assert.match(html,/diagnosticGuidanceRequest\(text\)\)\{state\.intakeStep='complete';state\.stage='diagnostic-testing'/);
  for(const label of ['DTC Status','MIL Status'])assert.match(html,new RegExp(`${label}:`));
});

test('10.13.00 starts a different-vehicle natural DTC entry from blank authoritative state',()=>{
  const start=html.indexOf('const processAuthoritativeEntry=process;'),end=html.indexOf('function renderTranscript(',start),guard=html.slice(start,end);
  assert.match(guard,/incomingCodes=codes\(text\),incomingVehicle=incomingCodes\.length\?parseVehicle\(text\):null/);
  assert.match(guard,/hasPriorVehicle/);
  assert.match(guard,/differentVehicle/);
  assert.match(guard,/incomingCodes\.length&&hasPriorVehicle&&differentVehicle\)state=blank\(\)/);
  const resolved=knowledge.resolve('P0340',{year:'2014',make:'Toyota',model:'Camry'});
  assert.equal(resolved.dtcFamily,'Powertrain');
  assert.equal(resolved.definition,'Camshaft Position Sensor A Circuit (Bank 1 or Single Sensor)');
  assert.equal(resolved.system,'Camshaft Position Sensing');
  assert.equal(resolved.subsystem,'Sensor A Circuit');
  assert.equal(resolved.workflow,'Camshaft Position Circuit');
});

test('10.13.01 resolves generic SAE P0704 independently of transmission applicability',()=>{
  const resolved=knowledge.resolve('P0704',{year:'2007',make:'Ford',model:'F-150'});
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(resolved.dtcFamily,'Powertrain');
  assert.equal(resolved.genericOrManufacturerSpecific,'Generic / SAE');
  assert.equal(resolved.definition,'Clutch Switch Input Circuit Malfunction');
  assert.equal(resolved.system,'Clutch Pedal / Start Enable Input');
  assert.equal(resolved.workflow,'Code-Specific Diagnostic');
});

test('10.13.02 resolves and routes generic transmission range P-codes before any unavailable fallback',()=>{
  const vehicle={year:'2007',make:'Ford',model:'F-150',engine:'',configuration:''};
  for(const [code,definition,workflow,testId] of [
    ['P0705','Transmission Range Sensor Circuit Malfunction / PRNDL Input','Transmission Range / Gear-Position Input Diagnostic','p0705-range-input-scan-tool-comparison'],
    ['P0706','Transmission Range Sensor A Circuit Range/Performance','Transmission Range / Gear-Position Input Diagnostic','p0706-range-performance-scan-tool-comparison']
  ]){
    const resolved=knowledge.resolve(code,vehicle),h=routingHarness({vehicle:{...vehicle},activeDtc:code,system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'});
    assert.equal(resolved.resolutionStatus,'RESOLVED',code);
    assert.equal(resolved.definition,definition,code);
    assert.equal(resolved.dtcFamily,'Powertrain',code);
    assert.equal(resolved.workflow,workflow,code);
    h.apply();
    assert.equal(h.state.authoritativeDiagnosticTest.testId,testId,code);
    assert.equal(h.state.stage,'diagnostic-testing',code);
  }
});

test('10.13.03 binds resolved P0704 to the active DTC and blocks unrelated symptom routing',()=>{
  const vehicle={year:'2007',make:'Ford',model:'F-150',engine:'',configuration:''},h=routingHarness({vehicle:{...vehicle},activeDtc:'P0704',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.resolvedDtcCode,'P0704');
  assert.equal(h.state.dtcDefinition,'Clutch Switch Input Circuit Malfunction');
  assert.equal(h.state.affectedSystem,'Clutch Pedal / Start Enable Input');
  assert.equal(h.state.dtcWorkflow,'Code-Specific Diagnostic');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-start-enable-architecture-discrimination');
  assert.doesNotMatch(JSON.stringify(h.state),/blower|hvac|fan-speed|resistor/i);
  assert.match(html,/function reconcileResolvedDtcState\(resolved\)/);
  assert.match(html,/state\.activeDtc=resolved\.code/);
  assert.match(html,/routingDecision:'DTC_STATE_RECONCILIATION_REQUIRED'/);
});

test('10.13.04 keeps P0704 active through architecture discrimination instead of a configuration dead end',()=>{
  const vehicle={year:'2007',make:'Ford',model:'F-150',engine:'',configuration:''},h=routingHarness({vehicle:{...vehicle},activeDtc:'P0704',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.resolutionStatus,'RESOLVED');
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.vehicle.configuration,'Architecture Discrimination Required');
  assert.equal(h.state.stage,'architecture-discrimination');
  assert.equal(h.state.intakeStep,'complete');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-start-enable-architecture-discrimination');
  assert.match(h.guidance.nextRequiredEvidence,/clutch-pedal\/safety input.*start-permission or transmission-range input.*starter-relay/i);
  assert.equal(h.state.componentCondemned,'None');
  assert.match(html,/function recordP0704NoStartObservation\(text\)/);
  assert.match(html,/Accessories\/electrical functions reported operational; primary complaint is no-start\/start-enable failure/);
  assert.match(html,/genericSymptomRestatementSuppressed:'YES'/);
  assert.doesNotMatch(html,/P0704[\s\S]{0,500}Configuration: Unresolved — requires architecture\/service information/);
});

test('10.13.05 consumes a P0704 no-start-enable observation and advances after one architecture fact',()=>{
  const h=p0704EvidenceHarness({id:'CASE-P0704',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:'Architecture Discrimination Required'},activeDtc:'P0704',dtcDefinition:'Clutch Switch Input Circuit Malfunction',dtcResolutionStatus:'RESOLVED',affectedSystem:'Clutch Pedal / Start Enable Input',dtcDiagnosticCategory:'Powertrain Input Circuit',stage:'architecture-discrimination',intakeStep:'complete',existingDiagnosticEvidence:[],technicianObservations:[],routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'});
  assert.equal(h.handle('Did not see start enable.'),true);
  assert.equal(h.state.stage,'p0704-architecture-confirmation');
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.dtcResolutionStatus,'RESOLVED');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).normalizedEvidence,'START_ENABLE_INPUT_NOT_OBSERVED');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).rawObservation,'Did not see start enable.');
  assert.equal(h.state.routingDiagnostics.genericFindingFallbackPrevented,'YES');
  assert.match(h.replies.at(-1),/automatic or manual transmission/i);
  assert.doesNotMatch(h.replies.at(-1),/continue with the next verified measurement/i);
  assert.equal(h.handle('Automatic transmission.'),true);
  assert.equal(h.state.stage,'dtc-architecture-contradiction');
  assert.equal(h.state.architectureDetermination,'AUTOMATIC_RANGE_START_PERMISSION');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-architecture-contradiction-review');
  assert.match(h.replies.at(-1),/automatic-transmission configuration conflicts.*VIN\/configuration.*reporting module/i);
  assert.equal(h.state.componentCondemned,'None');
});

test('10.13.06 binds P0704 to its authoritative family and rejects a stale HVAC workflow',()=>{
  const h=routingHarness({id:'CASE-P0704-BIND',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:''},activeDtc:'P0704',dtcs:['P0704'],system:'HVAC',component:'Blower Motor / Blower Speed Control',diagnosticDomain:'HVAC / Blower Diagnostic',dtcRouteKey:'CASE-OLD|P0000|2007|Ford|F-150',authoritativeDiagnosticTest:{testId:'blower-lower-speed-command-test',displayName:'Blower Lower-Speed Command Test',affectedSystem:'HVAC',diagnosticCategory:'HVAC Blower'},componentTestState:{workflowId:'hvac-blower-speed-control'},conversationalGuidance:{evidence:[{testId:'prior-evidence'}],measurements:[],completedTests:[],hypotheses:[],selectedNextTest:{testId:'blower-lower-speed-command-test',displayName:'Blower Lower-Speed Command Test'}},routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.code,'P0704');
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.dtcDefinition,'Clutch Switch Input Circuit Malfunction');
  assert.equal(h.state.dtcReportingModule,'Powertrain Control Module (PCM)');
  assert.equal(h.state.authoritativeDiagnosticFamily,'Powertrain / Clutch Pedal / Start Enable Input');
  assert.equal(h.state.selectedWorkflowFamily,h.state.authoritativeDiagnosticFamily);
  assert.equal(h.state.selectedWorkflowId,'p0704-start-enable-architecture-discrimination');
  assert.equal(h.state.workflowCompatibilityResult,'PASS');
  assert.doesNotMatch(JSON.stringify({test:h.state.authoritativeDiagnosticTest,system:h.state.system,domain:h.state.diagnosticDomain}),/blower|hvac|resistor|fan-speed/i);
  assert.match(html,/if\(symptom&&!found\.length&&!state\.activeDtc\)/);
  assert.match(html,/Workflow Binding:/);
});

test('10.13.07 treats a P0704 start-command no-change finding as evidence and advances the branch',()=>{
  const h=p0704EvidenceHarness({id:'CASE-P0704-PROGRESSION',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:'Architecture Discrimination Required'},activeDtc:'P0704',dtcDefinition:'Clutch Switch Input Circuit Malfunction',dtcResolutionStatus:'RESOLVED',dtcReportingModule:'Powertrain Control Module (PCM)',affectedSystem:'Clutch Pedal / Start Enable Input',dtcDiagnosticCategory:'Powertrain Input Circuit',stage:'architecture-discrimination',intakeStep:'complete',existingDiagnosticEvidence:[],technicianObservations:[],routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'});
  assert.equal(h.handle('Start command did not change.'),true);
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.dtcDefinition,'Clutch Switch Input Circuit Malfunction');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).normalizedEvidence,'START_COMMAND_STATE_NOT_CHANGED');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).rawObservation,'Start command did not change.');
  assert.equal(h.state.stage,'p0704-architecture-confirmation');
  assert.doesNotMatch(h.replies.at(-1),/continue with the next verified measurement/i);
  assert.equal(h.handle('Manual transmission.'),true);
  assert.equal(h.state.stage,'clutch-start-enable-circuit-isolation');
  assert.equal(h.state.currentDiagnosticBranch,'CLUTCH_INPUT_TRANSITION_ISOLATION');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-clutch-input-transition-isolation');
  assert.match(h.replies.at(-1),/clutch-pedal switch\/input circuit.*PCM clutch\/start-enable PID.*state should transition/i);
  assert.equal(h.state.componentCondemned,'None');
});

test('10.13.08 consumes a starter-relay no-change result and advances to command correlation',()=>{
  const h=p0704EvidenceHarness({id:'CASE-P0704-RELAY',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:'Manual transmission / clutch start-enable input (technician confirmed)'},activeDtc:'P0704',dtcDefinition:'Clutch Switch Input Circuit Malfunction',dtcResolutionStatus:'RESOLVED',affectedSystem:'Clutch Pedal / Start Enable Input',dtcDiagnosticCategory:'Powertrain Input Circuit',stage:'clutch-start-enable-circuit-isolation',intakeStep:'complete',existingDiagnosticEvidence:[],technicianObservations:[],routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'});
  assert.equal(h.handle('Starter relay never changes state.'),true);
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).normalizedEvidence,'STARTER_RELAY_STATE_NOT_CHANGED');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).rawObservation,'Starter relay never changes state.');
  assert.equal(h.state.stage,'start-enable-relay-command-isolation');
  assert.equal(h.state.currentDiagnosticBranch,'STARTER_RELAY_COMMAND_ISOLATION');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-starter-relay-command-isolation');
  assert.match(h.replies.at(-1),/starter-relay control circuit.*PCM clutch\/start-enable PID.*should change/i);
  assert.doesNotMatch(h.replies.at(-1),/continue with the next verified measurement|replace/i);
  assert.equal(h.state.componentCondemned,'None');
});

test('10.13.09 advances a failed P0704 switch functional result to local isolation without repeating it',()=>{
  const h=p0704EvidenceHarness({id:'CASE-P0704-SWITCH',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:'Architecture Discrimination Required'},activeDtc:'P0704',dtcDefinition:'Clutch Switch Input Circuit Malfunction',dtcResolutionStatus:'RESOLVED',affectedSystem:'Clutch Pedal / Start Enable Input',dtcDiagnosticCategory:'Powertrain Input Circuit',stage:'architecture-discrimination',intakeStep:'complete',existingDiagnosticEvidence:[],technicianObservations:[],previousTests:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'});
  assert.equal(h.handle('Switch does not change.'),true);
  assert.equal(h.state.activeDtc,'P0704');
  assert.equal(h.state.dtcDefinition,'Clutch Switch Input Circuit Malfunction');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).normalizedEvidence,'P0704_SWITCH_FUNCTIONAL_TEST_FAILED_NO_STATE_CHANGE');
  assert.equal(h.state.existingDiagnosticEvidence.at(-1).status,'FAIL');
  assert.equal(h.state.diagnosticProgressionState,'FAILED_FUNCTIONAL_RESULT');
  assert.equal(h.state.stage,'local-component-isolation');
  assert.equal(h.state.currentDiagnosticBranch,'LOCAL_COMPONENT_ISOLATION');
  assert.equal(h.state.authoritativeDiagnosticTest.testId,'p0704-switch-actuation-and-local-state-isolation');
  assert.match(h.replies.at(-1),/without repeating it.*physically actuates.*local input\/output electrical state.*PCM PID/i);
  assert.doesNotMatch(h.replies.at(-1),/continue with the next verified measurement|replace/i);
  assert.equal(h.state.componentCondemned,'None');
});

test('10.13.10 holds P0704 functional evidence pending until architecture is confirmed',()=>{
  const base={id:'CASE-P0704-GATE',vehicle:{year:'2007',make:'Ford',model:'F-150',engine:'',configuration:'Architecture Discrimination Required'},activeDtc:'P0704',dtcDefinition:'Clutch Switch Input Circuit Malfunction',dtcResolutionStatus:'RESOLVED',affectedSystem:'Clutch Pedal / Start Enable Input',dtcDiagnosticCategory:'Powertrain Input Circuit',stage:'architecture-discrimination',intakeStep:'complete',existingDiagnosticEvidence:[],technicianObservations:[],previousTests:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'};
  const manual=p0704ArchitectureGateHarness(base);
  assert.equal(manual.handle('Start never changed when pedal was applied.'),true);
  assert.equal(manual.state.stage,'p0704-architecture-confirmation');
  assert.equal(manual.state.architectureResolutionState,'ARCHITECTURE_REQUIRED');
  assert.equal(manual.state.architectureApplicability,'UNDETERMINED');
  assert.equal(manual.state.pendingArchitectureEvidence.at(-1).status,'PENDING_ARCHITECTURE');
  assert.match(manual.replies.at(-1),/transmission architecture must be established.*manual or automatic/i);
  assert.equal(manual.handle('Manual transmission.'),true);
  assert.equal(manual.state.architectureResolutionState,'ARCHITECTURE_CONFIRMED_APPLICABLE');
  assert.equal(manual.state.architectureApplicability,'APPLICABLE');
  assert.equal(manual.state.pendingArchitectureEvidence.at(-1).status,'CONSUMED');
  assert.equal(manual.state.stage,'local-component-isolation');
  assert.equal(manual.state.authoritativeDiagnosticTest.testId,'p0704-switch-actuation-and-local-state-isolation');
  const automatic=p0704ArchitectureGateHarness(base);
  automatic.handle('Start never changed when pedal was applied.');
  assert.equal(automatic.handle('Automatic transmission.'),true);
  assert.equal(automatic.state.architectureResolutionState,'ARCHITECTURE_CONFLICT');
  assert.equal(automatic.state.architectureApplicability,'NOT_APPLICABLE');
  assert.equal(automatic.state.stage,'dtc-architecture-contradiction');
  assert.equal(automatic.state.authoritativeDiagnosticTest.testId,'p0704-architecture-contradiction-review');
});

test('10.13.01 persists case ownership and rejects a restored mismatched evidence owner',()=>{
  assert.match(html,/state\.evidenceCaseId=state\.id/);
  assert.match(html,/state\.evidenceCaseId&&state\.evidenceCaseId!==state\.id\)state=blank\(\)/);
});

test('10.12.99 promotes resolved module metadata into authoritative workflow state',()=>{
  const h=routingHarness({vehicle:{year:'2016',make:'Chevrolet',model:'Silverado',engine:'5.3L',configuration:'5.3L'},activeDtc:'P0750',system:'',diagnosticDomain:'',routingDiagnostics:{},componentCondemned:'None',diagnosticConclusionState:'UNCONFIRMED'}),resolved=h.apply();
  assert.equal(resolved.workflow,'Transmission / Transaxle Diagnostic');
  assert.equal(h.state.system,'Transmission / Transaxle Control');
  assert.equal(h.state.dtcReportingModule,'Transmission Control Module (TCM) / PCM');
  assert.equal(h.state.dtcModuleCategory,'Transmission / Transaxle');
  assert.equal(/engine performance/i.test(h.state.diagnosticDomain),false);
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
  for(const label of ['DTC Family','DTC Definition','Affected System','Reporting Module','Module Category','DTC Classification','DTC Knowledge Source','DTC Resolution Status'])assert.match(html,new RegExp(`${label}:`));
});
