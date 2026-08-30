import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const sw=readFileSync(new URL('../sw.js',import.meta.url),'utf8');

test('10.13.120 has one canonical build authority',()=>{
  assert.match(html,/window\.NitrosBuild=Object\.freeze\(\{[\s\S]+version:'10\.13\.120',[\s\S]+release:'Electrical Connection-State Detection',[\s\S]+buildDate:'2026-08-30'/);
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

test('service worker uses 10.13.120 version and preserves safe navigation caching',()=>{
  assert.match(sw,/const VERSION = '10\.13\.120'/);
  assert.match(sw,/self\.skipWaiting\(\)/);
  assert.match(sw,/self\.clients\.claim\(\)/);
  assert.match(sw,/fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(sw,/STATIC_ASSETS = new Set\(\[new URL\('\.\/image-analysis-ad\.js'/);
  assert.match(sw,/cache\.put\(isVersionedStaticAsset \? request : APP_SHELL/);
  assert.match(sw,/caches\.match\(isVersionedStaticAsset \? request : APP_SHELL, \{ cacheName: CACHE_NAME \}\)/);
  assert.doesNotMatch(sw,/caches\.clear|localStorage|indexedDB/i);
});

test('mobile Tools menu clears the measured toolbar and safe area',()=>{
  assert.match(html,/:root\{--nitros-v1031-safe-bottom:max\(6px,env\(safe-area-inset-bottom\)\);--nitros-toolbar-height:0px/);
  assert.match(html,/\.quick-toolbar\{bottom:var\(--nitros-v1031-safe-bottom\)\}/);
  assert.match(html,/\.screen\{padding-bottom:max\(24px,var\(--nitros-ro-bottom-clearance\)\);scroll-padding-bottom:var\(--nitros-ro-bottom-clearance\)\}/);
  assert.match(html,/bottom:calc\(var\(--nitros-toolbar-height\) \+ env\(safe-area-inset-bottom\) \+ 12px\)/);
  assert.match(html,/new ResizeObserver\(syncLayout\)\.observe\(toolbar\)/);
});

test('mobile utility controls collapse into Tools without changing their button identities',()=>{
  assert.match(html,/id="mobileToolsToggle"[\s\S]*?aria-controls="mobileToolsMenu"/);
  assert.match(html,/const controls=\['globalDevelopmentNoteButton','quickNotesButton','nitrosSupportInboxButton','quickVehicleButton'\]/);
  assert.match(html,/controls\.forEach\(control=>menu\.append\(control\)\)/);
  assert.match(html,/scrim\.addEventListener\('click',close\)/);
  assert.match(html,/menu\.addEventListener\('click',event=>\{if\(event\.target\.closest\('button'\)\)close\(\)\}\)/);
  assert.match(html,/\.oliver-hub-launch\{left:max\(12px,env\(safe-area-inset-left\)\);right:auto/);
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

test('10.13.23 normalizes switch evidence by semantic role across turns',()=>{
  assert.match(html,/parseCompoundCircuitEvidenceWithSemanticRoles/);
  assert.match(html,/going in\|input\|feed\|power in\|hot\|battery voltage/);
  assert.match(html,/coming out\|output\|leaving\|other side\|signal out\|switched side/);
  assert.match(html,/press\(\?:ed\|ing\)\?\|push\(\?:ed\|ing\)\?\|depress/);
  assert.match(html,/const prior=\(state\.existingDiagnosticEvidence\|\|\[\]\)\.slice\(\)\.reverse\(\)\.find/);
});

test('10.13.24 normalizes condition, command, input, and output roles independent of wording',()=>{
  assert.match(html,/parseCompoundCircuitEvidenceWithConditionRoles/);
  assert.match(html,/clutch\\s\+\(\?:pedal\\s\+\)\?\(\?:depressed\|down\|pushed\|operated\|fully depressed\)/);
  assert.match(html,/const values=\[\.\.\.raw\.matchAll/);
  assert.match(html,/if\(facts\.mechanicalActuation&&facts\.inputVoltage>0&&facts\.outputVoltage===0\)facts\.outputTransitionObserved=false/);
});

test('10.13.25 evaluates evidence before scripted progression',()=>{
  assert.match(html,/function normalizeDiagnosticEvidence\(text,context=\{\}\)/);
  assert.match(html,/function evaluateEvidenceDrivenCase\(facts\)/);
  assert.match(html,/!test\|\|!facts\.mechanicalActuation\|\|!\(facts\.inputVoltage>0\)\|\|facts\.outputVoltage!==0/);
  assert.match(html,/state\.diagnosticStatus='FAULT_CONFIRMED'/);
  assert.match(html,/state\.repairRecommendation='Replace the clutch start-enable switch/);
});

test('10.13.26 persists repair verification separately from pre-repair evidence',()=>{
  assert.match(html,/function normalizeRepairVerificationEvidence\(text\)/);
  assert.match(html,/state\.preRepairEvidence=state\.preRepairEvidence\|\|/);
  assert.match(html,/state\.postRepairEvidence=Array\.isArray\(state\.postRepairEvidence\)/);
  assert.match(html,/state\.repairVerification='PASS';state\.caseStatus='VERIFIED REPAIR \/ COMPLETE'/);
});

test('10.13.27 commits normalized transmission facts before workflow gating',()=>{
  assert.match(html,/function normalizeConfigurationFacts\(text\)/);
  assert.match(html,/manual\|stick\(\?: shift\)\?\|standard/);
  assert.match(html,/automatic\|auto\|no clutch pedal\|prndl/);
  assert.match(html,/state\.architectureFact=\{\.\.\.fact,raw:text/);
  assert.match(html,/state\.pendingRequirement=null;state\.architectureResolutionState='RESOLVED';state\.architectureGate='COMPLETE'/);
});

test('10.13.28 creates an executable current test after configuration is resolved',()=>{
  assert.match(html,/function createActionableDiagnosticTest\(\)/);
  assert.match(html,/technicianInstruction:'At the clutch start-enable switch, use a digital voltmeter/);
  assert.match(html,/operatingCondition:'Key held in START; clutch pedal fully depressed/);
  assert.match(html,/state\.currentDiagnosticTest=test;state\.authoritativeDiagnosticTest=test/);
  assert.match(html,/if\(manual&&isDiagnosticActionRequest\(text\)&&\(!active\|\|!active\.technicianInstruction\)\)/);
});

test('10.13.29 hard-resets case-scoped diagnostic context before the next case',()=>{
  assert.match(html,/function hardResetDiagnosticCase\(\)\{const priorCaseId=state\?\.id;state=blank\(\)/);
  assert.match(html,/cleared:\['vehicle','configuration','complaint','dtcs','evidence','measurements','tests','hypotheses','patterns','retrieval','conclusions','conversation assumptions'\]/);
  assert.match(html,/state\.existingDiagnosticEvidence=\[\];state\.technicianObservations=\[\];state\.completedDiagnosticGates=\[\]/);
  assert.match(html,/function diagnosticInstructionIsRelevant\(instruction\)/);
});

test('10.13.30 filters stale context by active case provenance',()=>{
  assert.match(html,/function isolateCurrentCaseContext\(\)/);
  assert.match(html,/const activeCaseId=state\.id/);
  assert.match(html,/const valid=!item\.caseId\|\|item\.caseId===activeCaseId/);
  assert.match(html,/crossCaseContext:blocked\?'CROSS-CASE CONTEXT BLOCKED':'NONE'/);
});

test('10.13.31 rebuilds every diagnostic prompt from the active case only',()=>{
  assert.match(html,/function rebuildActiveCasePrompt\(\)/);
  assert.match(html,/item\.caseId&&item\.caseId!==activeCaseId/);
  assert.match(html,/status:stale\.length\?'REBUILT_AFTER_STALE_CONTEXT_REJECTION':'CURRENT_CASE_ONLY'/);
  assert.match(html,/diagnosticContextEpoch=priorEpoch\+1/);
  assert.match(html,/promptContextGuard='FRESH_NEW_CASE_CONTEXT'/);
});

test('10.13.32 rejects unrelated HVAC responses in a starting/enable case',()=>{
  assert.match(html,/function responseMatchesActiveCase\(text\)/);
  assert.match(html,/starting=\/\\b\(\?:starter\|start-enable\|clutch/);
  assert.match(html,/status:'CROSS_CASE_RESPONSE_REJECTED'/);
  assert.match(html,/REBUILD_REQUIRED_AFTER_RESPONSE_REJECTION/);
});

test('10.13.33 builds response context from extracted current-case facts',()=>{
  assert.match(html,/function buildAuthoritativeDiagnosticFacts\(\)/);
  assert.match(html,/state\.diagnosticFactLedger=facts/);
  assert.match(html,/function preflightDiagnosticResponse\(text\)/);
  assert.match(html,/status:'REJECTED_OFF_TOPIC_RESPONSE'/);
  assert.match(html,/status:'PASS_CURRENT_CASE_FACTS_ONLY'/);
});

test('10.13.34 captures no-crank complaints before DTC intake gating',()=>{
  assert.match(html,/function normalizeIntakeComplaint\(text\)/);
  assert.match(html,/complaint:'No crank when clutch pedal is applied'/);
  assert.match(html,/state\.normalizedSymptom=intake\.normalizedSymptom/);
  assert.match(html,/state\.dtcOptional='YES'/);
  assert.match(html,/state\.diagnosticWorkflowState='STARTING_NO_CRANK'/);
});

test('10.13.35 locks conclusive component transfer failures into repair verification',()=>{
  assert.match(html,/function evaluateComponentTransferFailure\(evidence\)/);
  assert.match(html,/input&&command&&outputDirect&&outputAbsent&&!contradiction/);
  assert.match(html,/state\.diagnosticStatus='CONCLUSIVE FAILURE'/);
  assert.match(html,/state\.authoritativeDiagnosticState='TERMINAL_CONCLUSION'/);
  assert.match(html,/state\.suppressAdditionalComponentTests=true/);
});

test('10.13.36 captures two-digit year, stick shift, and no-crank shorthand',()=>{
  assert.match(html,/function captureMechanicShorthandIntake\(text\)/);
  assert.match(html,/year=truck\?\.\[1\]\?2000\+Number\(truck\[1\]\):null/);
  assert.match(html,/stick\(\?: shift\)\?\|manual\|standard\|clutch pedal/);
  assert.match(html,/state\.normalizedSymptom='No-crank \/ starter receives no voltage'/);
  assert.match(html,/normalizeDiagnosticEvidenceWithShorthand/);
});

test('10.12.99 contains long diagnostic output inside the mobile viewport',()=>{
  assert.match(html,/#oliverDiagnosticMode\{max-width:100vw;overflow-x:hidden;overscroll-behavior-x:none\}/);
  assert.match(html,/\.diag-message\{width:min\(900px,100%\);overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
  assert.match(html,/#nitrosAuthoritativeStatus,#nitrosAuthoritativeStatus \*\{max-width:100%;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap\}/);
});

test('10.12.99 gives Oliver Hub header and scrolling content separate mobile layout regions',()=>{
  assert.match(html,/\.oliver-hub-card\{display:flex;flex-direction:column;min-height:0;overflow:hidden\}/);
  assert.match(html,/\.oliver-hub-head\{position:relative;z-index:2;flex:none\}/);
  assert.match(html,/\.oliver-hub-body\{min-height:0;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;flex:1;scroll-padding-top:16px\}/);
  assert.match(html,/#oliverImportPreview \.phase2-result\{scroll-margin-top:16px\}/);
  assert.match(html,/padding-top:max\(8px,env\(safe-area-inset-top\)\)/);
});

test('legacy persistence identifiers remain unchanged',()=>{
  assert.match(html,/STATE_KEY='nitros_diagnostic_case_v10120'/);
  assert.match(html,/DB_NAME='NitrosRepairOrders'/);
  assert.match(html,/PHOTO_DB_NAME="nitros_photo_evidence_v1"/);
});
