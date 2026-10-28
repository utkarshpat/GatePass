type Job = {
  printJobId: string;
  visitRequestId: string;
  accessPassId: string;
  status: string;
};
export type PrintImage = Job & { mimeType: string; imageBase64: string };
type Request = <T>(
  action: string,
  body: unknown,
  current?: () => boolean,
) => Promise<T>;
/** Server print receipts retain their original operation across uncertain requests. */
export class PrintCoordinator {
  private pending = new Map<
    string,
    {
      clientKey: string;
      visitRequestId: string;
      expectedPassId: string;
      printerLabel: string;
    }
  >();
  constructor(private api: Request) {}
  clear() {
    this.pending.clear();
  }
  async handoff(visitRequestId: string, expectedPassId: string) {
    const key = visitRequestId + ":" + expectedPassId;
    let operation = this.pending.get(key);
    if (!operation) {
      operation = {
        clientKey: crypto.randomUUID(),
        visitRequestId,
        expectedPassId,
        printerLabel: "Reception browser",
      };
      this.pending.set(key, operation);
    }
    const job = await this.api<Job>("print/request", operation),
      verify = (current: Job) => {
        if (
          current.printJobId !== job.printJobId ||
          current.visitRequestId !== visitRequestId ||
          current.accessPassId !== expectedPassId
        )
          throw Error(
            "Print response changed. Refresh the pass before retrying.",
          );
        return current;
      },
      completed = (current: Job) => {
        if (current.status === "DISPATCHED" || current.status === "FAILED") {
          this.pending.delete(key);
          throw Object.assign(
            Error(
              current.status === "DISPATCHED"
                ? "This job was already handed off. Use Reprint if another copy is needed."
                : "This print job failed. Start a new print request.",
            ),
            { dispatched: current.status === "DISPATCHED" },
          );
        }
      };
    let live = verify(
      await this.api<Job>("print/status", { printJobId: job.printJobId }),
    );
    completed(live);
    try {
      const image = await this.api<PrintImage>("print/render", {
        printJobId: job.printJobId,
      });
      if (
        image.printJobId !== job.printJobId ||
        image.status !== "DISPATCHED" ||
        !["image/svg+xml", "image/png"].includes(image.mimeType) ||
        typeof image.imageBase64 !== "string"
      )
        throw Error("Print handoff could not be verified.");
      this.pending.delete(key);
      return image;
    } catch (error) {
      try {
        live = verify(
          await this.api<Job>("print/status", { printJobId: job.printJobId }),
        );
      } catch {
        throw error;
      }
      completed(live);
      throw error;
    }
  }
}
export async function printDocument(
  handoff: () => Promise<PrintImage>,
  onReceipt: () => void,
) {
  const frame = document.createElement("iframe");
  frame.className = "print-frame";
  frame.title = "Pass print document";
  frame.setAttribute("aria-hidden", "true");
  let handedOff = false;
  const wait = (type: string, jobId?: string) =>
    new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        window.removeEventListener("message", receive);
        reject(Error("Printer document unavailable. Retry to check this job."));
      }, 15000);
      function receive(event: MessageEvent) {
        if (
          event.origin !== location.origin ||
          event.source !== frame.contentWindow ||
          (jobId && event.data?.printJobId !== jobId)
        )
          return;
        if (
          event.data?.type === type ||
          event.data?.type === "gatepass-print-display-error"
        ) {
          window.clearTimeout(timer);
          window.removeEventListener("message", receive);
          if (event.data.type === type) resolve();
          else reject(Error("Print image unavailable."));
        }
      }
      window.addEventListener("message", receive);
    });
  try {
    const ready = wait("gatepass-print-ready");
    frame.src = "/reception/print";
    document.body.append(frame);
    await ready;
    const image = await handoff();
    onReceipt();
    const loaded = wait("gatepass-print-loaded", image.printJobId);
    frame.contentWindow!.postMessage(
      { type: "gatepass-print-image", ...image },
      location.origin,
    );
    await loaded;
    frame.contentWindow!.addEventListener("afterprint", () => frame.remove(), {
      once: true,
    });
    window.setTimeout(() => frame.remove(), 60000);
    frame.contentWindow!.focus();
    frame.contentWindow!.print();
    handedOff = true;
  } finally {
    if (!handedOff) frame.remove();
  }
}
