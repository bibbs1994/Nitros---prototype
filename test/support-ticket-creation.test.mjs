import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const ticket=html.match(/<script id="nitros-support-ticket-service">([\s\S]*?)<\/script>/)?.[1]||'';
const guided=html.match(/<script id="nitros-guided-walkthrough-phase1">([\s\S]*?)<\/script>/)?.[1]||'';

test('Need help opens a dedicated support-choice panel instead of the normal Ask Oliver panel',()=>{
  for(const id of ['nitrosSupportTicket','nitrosSupportTicketChoice','nitrosSupportTicketHelp','nitrosSupportTicketReport','nitrosSupportTicketForm','nitrosSupportTicketCategory','nitrosSupportTicketNote','nitrosSupportTicketScreenshot','nitrosSupportTicketSummary','nitrosSupportTicketSend','nitrosSupportTicketCancel'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html,/Need Help \/ Report a Problem/);
  assert.match(html,/I need help using this screen/);
  assert.match(html,/Something isn't working \/ Report a bug/);
  assert.match(html,/Create Support Ticket/);
  assert.match(html,/What went wrong\?/);
  assert.match(ticket,/const KEY='nitros_support_tickets_v1'/);
  assert.match(ticket,/window\.NitrosSupportTickets=Object\.freeze\(\{storageKey:KEY,open,close,create,getTickets:read,buildSupportDiagnosticSnapshot:snapshot\}\)/);
  assert.match(guided,/function openSupportTicket\(\)/);
  assert.match(guided,/guidedWalkthroughHelpButton'\)\.addEventListener\('click',openSupportTicket\)/);
});

test('support tickets include persistent IDs, offline sync state, and a sanitized diagnostic snapshot',()=>{
  assert.match(ticket,/NT-\$\{day\}-\$\{String\(next\)\.padStart\(4,'0'\)\}/);
  for(const field of ['createdAt','createdAtLocal',"status:'OPEN'","syncState:navigator.onLine?'PENDING_SYNC':'LOCAL'",'screenContext','oliverContext','walkthroughContext','workflowContext','focusedElement','recentActions','recentErrors','deviceInfo','attachmentMetadata'])assert.ok(ticket.includes(field),field);
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
  assert.match(ticket,/Support ticket created successfully\. Ticket #\$\{ticket\.id\}/);
  assert.match(ticket,/screenshotAttachment:draft\.attachment/);
  assert.match(ticket,/function helpUsingScreen\(\)/);
  assert.match(ticket,/nitrosSupportTicketReport'\)\.addEventListener\('click',report\)/);
  assert.match(ticket,/currentStepId/);
  assert.match(ticket,/currentStepName/);
  assert.match(ticket,/previousRoute/);
  assert.doesNotMatch(ticket,/NitrosGuidedWalkthrough\.(?:start|resume|restart|exit)/);
});
