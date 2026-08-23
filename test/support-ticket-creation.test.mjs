import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ticket=html.match(/<script id="nitros-support-ticket-service">([\s\S]*?)<\/script>/)?.[1]||'';
const guided=html.match(/<script id="nitros-guided-walkthrough-phase1">([\s\S]*?)<\/script>/)?.[1]||'';
const inbox=html.match(/<script id="nitros-support-ticket-inbox">([\s\S]*?)<\/script>/)?.[1]||'';

test('Need help opens a dedicated support-choice panel instead of the normal Ask Oliver panel',()=>{
  for(const id of ['nitrosSupportTicket','nitrosSupportTicketChoice','nitrosSupportTicketHelp','nitrosSupportTicketReport','nitrosSupportTicketForm','nitrosSupportTicketCategory','nitrosSupportTicketNote','nitrosSupportTicketScreenshot','nitrosSupportTicketSummary','nitrosSupportTicketSend','nitrosSupportTicketCancel'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Need Help \/ Report a Problem/);
  assert.match(html,/I need help using this screen/);
  assert.match(html,/Something is not working \/ Report a bug/);
  assert.match(html,/Create Support Ticket/);
  assert.match(html,/What went wrong\?/);
  assert.match(ticket,/const KEY='nitros_support_tickets_v1'/);
  assert.match(ticket,/window\.NitrosSupportTickets=Object\.freeze\(\{storageKey:KEY,open,close,create,getTickets:read,syncPendingTickets,buildSupportDiagnosticSnapshot:snapshot\}\)/);
  assert.match(guided,/function openSupportTicket\(\)/);
  assert.match(guided,/guidedWalkthroughHelpButton'\)\.addEventListener\('click',openSupportTicket\)/);
  assert.doesNotThrow(()=>new Function(ticket),'support ticket service must parse and initialize');
  assert.match(ticket,/currentStepId:contextual\.currentStep\|\|source\.currentStep\|\|\(walk\?\.stepIndex\?\?''\)/);
  assert.match(guided,/const support=window\.NitrosSupportTickets;if\(typeof support\?\.open!=='function'\)/);
  assert.match(guided,/support\.open\(/);
});

test('support tickets include persistent IDs, an offline sync queue, and a sanitized diagnostic snapshot',()=>{
  assert.match(ticket,/nitros_support_ticket_device_v1/);
  assert.match(ticket,/NT-\$\{day\}-\$\{deviceId\(\)\}-\$\{String\(next\)\.padStart\(4,'0'\)\}/);
  for(const field of ['createdAt','createdAtLocal',"status:'New'","syncState:'PENDING_SYNC'","syncStatus:'PENDING_SYNC'",'serverTicketId','lastSyncAttemptAt','syncedAt','syncError','screenContext','oliverContext','walkthroughContext','workflowContext','focusedElement','recentActions','recentErrors','deviceInfo','attachmentMetadata'])assert.ok(ticket.includes(field),field);
  assert.match(ticket,/secret=\/password\|passcode\|token\|secret\|api\.\?key\|cookie\|card\|payment\|credential\/i/);
  assert.match(ticket,/screenshot:\{supported:false,status:'deferred',reason:/);
});

test('ticket creation is double-tap guarded and does not reset the walkthrough',()=>{
  assert.match(ticket,/if\(sending\|\|!draft\)return null/);
  assert.match(ticket,/nitrosSupportTicketSend'\)\.disabled=true/);
  assert.match(ticket,/Ticket could not be created\. Your work was not changed; please retry\./);
  assert.doesNotMatch(ticket,/NitrosGuidedWalkthrough\.exit/);
  assert.match(guided,/contextualMode,walkthrough:state/);
});

test('ticket service validates the description, persists category and attachment metadata, and keeps support independent',()=>{
  assert.match(ticket,/const userNote=\$\('nitrosSupportTicketNote'\)\.value\.trim\(\)/);
  assert.match(ticket,/Enter a short description of what went wrong before creating the ticket\./);
  assert.match(ticket,/category:\$\('nitrosSupportTicketCategory'\)\.value/);
  assert.match(ticket,/saved locally\. Delivering to support/);
  assert.match(ticket,/screenshotAttachment:draft\.attachment/);
  assert.match(ticket,/function helpUsingScreen\(\)/);
  assert.match(ticket,/nitrosSupportTicketReport'\)\.addEventListener\('click',report\)/);
  assert.match(ticket,/currentStepId/);
  assert.match(ticket,/currentStepName/);
  assert.match(ticket,/previousRoute/);
  assert.doesNotMatch(ticket,/NitrosGuidedWalkthrough\.(?:start|resume|restart|exit)/);
});

test('support-ticket delivery is local-first, retryable, bounded, and idempotent at the API boundary',()=>{
  assert.match(html,/name="nitros-support-ticket-endpoint"/);
  assert.match(html,/content="http:\/\/192\.168\.4\.24:8787\/api\/support-tickets"/);
  assert.match(ticket,/127\\\.0\\\.0\\\.1/);
  assert.match(ticket,/function syncTicket\(localId\)/);
  assert.match(ticket,/function syncPendingTickets\(\)/);
  assert.match(ticket,/sourceLocalId:ticket\.id/);
  assert.match(ticket,/new AbortController\(\)/);
  assert.match(ticket,/setTimeout\(\(\)=>controller\.abort\(\),4500\)/);
  assert.match(ticket,/syncStatus:'SYNCHRONIZED'/);
  assert.match(ticket,/Support server unavailable\. Ticket was not sent\. The app will retry when the server is available\./);
  assert.match(ticket,/window\.addEventListener\('online',\(\)=>void syncPendingTickets\(\)\)/);
  assert.match(ticket,/setTimeout\(\(\)=>void syncPendingTickets\(\),300\)/);
  assert.match(ticket,/saved and delivered to support/);
  assert.match(ticket,/saved locally and will retry automatically/);
  assert.match(ticket,/syncPayload=ticket=>/);
  for(const field of ['ticketId:ticket.id','submittedAt:ticket.createdAt','diagnosticSupportContext','browserDeviceInformation','recentSupportLogs','sourceLocalId:ticket.id'])assert.ok(ticket.includes(field),field);
  for(const message of ['ticket submission started','target API URL','server response status','returned ticket ID','ticket submission failure'])assert.ok(ticket.includes(message),message);
  assert.match(ticket,/Support server unavailable\. Ticket was not sent\./);
});

test('development support inbox uses the existing support-ticket records and preserves auditable triage updates',()=>{
  for(const id of ['nitrosSupportInboxButton','nitrosSupportInbox','nitrosSupportInboxSearch','nitrosSupportInboxFilter','nitrosSupportInboxList','nitrosSupportInboxDetail'])assert.match(html,new RegExp(`id="${id}"`));
  for(const id of ['nitrosSupportInboxDevelopmentNotes','nitrosSupportInboxResolutionNote'])assert.match(inbox,new RegExp(id));
  for(const status of ['New','Reviewing','Fix In Progress','Ready for Retest','Resolved','Closed'])assert.match(inbox,new RegExp(`['"]${status}['"]`));
  assert.match(inbox,/window\.NitrosSupportTickets\?\.storageKey\|\|'nitros_support_tickets_v1'/);
  assert.match(inbox,/userNote/);
  assert.match(inbox,/developmentNotes/);
  assert.match(inbox,/resolutionNote/);
  assert.match(ticket,/Ticket created/);
  assert.match(inbox,/Status changed/);
  assert.match(inbox,/Development note updated/);
  assert.match(inbox,/Resolution note updated/);
  assert.match(ticket,/status:'New'/);
  assert.match(ticket,/nitros:support-ticket-created/);
  assert.doesNotThrow(()=>new Function(inbox),'support inbox service must parse');
});
