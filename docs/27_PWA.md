# GatePass PWA

The current local web UI provides a root-scoped manifest and service worker on staff entry, reception and office QR entry pages. The print window does not register a worker. Installed launch opens `/`; public office QR links retain their office context and registration flow. Installation does not grant permissions or extend sessions.

App identity is **GatePass**. PNG icons (192, 512, maskable 512 and Apple touch 180) derive from the supplied original GatePass logo. Rebuild them with `node tools/build-pwa-icons.mjs` using the approved Sharp runtime. Company branding inside the app is unchanged.

On supported browsers, the staff entry header shows **Install app** only after the browser offers installation. It is hidden in standalone mode. Browser install menus remain available according to browser/platform support. No forced install prompt, automatic reload or activation during an in-progress form/print flow is used. A waiting update becomes active after existing app clients close.

The worker caches only six explicitly allowlisted public offline/icon assets. Pages containing sign-in state, office context, forms, API results, photos, passes and reports are never written to Cache Storage. POSTs and API requests bypass the worker. Navigation is network-only with `cache: no-store`; only network failure returns a generic offline screen. HTTP authorization failures keep their actual server response. No offline access approvals, scan decisions, background submission or queued mutations exist. Old caches are removed only within the `gatepass-static-` namespace; bump the version when changing cached assets.

The local `http://localhost:8443` origin supports secure-context PWA development. Devices connecting to a VM will require a trusted HTTPS origin. `tools/start-api.ts` remains an API-only production listener; production UI hosting must expose the same fixed PWA assets, manifest/worker CSP directives and registration script through its HTTPS frontend. Do not deploy the dummy SSO adapter.

Validation: `node --test tests/pwa.test.ts` checks cache exclusions, generic navigation fallback, cookie-free precaching, bounded routes, MIME/scope headers and generated icon dimensions. Browser installation, standalone launch and offline/reconnect acceptance on real desktop/Android/iOS devices remain separate device checks; passing these automated checks does not assert those device results.
