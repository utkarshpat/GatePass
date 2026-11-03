# Runtime configuration through .env

> Maintained guide reviewed 3 November 2026. See the [current system handbook](system/README.md) for completion and acceptance status.

The API, production email worker and local Node launcher load the repository-root `.env` before initializing services. No new dotenv dependency is needed: the existing Node runtime parses the file. `.env.example` is the tracked, empty production template; `.env` is ignored by Git. Actual private `.env` values are not read or published by a documentation review.

## Production VM

1. Copy `.env.example` to `.env` in the deployed application root, outside public/static hosting and personal cloud-sync folders.
2. Fill the approved origin, private SQL connection details and separate API/auth/worker logins, TLS file paths, stable source key, organization Graph sender/app credentials and approved directory/link-key adapter paths.
3. Restrict file access to the service identity and authorized administrators (Linux mode `600`, or equivalent Windows ACL). Do not expose the file through web hosting, logs, support attachments or source control.
4. Run `npm run check:config -- api` and `npm run check:config -- email`. Diagnostics contain field names only. Shape validation does not verify connectivity, permissions or integration completeness.
5. Start the existing services with `npm run start:api` and `npm run start:email`. Restart affected services after configuration changes. Do not generate a new source key on every deployment.

Pre-existing service environment variables take precedence over file values, so avoid duplicate settings in a service manager. A production-mode file cannot silently be downgraded by a development launcher. API/email startup validates required configuration before opening service connections, rejects development database/dummy identity settings, and rejects personal-mail authentication in production.

Quote passwords containing `#` or spaces. Use absolute paths for configured PEM files and adapter modules. File contents are never executed as shell commands. Only `NODE_ENV` and `GATEPASS_*` entries are loaded; unrelated variables such as `NODE_OPTIONS` are not imported.

## What .env contains

Connection settings, application client secrets, sender settings, feature switches and protected file/module paths. Actual SQL records, visitor photos, password hashes, OAuth token caches, certificates and QR/signing key-ring files remain in their purpose-specific database/private storage. A path in `.env` configures where protected material is read; it does not make that material public.

Production email uses `GATEPASS_GRAPH_TENANT_ID`, `GATEPASS_GRAPH_CLIENT_ID`, `GATEPASS_GRAPH_CLIENT_SECRET` and `GATEPASS_MAIL_SENDER`; it does not use the personal Outlook token-cache folder. The personal connector remains a separate development-only workflow.

## Pending integrations

The commented Entra/directory/Google entries in `.env.example` are reserved names, not completed adapters. Filling them does not enable corporate SSO, directory access or Google station login. Full production application composition and the previously documented deployment work remain required. Local SQL continues using the existing restricted Windows-authenticated bridge rather than pretending that the production SQL fields configure the development helper.

## Pentest hardening additions

Production modes must be explicit: API uses corporate SSO mode and API directory mode; email uses API directory mode and application Graph authentication. All configured API/auth/worker/Outlook database usernames must be separate. Obvious demo secrets and repeated-byte source keys are rejected; this does not prove an arbitrary chosen secret is strong. Local guard/staff sign-in additionally enforces the current passphrase policy in production, so short development passwords cannot remain usable there.

Request admission settings in `.env.example` default to 32 pending API requests, eight pending public requests and 300 public requests per minute per keyed direct socket source. Public capacity must remain below the total; invalid or noncanonical limits fail configuration validation. The policy is process-local and forwarding headers do not change source identity. Tune for office NAT/load and provision edge protection; these limits are not distributed DDoS protection. Details and limits are in [the risk-hardening report](94_Pentest_Risk_Hardening_28_October_2026.md).
