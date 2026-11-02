import type { NotificationBatch } from "./MailContracts.ts";
/** Separate channels share transport/configuration; one failing queue cannot starve the other. */
export class CombinedNotificationWorker {
  #channels: { channel: string; worker: NotificationBatch }[];
  constructor(channels: { channel: string; worker: NotificationBatch }[]) {
    if (
      !channels.length ||
      new Set(channels.map((c) => c.channel)).size !== channels.length
    )
      throw Error("INVALID_MAIL_CHANNELS");
    this.#channels = channels;
  }
  async runOnce() {
    const results: unknown[] = [];
    let failed = 0;
    for (const { channel, worker } of this.#channels) {
      try {
        const batch = await worker.runOnce();
        if (!Array.isArray(batch)) throw Error();
        results.push(...batch.map((result) => ({ channel, result })));
      } catch {
        failed++;
        results.push({ channel, status: "BATCH_UNAVAILABLE" });
      }
    }
    if (failed === this.#channels.length)
      throw Error("MAIL_CHANNELS_UNAVAILABLE");
    return results;
  }
}
