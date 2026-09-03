import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { normalizeWiringField } from '../semantic-analyzer-core.mjs';

const root = new URL('../', import.meta.url);
const [analyzer, html, serviceWorker, endpoint, core, vercelConfig] = await Promise.all([
  readFile(new URL('image-analysis-ad.js', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8'),
  readFile(new URL('sw.js', root), 'utf8'),
  readFile(new URL('api/semantic-image-analysis.mjs', root), 'utf8'),
  readFile(new URL('semantic-analyzer-core.mjs', root), 'utf8'),
  readFile(new URL('vercel.json', root), 'utf8')
]);

function semanticNormalizer(){
  const start=analyzer.indexOf('  function normalizeSemanticAnalysisResponse(payload){'),endMarker='  window.NitrosNormalizeSemanticResponse=normalizeSemanticAnalysisResponse;',end=analyzer.indexOf(endMarker,start)+endMarker.length,context={window:{}};
  assert.ok(start>0&&end>start,'semantic normalizer source must be extractable');vm.createContext(context);vm.runInContext(analyzer.slice(start,end),context);return context.window.NitrosNormalizeSemanticAnalysisResponse;
}

const semanticFixture={category:'AUTOMOTIVE_GRAPH',confidence:98,objects:['PID graph'],evidence:['visible plotted traces'],description:'Automotive PID graph',automotiveEvidence:[],graphEvidence:['horizontal graph axis','multiple plotted points'],documentEvidence:[]};

test('10.12.28 canonical normalizer accepts direct, array, envelope, OpenAI content, and fenced JSON shapes',()=>{
  const normalize=semanticNormalizer(),identity={transactionId:'sem-current',imageHash:'abc123'},cases=[
    {...identity,semanticResult:semanticFixture},
    [{...identity,semanticResult:semanticFixture}],
    {...identity,data:{result:{semanticResult:semanticFixture}}},
    {...identity,output:[{content:[{type:'output_text',text:JSON.stringify(semanticFixture)}]}]},
    {...identity,semanticResult:`\n\`\`\`json\n${JSON.stringify(semanticFixture)}\n\`\`\`\n`},
    {...identity,output_parsed:semanticFixture}
  ];
  for(const raw of cases){const result=normalize(raw);assert.equal(result.semanticResult.category,'AUTOMOTIVE_GRAPH');assert.equal(result.transactionId,identity.transactionId);assert.equal(result.imageHash,identity.imageHash)}
});

test('10.12.28 canonical normalizer rejects malformed and incomplete semantic content',()=>{
  const normalize=semanticNormalizer();assert.equal(normalize({semanticResult:'```json\n{bad json}\n```'}),null);assert.equal(normalize({semanticResult:{category:'AUTOMOTIVE_GRAPH'}}),null);
});

test('10.13.140 keeps the proven analyzer and production endpoint', () => {
  assert.match(analyzer, /const BUILD='10\.13\.140'/);
  assert.match(html, /10\.13\.140/);
  assert.match(html, /src="\.\/image-analysis-ad\.js"/);
  assert.match(html, /nitros-semantic-endpoint" content="https:\/\/nitros-prototype\.vercel\.app\/api\/semantic-image-analysis/);
  assert.match(serviceWorker, /const VERSION = '10\.13\.140'/);
  assert.doesNotMatch(`${analyzer}\n${html}\n${serviceWorker}`, /10\.12\.7A[FGHIJKLMN]/);
});

test('10.13.134 preserves the final reconciliation contract through client normalization', () => {
  assert.match(analyzer, /const reconciliationStatus=\['PASS','PARTIAL'\]\.includes\(raw\?\.crossFindingConsistency\?\.status\)/);
  assert.match(analyzer, /crossFindingConsistency:\{status:reconciliationStatus/);
  assert.match(analyzer, /conflictEvaluation,finalEvidencePromotion,semanticRequestId:raw\.semanticRequestId/);
  assert.match(analyzer, /\['PASS','PARTIAL'\]\.includes\(server\.crossFindingConsistency\)\)\{set\(26,'PASS'\);set\(27,'PASS'\);/);
});

test('semantic request preserves the production payload and classification gates', () => {
  assert.match(analyzer, /method:'POST'/);
  assert.match(analyzer, /activeVehicleAnalysisContext\(\)/);
  assert.match(analyzer, /JSON\.stringify\(\{transactionId:runId,imageHash,mimeType,imageBase64,\.\.\.\(vehicleContext\?\{vehicleContext\}:\{\}\)\}\)/);
  assert.match(analyzer, /'Content-Type':'application\/json'/);
  assert.doesNotMatch(analyzer, /Authorization\s*:/);
  assert.match(analyzer, /category==='AUTOMOTIVE_GRAPH'&&graphEvidence\.length<2/);
  assert.match(analyzer, /category==='AUTOMOTIVE_COMPONENT_OR_VEHICLE'&&!automotiveEvidence\.length/);
});

test('automotive graphs route into Oliver with context-safe structured findings', () => {
  assert.match(core, /semanticResult\.category === 'AUTOMOTIVE_GRAPH'/);
  assert.match(core, /nitros_automotive_graph/);
  assert.match(core, /never condemn a converter from the graph alone/i);
  assert.match(analyzer, /result\.route='Automotive graph analysis'/);
  assert.doesNotMatch(analyzer, /No clean-room graph\/OCR analyzer is configured/);
  assert.match(analyzer, /Observed:/);assert.match(analyzer, /Interpretation:/);assert.match(analyzer, /Next Test:/);assert.match(analyzer, /<strong>Why:<\/strong>/);
  for(const diagnostic of ['nitrosEvidenceInventoryStatus','nitrosAvailableDiagnosticChannels','nitrosNextTestUnresolvedQuestion','nitrosRedundantTestCheck','nitrosCandidateNextTestRejected','nitrosNextTestSelection'])assert.ok(analyzer.includes(diagnostic),`missing graph diagnostic ${diagnostic}`);
  for(const diagnostic of ['nitrosNumericSignNormalization','nitrosNumericEvidenceNormalization','nitrosCurrentMinMaxConsistency','nitrosInvalidPidEvidence','nitrosNumericInconsistencySource','nitrosZeroCrossingValidation','nitrosDirectionalClaimValidation','nitrosDependentInterpretationSuppressed','nitrosDiagnosticSignificanceGuard','nitrosNumericInterpretationGuard','nitrosNumericNarrativeConflict','nitrosNumericNarrativeCorrection'])assert.ok(analyzer.includes(diagnostic),`missing numeric guard diagnostic ${diagnostic}`);
  assert.match(analyzer,/graph\.analysisMode==='PID_SNAPSHOT'\?'AUTOMOTIVE PID SNAPSHOT ANALYSIS':'AUTOMOTIVE PID GRAPH ANALYSIS'/);
  assert.match(analyzer,/freshResultVerification:fresh\?'PASS':'FAIL'/);assert.match(analyzer,/nitrosEvidenceType/);assert.match(analyzer,/nitrosSemanticConsistencyStatus/);assert.match(analyzer,/workflowRelevance/);assert.match(analyzer,/camWorkflow/);assert.match(analyzer,/authoritativeWorkflowPreserved:true/);
  assert.match(analyzer,/Numeric Evidence Consistency: FAIL/);assert.match(analyzer,/numeric evidence is incomplete because Min and\/or Max could not be reliably recovered/);assert.match(analyzer,/finalCanonicalPidEvidence/);
  assert.match(analyzer,/<strong>Trace Behavior:<\/strong>/);
  assert.match(analyzer, /NitrosQuickVehicle\?\.getActiveVehicle/);
  assert.match(analyzer, /Possible vehicle-context mismatch/);
  assert.match(analyzer, /Retain these graph findings in the current diagnostic conversation/);
  for(const field of ['nitrosTemporalRoutingDecision','nitrosTemporalInterpretationPermissions','nitrosTemporalClaimValidation','nitrosTemporalClaimConflictDetected'])assert.ok(analyzer.includes(field),`missing temporal enforcement diagnostic ${field}`);
});

test('technician pointer evidence remains contextual and cannot override whole-image primary selection', () => {
  assert.match(analyzer,/TECHNICIAN-INDICATED TARGET — CONTEXTUAL INSPECTION AREA/);
  assert.match(analyzer,/pointerEvidence=\(result\.evidence\|\|\[\]\)\.find/);
  assert.match(analyzer,/No definite defect can be confirmed at the technician-indicated location from this image/);
  assert.match(analyzer,/primary selection follows the completed whole-image candidate sweep/);
});

test('electrical or wheel-area pointer targets run visible-circuit inspection and guidance without forcing a wiring diagram', () => {
  assert.match(analyzer,/function hasElectricalPointerTarget\(result\)/);
  assert.match(analyzer,/pointer&&\(electrical\|\|wheelArea\)/);
  assert.match(analyzer,/electricalCircuitPipeline:'PASS'/);
  assert.match(analyzer,/electricalDiagramStatus:electricalPipeline\.diagramStatus/);
  assert.match(analyzer,/Visible circuit inspection:<\/strong> PERFORMED/);
  assert.match(analyzer,/Component verification guidance:<\/strong> GENERATED/);
  assert.match(analyzer,/Wiring diagram confirmed/);
});

test('executed backend electrical pipeline controls circuit-stage status and non-electrical skips carry a reason', () => {
  assert.match(analyzer,/electricalCircuitAnalysis:raw\.electricalCircuitAnalysis\|\|null/);
  assert.match(analyzer,/electricalPipeline\?\.wiringAnalysisExecuted&&electricalPipeline\?\.visibleCircuitAnalysisExecuted&&electricalPipeline\?\.testGuidanceGenerated/);
  assert.match(analyzer,/SKIPPED — not_electrical/);
  assert.match(core,/function buildElectricalCircuitAnalysis/);
  assert.match(core,/diagramStatus: 'DIAGRAM_REQUIRED'/);
  assert.match(core,/visibleCircuitStatus: visible\.length \? 'INSPECTED_LIMITED_TO_VISIBLE_AREAS' : 'NOT_VISIBLE_ADDITIONAL_PHOTO_REQUIRED'/);
});

test('current image context suppresses incompatible inherited visual targets while retaining vehicle context', () => {
  assert.match(analyzer,/function authoritativeImageContext\(result\)/);
  assert.match(analyzer,/contextConflictDetected:conflict/);
  assert.match(analyzer,/staleVisualContextSuppressed:conflict/);
  assert.match(analyzer,/vehicleContextRetained:Boolean\(result\?\.vehicleContextBinding\|\|result\?\.vehicleContextApplied\?\.available\)/);
  assert.match(analyzer,/Engine air-intake \/ sensor \/ connector family/);
  assert.match(analyzer,/window\.NitrosDeveloperMode\.authoritativeImageContext/);
});

test('a visible disconnected electrical connector is reported as an observation before its recommendation', () => {
  assert.match(analyzer,/Visible observation: Electrical connector appears disconnected\/unplugged/);
  assert.match(analyzer,/Recommended technician verification:<\/strong> \$\{escapeHtml\(item\.recommendedVerification\)\}/);
  assert.match(core,/Condition confidence must be independent from component-identification confidence/);
});

test('10.12.42 final shared triplet gate validates and renders one frozen canonical object',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start);assert.ok(start>=0&&end>start);const context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);
  const row=(pidName,current,minimum,maximum,unit)=>({pidName,current,minimum,maximum,unit,currentPresent:true,minimumPresent:true,maximumPresent:true}),graph={numericEvidence:[row('Long FT #1',6.249,-6.249,5.467,'%'),row('Short FT #1',.781,-2.342,1.563,'%'),row('AFS Voltage B1S1',3.249,3.191,3.303,'V'),row('O2S B1S2',.055,0,.055,'V'),row('Engine Speed',905,899,994,'RPM')],interpretation:['Long FT #1 indicates a diagnosis.','Short FT #1 is observed.'],traceFindings:['Long FT #1 trace conclusion.','O2S B1S2 trace observed.'],diagnosticSignificance:'SIGNIFICANT',nextTest:['Replace component'],numericValidation:{currentMinMaxConsistency:'PASS'},freshResultVerification:'PASS'};
  const failed=context.gate(graph),ltft=failed.finalCanonicalPidEvidence[0];assert.equal(failed.finalRenderValidationStatus,'FAIL');assert.equal(failed.freshResultVerification,'PASS');assert.deepEqual(Array.from(failed.finalCanonicalPidEvidence,row=>row.invariantResult),['FAIL','PASS','PASS','PASS','PASS']);assert.equal(ltft.currentNumeric,6.249);assert.equal(ltft.currentText,'+6.249%');assert.equal(ltft.maxText,'+5.467%');assert.equal(ltft.invariantFailureReason,'Current exceeds Max.');assert.strictEqual(failed.renderedPidEvidence,failed.finalCanonicalPidEvidence);assert.ok(Object.isFrozen(failed.renderedPidEvidence)&&failed.renderedPidEvidence.every(Object.isFrozen));assert.match(failed.interpretation.join(' '),/Long FT #1 displays Current \+6\.249%, Min -6\.249%, and Max \+5\.467%/);assert.doesNotMatch(failed.traceFindings.join(' '),/Long FT|LTFT/i);assert.match(failed.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.equal(failed.numericValidation.authoritativeSource,'SHARED_IMMUTABLE_RENDERED_NUMERIC_TRIPLET');assert.equal(failed.renderedInvariantLog[0].finiteNumberValidation,'PASS');
  for(const [current,minimum,maximum,expected] of [[-6.249,-6.249,-5.467,'PASS'],[1.563,-2.342,1.563,'PASS'],[1,1,1,'PASS'],[1,5,-5,'FAIL'],[-6,-5,5,'FAIL'],[6,-5,5,'FAIL']]){const result=context.gate({numericEvidence:[row('Long FT #1',current,minimum,maximum,'%')],numericValidation:{},freshResultVerification:'PASS',interpretation:[],traceFindings:[]});assert.equal(result.finalCanonicalPidEvidence[0].invariantResult,expected,`${minimum} <= ${current} <= ${maximum}`)}
});

test('10.12.42 follows final displayed rounding and sign values',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const row=(current,minimum,maximum)=>({pidName:'Long FT #1',current,minimum,maximum,unit:'%',currentPresent:true,minimumPresent:true,maximumPresent:true});
  const roundedPass=context.gate({numericEvidence:[row(1.00049,1.0004,1.00048)],interpretation:[],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'});assert.equal(roundedPass.renderedPidEvidence[0].currentText,'+1.000%');assert.equal(roundedPass.finalRenderValidationStatus,'PASS');
  const roundedFail=context.gate({numericEvidence:[row(1.00051,1.00049,1.0005)],interpretation:['Long FT #1 is rising.'],traceFindings:['Long FT #1 rises over time.'],numericValidation:{},freshResultVerification:'PASS'});assert.equal(roundedFail.renderedPidEvidence[0].currentText,'+1.001%');assert.equal(roundedFail.renderedPidEvidence[0].maxText,'+1.000%');assert.equal(roundedFail.finalRenderValidationStatus,'FAIL');assert.deepEqual(Array.from(roundedFail.traceFindings),[]);
  const signFailure=context.gate({numericEvidence:[row(-6,-5,-4)],interpretation:[],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'});assert.equal(signFailure.renderedPidEvidence[0].currentText,'-6.000%');assert.equal(signFailure.renderedPidEvidence[0].currentNumeric,-6);assert.equal(signFailure.finalRenderValidationStatus,'FAIL');
});

test('10.12.42 reproduces the live dual fuel-trim failure safely',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const row=(pidName,current,minimum,maximum)=>({pidName,current,minimum,maximum,unit:'%',currentPresent:true,minimumPresent:true,maximumPresent:true});
  const result=context.gate({numericEvidence:[row('Long FT #1',6.249,6.249,5.467),row('Short FT #1',1.563,2.342,1.563)],interpretation:['Long FT #1 is falling.','Short FT #1 is rising.'],traceFindings:['Long FT #1 drifts rich.','Short FT #1 switches lean.'],numericValidation:{},freshResultVerification:'PASS'});const text=result.interpretation.join(' ');
  assert.equal(result.finalRenderValidationStatus,'FAIL');assert.deepEqual(Array.from(result.renderedPidEvidence,row=>row.invariantResult),['FAIL','FAIL']);assert.equal(result.diagnosticSignificance,'INDETERMINATE');assert.match(text,/Long FT #1 displays Current \+6\.249%, Min \+6\.249%, and Max \+5\.467%/);assert.match(text,/Short FT #1 displays Current \+1\.563%, Min \+2\.342%, and Max \+1\.563%/);assert.doesNotMatch(result.traceFindings.join(' '),/rising|falling|rich|lean|stable|switching|recovering|drifting/i);assert.match(result.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.doesNotMatch(result.nextTest.join(' '),/reacquire/i);
});

test('10.12.42 final rendered parse-back covers invariants and unverifiable values',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  function finalizeRenderedNumericEvidence(',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.make=createRenderedNumericTriplet;this.assertRows=assertFinalRenderedPidEvidence;this.observed=finalObservedFromRenderedTriplets;`,context);const make=(current,minimum,maximum,unit='%')=>context.make({pidName:'PID',unit,current,minimum,maximum});const cases=[['live failure',6.249,-6.249,-5.467,'FAIL'],['fuel trim pass',.781,-2.342,1.563,'PASS'],['voltage pass',3.249,3.191,3.303,'PASS'],['rpm pass',905,899,994,'PASS'],['zero voltage pass',.055,0,.055,'PASS'],['equal',1,1,1,'PASS'],['below min',1,2,3,'FAIL'],['above max',4,1,3,'FAIL'],['reversed',2,3,1,'FAIL'],['missing current',null,2,7,'UNVERIFIABLE'],['missing min',6,null,7,'UNVERIFIABLE'],['missing max',6,5,null,'UNVERIFIABLE'],['NaN',NaN,5,7,'UNVERIFIABLE']];for(const [name,current,minimum,maximum,expected] of cases)assert.equal(make(current,minimum,maximum).invariantResult,expected,name);
  const positive=make('+6.249','+5.467','+7.030'),negative=make('-6.249','-7.030','-5.467'),voltage=make(.055,0,.1,'V'),rpm=make(905,899,994,'RPM');assert.equal(positive.currentNumeric,6.249);assert.equal(positive.currentText,'+6.249%');assert.equal(negative.currentText,'-6.249%');assert.equal(voltage.currentNumeric,.055);assert.equal(voltage.currentText,'+0.055V');assert.equal(rpm.currentNumeric,905);assert.equal(rpm.currentText,'905 RPM');assert.equal(make(0,0,0).currentText,'0.000%');
  const fallback=context.make({pidName:'Long FT #1',unit:'%',rawCurrent:'+6.249%',numericRange:{minimum:5.467,maximum:7.03}});assert.equal(fallback.currentText,'+6.249%');assert.equal(fallback.minText,'+5.467%');assert.equal(fallback.maxText,'+7.030%');assert.equal(fallback.invariantResult,'PASS');const assertion=context.assertRows(Object.freeze([fallback]));assert.strictEqual(assertion.renderedPidEvidence[0],fallback);const observed=context.observed(['Long FT #1 Current: stale','Plotted trace visible'],[fallback]);assert.deepEqual(Array.from(observed),['Plotted trace visible','Long FT #1 (%) — Min: +5.467%; Current: +6.249%; Max: +7.030%']);assert.equal(assertion.status,'PASS');assert.equal(context.assertRows([make(6,null,7)]).status,'INCOMPLETE');
});

test('10.12.42 renderer reasserts shared triplets before allowing PASS',()=>{
  assert.match(analyzer,/postRenderAssertion=assertFinalRenderedPidEvidence\(graph\.renderedPidEvidence\|\|graph\.finalCanonicalPidEvidence\|\|\[\]\)/);assert.match(analyzer,/numericFailure=postRenderAssertion\.status!=='PASS'/);assert.match(analyzer,/POST_RENDER_INVARIANT_BLOCKED_FALSE_PASS/);assert.match(analyzer,/Numeric Evidence Consistency: PASS/);
});

test('10.12.44 carries Engine Speed candidate audit into the rendered invariant developer log',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const candidateAudit={canonicalPid:'Engine Speed',rawEvidenceTokens:['Engine RPM Min 701 Current 2167 Max 3188'],candidates:[{role:'minimum',value:701,status:'ACCEPTED',reason:'PID_LOCAL_EXPLICIT_ROLE_BINDING'},{role:'current',value:2167,status:'ACCEPTED',reason:'PID_LOCAL_EXPLICIT_ROLE_BINDING'},{role:'maximum',value:3188,status:'ACCEPTED',reason:'PID_LOCAL_EXPLICIT_ROLE_BINDING'}]},result=context.gate({numericEvidence:[{pidName:'Engine Speed',unit:'RPM',current:2167,minimum:701,maximum:3188,candidateAudit,rejectedCandidates:[]}],interpretation:[],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'}),log=result.renderedInvariantLog[0];assert.equal(log.pidName,'Engine Speed');assert.deepEqual(Array.from(log.rawEvidenceTokens),candidateAudit.rawEvidenceTokens);assert.equal(log.candidateAudit.canonicalPid,'Engine Speed');assert.deepEqual([log.boundMin,log.boundCurrent,log.boundMax],[701,2167,3188]);assert.deepEqual([log.minText,log.currentText,log.maxText],['701 RPM','2167 RPM','3188 RPM']);assert.equal(log.renderedInvariant,'PASS');
});

test('10.12.45 classifies authoritative Engine Speed triplets and suppresses duplicate rendering',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;this.observed=finalObservedFromRenderedTriplets;`,context);const source=(pidName,current,minimum,maximum,sourceField)=>({pidName,unit:'RPM',current,minimum,maximum,sourceField}),run=(current,minimum,maximum)=>context.gate({numericEvidence:[source('Engine Speed',current,minimum,maximum,'TEST')],observed:[],interpretation:['Engine Speed dependent conclusion.','Camshaft evidence remains valid.'],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'});const valid=run(2167,742,2241),above=run(2167,700,1800),below=run(500,700,2200),reversed=run(1500,2200,700),incomplete=run(2167,null,null);assert.equal(valid.finalCanonicalPidEvidence.length,1);assert.equal(valid.finalCanonicalPidEvidence[0].evidenceState,'COMPLETE_VALID');assert.equal(valid.finalRenderValidationStatus,'PASS');assert.deepEqual([valid.finalCanonicalPidEvidence[0].minText,valid.finalCanonicalPidEvidence[0].currentText,valid.finalCanonicalPidEvidence[0].maxText],['742 RPM','2167 RPM','2241 RPM']);for(const result of [above,below,reversed]){assert.equal(result.finalCanonicalPidEvidence[0].evidenceState,'INCONSISTENT');assert.equal(result.finalRenderValidationStatus,'FAIL');assert.equal(result.diagnosticSignificance,'INDETERMINATE')}assert.equal(incomplete.finalCanonicalPidEvidence[0].evidenceState,'INCOMPLETE');assert.equal(incomplete.finalRenderValidationStatus,'INCOMPLETE');assert.equal(incomplete.diagnosticSignificance,'INDETERMINATE');assert.doesNotMatch(incomplete.interpretation.join(' '),/internally inconsistent/i);assert.match(incomplete.interpretation.join(' '),/numeric evidence is incomplete/i);const reconciled=context.gate({numericEvidence:[source('Engine Speed',2167,null,null,'OCR_CURRENT'),source('Engine RPM',null,742,2241,'GRAPH_STATISTICS')],observed:['Engine Speed (RPM): 2167','Camshaft Adjustment Actual Value: 4.2 degrees'],interpretation:[],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'});assert.equal(reconciled.finalCanonicalPidEvidence.length,1);const rpm=reconciled.finalCanonicalPidEvidence[0];assert.deepEqual([rpm.currentNumeric,rpm.minNumeric,rpm.maxNumeric],[2167,742,2241]);assert.equal(rpm.evidenceState,'COMPLETE_VALID');assert.equal(rpm.sourceMetadata.candidateAudit.duplicateCanonicalRecordsRemoved,1);assert.equal(reconciled.renderedInvariantLog[0].duplicateCanonicalRecordsRemoved,1);const observed=context.observed(reconciled.observed,reconciled.renderedPidEvidence);assert.equal(observed.filter(item=>/Engine Speed/i.test(item)).length,1);assert.match(observed[0],/Camshaft Adjustment/);assert.match(observed[1],/Min: 742 RPM; Current: 2167 RPM; Max: 2241 RPM/);assert.equal(rpm.currentNumeric,context.gate({numericEvidence:[source('RPM',2167,742,2241,'EXACT_RENDER')],observed:[],interpretation:[],traceFindings:[],numericValidation:{},freshResultVerification:'PASS'}).finalCanonicalPidEvidence[0].parsedCurrent);
});

test('10.12.46 keeps fresh provenance independent from rendered numeric evidence state',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const source=(current,minimum,maximum)=>({pidName:'Engine Speed',unit:'RPM',current,minimum,maximum,sourceField:'CURRENT_IMAGE_EVIDENCE'}),run=(current,minimum,maximum)=>context.gate({numericEvidence:[source(current,minimum,maximum)],observed:[],interpretation:[],traceFindings:[],numericValidation:{},semanticConsistencyStatus:'PASS',freshResultVerification:'PASS'});const complete=run(2167,742,2241),incomplete=run(2167,null,null),inconsistent=run(2167,700,1800);assert.deepEqual([complete.freshResultVerification,incomplete.freshResultVerification,inconsistent.freshResultVerification],['PASS','PASS','PASS']);assert.deepEqual([complete.evidenceResultVerification,incomplete.evidenceResultVerification,inconsistent.evidenceResultVerification],['PASS','INCOMPLETE','FAIL']);assert.match(analyzer,/transaction ID does not match the current semantic request/);assert.match(analyzer,/image hash does not match the current image/);assert.match(analyzer,/freshResultProvenance:Object\.freeze\(\{status:'PASS',runId:run\.runId,semanticRequestId:run\.analyzer\.requestId,imageHash:run\.imageHash/);assert.doesNotMatch(analyzer,/freshResultVerification:failed\.length\?'FAIL'/);assert.match(analyzer,/freshResultVerification:fresh\?'PASS':'FAIL',evidenceResultVerification:evidenceVerified\?'PASS':graph\.finalRenderValidationStatus/);
});

test('10.12.49 keeps an incomplete Engine Speed limitation separate from the selected Closed Loop rationale',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const result=context.gate({numericEvidence:[{pidName:'Engine Speed',unit:'RPM',current:2167,minimum:null,maximum:null}],evidenceInventory:{channels:['Engine Speed','Long FT #1','Short FT #1']},observed:[],interpretation:[],traceFindings:[],numericValidation:{},semanticConsistencyStatus:'PASS',freshResultVerification:'PASS'}),rpm=result.finalCanonicalPidEvidence[0];assert.deepEqual([rpm.currentNumeric,rpm.minNumeric,rpm.maxNumeric],[2167,null,null]);assert.equal(rpm.evidenceState,'INCOMPLETE');assert.match(result.nextTest[0],/Fuel System Status \/ Closed Loop Status/);assert.match(result.nextTestReason,/Fuel System Status is not available/);assert.doesNotMatch(result.nextTestReason,/Engine Speed|Min|Max/i);assert.equal(result.nextTestRationaleAligned,true);assert.equal(result.nextTestSelection,'PASS');assert.match(result.selectedNextTest.diagnosticObjective,/fuel-control state/i);assert.deepEqual(Array.from(result.selectedNextTest.evidenceMissing),['Fuel System Status / Closed Loop state']);assert.match(result.interpretation.join(' '),/Engine Speed numeric evidence is incomplete/i);assert.match(analyzer,/nextTestRationaleAligned/);assert.match(analyzer,/nitrosNextTestRationaleAlignment/);
});

test('10.12.49 targets only inconsistent PID triplets and rejects stale recovery generations',()=>{
  const start=analyzer.indexOf('  function canonicalSourceNumber('),end=analyzer.indexOf('  window.NitrosValidateFinalRenderedPid=',start),context={};vm.runInNewContext(`${analyzer.slice(start,end)};this.gate=finalizeRenderedNumericEvidence;`,context);const row=(pidName,current,minimum,maximum,unit)=>({pidName,current,minimum,maximum,unit,sourceField:'INITIAL_CURRENT_IMAGE'}),base={numericEvidence:[row('Long FT #1',6.249,-6.249,5.467,'%'),row('Short FT #1',.781,-2.342,1.563,'%'),row('O2S B1S2',.055,0,.055,'V'),row('AFS B1S1',3.249,3.191,3.303,'V'),row('Engine Speed',905,899,994,'RPM')],observed:[],interpretation:[],traceFindings:[],numericValidation:{},semanticConsistencyStatus:'FAIL_NUMERIC_EVIDENCE',freshResultVerification:'PASS',semanticRequestId:'generation-47',imageHash:'hash-47'},recovery={pidName:'Long FT #1',current:-6.249,minimum:-6.249,maximum:-5.467,unit:'%',visibleEvidence:['Long FT #1 visible row'],status:'RECOVERED',semanticRequestId:'generation-47',imageHash:'hash-47',generationId:'generation-47'},recovered=context.gate({...base,targetedPidRecovery:[recovery]}),engine=recovered.finalCanonicalPidEvidence.find(item=>item.pidName==='Engine Speed'),ltft=recovered.finalCanonicalPidEvidence.find(item=>item.pidName==='Long FT #1');assert.deepEqual([engine.currentNumeric,engine.minNumeric,engine.maxNumeric],[905,899,994]);assert.deepEqual([ltft.currentNumeric,ltft.minNumeric,ltft.maxNumeric],[-6.249,-6.249,-5.467]);assert.equal(ltft.evidenceState,'COMPLETE_VALID');assert.equal(recovered.targetedRecoveryLog.find(item=>item.pidName==='Long FT #1').recoveryAttempted,'YES');assert.equal(recovered.targetedRecoveryLog.find(item=>item.pidName==='Engine Speed').recoveryAttempted,'NO');const stale=context.gate({...base,targetedPidRecovery:[{...recovery,generationId:'old-generation'}]}),staleLtft=stale.finalCanonicalPidEvidence.find(item=>item.pidName==='Long FT #1');assert.deepEqual([staleLtft.currentNumeric,staleLtft.minNumeric,staleLtft.maxNumeric],[6.249,-6.249,5.467]);assert.equal(staleLtft.evidenceState,'INCONSISTENT');assert.equal(stale.targetedRecoveryLog.find(item=>item.pidName==='Long FT #1').recoveryIdentityStatus,'REJECTED_OR_UNAVAILABLE');const stillInvalid=context.gate({...base,targetedPidRecovery:[{...recovery,current:6.249,maximum:5.467}]}),invalidLtft=stillInvalid.finalCanonicalPidEvidence.find(item=>item.pidName==='Long FT #1');assert.equal(invalidLtft.evidenceState,'INCONSISTENT');assert.equal(stillInvalid.freshResultVerification,'PASS');
});

test('10.12.28 preserves supported semantic response shapes and one transient unusable-result retry',()=>{
  for(const shape of ['semanticResult','structured_output','output_parsed','output[]','content[]','JSON text','unsupported'])assert.ok(analyzer.includes(shape),`missing response shape ${shape}`);
  for(const failure of ['transport_failure','endpoint_failure','openai_request_failure','empty_model_response','malformed_semantic_response','unsupported_response_shape','valid_response_no_usable_visual_evidence'])assert.ok(analyzer.includes(failure),`missing failure class ${failure}`);
  assert.match(analyzer,/function normalizeSemanticAnalysisResponse\(payload\)/);
  assert.match(analyzer,/window\.NitrosNormalizeSemanticAnalysisResponse=normalizeSemanticAnalysisResponse/);
  assert.match(analyzer,/for\(let analysisAttempt=1;analysisAttempt<=2;analysisAttempt\+=1\)/);
  assert.match(analyzer,/analysisAttempt===2\)run\.analyzer\.retryStatus='PASS'/);assert.match(analyzer,/retryStatus='RUNNING'/);
  assert.match(analyzer,/retryable:failureClass==='malformed_semantic_response'/);
  assert.match(analyzer,/valid_response_no_usable_visual_evidence[\s\S]+retryable:false/);
  assert.match(analyzer,/CURRENT_REQUEST_MISMATCH/);assert.match(analyzer,/CURRENT_IMAGE_MISMATCH/);assert.match(analyzer,/CURRENT_ATTEMPT_MISMATCH/);
  for(const stage of ['Semantic response shape normalized','Semantic objects received','Semantic analysis retry','Fresh-result verification'])assert.ok(analyzer.includes(stage),`missing stage ${stage}`);
  assert.match(analyzer,/topLevelKeys:payload&&typeof payload==='object'&&!Array\.isArray\(payload\)\?Object\.keys\(payload\)\.sort\(\):\[\]/);
  assert.match(analyzer,/Semantic failure class:/);assert.match(analyzer,/Response shape:/);
  for(const field of ['rawResponseType','semanticPayloadLocated','semanticPayloadParsed','canonicalNormalizationSuccessful','semanticObjectCount'])assert.ok(analyzer.includes(field),`missing normalization diagnostic ${field}`);
});

test('analysis payload preserves original evidence bytes with optional active-RO context', () => {
  assert.match(analyzer, /Automotive photographs are evidence/);
  assert.match(analyzer, /imageOrientation:'from-image'/);
  assert.doesNotMatch(analyzer, /canvas\.toBlob\([^;]+,'image\/jpeg',quality\)/);
  assert.match(analyzer, /MAX_SEMANTIC_REQUEST_BYTES=16\.5\*1024\*1024/);
  assert.match(analyzer, /run\.analysisBytes\.slice\(0\)/);
  assert.match(analyzer, /run\.bytes=sourceBuffer\.slice\(0\)/);
  assert.match(analyzer, /payloadImageCount:1/);
  assert.match(analyzer,/vehicleContext\?\{vehicleContext\}:\{\}/);
  assert.match(core, /gpt-5\.6-sol/);
  assert.match(core, /effort: 'max', mode: 'pro'/);
  assert.match(core, /DEEP_VISION_DETAIL = 'original'/);
  assert.ok((core.match(/type:\s*'input_image'/g)||[]).length >= 15);
  assert.ok((core.match(/image_url:/g)||[]).length >= 15);
  assert.match(core, /requiredFields = \['transactionId', 'imageHash', 'mimeType', 'imageBase64'\]/);
  assert.match(core,/nitros_vehicle_area_relationship/);
  assert.match(analyzer,/VEHICLE-AREA &amp; COMPONENT RELATIONSHIP/);
  for(const stage of ['Determining vehicle-area location…','Analyzing component relationships…','Generating photo-verification guidance…'])assert.ok(analyzer.includes(stage),`missing vehicle-area stage ${stage}`);
});

test('payload diagnostics and payload-specific failure are explicit', () => {
  for (const field of ['originalDimensions','originalImageBytes','analysisDimensions','analysisJpegQuality','encodedPayloadBytes','payloadImageCount','compressionStage']) assert.ok(analyzer.includes(field), `missing ${field}`);
  assert.match(analyzer, /TRANSPORT\/PAYLOAD FAILURE/);
  assert.match(analyzer, /Image could not be prepared for analysis\./);
  assert.match(analyzer, /Semantic classification:<\/strong> Not performed/);
});

test('semantic confidence is normalized once and exposed safely in Developer Mode', () => {
  assert.match(core, /export function normalizeSemanticConfidence\(rawConfidence\)/);
  assert.match(core, /if \(numeric <= 1\) numeric \*= 100/);
  assert.match(core, /rawConfidence: raw\.confidence \?\? null/);
  assert.match(core, /normalizedConfidence/);
  assert.doesNotMatch(analyzer, /Math\.round\(confidence\)/);
  assert.match(analyzer, /rawConfidence:raw\.rawConfidence\?\?null/);
  assert.match(analyzer, /result\.confidence===null\?'Not provided'/);
  assert.match(html, /id="nitrosRawConfidence"/);
  assert.match(html, /id="nitrosNormalizedConfidence"/);
  assert.match(analyzer, /fileInput\.onchange=.*handleFile\(selected\)/);
  assert.match(analyzer, /oliverImportCameraFile'\)\.onchange=.*handleFile\(selected\)/);
  assert.doesNotMatch(analyzer, /confidence\s*(?:\|\||\?\?)\s*(?:0\.01|1)\b/);
});

test('BF diagnostic imports require a visible explicit case-verification action',()=>{
  assert.match(analyzer,/publishImport\(\{kind:'image-analysis'.*analysis:routed/);
  assert.match(analyzer,/publishImport\(\{kind:'text-data'.*parsedData/);
  assert.match(analyzer,/publishImport\(\{kind:'pdf-attachment'.*fileSize/);
  assert.match(analyzer,/id="oliverUseVerifiedRepairInfo"[^>]*hidden>Use as Verified Repair Information/);
  assert.match(analyzer,/nitros:verify-repair-information/);
  assert.match(html,/addEventListener\('nitros:diagnostic-import'.*handleRepairInformationImport\(event\.detail\)/);
  assert.match(html,/addEventListener\('nitros:verify-repair-information'.*verifyPendingRepairInformation/);
  assert.match(html,/NitrosDiagnosticV10120=.*verifyRepairInformation:verifyPendingRepairInformation/);
});

test('specific component UI is automotive-gated, independently normalized, and hash-bound', () => {
  assert.match(core, /semanticResult\.category === 'AUTOMOTIVE_COMPONENT_OR_VEHICLE'/);
  assert.match(core, /Component confidence must be independent from category confidence/);
  assert.match(core, /status: 'FAILED'/);
  assert.match(analyzer, /category!=='AUTOMOTIVE_COMPONENT_OR_VEHICLE'\)return null/);
  assert.match(analyzer, /normalizedComponentConfidence/);
  assert.match(analyzer, /raw\.semanticRequestId!==run\.analyzer\.requestId\|\|raw\.imageHash!==run\.imageHash/);
  assert.match(core, /semanticRequestId: transactionId, imageHash/);
  assert.match(analyzer, /SPECIFIC COMPONENT IDENTIFICATION/);
  assert.match(analyzer, /Automotive category confirmed/);
  assert.match(analyzer, /Identifying specific component/);
  assert.match(analyzer, /Component result received/);
  assert.match(analyzer, /Component confidence normalized/);
  assert.match(html, /id="nitrosPrimaryComponent"/);
  assert.match(html, /id="nitrosComponentHashMatch"/);
});

test('drivetrain discrimination uses structured spatial and power-flow evidence', () => {
  for (const value of ['TRANSFER_CASE','DIFFERENTIAL','TRANSMISSION','TRANSAXLE','engineConnection','transmissionConnection','longitudinalShafts','lateralAxleOutputs','axleTubes','location','powerFlowRole','distinguishingFeaturesComplete','competingCandidate']) assert.ok(core.includes(value), `missing ${value}`);
  assert.match(core, /Math\.min\(84, normalizedConfidence\)/);
  assert.match(core, /perimeter bolts, under-vehicle location, or a nearby driveshaft alone are insufficient/);
  assert.match(core, /TRANSFER CASE evidence includes a separate gearbox directly attached to or behind the transmission/);
  assert.match(core, /TRANSAXLE evidence includes an integrated transmission\/final-drive assembly/);
  assert.match(core, /Primary drivetrain identification conflicts with the discrimination result/);
});

test('wiring diagrams are structurally gated and expose one-step guided test state', () => {
  assert.match(core, /'AUTOMOTIVE_WIRING_DIAGRAM'/);
  assert.match(core, /Automotive words or OCR text alone are insufficient/);
  assert.match(core, /Wiring diagram classification lacks structural schematic evidence/);
  assert.match(core, /VERIFY → TEST → ISOLATE → REPAIR → CONFIRM/);
  assert.match(core, /unsupported numeric specification/);
  assert.match(analyzer, /category==='AUTOMOTIVE_WIRING_DIAGRAM'/);
  assert.match(analyzer, /START GUIDED COMPONENT TEST/);
  assert.match(analyzer, /componentTestSession/);
  assert.match(analyzer, /evaluateGuidedResult\(step,measurement\)/);
  assert.match(analyzer, /completedTests\.push/);
  assert.match(analyzer, /Wiring diagram result does not match the current image request/);
  assert.match(html, /id="nitrosComponentTestSessionId"/);
});

test('V5 document screenshots keep their category and route through fresh repair-information extraction',()=>{
  assert.match(core,/semanticResult\.category === 'DOCUMENT_OR_TEXT_SCREENSHOT'/);
  assert.match(core,/documentRepairInformationSchema/);
  assert.match(core,/Do not reclassify the image/);
  assert.match(core,/Never manufacture, infer, complete, substitute, or supplement missing connector names, pins, terminals, wire colors, methods, specifications/);
  assert.match(analyzer,/result\.category==='DOCUMENT_OR_TEXT_SCREENSHOT'/);
  assert.match(analyzer,/result\.route='Document\/OCR'/);
  assert.doesNotMatch(analyzer,/No clean-room document\/OCR analyzer is configured/);
  assert.match(analyzer,/documentRepairInformation.*freshResultVerification/);
  assert.match(analyzer,/result\.isolationTests=\[\]/);
  for(const id of ['nitrosDocumentExtractionStatus','nitrosDocumentExtractedFields','nitrosDocumentMissingFields','nitrosDocumentDtcApplicability','nitrosDocumentFreshVerification','nitrosDocumentExtractionRunId','nitrosDocumentVerificationRunId','nitrosDocumentCanonicalCriterion','nitrosDocumentExtractionMissingFields','nitrosDocumentVerificationMissingFields','nitrosDocumentSynchronizationStatus'])assert.match(html,new RegExp(`id="${id}"`));
});

test('V6 document completion validates resolved applicability independently from visible DTC codes',()=>{
  assert.match(core,/\['APPLICABLE','NOT APPLICABLE','UNKNOWN \/ CANNOT DETERMINE'\]\.includes\(raw\.dtcApplicability\)/);
  assert.match(core,/\['DTC applicability',result\.dtcApplicability\]/);
  assert.doesNotMatch(core,/\['DTC applicability',result\.dtcs\.length\]/);
  assert.match(analyzer,/extraction\?\.extractionRunId===run\.runId/);
  assert.doesNotMatch(analyzer,/activeDtcMatch|resolvedApplicability/);
  assert.match(analyzer,/extractionStatus:complete\?'COMPLETE':'INCOMPLETE'/);
});

test('V7 document criterion requires current visible-text evidence in server and client validation',()=>{
  assert.match(core,/criterionEvidenceVisible=!!criterionEvidence/);
  assert.match(core,/criterionGrounded=criterionEvidenceVisible/);
  assert.match(core,/criterion:criterionGrounded\?claimedCriterion:''/);
  assert.match(core,/minimum:criterionGrounded&&Number\.isFinite/);
  assert.match(core,/If no criterion\/specification is visibly printed/);
  assert.match(analyzer,/criterionEvidenceVisible=!!criterionEvidence/);
  assert.match(analyzer,/criterionGrounded=criterionEvidenceVisible/);
  assert.match(analyzer,/criterion:criterionGrounded\?claimedCriterion:''/);
});

test('V8 canonical criterion aliases normalize once and synchronization is run-bound',()=>{
  for(const alias of ['criterion','criteria','specification','spec','expectedValue','expected_value','acceptableRange','acceptable_range'])assert.ok(analyzer.includes(`'${alias}'`),`missing criterion alias ${alias}`);
  assert.match(analyzer,/analysisRunId:run\.runId,extractionRunId:run\.runId/);
  assert.match(analyzer,/verificationRunId:run\.runId,synchronizationStatus:fresh\?'PASS':'FAIL'/);
  assert.match(html,/analysis\.runId===document\.extractionRunId&&document\.extractionRunId===document\.verificationRunId/);
  assert.match(html,/INTERNAL STATE MISMATCH: extraction reports no missing fields while verification reports/);
});

test('AO guided electrical testing does not verify a fault from one ambiguous reading', () => {
  assert.match(analyzer, /numeric!==null.*status:'INCONCLUSIVE'/);
  assert.match(analyzer, /That reading alone does not verify a fault/);
  assert.match(analyzer, /Fault not yet verified\. Additional circuit testing required/);
  assert.match(analyzer, /verificationSupported\(session,step\)/);
  assert.match(analyzer, /failed\.length>=2/);
  assert.match(analyzer, /confidenceState:'NOT TESTED'/);
  for (const state of ['NOT TESTED','TESTING','SUSPECTED','SUPPORTED BY TEST RESULTS','VERIFIED','PASSED']) assert.ok(analyzer.includes(state), `missing confidence state ${state}`);
});

test('AO guided tests capture exact conditions and a structured evidence log', () => {
  for (const field of ['testNumber','component','circuitPin','ignitionState','connectorState','meterMode','redLeadLocation','blackLeadLocation','technicianReading','expectedBehavior','interpretation','result','timestamp']) assert.ok(analyzer.includes(field), `missing evidence field ${field}`);
  assert.match(analyzer, /guided-test-confirm/);
  assert.match(analyzer, /Confirm the exact test conditions before the reading can be interpreted/);
  assert.match(analyzer, /Diagnostic evidence log/);
  assert.match(analyzer, /START GUIDED COMPONENT TEST/);
});

test('AO neutral circuit paths and electrical safety gates are enforced', () => {
  assert.match(core, /circuitPaths/);
  assert.match(core, /Circuit function not reliably confirmed from supplied diagram/);
  assert.match(core, /Do not label a two-wire resistive sensor as conventional power and ground/);
  assert.match(core, /attempts resistance or continuity testing without an explicit de-energized condition/);
  assert.match(analyzer, /TEST BLOCKED — INVALID TEST CONDITION/);
  assert.match(analyzer, /Circuit must be de-energized before resistance\/continuity testing/);
  assert.match(analyzer, /<strong>Circuit paths:<\/strong>/);
  assert.doesNotMatch(analyzer, /<strong>Power path:<\/strong>/);
  assert.doesNotMatch(analyzer, /<strong>Ground path:<\/strong>/);
});

test('AO wiring parser defensively normalizes legacy semantic field shapes', () => {
  assert.match(core, /export function normalizeWiringField/);
  assert.match(core, /\['path','steps','nodes','components','testPoints','connectors'\]/);
  assert.match(core, /normalizeWiringField\(raw\.powerPath\)/);
  assert.match(core, /normalizeWiringField\(raw\.groundPath\)/);
  assert.match(core, /normalizeWiringField\(raw\.controlPath \?\? raw\.signalPath\)/);
  assert.match(analyzer, /const powerPath=normalizeField\(raw\.powerPath\),groundPath=normalizeField\(raw\.groundPath\)/);
  assert.match(analyzer, /Normalized power path/);
  assert.match(analyzer, /Visible test points/);
  assert.doesNotMatch(analyzer, /stringArray\(raw\[field\],field\)/);
  assert.match(html, /version:'10\.13\.140'/);
});

test('VJ partial-readable wiring evidence retains reliable circuit data without inventing unreadable pins', () => {
  const nodes=normalizeWiringField([{component:'Camshaft Position Sensor',terminal:'',wire:'Signal circuit'},{component:'ECM',pin:null,description:'Visible destination; terminal unreadable'}]);
  assert.equal(nodes.length,2);
  assert.equal(nodes[0].component,'Camshaft Position Sensor');
  assert.equal(nodes[0].terminal,'');
  assert.equal(nodes[1].component,'ECM');
  assert.equal(nodes[1].terminal,'');
  assert.match(core,/one unreadable connector, pin, or wire designation must not erase otherwise reliable components or circuit paths/);
  assert.match(core,/while still returning other readable evidence and source confidence/);
});

test('VL completed diagnostics render repair-decision CTA and hard-block stale guided-test creation', () => {
  const completeBranch=analyzer.indexOf("if(window.NitrosDiagnosticV10120?.isComplete?.())"),testBranch=analyzer.indexOf("else if(diagram.status==='READY'&&diagram.testPlan.length)",completeBranch),sessionCreation=analyzer.indexOf('run.componentTestSession={',testBranch),clickRecheck=analyzer.indexOf("if(window.NitrosDiagnosticV10120?.isComplete?.())",testBranch);
  assert.ok(completeBranch>=0&&testBranch>completeBranch,'authoritative completion must be checked before the generic diagram test CTA');
  assert.match(analyzer,/button\.textContent='CONTINUE TO REPAIR DECISION'/);
  assert.match(analyzer,/continueToRepairDecision\?\.\(\)/);
  assert.ok(clickRecheck>testBranch&&clickRecheck<sessionCreation,'a stale rendered CTA must recheck completion before creating a guided-test session');
  assert.match(html,/isComplete:isDiagnosticComplete,continueToRepairDecision/);
  assert.match(analyzer,/Fresh-result verification/);
});

test('transport diagnostics cover lifecycle, timing, and categorized failures', () => {
  for (const category of ['CONFIGURATION_ERROR','NETWORK_ERROR','CORS_ERROR','HTTP_ERROR','TIMEOUT_ERROR','REQUEST_ABORTED','PAYLOAD_ERROR','RESPONSE_PARSE_ERROR','SEMANTIC_API_ERROR','UNKNOWN_TRANSPORT_ERROR']) {
    assert.ok(analyzer.includes(category), `missing ${category}`);
  }
  for (const field of ['requestId','stage','endpoint','method','payloadGenerated','encodedPayloadBytes','fetchStarted','responseReceived','httpStatus','httpStatusText','responseType','responseContentType','parseResult','imagePreparationMs','payloadEncodingMs','requestStartMs','responseReceivedMs','responseParsingMs','totalMs']) {
    assert.ok(analyzer.includes(field), `missing ${field}`);
  }
  assert.match(analyzer, /createSemanticDiagnostic\(mimeType\)/);
  assert.match(analyzer, /requestId:createId\('sem'\)/);
  assert.match(analyzer, /NO HTTP RESPONSE RECEIVED/);
  assert.match(analyzer, /SEMANTIC ANALYSIS FAILED/);
  assert.match(analyzer, /SEMANTIC_NETWORK_ERROR:/);
  assert.match(analyzer, /SEMANTIC_PARSE_ERROR:/);
  assert.match(analyzer, /SEMANTIC_RESULT_MISSING:/);
});

test('classification is gated by response, schema, request ID, and image hash', () => {
  for (const state of ['REQUEST_SENT','RESPONSE_RECEIVED','RESPONSE_HTTP_OK','RESPONSE_PARSED','SEMANTIC_CONTENT_FOUND','CLASSIFICATION_STARTED','CLASSIFICATION_COMPLETE']) {
    assert.ok(analyzer.includes(state), `missing ${state}`);
  }
  assert.match(analyzer, /runId:run\.analyzer\.requestId/);
  assert.match(analyzer, /raw\.transactionId!==run\.analyzer\.requestId/);
  assert.match(analyzer, /normalizedResponse\?\.transactionId===runId/);
  assert.match(analyzer, /normalizedResponse\?\.imageHash===imageHash/);
  assert.match(analyzer, /attemptMatches=diagnostic\.analysisAttempt===analysisAttempt/);
  assert.match(analyzer, /expectedSemanticFieldsPresent:true/);
  assert.match(analyzer, /pipeline:\{\.\.\.diagnostic\.pipeline,SEMANTIC_CONTENT_FOUND:'PASS'\}/);
});

test('visible stages reflect confirmed browser, Vercel, OpenAI, parse, and object evidence', () => {
  for (const label of ['Building semantic request','Contacting Vercel endpoint','Vercel endpoint response','OpenAI request','OpenAI response','Parsing semantic response','Semantic objects received','Classifying','Fresh-result verification','Complete']) {
    assert.ok(analyzer.includes(label), `missing ${label}`);
  }
  assert.match(analyzer, /if\(diag\.payloadGenerated\)set\(2,'PASS'\)/);
  assert.match(analyzer, /if\(diag\.responseReceived\)\{set\(3,'PASS'\);set\(4,'PASS'\)\}/);
  assert.match(analyzer, /if\(server\.openaiResponseReceived&&server\.openaiResponseOk\)set\(5,'PASS'\)/);
  assert.doesNotMatch(analyzer, /if\(server\.openaiRequestAttempted\)set\(5,'PASS'\)/);
  assert.match(analyzer, /if\(diag\.responseShapeNormalized\)set\(8,'PASS'\)/);
  assert.match(analyzer, /if\(diag\.semanticObjectCount>0&&diag\.responseShapeNormalized\)set\(9,'PASS'\)/);
});

test('CORS preflight explicitly allows the production request headers', () => {
  assert.match(endpoint, /Access-Control-Allow-Headers', 'Content-Type, Cache-Control'/);
  assert.doesNotMatch(endpoint, /Access-Control-Allow-Origin', '\*'/);
});

test('semantic transport has a bounded client timeout while preserving image-reset aborts', () => {
  assert.match(analyzer, /SEMANTIC_REQUEST_TIMEOUT_MS=290_000/);
  assert.match(analyzer, /new DOMException\('Semantic analysis timeout','TimeoutError'\)/);
  assert.match(analyzer, /signal\?\.addEventListener\('abort',forwardAbort,\{once:true\}\)/);
  assert.match(analyzer, /clearTimeout\(requestTimer\)/);
});

test('Vercel duration exceeds the bounded portal timeout for deep-vision completion', () => {
  const config=JSON.parse(vercelConfig);
  assert.equal(config.functions['api/semantic-image-analysis.mjs'].maxDuration,300);
  assert.match(analyzer,/SEMANTIC_REQUEST_TIMEOUT_MS=290_000/);
});

test('response diagnostics retain sanitized structure without semantic values', () => {
  for (const field of ['responseCharacters','responseBytes','responseOk','topLevelKeys','semanticResultKeys','missingSemanticPaths','responseId','responseTransactionId','responseImageHash']) {
    assert.ok(analyzer.includes(field), `missing ${field}`);
  }
  assert.match(analyzer, /RESPONSE_NOT_JSON/);
  assert.match(analyzer, /safeResponsePreview\(payload,responseText\)/);
  assert.match(analyzer, /semanticResultPresent:Boolean\(semantic\)/);
});

test('diagnostics redact credentials and limit response previews to safe structure', () => {
  assert.match(analyzer, /Bearer \[REDACTED\]/);
  assert.match(analyzer, /\[REDACTED_API_KEY\]/);
  assert.match(analyzer, /\[REDACTED_IMAGE_DATA\]/);
  assert.match(analyzer, /semanticResultKeys:semantic\?Object\.keys\(semantic\)\.sort\(\):\[\]/);
  assert.match(analyzer, /sanitizeDiagnosticText\(responseText,500\)/);
  assert.doesNotMatch(analyzer, /safe=\{[^}]*semanticResult:semantic/);
  assert.doesNotMatch(html, /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}/);
});

test('developer panel and preview remain contained on mobile', () => {
  assert.match(html, /SEMANTIC ANALYZER TRANSPORT DIAGNOSTIC/);
  assert.match(html, /id="nitrosSemanticTransportDiagnostic"/);
  assert.match(html, /white-space:pre-wrap/);
  assert.match(html, /overflow-x:hidden/);
  assert.match(html, /\.oliver-import-preview img\{height:auto;object-fit:contain\}/);
});

test('service worker keeps navigation network-first and refreshes only the graph-analysis static asset', () => {
  assert.match(serviceWorker, /if \(request\.method !== 'GET'\) return/);
  assert.match(serviceWorker, /if \(!isNavigation && !isAppShellHtml && !isVersionedStaticAsset\) return/);
  assert.match(serviceWorker, /fetch\(request, \{ cache: 'no-store' \}\)/);
  assert.match(serviceWorker, /caches\.match\(isVersionedStaticAsset \? request : APP_SHELL/);
});
