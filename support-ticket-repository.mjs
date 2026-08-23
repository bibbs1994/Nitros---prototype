import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SUPPORT_TICKET_STATUSES = Object.freeze(['Open', 'In Progress', 'Fixed', 'Resolved']);
const MAX_TEXT = 20_000;
const text = value => typeof value === 'string' ? value.slice(0, MAX_TEXT) : value;
const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};

function normalizeStatus(value) {
  const legacy = { New: 'Open', OPEN: 'Open', Reviewing: 'In Progress', 'Fix In Progress': 'In Progress', 'Ready for Retest': 'Fixed', Closed: 'Resolved' };
  const status = legacy[value] || value || 'Open';
  if (!SUPPORT_TICKET_STATUSES.includes(status)) throw Object.assign(new Error('Ticket status is invalid.'), { statusCode: 400, code: 'INVALID_TICKET_STATUS' });
  return status;
}

export function normalizeSupportTicket(input, existing = null) {
  const raw = object(input), prior = existing || {};
  const workflow = object(raw.workflowContext || prior.workflowContext), screen = object(raw.screenContext || prior.screenContext);
  const identity = object(raw.user || prior.user), vehicle = object(raw.vehicle || prior.vehicle);
  const id = typeof prior.id === 'string' ? prior.id : (typeof raw.id === 'string' && /^NT-[A-Za-z0-9-]{4,120}$/.test(raw.id) ? raw.id : `ST-${randomUUID()}`);
  const createdAt = prior.createdAt || (typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString());
  const description = text(raw.description ?? raw.userNote ?? prior.description ?? prior.userNote ?? '');
  return {
    ...prior, ...raw,
    id,
    sourceLocalId: text(raw.sourceLocalId ?? raw.id ?? prior.sourceLocalId ?? ''),
    createdAt,
    updatedAt: new Date().toISOString(),
    status: normalizeStatus(raw.status ?? prior.status),
    userId: text(raw.userId ?? identity.id ?? prior.userId ?? ''),
    userName: text(raw.userName ?? identity.name ?? prior.userName ?? ''),
    repairOrderId: text(raw.repairOrderId ?? workflow.roId ?? prior.repairOrderId ?? ''),
    repairOrderNumber: text(raw.repairOrderNumber ?? workflow.roId ?? prior.repairOrderNumber ?? ''),
    customerName: text(raw.customerName ?? workflow.customerName ?? prior.customerName ?? ''),
    vehicleId: text(raw.vehicleId ?? workflow.vehicleId ?? prior.vehicleId ?? ''),
    vehicleYear: text(raw.vehicleYear ?? workflow.year ?? vehicle.year ?? prior.vehicleYear ?? ''),
    vehicleMake: text(raw.vehicleMake ?? workflow.make ?? vehicle.make ?? prior.vehicleMake ?? ''),
    vehicleModel: text(raw.vehicleModel ?? workflow.model ?? vehicle.model ?? prior.vehicleModel ?? ''),
    vin: text(raw.vin ?? workflow.vin ?? prior.vin ?? ''),
    screenId: text(raw.screenId ?? screen.screenId ?? prior.screenId ?? ''),
    screenName: text(raw.screenName ?? screen.screenName ?? prior.screenName ?? ''),
    walkthroughStep: text(raw.walkthroughStep ?? object(raw.walkthroughContext).currentStepName ?? prior.walkthroughStep ?? ''),
    description,
    capturedContext: object(raw.capturedContext || raw.snapshot || prior.capturedContext),
    appVersion: text(raw.appVersion ?? prior.appVersion ?? ''),
    developerNotes: text(raw.developerNotes ?? prior.developerNotes ?? ''),
    fixDescription: text(raw.fixDescription ?? prior.fixDescription ?? ''),
    resolutionNotes: text(raw.resolutionNotes ?? raw.resolutionNote ?? prior.resolutionNotes ?? prior.resolutionNote ?? '')
  };
}

export class SupportTicketRepository {
  constructor(filePath) { this.filePath = filePath; this.pending = Promise.resolve(); }
  async readAll() { try { const parsed = JSON.parse(await readFile(this.filePath, 'utf8')); return Array.isArray(parsed) ? parsed : []; } catch (error) { if (error.code === 'ENOENT') return []; throw error; } }
  async writeAll(tickets) { await mkdir(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; await writeFile(temporary, JSON.stringify(tickets, null, 2), 'utf8'); await rename(temporary, this.filePath); }
  serialize(work) { const next = this.pending.then(work, work); this.pending = next.catch(() => {}); return next; }
  async list() { return (await this.readAll()).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))); }
  async get(id) { return (await this.readAll()).find(ticket => ticket.id === id) || null; }
  async create(input) { return this.serialize(async () => { const tickets = await this.readAll(), sourceId = typeof input?.id === 'string' ? input.id : typeof input?.sourceLocalId === 'string' ? input.sourceLocalId : ''; const duplicate = sourceId && tickets.find(ticket => ticket.id === sourceId || ticket.sourceLocalId === sourceId); if (duplicate) return { ticket: duplicate, created: false }; const ticket = normalizeSupportTicket({ ...input, status: 'Open' }); tickets.push(ticket); await this.writeAll(tickets); return { ticket, created: true }; }); }
  async update(id, changes) { return this.serialize(async () => { const tickets = await this.readAll(), index = tickets.findIndex(ticket => ticket.id === id); if (index < 0) return null; tickets[index] = normalizeSupportTicket({ ...changes, id }, tickets[index]); await this.writeAll(tickets); return tickets[index]; }); }
}
