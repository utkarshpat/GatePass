# Private photos and QR key storage — local Windows implementation

This is the first storage step in the agreed sequence. It implements the existing `PrivatePhotoStore`, `PrivatePhotoReader` and `QrKeySource` ports without changing database migrations or the visitor/employee authorization model.

## Local setup

```powershell
npm.cmd run storage:init
```

The store has already been initialized locally. Its stable location is `%USERPROFILE%\.gatepass\private-v1`, outside the repository, OneDrive and web root. `photos` and `qr-keys` are separate private directories. No corporate SSO key or external service is required. Initialization reports only the path, usage, public key-version identifier and protection scheme; it never prints a QR secret or encryption key.

The user-profile location also avoids the LocalAppData filesystem virtualization observed when tools run inside the packaged desktop app. Both a normal terminal and a desktop-launched process must use the same persistent key store. Canonical filesystem paths are pinned and checked against forbidden roots. Existing directories must already meet permission requirements; opening them never broadens access.

New Windows roots receive an explicit protected ACL granting only the current Windows user and SYSTEM full control. Inherited broad entries are removed from those newly created, empty roots. Existing roots are verified. Parent traversal rejects filesystem links/junctions; same-account code and administrators remain within the OS trust boundary. On POSIX the directory admission check requires current-user ownership and no group/other permission bits; a production Linux key protector is still a deployment task.

## Photos

`FilePhotoStore` is an internal filesystem port. It is not a static website folder and has no direct HTTP path. The existing SQL-authorized photo service and renderer must authorize a visit/pass before invoking a read; they also validate stored content hash/metadata and recheck authorization around delivery.

- Upload storage keys are exactly `intakes/<32 lowercase hex>/<32 lowercase hex>.jpg`. Reads also recognize the existing PNG/WebP contract. Paths, drive prefixes, ADS, traversal and Windows aliases are rejected.
- The existing normalizer still owns image decode, orientation, pixel limits and metadata stripping. The file store accepts bounded normalized JPEG bytes and writes them without replacement. Photo files are protected by OS ACLs; the application does not claim that JPEG contents are independently encrypted on disk.
- A complete private temporary file is flushed before an atomic no-replace hard-link publication. An existing destination is never overwritten. Temporary siblings are removed after normal publication; unknown outcomes do not cause committed photos to be deleted.
- Reads reject symlinked directories/files, unexpected hard links and files over the caller's bound. The opened file's identity is compared with its inspected identity; reads allocate at most the bounded amount plus one byte for overflow detection.
- An exclusive filesystem lock serializes quota checks and publication across instances. Defaults are **512 MiB and 10,000 files**. Both limits are independent; leftover staged/temporary files also consume quota. A crash-left lock fails closed and requires operator reconciliation rather than being silently stolen.

There is deliberately no blind TTL deletion API. Staged-photo cleanup still requires a reference-aware SQL reconciliation/retention policy so an upload whose SQL response timed out is not deleted after a successful commit. Until that policy is implemented, quota exhaustion rejects new storage; referenced content is preserved. Public rollout remains subject to that lifecycle work.

## QR encryption keys

`FileQrKeySource` generates a random 256-bit QR encryption key once and stores a protected version under `qr-keys/versions`. The active manifest names its version. Existing encrypted QR envelopes and their existing AES-256-GCM/AAD contract are unchanged.

On this Windows host, key bytes are wrapped using **DPAPI CurrentUser**, with additional entropy bound to the exact key-version ID. The helper uses stdin/stdout pipes rather than command-line secret arguments. Only the encrypted DPAPI blob is persisted. File permissions are an additional boundary. Raw key material is never included in status DTOs or web responses.

Initialization verifies and reuses the current key. It refuses malformed manifests, missing versions, unknown protection schemes, failed decryption or a missing manifest alongside existing key files. It never silently creates a replacement key over a damaged store. Concurrent key maintenance uses a separate exclusive lock.

Rotation creates an immutable protected key version and atomically changes the active manifest. Older versions remain available through `resolve(id)`, allowing existing pass QR secrets to be recovered. There is no automatic old-key deletion, and a 1,000-version limit fails closed. Rotation is an internal/operator action, not a public HTTP endpoint.

DPAPI binds protection to this Windows identity/profile. Copying the files to Linux is not a complete key migration. The later VM stage must supply an approved Linux protector, preserve the key IDs, rewrap keys through a protected transfer and validate backup/restore before the Windows source is retired. No key export or migration has been performed. Power-loss durability/backup recovery are not claimed by the online restart tests.

## Validation and next step

**232/232 Node tests pass**, with no skips on this Windows host. Seventeen new storage tests cover forbidden roots, ACL reopening, path attacks, immutable writes, bounded reads, quotas, concurrent publication, junction/hard-link rejection, stale locks, idempotent key startup, rotation, tampering and missing manifests. Actual Windows DPAPI round-trips reject an incorrect version binding. The real file vault reopens, rotates and recovers an older encrypted QR through separate DPAPI helper processes.

Current evidence: `database/validation/private-storage-unit-report.json` and `private-storage-full-unit-tests.txt`. The local persistent photo directory is empty; generated test photos/files were isolated and removed. The one persistent active key is retained for the coming development flows. No real photo, message, credential or QR plaintext was published. Core database migrations remain 001–020.

Next: employee Digital ID request UI and wiring these storage ports into the local development flow, followed by project visit screens. This increment does not claim that those screens or photo HTTP delivery are already wired. Real SSO/mail, production TDS, Linux key migration, retention/restore validation and final printer acceptance remain later stages.
