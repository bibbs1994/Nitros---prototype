import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function parseDate(text)');
const endMarker='    window.NitrosAppointmentAssistant=Object.freeze({normalizeAppointmentTranscript,parseAppointmentRequest,hydrateAppointmentDraft,verifyAppointmentHydration,prepare:oliverParse});';
const end=html.indexOf(endMarker,start)+endMarker.length;
assert.ok(start>0&&end>start,'appointment assistant source must be extractable');
const assistantSource=html.slice(start,end);

function assistant(){
  const fields=new Map(),document={getElementById(id){if(!fields.has(id))fields.set(id,{value:'',textContent:'',className:'',scrollIntoView(){},focus(){}});return fields.get(id)}};
  class LocalDate extends Date{constructor(...args){super(...(args.length?args:[2026,7,12,10,0,0]))}}
  const context={window:{},document,Date:LocalDate,console,localStorage:{getItem(){return null},setItem(){}},isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},el:id=>document.getElementById(id),blankAppointment(){for(const id of ['appointmentEditId','appointmentCustomer','appointmentPhone','appointmentVehicle','appointmentConcern','appointmentNotes'])document.getElementById(id).value='';document.getElementById('appointmentArrival').value='Drop-off'},currentDraft(){return{}},showConflict(){return[]},blankFollowup(){},read(){return[]},setMsg(){},speak(){}};
  vm.createContext(context);vm.runInContext(assistantSource,context);return{api:context.window.NitrosAppointmentAssistant,fields,context};
}

test('10.12.19 exact dictated appointment parses and hydrates without saving',()=>{
  const {api,fields}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.');
  assert.deepEqual({customer:draft.customer,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,concern:draft.concern,phone:draft.phone},{customer:'Derek Lord',vehicle:'Jeep',date:'2026-08-13',time:'08:00',arrival:'Drop-off',concern:'EVAP code',phone:''});
  assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(api.verifyAppointmentHydration(draft),true);assert.equal(fields.get('appointmentCustomer').value,'Derek Lord');assert.equal(fields.get('appointmentPhone').value,'');assert.doesNotMatch(assistantSource,/write\(APPT_KEY/);
});

test('10.12.19 tomorrow phrasing and automotive speech normalization preserve missing phone',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an E V A P code.');
  assert.equal(draft.date,'2026-08-13');assert.equal(draft.time,'08:00');assert.equal(draft.customer,'Derek Lord');assert.equal(draft.vehicle,'Jeep');assert.equal(draft.concern,'EVAP code');assert.equal(draft.phone,'');assert.equal(draft.dropOffIntent,true);
});

test('10.12.19 hydration failure is detectable and cannot verify success',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.'),result=api.hydrateAppointmentDraft(draft,()=>{throw new Error('mock write failure')});
  assert.equal(result.ok,false);assert.match(result.error,/mock write failure/);assert.equal(api.verifyAppointmentHydration(draft),false);assert.match(html,/could not write it into the form\. Your original instruction is preserved/);assert.match(html,/formHydration:'FAILED'/);assert.match(html,/formHydration:'SUCCESS'[\s\S]+draftReady:true/);
});

test('manual appointment save and conflict workflow remain independently wired',()=>{
  assert.match(html,/function saveAppointment\(\)/);assert.match(html,/el\('saveAppointment'\)\?\.addEventListener\('click',saveAppointment\)/);assert.match(html,/el\('checkAppointmentConflict'\)\?\.addEventListener\('click',\(\)=>showConflict\(\)\)/);assert.match(html,/write\(APPT_KEY,\[\.\.\.list\.filter/);
});
