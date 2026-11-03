export function defaults(zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return { enabled: false, frequency: 'daily', time: '21:00', weekday: 0, timeZone: zone };
}
export function validateSettings(input) {
  if (!['daily', 'weekly'].includes(input.frequency) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.time) || !Number.isInteger(input.weekday) || input.weekday < 0 || input.weekday > 6) throw new Error('Invalid backup schedule');
  try { new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(); } catch { throw new Error('Use a valid IANA time zone, for example America/New_York'); }
  return { enabled: input.enabled === true, frequency: input.frequency, time: input.time, weekday: input.weekday, timeZone: input.timeZone };
}
export function localParts(now, zone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).map(p => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}
const shift = (date, days) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
// A calendar slot, not a claim that a closed browser will execute at that instant.
// One latest missed slot is caught up, not a burst of every missed day.
export function latestDue(settings, now = new Date()) {
  const s = validateSettings(settings); if (!s.enabled) return null;
  const local = localParts(now, s.timeZone);
  let date = local.time >= s.time ? local.date : shift(local.date, -1);
  if (s.frequency === 'weekly') { const day = new Date(date + 'T12:00:00Z').getUTCDay(); date = shift(date, -((day - s.weekday + 7) % 7)); }
  const slot = date + 'T' + s.time;
  if (settings.enabledAt) {
    const enabled = localParts(new Date(settings.enabledAt), s.timeZone);
    if (slot <= enabled.date + 'T' + enabled.time) return null;
  }
  return { id: `${s.frequency}|${s.weekday}|${s.timeZone}|${slot}`, localDate: date, localTime: s.time, timeZone: s.timeZone, catchUp: date !== local.date || local.time !== s.time };
}
