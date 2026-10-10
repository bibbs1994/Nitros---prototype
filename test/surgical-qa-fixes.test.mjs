import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const between=(start,end)=>html.slice(html.indexOf(start),html.indexOf(end,html.indexOf(start)));
const vinListener=between("  $('vinInput')?.addEventListener('input'",'  // Make the complete repair-order card open');
const profileSource=between('  function applyPortalProfile(profile){','  function portalEscape');
const renderSource=between('  function renderValidationCenter(){','  function clearValidationHighlight');
const saveSource=between('document.getElementById("submitCheckin")?.addEventListener("click",async()=>{','  document.addEventListener("input",e=>');
function element(value=''){
  return {value,textContent:'',innerHTML:'',disabled:false,files:[],handlers:{},classList:{add(){},remove(){},toggle(){}},
    addEventListener(type,fn){this.handlers[type]=fn},setSelectionRange(start,end){this.selectionStart=start;this.selectionEnd=end},scrollIntoView(){}};
}

test('typed and pasted DEMO1–DEMO4 survive VIN normalization, while real VIN filtering stays strict',()=>{
  const input=element(),context=vm.createContext({$:()=>input});vm.runInContext(vinListener,context);
  for(const code of ['DEMO1','DEMO2','DEMO3','DEMO4']){
    input.value='';for(const ch of code.toLowerCase()){input.value+=ch;input.selectionStart=input.value.length;input.handlers.input({target:input})}
    assert.equal(input.value,code);
    input.value=code.toLowerCase();input.handlers.input({target:input});assert.equal(input.value,code);
  }
  input.value='1hgcm82633a004352';input.handlers.input({target:input});assert.equal(input.value,'1HGCM82633A004352');
  input.value='IOQ-1HGCM82633A0043529';input.handlers.input({target:input});assert.equal(input.value,'1HGCM82633A004352');
  for(const invalid of ['ABC','1234','DEMO5']){input.value=invalid;input.handlers.input({target:input});assert.ok(!/^DEMO[1-4]$/.test(input.value));assert.ok(input.value.length<17)}
});

test('session defaults populate blank fields and preserve deliberate assignments',()=>{
  const fields=new Map(['techHeader','techHeaderText','technicianName','assignedTechnician'].map(id=>[id,element()]));
  const context=vm.createContext({document:{getElementById:id=>fields.get(id)}});vm.runInContext(profileSource,context);
  context.applyPortalProfile({name:'bobby'});
  assert.equal(fields.get('technicianName').value,'bobby');assert.equal(fields.get('assignedTechnician').value,'bobby');
  fields.get('technicianName').value='alex';fields.get('assignedTechnician').value='sam';context.applyPortalProfile({name:'bobby'});
  assert.equal(fields.get('technicianName').value,'alex');assert.equal(fields.get('assignedTechnician').value,'sam');
  fields.get('assignedTechnician').value='';context.applyPortalProfile({name:'bobby'});assert.equal(fields.get('assignedTechnician').value,'alex');
});

function saveHarness(){
  const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,element());return fields.get(id)};
  const writes=[],history=[],context=vm.createContext({
    document:{getElementById:get,querySelectorAll:()=>[]},console:{error(){}},navigator:{onLine:true,userAgent:'test'},
    localStorage:{setItem:(key,value)=>writes.push([key,value]),removeItem(){}},
    inspectionSaveInProgress:false,lastSavedRecordId:null,editingCheckInId:null,selectedVehicle:{vin:'TEST'},activePhotoEvidence:{},jobClock:{timeline:[]},roadTestLocation:null,DRAFT_KEY:'draft',
    validationRequirements:()=>Array.from({length:20},()=>({section:'Customer Information',complete:()=>true})),escapeHtml:x=>x,
    persistActivePhotosToRecord:async()=>[],normalizeLicensePlateForSave:()=>'',calculateHealthScore:()=>100,signatureHasInk:()=>true,calculateEstimate:()=>({}),getActiveMilliseconds:()=>0,getPausedMilliseconds:()=>0,getLaborComparisonText:()=>'',getEfficiencyText:()=>'',portalProfile:()=>({name:'bobby'}),
    saveCustomerHistoryRecord:record=>{const i=history.findIndex(x=>x.checkInId===record.checkInId);if(i<0)history.push(record);else history[i]=record},syncCompletedCheckInToTechnicianDashboard:()=>({ro:'QA'}),refreshDraftPanel(){},setSaveStatus(){}
  });
  vm.runInContext(renderSource+'\n'+saveSource,context);
  return {context,get,writes,history,save:()=>get('submitCheckin').handlers.click()};
}

