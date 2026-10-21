/* One browser handoff per server job; an intentional reprint always uses a new operation key. */
'use strict';
class ReceptionPrintCoordinator {
  constructor(api) { this.api = api; this.pending = new Map(); }
  key(visit, pass) { return visit + ':' + pass; }
  clear() { this.pending.clear(); }
  async handoff(visitRequestId, expectedPassId, makeKey) {
    const key = this.key(visitRequestId, expectedPassId);
    let operation = this.pending.get(key);
    if (!operation) {
      operation = { clientKey: makeKey(), visitRequestId, expectedPassId, printerLabel: 'Reception browser' };
      this.pending.set(key, operation);
    }
    const job = await this.api('print/request', operation);
    const verify = current => {
      if (current.printJobId !== job.printJobId || current.visitRequestId !== visitRequestId || current.accessPassId !== expectedPassId) throw new Error('Print response changed. Refresh the pass before retrying.');
      return current;
    };
    let live = verify(await this.api('print/status', { printJobId: job.printJobId }));
    const completed = current => {
      if (current.status === 'DISPATCHED' || current.status === 'FAILED') {
        this.pending.delete(key);
        const error = new Error(current.status === 'DISPATCHED' ? 'This job was already handed off. Use Reprint if another copy is needed.' : 'This print job failed. Start a new print request.');
        error.dispatched = current.status === 'DISPATCHED';
        throw error;
      }
    };
    completed(live);
    try {
      const image = await this.api('print/render', { printJobId: job.printJobId });
      if (image.printJobId !== job.printJobId || image.status !== 'DISPATCHED' || !['image/svg+xml', 'image/png'].includes(image.mimeType) || typeof image.imageBase64 !== 'string') throw new Error('Print handoff could not be verified.');
      this.pending.delete(key);
      return image;
    } catch (error) {
      // A lost render response can hide a successful server dispatch. Never re-release that artifact.
      try { live = verify(await this.api('print/status', { printJobId: job.printJobId })); }
      catch { throw error; }
      completed(live);
      throw error;
    }
  }
}
globalThis.ReceptionPrintCoordinator = ReceptionPrintCoordinator;
