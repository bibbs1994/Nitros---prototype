import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SupportTicketRepository } from '../support-ticket-repository.mjs';

test('support ticket repository persists, deduplicates local retries, and updates triage fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'nitros-support-ticket-'));
  try {
    const file = join(directory, 'tickets.json'), repository = new SupportTicketRepository(file);
    const created = await repository.create({ id: 'NT-20260823-0001', userNote: 'Need help with inspection.', workflowContext: { roId: 'RO-42', vehicle: '2020 Nitros Test Vehicle', vin: 'TESTVIN' }, screenContext: { screenId: 'inspection', screenName: 'Walk-Around Inspection' }, appVersion: '10.13.66' });
    assert.equal(created.created, true); assert.equal(created.ticket.status, 'Open'); assert.equal(created.ticket.repairOrderId, 'RO-42'); assert.equal(created.ticket.description, 'Need help with inspection.');
    const duplicate = await repository.create({ id: 'NT-20260823-0001', userNote: 'Retry' });
    assert.equal(duplicate.created, false); assert.equal((await repository.list()).length, 1);
    const updated = await repository.update(created.ticket.id, { status: 'In Progress', developerNotes: 'Reproducing.', fixDescription: 'Corrected handler.', resolutionNotes: 'Ready for verification.' });
    assert.equal(updated.status, 'In Progress'); assert.equal(updated.developerNotes, 'Reproducing.');
    const reloaded = new SupportTicketRepository(file);
    const persisted = await reloaded.get(created.ticket.id);
    assert.equal(persisted.fixDescription, 'Corrected handler.');
    assert.equal((await reloaded.update(created.ticket.id, { status: 'Fixed' })).status, 'Fixed');
    assert.equal((await reloaded.update(created.ticket.id, { status: 'Closed', developmentNotes: 'Closed from the dashboard.' })).status, 'Closed');
    assert.equal((await reloaded.get(created.ticket.id)).developerNotes, 'Closed from the dashboard.');
  } finally { await rm(directory, { recursive: true, force: true }); }
});