test('save guards concurrent clicks, retains completed state on re-render, and leaves print enabled',async()=>{
  const h=saveHarness();let release;h.context.persistActivePhotosToRecord=()=>new Promise(resolve=>release=resolve);
  const pending=h.save();assert.equal(h.get('submitCheckin').disabled,true);await h.save();assert.equal(h.writes.length,0);
  release([]);await pending;assert.equal(h.writes.length,1);assert.equal(h.history.length,1);
  assert.equal(h.get('submitCheckin').textContent,'✓ Inspection Report Saved');assert.equal(h.get('submitCheckin').disabled,true);assert.equal(h.get('printReport').disabled,false);
  h.context.renderValidationCenter();await h.save();assert.equal(h.writes.length,1);assert.equal(h.get('submitCheckin').disabled,true);
});

for(const failure of ['photos','storage','history','dashboard'])test(`failed ${failure} save remains retryable and never displays saved state`,async()=>{
  const h=saveHarness();let restore;
  if(failure==='photos'){restore=h.context.persistActivePhotosToRecord;h.context.persistActivePhotosToRecord=async()=>{throw Error('photo storage failed')}}
  if(failure==='storage'){restore=h.context.localStorage.setItem;h.context.localStorage.setItem=()=>{throw Error('storage full')}}
  if(failure==='history'){restore=h.context.saveCustomerHistoryRecord;h.context.saveCustomerHistoryRecord=()=>{throw Error('history storage full')}}
  if(failure==='dashboard'){restore=h.context.syncCompletedCheckInToTechnicianDashboard;h.context.syncCompletedCheckInToTechnicianDashboard=()=>{throw Error('dashboard storage full')}}
  await h.save();assert.equal(h.context.lastSavedRecordId,null);assert.equal(h.context.inspectionSaveInProgress,false);assert.equal(h.get('submitCheckin').disabled,false);assert.equal(h.get('submitCheckin').textContent,'Save Inspection Report');assert.equal(h.get('submitStatus').className,'status bad');
  if(failure==='photos')h.context.persistActivePhotosToRecord=restore;
  if(failure==='storage')h.context.localStorage.setItem=restore;
  if(failure==='history')h.context.saveCustomerHistoryRecord=restore;
  if(failure==='dashboard')h.context.syncCompletedCheckInToTechnicianDashboard=restore;
  await h.save();assert.equal(h.get('submitCheckin').textContent,'✓ Inspection Report Saved');
});

test('explicit reopen updates the saved record instead of creating another visit',async()=>{
  const h=saveHarness();await h.save();const id=h.context.lastSavedRecordId;h.context.editingCheckInId=id;
  h.context.renderValidationCenter();assert.equal(h.get('submitCheckin').disabled,false);await h.save();assert.equal(h.history.length,1);assert.equal(h.history[0].checkInId,id);assert.equal(h.get('submitCheckin').disabled,true);
});

test('incomplete wizard blocks report persistence',async()=>{
  const h=saveHarness();h.context.validationRequirements=()=>[{section:'Customer Information',complete:()=>false}];await h.save();assert.equal(h.writes.length,0);assert.equal(h.get('submitCheckin').disabled,true);
});
