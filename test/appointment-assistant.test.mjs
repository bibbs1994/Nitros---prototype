import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function parseDate(text)');
const endMarker='    window.NitrosAppointmentAssistant=Object.freeze({normalizeAppointmentTranscript,parseAppointmentRequest,hydrateAppointmentDraft,verifyAppointmentHydration,appointmentDraftFromForm,commitAppointmentDraft,restoreAppointmentDraft,prepare:oliverParse});';
const end=html.indexOf(endMarker,start)+endMarker.length;
assert.ok(start>0&&end>start,'appointment assistant source must be extractable');
const assistantSource=html.slice(start,end);

function assistant(){
  const fields=new Map(),document={getElementById(id){if(!fields.has(id))fields.set(id,{value:'',textContent:'',className:'',scrollIntoView(){},focus(){}});return fields.get(id)}};
  class LocalDate extends Date{constructor(...args){super(...(args.length?args:[2026,7,12,10,0,0]))}}
  const storage=new Map(),localStorage={getItem(key){return storage.has(key)?storage.get(key):null},setItem(key,value){storage.set(key,String(value))},removeItem(key){storage.delete(key)}};
  const context={window:{},document,Date:LocalDate,console,localStorage,APPT_DRAFT_KEY:'nitros_oliver_appointment_draft_v1',isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},el:id=>document.getElementById(id),blankAppointment(){for(const id of ['appointmentEditId','appointmentCustomer','appointmentPhone','appointmentVehicle','appointmentConcern','appointmentNotes'])document.getElementById(id).value='';document.getElementById('appointmentArrival').value='Drop-off';document.getElementById('appointmentStatus').value='Scheduled'},currentDraft(){return{}},showConflict(){return[]},blankFollowup(){},read(key,fallback=[]){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}},setMsg(){},speak(){}};
  vm.createContext(context);vm.runInContext(assistantSource,context);return{api:context.window.NitrosAppointmentAssistant,fields,context};
}

test('10.12.20 exact dictated appointment parses and hydrates without saving',()=>{
  const {api,fields}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.');
  assert.deepEqual({customer:draft.customer,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,concern:draft.concern,phone:draft.phone},{customer:'Derek Lord',vehicle:'Jeep',date:'2026-08-13',time:'08:00',arrival:'Drop-off',concern:'EVAP code',phone:''});
  assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(api.verifyAppointmentHydration(draft),true);assert.equal(fields.get('appointmentCustomer').value,'Derek Lord');assert.equal(fields.get('appointmentPhone').value,'');assert.doesNotMatch(assistantSource,/write\(APPT_KEY/);
});

test('10.12.20 tomorrow phrasing and automotive speech normalization preserve missing phone',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an E V A P code.');
  assert.equal(draft.date,'2026-08-13');assert.equal(draft.time,'08:00');assert.equal(draft.customer,'Derek Lord');assert.equal(draft.vehicle,'Jeep');assert.equal(draft.concern,'EVAP code');assert.equal(draft.phone,'');assert.equal(draft.dropOffIntent,true);
});

test('10.12.20 conversational variants resolve to equivalent structured appointments',()=>{
  const {api}=assistant(),commands=["Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an EVAP code.","Schedule Derek Lord’s Jeep for tomorrow at eight for an EVAP code.","Derek Lord is dropping the Jeep off tomorrow at 8. It has an EVAP code.","Put Derek Lord down tomorrow morning at eight. He’s dropping off the Jeep for an EVAP code."];
  const compact=draft=>({customer:draft.customer,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,status:draft.status,concern:draft.concern,phone:draft.phone});const expected={customer:'Derek Lord',vehicle:'Jeep',date:'2026-08-13',time:'08:00',arrival:'Drop-off',status:'Scheduled',concern:'EVAP code',phone:''};for(const command of commands)assert.deepEqual(compact(api.parseAppointmentRequest(command)),expected,command);
});

test('10.12.20 verified structured draft commits and restores after form loss',()=>{
  const {api,fields,context}=assistant(),draft=api.parseAppointmentRequest('Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an EVAP code.');assert.equal(api.hydrateAppointmentDraft(draft).ok,true);const commit=api.commitAppointmentDraft(draft);assert.equal(commit.ok,true);assert.match(context.localStorage.getItem('nitros_oliver_appointment_draft_v1'),/Derek Lord/);fields.get('appointmentCustomer').value='';fields.get('appointmentVehicle').value='';assert.equal(api.restoreAppointmentDraft().ok,true);assert.equal(fields.get('appointmentCustomer').value,'Derek Lord');assert.equal(fields.get('appointmentVehicle').value,'Jeep');assert.equal(fields.get('appointmentStatus').value,'Scheduled');
});

test('10.12.20 hydration failure is detectable and cannot verify success',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.'),result=api.hydrateAppointmentDraft(draft,()=>{throw new Error('mock write failure')});
  assert.equal(result.ok,false);assert.match(result.error,/mock write failure/);assert.equal(api.verifyAppointmentHydration(draft),false);assert.match(html,/could not write it into the form\. Your original instruction is preserved/);assert.match(html,/formHydration:'FAILED'/);assert.match(html,/formHydration:'SUCCESS'[\s\S]+appointmentStateCommitResult:'SUCCESS'/);
});

test('manual appointment save and conflict workflow remain independently wired',()=>{
  assert.match(html,/function saveAppointment\(\)/);assert.match(html,/el\('saveAppointment'\)\?\.addEventListener\('click',saveAppointment\)/);assert.match(html,/el\('checkAppointmentConflict'\)\?\.addEventListener\('click',\(\)=>showConflict\(\)\)/);assert.match(html,/write\(APPT_KEY,\[\.\.\.list\.filter/);
});
