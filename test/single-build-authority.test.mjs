import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.13.22 has one canonical build authority',()=>{
  assert.match(html,/window\.NitrosBuild=Object\.freeze\(\{[\s\S]+version:'10\.13\.22',[\s\S]+release:'Compound Evidence Test Completion & Component Condemnation',[\s\S]+buildDate:'2026-08-17'/);
  assert.match(html,/const \{version:VERSION,buildDate:BUILD,release:RELEASE\}=window\.NitrosBuild/);
  assert.match(html,/Authoritative Diagnostic State — v\$\{VERSION\}/);
  assert.match(html,/build:window\.NitrosBuild\.version/);
});

test('production has exactly one unversioned service-worker registration',()=>{
  const registrations=[...html.matchAll(/navigator\.serviceWorker\.register\(/g)];
  assert.equal(registrations.length,1);
  assert.match(html,/navigator\.serviceWorker\.register\('\.\/sw\.js',\{updateViaCache:'none'\}\)/);
  assert.doesNotMatch(html,/serviceWorker\.register\([^\n]+sw\.js\?v=/);
  assert.match(html,/await registration\.update\(\)/);
  assert.match(html,/controllerchange/);
  assert.match(html,/sessionStorage\.getItem\(RELOAD_KEY\)==='1'/);
});

test('runtime verification exposes service-worker support, control, URL, and state',()=>{
  for(const id of ['nitrosRuntimeAppBuild','nitrosRuntimeSwSupported','nitrosRuntimeSwControlled','nitrosRuntimeSwUrl','nitrosRuntimeSwState'])assert.match(html,new RegExp(`id="${id}"`));
});

test('service worker uses 10.13.22 version and preserves safe navigation caching',()=>{
  assert.match(sw,/const VERSION = '10\.13\.22'/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  assert.match(sw,/fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(sw,/STATIC_ASSETS = new Set\(\[new URL\('\.\/image-analysis-ad\.js'/);
  assert.match(sw,/cache\.put\(isVersionedStaticAsset \? request : APP_SHELL/);
  assert.match(sw,/caches\.match\(isVersionedStaticAsset \? request : APP_SHELL, \{ cacheName: CACHE_NAME \}\)/);
  assert.doesNotMatch(sw,/caches\.clear|localStorage|indexedDB/i);
});

test('hard stop dispatcher blocks progression without converting control inputs to evidence',()=>{
  assert.match(html,/function isHardStopState\(value\)\{return\['STOPPED','HOLD','PAUSED','COMPLETE','COMPLETED','AWAITING_REVIEW','AWAITING_REQUIRED_INFORMATION','REPAIR_DECISION_REQUIRED','TERMINATED','CANCELLED','ABORTED','AWAITING_TECHNICIAN_FINDING'\]/);
  assert.match(html,/classification==='HARD_STOP_COMMAND'[\s\S]+authoritativeDiagnosticState='STOPPED'/);
  assert.match(html,/state\.pendingNextTest=null;state\.queuedDiagnosticAction=null;state\.activePromptForMeasurement=null/);
  assert.match(html,/function canAdvanceDiagnostic\(\)\{return state\.authoritativeDiagnosticState==='ACTIVE'&&canDispatchDiagnosticAction\('advance'\)\}/);
});

test('10.13.16 dispatcher classifies commands before evidence handling',()=>{
  assert.match(html,/function classifyDiagnosticInput\(raw\)\{[\s\S]+HARD_STOP_COMMAND[\s\S]+PROGRESSION_COMMAND[\s\S]+REPEAT_COMMAND/);
  assert.match(html,/if\(classification==='PROGRESSION_COMMAND'\)\{if\(current!=='ACTIVE'\)/);
  assert.match(html,/diagnosticDispatcherAudit\(text,classification\)/);
  assert.match(html,/if\(isHardStopState\(current\)\)\{diagnosticDispatcherAudit\(text,'UNKNOWN_INPUT'\)/);
  assert.match(html,/Input Classification: \$\{esc\(state\.dispatcherClassification/);
});

test('10.13.17 blocks unrelated input behind the architecture requirement gate',()=>{
  assert.match(html,/pendingRequirement=\{type:'architecture-discrimination',field:'transmissionArchitecture'/);
  assert.match(html,/const processWithArchitectureRequirementGate=process;/);
  assert.match(html,/if\(requirement\.type==='architecture-discrimination'&&architecture\)/);
  assert.match(html,/That information does not answer the current configuration question/);
  assert.match(html,/state\.pendingRequirement=null;state\.architectureResolutionState='ARCHITECTURE_CONFIRMED'/);
});

test('10.13.18 persists resolved architecture and prevents gate re-entry',()=>{
  assert.match(html,/architectureResolution=\{status:'RESOLVED',value,source:'technician-confirmed'/);
  assert.match(html,/completedDiagnosticGates\.includes\('architecture-discrimination'\)/);
  assert.match(html,/persisted\?\.status==='RESOLVED'&&persisted\.caseId===state\.id&&persisted\.dtc===state\.activeDtc/);
  assert.match(html,/state\.architectureQuestionAllowed=false/);
  assert.match(html,/Illegal architecture re-entry repaired/);
});

test('10.13.19 commits applicable voltage readings through the authoritative evidence path',()=>{
  assert.match(html,/function activeAwaitingDiagnosticTest\(\)/);
  assert.match(html,/function commitAuthoritativeVoltageEvidence\(text\)/);
  assert.match(html,/measurementType:'Voltage',measurementValue:value,measurementUnit:'V'/);
  assert.match(html,/state\.evidenceConsumed='YES';state\.evidenceAppliedToStep=test\.testId;state\.evidenceWrite='ALLOWED'/);
  assert.match(html,/A single static voltage reading is retained but does not establish the requested input\/PID transition/);
});

test('10.13.20 retains incremental transition evidence and clears stale architecture workflow state',()=>{
  assert.match(html,/state\.diagnosticWorkflowState='DIAGNOSTIC_ACTIVE'/);
  assert.match(html,/const all=\(state\.existingDiagnosticEvidence\|\|\[\]\)\.filter\(item=>item\.testId===record\.testId&&item\.measurementType==='Voltage'\)/);
  assert.match(html,/transition=\/\\b\(\?:pedal\\s\*\(\?:down\|depressed\)\|drops\?\\s\+to\)\\b\/i\.test\(text\)&&all\.length>=2/);
  assert.match(html,/test\.status='PASS'/);
  assert.match(html,/advanceP0704StarterRelayIsolation\('MANUAL_CLUTCH_START_ENABLE'\)/);
});

test('10.13.21 normalizes contextual no-power findings and reconciles stale test state',()=>{
  assert.match(html,/function normalizeElectricalTransitionObservation\(text,test\)/);
  assert.match(html,/no power\|no voltage\|zero volts?/);
  assert.match(html,/function reconcileTransitionEvidence\(record\)/);
  assert.match(html,/transitionDetected:changed/);
  assert.match(html,/reconciliationResult=changed\?'SUPERSEDED_BY_NEW_EVIDENCE':'CONFIRMED_NO_STATE_CHANGE'/);
  assert.match(html,/commitAuthoritativeVoltageEvidenceWithStaleRecovery/);
});

test('10.13.22 atomically commits and judges compound switch evidence',()=>{
  assert.match(html,/function parseCompoundCircuitEvidence\(text,test\)/);
  assert.match(html,/function commitCompoundCircuitEvidence\(facts,test\)/);
  assert.match(html,/mechanicalActuation:mechanical&&!uncertain,inputVoltage/);
  assert.match(html,/facts\.mechanicalActuation&&facts\.inputVoltage>0&&facts\.outputVoltage===0&&facts\.outputTransitionObserved===false/);
  assert.match(html,/state\.componentCondemned='Clutch Start-Enable Switch'/);
  assert.match(html,/state\.diagnosticWorkflowState='REPAIR_OR_VERIFICATION'/);
});

test('10.12.99 contains long diagnostic output inside the mobile viewport',()=>{
  assert.match(html,/#oliverDiagnosticMode\{max-width:100vw;overflow-x:hidden;overscroll-behavior-x:none\}/);
  assert.match(html,/\.diag-message\{width:min\(900px,100%\);overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
  assert.match(html,/#nitrosAuthoritativeStatus,#nitrosAuthoritativeStatus \*\{max-width:100%;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
});

test('10.12.99 gives Oliver Hub header and scrolling content separate mobile layout regions',()=>{
  assert.match(html,/\.oliver-hub-card\{display:flex;flex-direction:column;min-height:0;overflow:hidden\}/);
  assert.match(html,/\.oliver-hub-head\{position:relative;z-index:2;flex:none\}/);
  assert.match(html,/\.oliver-hub-body\{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;flex:1;scroll-padding-top:1px\}/);
  assert.match(html,/padding-top:max\(8px,env\(safe-area-inset-top\)\)/);
});

test('legacy persistence identifiers remain unchanged',()=>{
  assert.match(html,/STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.match(html,/DB_NAME='NitrosRepairOrders'/);
  assert.match(html,/PHOTO_DB_NAME="nitros_photo_evidence_v1"/);
});
