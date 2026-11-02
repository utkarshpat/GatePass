export class CoordinationFailure extends Error {
  status: number;
  constructor(status: number) {
    super(
      status === 401
        ? "Your session expired. Sign in again."
        : status === 403
          ? "This visit or action is outside your current access."
          : status === 409
            ? "The visit or planning configuration changed. Refresh and review before retrying."
            : status === 400
              ? "Check the entered fields and configured internal contacts."
              : status === 429
                ? "Too many requests. Wait briefly and retry."
                : "Unable to load or save. Please retry.",
    );
    this.status = status;
  }
}
export function csrf() {
  return document.cookie
    .split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith("gp-staff-csrf="))
    ?.slice(14);
}
export async function coordinationRequest(
  action: string,
  body: unknown,
  signal: AbortSignal,
) {
  const response = await fetch("/api/coordination/" + action, {
    method: "POST",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": csrf() ?? "",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!response.ok) throw new CoordinationFailure(response.status);
  return response.json();
}
