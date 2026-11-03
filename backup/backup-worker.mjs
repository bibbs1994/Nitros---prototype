import { createPackage, validatePackage, hash } from './backup-core.mjs';
self.onmessage = async event => {
  try {
    const { snapshot, source, envelope: supplied, includeEnvelope = true } = event.data;
    const envelope = supplied || await createPackage(snapshot, source);
    const { summary } = await validatePackage(envelope);
    const { localStorage, databases, binaries } = envelope.payload;
    const dataHash = await hash(JSON.stringify({ localStorage, databases, binaries }));
    self.postMessage({ ok: true, envelope: includeEnvelope ? envelope : undefined, summary, dataHash });
  } catch (error) { self.postMessage({ ok: false, error: error.message }); }
};
