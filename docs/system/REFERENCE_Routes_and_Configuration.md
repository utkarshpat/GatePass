# Reference B. Routes and configuration declarations

Names from source only. Variables can be optional, process-specific or test-only. This is not a required environment template. Values are not extracted. Some route strings are prefixes; regex/dynamic expansions are in chapter 05 and the declaring handler.

## Literal route declarations

| Path / prefix | Source | Line |
|---|---|---|
| /admin | src/development/StaffEntryRoutes.ts | 29 |
| /admin | tools/start-dummy-sso.ts | 114 |
| /admin | tools/start-dummy-sso.ts | 115 |
| /admin | tools/start-dummy-sso.ts | 119 |
| /admin/ | tools/start-dummy-sso.ts | 114 |
| /admin/ | tools/start-dummy-sso.ts | 115 |
| /admin/ | tools/start-dummy-sso.ts | 119 |
| /api/ | src/transport/Composition.ts | 60 |
| /api/admin/ | src/transport/Composition.ts | 85 |
| /api/admin/common-duties | src/transport/Composition.ts | 75 |
| /api/admin/common-duty | src/transport/Composition.ts | 76 |
| /api/admin/staff/ | src/transport/Composition.ts | 87 |
| /api/auth/login | src/transport/ApiHandler.ts | 44 |
| /api/auth/login | src/transport/ApiHandler.ts | 48 |
| /api/auth/logout | src/transport/ApiHandler.ts | 44 |
| /api/auth/logout | src/transport/ApiHandler.ts | 63 |
| /api/auth/setup | src/transport/ApiHandler.ts | 44 |
| /api/auth/setup | src/transport/ApiHandler.ts | 55 |
| /api/auth/touch | src/transport/ApiHandler.ts | 44 |
| /api/auth/touch | src/transport/ApiHandler.ts | 63 |
| /api/dev/sso/employees | src/development/DummySsoRoutes.ts | 11 |
| /api/dev/sso/login | src/development/DummySsoRoutes.ts | 11 |
| /api/dev/sso/logout | src/development/DummySsoRoutes.ts | 11 |
| /api/dev/sso/me | src/development/DummySsoRoutes.ts | 11 |
| /api/dev/sso/touch | src/development/DummySsoRoutes.ts | 11 |
| /api/email/external/detail | src/transport/Composition.ts | 82 |
| /api/email/external/detail | src/transport/EmailPublicRoutes.ts | 11 |
| /api/email/external/image | src/transport/EmailPublicRoutes.ts | 11 |
| /api/email/host/decide | src/transport/Composition.ts | 80 |
| /api/email/host/detail | src/transport/Composition.ts | 79 |
| /api/email/request/detail | src/transport/Composition.ts | 81 |
| /api/employee/digital-id/detail | src/development/EmployeeDigitalIdRoutes.ts | 15 |
| /api/employee/digital-id/image | src/development/EmployeeDigitalIdRoutes.ts | 15 |
| /api/employee/digital-id/image | src/development/EmployeeDigitalIdRoutes.ts | 27 |
| /api/guard/contexts | src/transport/Composition.ts | 68 |
| /api/guard/duties | src/transport/Composition.ts | 73 |
| /api/guard/movement | src/transport/Composition.ts | 78 |
| /api/guard/verify | src/transport/Composition.ts | 77 |
| /api/guard/visitors | src/transport/Composition.ts | 74 |
| /api/outlook/decision | src/transport/Composition.ts | 45 |
| /api/outlook/decision | src/transport/OutlookActionHandler.ts | 12 |
| /api/reception/ | src/development/ReceptionRoutes.ts | 13 |
| /api/registration/locations | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/registration/options | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/registration/photo | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/registration/reset | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/registration/start | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/registration/submit | src/transport/RegistrationHttpRoutes.ts | 12 |
| /api/staff/login | src/development/StaffEntryRoutes.ts | 10 |
| /api/staff/logout | src/development/StaffEntryRoutes.ts | 10 |
| /api/staff/me | src/development/StaffEntryRoutes.ts | 10 |
| /api/visits/cancel | src/transport/Composition.ts | 83 |
| /approval/ | src/transport/OutlookActionHandler.ts | 20 |
| /guard | src/development/StaffEntryRoutes.ts | 29 |
| /guard | tools/start-dummy-sso.ts | 114 |
| /guard | tools/start-dummy-sso.ts | 115 |
| /guard | tools/start-dummy-sso.ts | 118 |
| /guard | tools/start-dummy-sso.ts | 119 |
| /guard/ | tools/start-dummy-sso.ts | 114 |
| /guard/ | tools/start-dummy-sso.ts | 115 |
| /guard/ | tools/start-dummy-sso.ts | 118 |
| /guard/ | tools/start-dummy-sso.ts | 119 |
| /reception | src/development/StaffEntryRoutes.ts | 29 |
| /reception | tools/start-dummy-sso.ts | 114 |
| /reception | tools/start-dummy-sso.ts | 115 |
| /reception/ | tools/start-dummy-sso.ts | 114 |
| /reception/ | tools/start-dummy-sso.ts | 115 |
| /reception/print | tools/start-dummy-sso.ts | 114 |
| /reception/print | tools/start-dummy-sso.ts | 119 |
| /reception/print | tools/start-dummy-sso.ts | 120 |

