# 08. Current security and recovery acceptance

> Maintained manual acceptance catalogue — 3 November 2026. These are test instructions, not newly executed results. [Actual evidence](../system/10_Testing_CI_and_Evidence.md).

Use this maintained checklist; chapter 06 in this folder is a historical findings log, not a current security certification.

| Case | Exercise | Expected result |
|---|---|---|
| SEC-01 | Use missing/forged/revoked credentials, wrong CSRF/Origin/Host and held protected request bodies. | Authentication/admission before protected body work; bounded public/verification/total capacity; per-action SQL scope retained. |
| SEC-02 | Impersonate a runtime principal with direct object, ownership or broader server permission. | Least-privilege admission rejects elevated/misconfigured identities; no fallback to schema admin. |
| SEC-03 | Use stale/foreign IDs, snapshots, duties, office/project/grant/group revisions and opposite retries. | Current scope/state fencing; stable authorized replay only; no resource existence leak. |
| SEC-04 | Inject markup/events into names/messages/reasons and formula-looking export cells. | React/text escaping and safe workbook strings; no script/event/formula execution. |
| SEC-05 | Inspect caches, offline shell, response headers, history restoration and identity change. | Authorized documents/media/API data not offline-cached; private state cleared/revalidated. |
| SEC-06 | Inspect source/release/log artifacts and configuration error paths. | No actual .env, secrets, hashes, keys, photos, cookies, capability links or raw provider bodies published. |
| SEC-07 | Exercise corporate identity/mail/Outlook/Google station controls in approved staging. | Real provider/device/revocation acceptance recorded separately; local/mock tests are not certification. |
| SEC-08 | Restore coordinated SQL/media/keys into an isolated target; test an issued pass/link and outbox recovery. | References/key versions preserved, no blind redispatch, measured agreed RPO/RTO; production approval remains explicit. |

Use synthetic identities/media and an approved test environment. Record the environment, source revision, actor/scope, actual result and sanitized correlation. Do not send real email or mutate production as part of a manual documentation walkthrough.
