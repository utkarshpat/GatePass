import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  isSessionToken,
  sessionIdentity,
  sessionTokenDigest,
  SessionProofError,
} from "../src/security/SessionProof.ts";

test("session proof rejects alternate encodings, invalid shapes and missing capabilities", () => {
  const token = Buffer.alloc(32, 255).toString("base64url");
  const alias = token.slice(0, -1) + "9";
  assert.deepEqual(
    Buffer.from(alias, "base64url"),
    Buffer.from(token, "base64url"),
  );
  assert(isSessionToken(token));
  for (const value of [
    alias,
    token + "=",
    token + "\n",
    "",
    undefined,
    null,
    [],
    Buffer.alloc(32),
    "a".repeat(42),
    "a".repeat(44),
  ]) {
    assert.equal(isSessionToken(value), false);
    assert.throws(() => sessionTokenDigest(value), SessionProofError);
  }
  assert.throws(() => sessionIdentity(null as any), { code: "NOT_AUTHORIZED" });
});
test("session proof hashes decoded bytes and preserves the calling domain error contract", () => {
  const rawSession = Buffer.alloc(32, 1),
    rawCsrf = Buffer.alloc(32, 2);
  const proof = sessionIdentity({
    sessionToken: rawSession.toString("base64url"),
    csrfToken: rawCsrf.toString("base64url"),
  });
  assert.deepEqual(Object.keys(proof).sort(), ["CsrfHash", "SessionHash"]);
  assert.deepEqual(
    proof.SessionHash.value,
    createHash("sha256").update(rawSession).digest(),
  );
  assert.deepEqual(
    proof.CsrfHash.value,
    createHash("sha256").update(rawCsrf).digest(),
  );
  const domainError = Object.assign(new Error("REDACTED"), {
    code: "NOT_AUTHORIZED",
  });
  assert.throws(
    () =>
      sessionIdentity(
        { sessionToken: "bad", csrfToken: "bad" },
        () => domainError,
      ),
    (error) => error === domainError,
  );
});
