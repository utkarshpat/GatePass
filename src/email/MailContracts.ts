/** Provider-independent contracts shared by notification use cases and mail adapters. */
export type MailMessage = {
  notificationId: string;
  to: string;
  subject: string;
  html: string;
  inlineLogo?: string;
  personPhoto?: {
    mimeType: "image/jpeg" | "image/png" | "image/webp";
    contentBytes: string;
  };
};
export interface MailTransport {
  send(message: MailMessage): Promise<{ providerMessageId?: string }>;
}
export interface MailDirectory {
  getEmployee(
    id: string,
  ): Promise<{ isActive: boolean; officialEmail: string } | null>;
  getManager(
    id: string,
  ): Promise<{ isActive: boolean; officialEmail: string } | null>;
}
export interface MailRenderer {
  render(value: unknown): MailMessage;
}
export interface NotificationBatch {
  runOnce(): Promise<unknown[]>;
}
export class MailFailure extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}
