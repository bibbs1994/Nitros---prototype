import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=html.indexOf('    function parseDate(text)');
const endMarker='    window.NitrosAppointmentAssistant=Object.freeze({normalizeAppointmentTranscript,parseAppointmentRequest,mergePreparedAppointment,hydrateAppointmentDraft,verifyAppointmentHydration,appointmentDraftFromForm,commitAppointmentDraft,restoreAppointmentDraft,prepare:oliverParse});';
const end=html.indexOf(endMarker,start)+endMarker.length;
assert.ok(start>0&&end>start,'appointment assistant source must be extractable');
const assistantSource=html.slice(start,end);

function assistant(){
  const fields=new Map(),document={getElementById(id){if(!fields.has(id))fields.set(id,{value:'',textContent:'',className:'',scrollIntoView(){},focus(){}});return fields.get(id)}};
  class LocalDate extends Date{constructor(...args){super(...(args.length?args:[2026,7,12,10,0,0]))}}
  const storage=new Map(),localStorage={getItem(key){return storage.has(key)?storage.get(key):null},setItem(key,value){storage.set(key,String(value))},removeItem(key){storage.delete(key)}};
  const context={window:{},document,Date:LocalDate,console,localStorage,APPT_KEY:'nitros_v818_appointments',APPT_DRAFT_KEY:'nitros_oliver_appointment_draft_v1',isoDate(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`},el:id=>document.getElementById(id),blankAppointment(){for(const id of ['appointmentEditId','appointmentCustomer','appointmentPhone','appointmentVehicle','appointmentConcern','appointmentNotes'])document.getElementById(id).value='';document.getElementById('appointmentArrival').value='Drop-off';document.getElementById('appointmentStatus').value='Scheduled'},currentDraft(){return{}},showConflict(){return[]},blankFollowup(){},read(key,fallback=[]){try{return JSON.parse(localStorage.getItem(key)||JSON.stringify(fallback))}catch{return fallback}},setMsg(){},speak(){}};
  vm.createContext(context);vm.runInContext(assistantSource,context);return{api:context.window.NitrosAppointmentAssistant,fields,context};
}

test('10.12.23 exact dictated appointment parses and hydrates without saving',()=>{
  const {api,fields}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.');
  assert.deepEqual({customer:draft.customer,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,concern:draft.concern,phone:draft.phone},{customer:'Derek Lord',vehicle:'Jeep',date:'2026-08-13',time:'08:00',arrival:'Drop-off',concern:'EVAP code',phone:''});
  assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(api.verifyAppointmentHydration(draft),true);assert.equal(fields.get('appointmentCustomer').value,'Derek Lord');assert.equal(fields.get('appointmentPhone').value,'');assert.doesNotMatch(assistantSource,/write\(APPT_KEY/);
});

test('10.12.23 tomorrow phrasing and automotive speech normalization preserve missing phone',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an E V A P code.');
  assert.equal(draft.date,'2026-08-13');assert.equal(draft.time,'08:00');assert.equal(draft.customer,'Derek Lord');assert.equal(draft.vehicle,'Jeep');assert.equal(draft.concern,'EVAP code');assert.equal(draft.phone,'');assert.equal(draft.dropOffIntent,true);
});

test('10.12.23 conversational variants resolve to equivalent structured appointments',()=>{
  const {api}=assistant(),commands=["Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an EVAP code.","Schedule Derek Lord’s Jeep for tomorrow at eight for an EVAP code.","Derek Lord is dropping the Jeep off tomorrow at 8. It has an EVAP code.","Put Derek Lord down tomorrow morning at eight. He’s dropping off the Jeep for an EVAP code."];
  const compact=draft=>({customer:draft.customer,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,status:draft.status,concern:draft.concern,phone:draft.phone});const expected={customer:'Derek Lord',vehicle:'Jeep',date:'2026-08-13',time:'08:00',arrival:'Drop-off',status:'Scheduled',concern:'EVAP code',phone:''};for(const command of commands)assert.deepEqual(compact(api.parseAppointmentRequest(command)),expected,command);
});

test('10.12.23 verified structured draft commits and restores after form loss',()=>{
  const {api,fields,context}=assistant(),draft=api.parseAppointmentRequest('Derek Lord dropping off his Jeep tomorrow morning at 8 AM with an EVAP code.');assert.equal(api.hydrateAppointmentDraft(draft).ok,true);const commit=api.commitAppointmentDraft(draft);assert.equal(commit.ok,true);assert.match(context.localStorage.getItem('nitros_oliver_appointment_draft_v1'),/Derek Lord/);fields.get('appointmentCustomer').value='';fields.get('appointmentVehicle').value='';assert.equal(api.restoreAppointmentDraft().ok,true);assert.equal(fields.get('appointmentCustomer').value,'Derek Lord');assert.equal(fields.get('appointmentVehicle').value,'Jeep');assert.equal(fields.get('appointmentStatus').value,'Scheduled');
});

test('10.12.23 hydration failure is detectable and cannot verify success',()=>{
  const {api}=assistant(),draft=api.parseAppointmentRequest('Derek Lord is leaving his Jeep 8 AM Thursday morning for an EVA code.'),result=api.hydrateAppointmentDraft(draft,()=>{throw new Error('mock write failure')});
  assert.equal(result.ok,false);assert.match(result.error,/mock write failure/);assert.equal(api.verifyAppointmentHydration(draft),false);assert.match(html,/could not write it into the form\. Your original instruction is preserved/);assert.match(html,/formHydration:'FAILED'/);assert.match(html,/formHydration:'SUCCESS'[\s\S]+appointmentStateCommitResult:'SUCCESS'/);
});

test('10.12.23 exact live phone-adjacent customer and multi-field request is preserved atomically',()=>{
  const {api,fields}=assistant(),draft=api.parseAppointmentRequest('Derek Law 5086785432 dropping off Thursday at 8:00 am 2018 Jeep Wrangler with EVAP code also check all the fluids customer authorized EV repair also has smell coming from under the vehicle.');
  assert.deepEqual({customer:draft.customer,phone:draft.phone,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,concern:draft.concern,inspections:draft.inspections},{customer:'Derek Law',phone:'5086785432',vehicle:'2018 Jeep Wrangler',date:'2026-08-13',time:'08:00',arrival:'Drop-off',concern:'EVAP code',inspections:'All the fluids'});
  assert.equal(draft.notes,'customer authorized EV repair also has smell coming from under the vehicle');
  assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(api.verifyAppointmentHydration(draft),true);assert.equal(fields.get('appointmentCustomer').value,'Derek Law');assert.equal(fields.get('appointmentInspections').value,'All the fluids');assert.match(fields.get('appointmentNotes').value,/customer authorized EV repair.*smell coming from under the vehicle/i);
});

test('10.12.23 all live customer-name variants retain Derek Law independently of phone format',()=>{
  const {api}=assistant(),commands=[
    'Derek Law 5086785432 dropping off his Jeep Thursday at 8 for an EVAP code.',
    'Derek Law, phone 508-678-5432, is dropping off a 2018 Jeep Wrangler Thursday morning at eight with an EVAP code.',
    'Schedule Derek Law for Thursday at 8 AM. Phone number 5086785432. It’s a 2018 Jeep Wrangler with an EVAP code.',
    'Derek Law is dropping the Jeep off Thursday at eight. His number is 5086785432. Check an EVAP code and all the fluids.'
  ];
  for(const command of commands){const draft=api.parseAppointmentRequest(command);assert.equal(draft.customer,'Derek Law',command);assert.equal(draft.phone,'5086785432',command);assert.equal(draft.date,'2026-08-13',command);assert.equal(draft.time,'08:00',command);assert.equal(draft.arrival,'Drop-off',command);assert.equal(draft.concern,'EVAP code',command)}
  assert.equal(api.parseAppointmentRequest(commands[3]).inspections,'All the fluids');
});

test('10.12.23 phone-adjacent name forms remain separate entities',()=>{
  const {api}=assistant(),commands=['Derek Law 5086785432 dropping off his Jeep Thursday at 8 for an EVAP code.','Derek Law, 508-678-5432 dropping off his Jeep Thursday at 8 for an EVAP code.','Derek Law phone number 5086785432 dropping off his Jeep Thursday at 8 for an EVAP code.','This is Derek Law, number 5086785432 dropping off his Jeep Thursday at 8 for an EVAP code.','Put Derek Law down, 5086785432 for Thursday at 8 AM with an EVAP code.'];
  for(const command of commands){const draft=api.parseAppointmentRequest(command);assert.equal(draft.customer,'Derek Law',command);assert.equal(draft.phone,'5086785432',command)}
});

test('10.12.23 exact live semantic appointment routes every dedicated field without losing notes',()=>{
  const {api,fields}=assistant(),raw='Derek Lord, phone number 508-678-5432, is dropping off his 2018 Jeep Wrangler tomorrow, Thursday, at 8:00 AM for an EVAP code. Also check all the fluids and inspect a fuel smell coming from underneath the vehicle. Customer authorizes diagnostic testing up to 130 dollars. Keys will be left with the shop. Customer needs a ride home. Confirm the appointment by text. If possible, have the vehicle completed by 2:00 PM.',draft=api.parseAppointmentRequest(raw);
  assert.deepEqual({customer:draft.customer,phone:draft.phone,vehicle:draft.vehicle,date:draft.date,time:draft.time,arrival:draft.arrival,status:draft.status,concern:draft.concern,inspections:draft.inspections,keys:draft.keys,transportation:draft.transportation,confirmationMethod:draft.confirmationMethod,promisedTime:draft.promisedTime},{customer:'Derek Lord',phone:'5086785432',vehicle:'2018 Jeep Wrangler',date:'2026-08-13',time:'08:00',arrival:'Drop-off',status:'Scheduled',concern:'EVAP code',inspections:'All the fluids',keys:'Keys received',transportation:'Needs transportation arranged',confirmationMethod:'Text message',promisedTime:'14:00'});
  assert.equal(draft.rawTranscript,raw);assert.match(draft.notes,/fuel smell coming from underneath the vehicle/i);assert.match(draft.notes,/130 dollars/i);assert.doesNotMatch(draft.notes,/keys will be left|needs a ride|confirm the appointment|completed by 2/i);
  assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(api.verifyAppointmentHydration(draft),true);assert.equal(fields.get('appointmentTime').value,'08:00');assert.equal(fields.get('appointmentPromisedTime').value,'14:00');assert.equal(fields.get('appointmentKeys').value,'Keys received');assert.equal(fields.get('appointmentTransportation').value,'Needs transportation arranged');assert.equal(fields.get('appointmentConfirmationMethod').value,'Text message');
});

test('10.12.23 automotive appointment context normalizes conservative EVAP speech variants',()=>{
  const {api}=assistant(),variants=['EV cold','EV app code','evap cold','EVAP coat','EV code'];
  for(const variant of variants){const raw=`Derek Lord dropping off his Jeep tomorrow at 8 AM for an ${variant}.`,draft=api.parseAppointmentRequest(raw);assert.equal(draft.concern,'EVAP code',variant);assert.equal(draft.rawTranscript,raw);assert.match(draft.normalizedTranscript,/EVAP code/);assert.ok(draft.normalizationsApplied.length>0)}
  assert.equal(api.normalizeAppointmentTranscript('The EV charging cable is in the trunk.'),'The EV charging cable is in the trunk.');
  for(const concern of ['EVAP leak','check engine light','misfire','brake noise','oil leak','coolant leak','no-start','crank-no-start','battery light','ABS light','airbag light','P0420','P0300','P0456'])assert.equal(api.parseAppointmentRequest(`Derek Lord dropping off his Jeep tomorrow at 8 AM for a ${concern}.`).concern,concern);
});

test('10.12.23 dedicated routing variants use existing appointment option values',()=>{
  const {api}=assistant(),base='Derek Lord dropping off his Jeep tomorrow at 8 AM for an EVAP code. ';
  assert.equal(api.parseAppointmentRequest(base+'Keys are in the drop box.').keys,'Key drop box');assert.equal(api.parseAppointmentRequest(base+'Customer has their own transportation.').transportation,'Customer has ride');assert.equal(api.parseAppointmentRequest(base+'Customer is waiting.').transportation,'Waiting at shop');assert.equal(api.parseAppointmentRequest(base+'Confirm by phone.').confirmationMethod,'Phone call');assert.equal(api.parseAppointmentRequest(base+'Confirm by email.').confirmationMethod,'Email');assert.equal(api.parseAppointmentRequest(base+'Customer needs vehicle by 2 PM.').promisedTime,'14:00');
});

test('10.12.23 prepare handler commits all four real form values and records before-after trace',()=>{
  const {api,fields,context}=assistant();context.document.getElementById('oliverScheduleInput').value='Derek Lord, phone number 508-678-5432, is dropping off his 2018 Jeep Wrangler tomorrow, Thursday, at 8:00 AM for an EVAP code. Also check all the fluids and inspect a fuel smell coming from underneath the vehicle. Customer authorizes diagnostic testing up to 130 dollars. Keys will be left with the shop. Customer needs a ride home. Confirm the appointment by text. If possible, have the vehicle completed by 2:00 PM.';api.prepare();
  assert.deepEqual({confirmation:fields.get('appointmentConfirmationMethod').value,promised:fields.get('appointmentPromisedTime').value,keys:fields.get('appointmentKeys').value,transportation:fields.get('appointmentTransportation').value,appointmentTime:fields.get('appointmentTime').value},{confirmation:'Text message',promised:'14:00',keys:'Keys received',transportation:'Needs transportation arranged',appointmentTime:'08:00'});
  const diag=context.window.NitrosDeveloperMode.appointmentAssistant;assert.equal(diag.confirmationMethodFormValue,'Text message');assert.equal(diag.confirmationMethodCommitResult,'SUCCESS');assert.equal(diag.promisedCompletionFormValue,'14:00');assert.equal(diag.promisedCompletionCommitResult,'SUCCESS');assert.equal(diag.keysAccessFormValue,'Keys received');assert.equal(diag.keysAccessCommitResult,'SUCCESS');assert.equal(diag.transportationFormValue,'Needs transportation arranged');assert.equal(diag.transportationCommitResult,'SUCCESS');assert.equal(diag.preparedAppointmentObject.promisedTime,'14:00');assert.equal(diag.finalAppointmentFormState.transportation,'Needs transportation arranged');assert.equal(diag.stateCommitResult,'SUCCESS');
});

test('manual appointment save and conflict workflow remain independently wired',()=>{
  assert.match(html,/function saveAppointment\(\)/);assert.match(html,/el\('saveAppointment'\)\?\.addEventListener\('click',saveAppointment\)/);assert.match(html,/el\('checkAppointmentConflict'\)\?\.addEventListener\('click',\(\)=>showConflict\(\)\)/);assert.match(html,/write\(APPT_KEY,\[\.\.\.list\.filter/);
});

test('10.12.25 two-field result preserves every known-good appointment property',()=>{
  const {api}=assistant(),raw='Derek Lord, phone number 508-678-5432, is dropping off his 2018 Jeep Wrangler tomorrow, Thursday, at 8:00 AM for an EVAP code. Also check all the fluids and inspect a fuel smell coming from underneath the vehicle. Customer authorizes diagnostic testing up to 130 dollars. Keys will be left with the shop. Customer needs a ride home. Confirm the appointment by text. If possible, have the vehicle completed by 2:00 PM.',draft=api.parseAppointmentRequest(raw);
  const protectedFields={phone:'5086785432',vehicle:'2018 Jeep Wrangler',date:'2026-08-13',time:'08:00',arrival:'Drop-off',status:'Scheduled',confirmationMethod:'Text message',keys:'Keys received',transportation:'Needs transportation arranged',concern:'EVAP code',inspections:'All the fluids'};
  for(const [key,value] of Object.entries(protectedFields))assert.equal(draft[key],value,key);
  assert.match(draft.notes,/130 dollars/i);assert.match(draft.notes,/fuel smell/i);assert.equal(draft.customer,'Derek Lord');assert.equal(draft.promisedTime,'14:00');
});

test('10.12.25 target isolation cases retain arrival/deadline distinction',()=>{
  const {api}=assistant();let draft=api.parseAppointmentRequest('Derek Lord, phone number 508-678-5432.');assert.equal(draft.customer,'Derek Lord');assert.equal(draft.phone,'5086785432');
  draft=api.parseAppointmentRequest('Derek Lord is dropping off tomorrow at 8 AM and needs the vehicle completed by 2 PM.');assert.equal(draft.customer,'Derek Lord');assert.equal(draft.time,'08:00');assert.equal(draft.promisedTime,'14:00');
  draft=api.parseAppointmentRequest('Derek Lord is dropping off at 2 PM.');assert.equal(draft.time,'14:00');assert.equal(draft.promisedTime,'');
});

test('10.12.26 phone commits regardless of formatting or fixed name placement',()=>{
  const {api,fields}=assistant();for(const phone of ['5082947538','508-294-7538','(508) 294-7538']){const draft=api.parseAppointmentRequest(`Derek Lord phone number ${phone} is dropping off his 2018 Jeep Wrangler tomorrow.`);assert.equal(draft.customer,'Derek Lord');assert.equal(draft.phone,'5082947538');assert.equal(draft.vehicle,'2018 Jeep Wrangler');assert.equal(api.hydrateAppointmentDraft(draft).ok,true);assert.equal(fields.get('appointmentPhone').value,'5082947538')}
});

test('10.12.26 completion-only language cannot populate appointment time',()=>{
  const {api}=assistant(),completionOnly=api.parseAppointmentRequest('Derek Lord is dropping off the Jeep tomorrow and promises to have it done by 2 PM.'),twoTimes=api.parseAppointmentRequest('Derek Lord is dropping off the Jeep tomorrow at 8 AM and needs it done by 2 PM.');
  assert.equal(completionOnly.customer,'Derek Lord');assert.equal(completionOnly.time,'');assert.equal(completionOnly.promisedTime,'14:00');assert.equal(twoTimes.time,'08:00');assert.equal(twoTimes.promisedTime,'14:00');
});

test('10.12.26 office keys and confirmation variants use existing enum values',()=>{
  const {api}=assistant();assert.equal(api.parseAppointmentRequest('Keys will be left at the office.').keys,'Keys received');assert.equal(api.parseAppointmentRequest('Call to confirm.').confirmationMethod,'Phone call');
});

test('10.12.26 routing diagnostics distinguish absent speech input from commit failure',()=>{
  const {api,context}=assistant();context.document.getElementById('oliverScheduleInput').value='Derek Lord phone number 5082947538 is dropping off his 2018 Jeep Wrangler tomorrow for an EV code. Keys will be left at the office.';api.prepare();const diag=context.window.NitrosDeveloperMode.appointmentAssistant;
  assert.equal(diag.routingTrace.phone.normalizedValue,'5082947538');assert.equal(diag.routingTrace.phone.commitSucceeded,true);assert.equal(diag.routingTrace.keysAccess.normalizedValue,'Keys received');assert.equal(diag.routingTrace.keysAccess.commitSucceeded,true);assert.equal(diag.routingTrace.confirmationMethod.resolution,'SPEECH_MISSING_INPUT');assert.equal(diag.routingTrace.transportation.resolution,'SPEECH_MISSING_INPUT');assert.equal(diag.routingTrace.additionalInspection.resolution,'SPEECH_MISSING_INPUT');assert.ok(diag.formStateBeforeMerge);assert.ok(diag.formStateAfterMerge);assert.equal(diag.speechCaptureStatus,'TYPED_INPUT');
});

test('10.12.26 preservation-safe merge adds promised time without erasing existing fields',()=>{
  const {api}=assistant(),existing={customer:'Derek Lord',phone:'5082947538',vehicle:'2018 Jeep Wrangler',date:'2026-08-13',time:'08:00',arrival:'Drop-off',status:'Scheduled',concern:'EVAP code',notes:'Authorization retained',confirmationMethod:'Text message',keys:'Keys received',transportation:'Needs transportation arranged',inspections:'All the fluids'},parsed=api.parseAppointmentRequest('Promise to have it done by 2 PM.'),merged=api.mergePreparedAppointment(existing,parsed);
  for(const [key,value] of Object.entries(existing))assert.equal(merged[key],value,key);assert.equal(merged.promisedTime,'14:00');
});
