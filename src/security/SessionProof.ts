import { createHash } from "node:crypto";
import type { SqlParameter } from "../contracts/Sql.ts";

export type Session = { sessionToken: string; csrfToken: string };

export class SessionProofError extends Error {
  readonly code = "NOT_AUTHORIZED";
  constructor() {
    super("NOT_AUTHORIZED");
  }
}

/** Canonical 32-byte capability shape only; SQL still authenticates the live session. */
export function isSessionToken(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/u.test(value))
    return false;
  const bytes = Buffer.from(value, "base64url");
  try {
    return bytes.length === 32 && bytes.toString("base64url") === value;
  } finally {
    bytes.fill(0);
  }
}

/** Fail before I/O; discard raw decoded capabilities after hashing. */
export function sessionIdentity(
  session: Session,
  unauthorized: () => Error = () => new SessionProofError(),
): Record<string, SqlParameter> {
  if (
    !isSessionToken(session?.sessionToken) ||
    !isSessionToken(session?.csrfToken)
  )
    throw unauthorized();
  return {
    SessionHash: {
      type: "binary",
      value: sessionTokenDigest(session.sessionToken, unauthorized),
    },
    CsrfHash: {
      type: "binary",
      value: sessionTokenDigest(session.csrfToken, unauthorized),
    },
  };
}

export function sessionTokenDigest(
  value: unknown,
  unauthorized: () => Error = () => new SessionProofError(),
): Buffer {
  if (!isSessionToken(value)) throw unauthorized();
  const bytes = Buffer.from(value, "base64url");
  try {
    return createHash("sha256").update(bytes).digest();
  } finally {
    bytes.fill(0);
  }
}