## Configuration names

| Variable | Source files |
|---|---|
| GATEPASS_API_DB_PASSWORD | tools/start-api.ts |
| GATEPASS_API_DB_USER | tools/start-api.ts |
| GATEPASS_AUTH_DB_PASSWORD | tools/start-api.ts |
| GATEPASS_AUTH_DB_USER | tools/start-api.ts |
| GATEPASS_BIND_ADDRESS | tools/start-api.ts |
| GATEPASS_DB_NAME | tools/start-api.ts, tools/start-email-worker.ts |
| GATEPASS_DB_PORT | tools/start-api.ts, tools/start-email-worker.ts |
| GATEPASS_DB_SERVER | tools/start-api.ts, tools/start-email-worker.ts |
| GATEPASS_DEV_TLS_CERT_FILE | src/development/DevelopmentTls.ts |
| GATEPASS_DEV_TLS_KEY_FILE | src/development/DevelopmentTls.ts |
| GATEPASS_DEV_TLS_PASSWORD_FILE | src/development/DevelopmentTls.ts |
| GATEPASS_DEV_TLS_PFX_FILE | src/development/DevelopmentTls.ts |
| GATEPASS_DIRECTORY_MODE | src/development/DummyEmployeeSso.ts, src/integrations/directory/DirectoryGateway.ts, src/transport/RegistrationHttpRoutes.ts, tools/Claim-DevelopmentEmail.ps1, tools/GatePass.DevelopmentApiBridge.ps1, tools/GatePass.DevelopmentSqlBridge.ps1, tools/Seed-DevelopmentGuardCredentials.ps1, tools/Seed-DevelopmentStaffCredentials.ps1, tools/Set-DevelopmentTestPasswords.ps1, tools/Start-DummySso.ps1, tools/seed-development-guard-logins.ts, tools/seed-development-staff-logins.ts, tools/set-development-test-passwords.ts, tools/start-development-email.ts, tools/start-dummy-sso.ts, tools/start-email-worker.ts |
| GATEPASS_DUMMY_PORT | tools/start-dummy-sso.ts |
| GATEPASS_EMAIL_LINKS_MODULE | tools/start-api.ts, tools/start-email-worker.ts |
| GATEPASS_GRAPH_CLIENT_ID | tools/connect-personal-outlook.ts, tools/start-email-worker.ts |
| GATEPASS_GRAPH_CLIENT_SECRET | tools/start-email-worker.ts |
| GATEPASS_GRAPH_TENANT_ID | tools/start-email-worker.ts |
| GATEPASS_MAIL_AUTH_MODE | tools/start-email-worker.ts |
| GATEPASS_MAIL_DIRECTORY_MODULE | tools/start-email-worker.ts |
| GATEPASS_MAIL_SENDER | tools/connect-personal-outlook.ts, tools/start-email-worker.ts |
| GATEPASS_ORIGIN | tools/start-api.ts, tools/start-email-worker.ts |
| GATEPASS_OUTLOOK_ACTIONS_ENABLED | src/email/OutlookConfiguration.ts |
| GATEPASS_OUTLOOK_APPLICATION_ID | src/email/OutlookConfiguration.ts |
| GATEPASS_OUTLOOK_DB_PASSWORD | tools/start-api.ts |
| GATEPASS_OUTLOOK_DB_USER | tools/start-api.ts |
| GATEPASS_OUTLOOK_KEYS_MODULE | src/email/OutlookConfiguration.ts |
| GATEPASS_OUTLOOK_PROVIDER_ID | src/email/OutlookConfiguration.ts |
| GATEPASS_OUTLOOK_SCOPE | src/email/OutlookConfiguration.ts |
| GATEPASS_OUTLOOK_TENANT_ID | src/email/OutlookConfiguration.ts |
| GATEPASS_PWSH_PATH | tools/launch-dummy-sso.mjs |
| GATEPASS_SHARP_PATH | tools/build-pwa-icons.mjs, tools/build-redesigned-card-preview.ts, tools/preview-print-cards.ts, tools/start-dummy-sso.ts |
| GATEPASS_SOURCE_KEY | tools/start-api.ts |
| GATEPASS_SSO_MODE | src/development/DummyEmployeeSso.ts, src/transport/RegistrationHttpRoutes.ts, tools/Claim-DevelopmentEmail.ps1, tools/GatePass.DevelopmentApiBridge.ps1, tools/GatePass.DevelopmentSqlBridge.ps1, tools/New-DevelopmentTls.ps1, tools/Start-DummySso.ps1, tools/start-api.ts, tools/start-development-email.ts, tools/start-dummy-sso.ts, tools/start-email-worker.ts |
| GATEPASS_STAGING_ORIGIN | tools/ci/staging-smoke.mjs |
| GATEPASS_TEST_SQL_SERVER | tools/ci/Initialize-TestDatabase.ps1, tools/ci/Run-SqlChecks.ps1 |
| GATEPASS_TEST_STORAGE_ROOT | tools/start-dummy-sso.ts |
| GATEPASS_TLS_CERT_FILE | tools/start-api.ts |
| GATEPASS_TLS_KEY_FILE | tools/start-api.ts |
| GATEPASS_WORKER_DB_PASSWORD | tools/start-email-worker.ts |
| GATEPASS_WORKER_DB_USER | tools/start-email-worker.ts |
