# Routes and runtime configuration

Updated 20 November 2026. Literal source inventory; dynamic/regex routes require checking their handlers. Not an OpenAPI schema. Names only: no live environment file or secret value is read.

## Runtime setup

Root `.env` is private and ignored; `.env.example` is the empty tracked template. API/email startup validates production settings. Existing process variables take precedence. Reserved corporate/Google fields do not enable unfinished adapters. See [configuration](../86_Runtime_Environment_Configuration.md).

## Literal routes

| Route/prefix | Source | Line |
|---|---|---|
| `/admin` | [src/app/staff-entry.js](../../src/app/staff-entry.js) | 7 |
| `/admin` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 29 |
| `/admin` | [src/frontend/pages/AdminPage.tsx](../../src/frontend/pages/AdminPage.tsx) | 102 |
| `/admin` | [src/frontend/staffAccess.ts](../../src/frontend/staffAccess.ts) | 2 |
| `/admin` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/admin` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/admin` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/admin/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/admin/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/admin/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/api/` | [src/app/admin.js](../../src/app/admin.js) | 41 |
| `/api/` | [src/app/guard.js](../../src/app/guard.js) | 13 |
| `/api/` | [src/app/service-worker.js](../../src/app/service-worker.js) | 20 |
| `/api/` | [src/frontend/admin/model.ts](../../src/frontend/admin/model.ts) | 161 |
| `/api/` | [src/frontend/guard/model.ts](../../src/frontend/guard/model.ts) | 176 |
| `/api/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 78 |
| `/api/admin/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 73 |
| `/api/admin/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 100 |
| `/api/admin/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 116 |
| `/api/admin/common-duties` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 99 |
| `/api/admin/common-duty` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 101 |
| `/api/admin/create-staff` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 95 |
| `/api/admin/register` | [tools/load-stress/ExportPressure.ts](../../tools/load-stress/ExportPressure.ts) | 12 |
| `/api/admin/staff/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 119 |
| `/api/admin/summary-range` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 117 |
| `/api/admin/summary-range` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 56 |
| `/api/auth/login` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 50 |
| `/api/auth/login` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 54 |
| `/api/auth/login` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 72 |
| `/api/auth/login` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/auth/logout` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 50 |
| `/api/auth/logout` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 85 |
| `/api/auth/setup` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 50 |
| `/api/auth/setup` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 54 |
| `/api/auth/setup` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 79 |
| `/api/auth/setup` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/auth/touch` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 50 |
| `/api/auth/touch` | [src/transport/ApiHandler.ts](../../src/transport/ApiHandler.ts) | 85 |
| `/api/coordination/` | [src/frontend/coordination/client.ts](../../src/frontend/coordination/client.ts) | 32 |
| `/api/coordination/` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 72 |
| `/api/dev/sso/` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 55 |
| `/api/dev/sso/` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 165 |
| `/api/dev/sso/login` | [src/app/email-request.js](../../src/app/email-request.js) | 67 |
| `/api/dev/sso/login` | [src/development/DummySsoRoutes.ts](../../src/development/DummySsoRoutes.ts) | 11 |
| `/api/dev/sso/login` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 381 |
| `/api/dev/sso/login` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/dev/sso/login` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 41 |
| `/api/dev/sso/login` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 54 |
| `/api/dev/sso/logout` | [src/development/DummySsoRoutes.ts](../../src/development/DummySsoRoutes.ts) | 11 |
| `/api/dev/sso/me` | [src/development/DummySsoRoutes.ts](../../src/development/DummySsoRoutes.ts) | 11 |
| `/api/dev/sso/touch` | [src/development/DummySsoRoutes.ts](../../src/development/DummySsoRoutes.ts) | 11 |
| `/api/email/` | [src/app/email-request.js](../../src/app/email-request.js) | 19 |
| `/api/email/` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 155 |
| `/api/email/external/` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/email/external/` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 27 |
| `/api/email/external/detail` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 113 |
| `/api/email/external/detail` | [src/transport/EmailPublicRoutes.ts](../../src/transport/EmailPublicRoutes.ts) | 15 |
| `/api/email/external/detail` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 49 |
| `/api/email/external/detail` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 53 |
| `/api/email/external/image` | [src/transport/EmailPublicRoutes.ts](../../src/transport/EmailPublicRoutes.ts) | 15 |
| `/api/email/external/image` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 50 |
| `/api/email/external/session` | [src/app/email-request.js](../../src/app/email-request.js) | 63 |
| `/api/email/external/session` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 353 |
| `/api/email/external/session` | [src/transport/EmailPublicRoutes.ts](../../src/transport/EmailPublicRoutes.ts) | 15 |
| `/api/email/external/session` | [src/transport/EmailPublicRoutes.ts](../../src/transport/EmailPublicRoutes.ts) | 17 |
| `/api/email/host/decide` | [src/app/email-request.js](../../src/app/email-request.js) | 68 |
| `/api/email/host/decide` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 414 |
| `/api/email/host/decide` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 110 |
| `/api/email/host/decide` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 59 |
| `/api/email/host/detail` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 109 |
| `/api/email/host/detail` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 23 |
| `/api/email/host/detail` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 24 |
| `/api/email/host/detail` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 42 |
| `/api/email/host/detail` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 55 |
| `/api/email/host/photo` | [src/app/email-request.js](../../src/app/email-request.js) | 57 |
| `/api/email/host/photo` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 302 |
| `/api/email/request/detail` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 111 |
| `/api/email/request/revoke` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 112 |
| `/api/employee/digital-id/detail` | [src/development/EmployeeDigitalIdRoutes.ts](../../src/development/EmployeeDigitalIdRoutes.ts) | 15 |
| `/api/employee/digital-id/image` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 409 |
| `/api/employee/digital-id/image` | [src/development/EmployeeDigitalIdRoutes.ts](../../src/development/EmployeeDigitalIdRoutes.ts) | 15 |
| `/api/employee/digital-id/image` | [src/development/EmployeeDigitalIdRoutes.ts](../../src/development/EmployeeDigitalIdRoutes.ts) | 27 |
| `/api/employee/digital-id/image` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 674 |
| `/api/guard/context` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 86 |
| `/api/guard/contexts` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 91 |
| `/api/guard/detail` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 103 |
| `/api/guard/duties` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 96 |
| `/api/guard/movement` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 108 |
| `/api/guard/movement` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 72 |
| `/api/guard/movement` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 77 |
| `/api/guard/movement` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 91 |
| `/api/guard/movement` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 104 |
| `/api/guard/queue` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 97 |
| `/api/guard/queue` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 57 |
| `/api/guard/verify` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 102 |
| `/api/guard/visitors` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 98 |
| `/api/operations/actions` | [src/app/action-centre.js](../../src/app/action-centre.js) | 68 |
| `/api/operations/actions` | [src/development/ActionCentreRoutes.ts](../../src/development/ActionCentreRoutes.ts) | 12 |
| `/api/operations/actions` | [src/frontend/shared/ActionCentre.tsx](../../src/frontend/shared/ActionCentre.tsx) | 129 |
| `/api/operations/actions` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 75 |
| `/api/operations/actions` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 58 |
| `/api/operations/remind` | [src/app/action-centre.js](../../src/app/action-centre.js) | 54 |
| `/api/operations/remind` | [src/development/ActionCentreRoutes.ts](../../src/development/ActionCentreRoutes.ts) | 12 |
| `/api/operations/remind` | [src/development/ActionCentreRoutes.ts](../../src/development/ActionCentreRoutes.ts) | 19 |
| `/api/operations/remind` | [src/frontend/shared/ActionCentre.tsx](../../src/frontend/shared/ActionCentre.tsx) | 301 |
| `/api/operations/remind` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 76 |
| `/api/outlook/decision` | [src/email/OutlookApprovalCard.ts](../../src/email/OutlookApprovalCard.ts) | 15 |
| `/api/outlook/decision` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 52 |
| `/api/outlook/decision` | [src/transport/OutlookActionHandler.ts](../../src/transport/OutlookActionHandler.ts) | 12 |
| `/api/reception/` | [src/app/reception.js](../../src/app/reception.js) | 13 |
| `/api/reception/` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 14 |
| `/api/reception/` | [src/frontend/reception/model.ts](../../src/frontend/reception/model.ts) | 136 |
| `/api/reception/correct-return` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 39 |
| `/api/reception/lookup` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 38 |
| `/api/reception/manual/` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 41 |
| `/api/reception/manual/` | [src/development/ReceptionRegistrationRoutes.ts](../../src/development/ReceptionRegistrationRoutes.ts) | 28 |
| `/api/reception/manual/` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 118 |
| `/api/reception/manual/submit` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 54 |
| `/api/reception/queue` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 42 |
| `/api/reception/queue` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 74 |
| `/api/reception/queue` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 59 |
| `/api/reception/remind-host` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 41 |
| `/api/reception/return` | [src/development/ReceptionRoutes.ts](../../src/development/ReceptionRoutes.ts) | 40 |
| `/api/registration/` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 41 |
| `/api/registration/` | [src/development/ReceptionRegistrationRoutes.ts](../../src/development/ReceptionRegistrationRoutes.ts) | 28 |
| `/api/registration/` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 116 |
| `/api/registration/` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 118 |
| `/api/registration/` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/registration/card` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 409 |
| `/api/registration/card` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 673 |
| `/api/registration/card` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/locations` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/options` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 178 |
| `/api/registration/options` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 291 |
| `/api/registration/options` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 276 |
| `/api/registration/options` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 410 |
| `/api/registration/options` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/options` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 29 |
| `/api/registration/options` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 30 |
| `/api/registration/photo` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 476 |
| `/api/registration/photo` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 770 |
| `/api/registration/photo` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/photo` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 32 |
| `/api/registration/reset` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 174 |
| `/api/registration/reset` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 475 |
| `/api/registration/reset` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 270 |
| `/api/registration/reset` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 759 |
| `/api/registration/reset` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/start` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 176 |
| `/api/registration/start` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 475 |
| `/api/registration/start` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 272 |
| `/api/registration/start` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 761 |
| `/api/registration/start` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/start` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 28 |
| `/api/registration/submit` | [src/app/employee-portal.js](../../src/app/employee-portal.js) | 478 |
| `/api/registration/submit` | [src/frontend/selfService/model.ts](../../src/frontend/selfService/model.ts) | 797 |
| `/api/registration/submit` | [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts) | 12 |
| `/api/registration/submit` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 34 |
| `/api/registration/submit` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 39 |
| `/api/registration/submit` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 54 |
| `/api/registration/submit` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 58 |
| `/api/registration/submit` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 61 |
| `/api/staff/` | [src/app/staff-entry.js](../../src/app/staff-entry.js) | 5 |
| `/api/staff/` | [src/frontend/staffModel.ts](../../src/frontend/staffModel.ts) | 52 |
| `/api/staff/login` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 10 |
| `/api/staff/login` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/staff/login` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) | 53 |
| `/api/staff/logout` | [src/app/reception.js](../../src/app/reception.js) | 206 |
| `/api/staff/logout` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 10 |
| `/api/staff/logout` | [src/frontend/pages/CoordinationPage.tsx](../../src/frontend/pages/CoordinationPage.tsx) | 515 |
| `/api/staff/logout` | [src/frontend/reception/model.ts](../../src/frontend/reception/model.ts) | 1287 |
| `/api/staff/me` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 10 |
| `/api/staff/me` | [src/frontend/shared/StaffNavigation.tsx](../../src/frontend/shared/StaffNavigation.tsx) | 119 |
| `/api/staff/setup` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 10 |
| `/api/staff/setup` | [src/transport/RequestAdmission.ts](../../src/transport/RequestAdmission.ts) | 62 |
| `/api/visits/cancel` | [src/transport/Composition.ts](../../src/transport/Composition.ts) | 114 |
| `/api/workspace/events` | [src/app/live-refresh.js](../../src/app/live-refresh.js) | 29 |
| `/api/workspace/events` | [src/development/WorkspaceEventRoutes.ts](../../src/development/WorkspaceEventRoutes.ts) | 13 |
| `/api/workspace/events` | [src/frontend/shared/liveRefresh.ts](../../src/frontend/shared/liveRefresh.ts) | 117 |
| `/api/workspace/events` | [tools/load-stress/Support.ts](../../tools/load-stress/Support.ts) | 50 |
| `/approval/` | [src/app/email-request.js](../../src/app/email-request.js) | 2 |
| `/approval/` | [src/email/NotificationEmailWorker.ts](../../src/email/NotificationEmailWorker.ts) | 30 |
| `/approval/` | [src/email/OutlookApprovalCard.ts](../../src/email/OutlookApprovalCard.ts) | 16 |
| `/approval/` | [src/frontend/emailModel.ts](../../src/frontend/emailModel.ts) | 50 |
| `/approval/` | [src/transport/OutlookActionHandler.ts](../../src/transport/OutlookActionHandler.ts) | 20 |
| `/approval/` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 21 |
| `/approval/` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 66 |
| `/approval/` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 91 |
| `/coordination` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 29 |
| `/coordination` | [src/frontend/staffAccess.ts](../../src/frontend/staffAccess.ts) | 5 |
| `/coordination` | [src/frontend/staffModel.ts](../../src/frontend/staffModel.ts) | 86 |
| `/coordination` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/coordination` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/coordination` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/coordination` | [tools/test-coordination-server.ts](../../tools/test-coordination-server.ts) | 88 |
| `/coordination/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/coordination/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/coordination/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/guard` | [src/app/staff-entry.js](../../src/app/staff-entry.js) | 7 |
| `/guard` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 29 |
| `/guard` | [src/frontend/staffAccess.ts](../../src/frontend/staffAccess.ts) | 4 |
| `/guard` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/guard` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/guard` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 158 |
| `/guard` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/guard/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/guard/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/guard/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 158 |
| `/guard/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/office/` | [src/development/AdminRoutes.ts](../../src/development/AdminRoutes.ts) | 70 |
| `/office/bengaluru` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 61 |
| `/office/noida` | [tools/create-email-test.ts](../../tools/create-email-test.ts) | 28 |
| `/office/noida` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 36 |
| `/office/noida` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 50 |
| `/office/noida` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) | 58 |
| `/pwa/` | [src/app/PwaAssets.ts](../../src/app/PwaAssets.ts) | 10 |
| `/pwa/apple-touch-icon.png` | [src/app/PwaAssets.ts](../../src/app/PwaAssets.ts) | 24 |
| `/pwa/apple-touch-icon.png` | [src/app/service-worker.js](../../src/app/service-worker.js) | 4 |
| `/pwa/icon-192.png` | [src/app/PwaAssets.ts](../../src/app/PwaAssets.ts) | 24 |
| `/pwa/icon-192.png` | [src/app/service-worker.js](../../src/app/service-worker.js) | 4 |
| `/pwa/icon-512.png` | [src/app/service-worker.js](../../src/app/service-worker.js) | 4 |
| `/pwa/icon-maskable-512.png` | [src/app/service-worker.js](../../src/app/service-worker.js) | 4 |
| `/pwa/offline.css` | [src/app/PwaAssets.ts](../../src/app/PwaAssets.ts) | 9 |
| `/pwa/offline.css` | [src/app/service-worker.js](../../src/app/service-worker.js) | 4 |
| `/pwa/offline.html` | [src/app/PwaAssets.ts](../../src/app/PwaAssets.ts) | 8 |
| `/pwa/offline.html` | [src/app/service-worker.js](../../src/app/service-worker.js) | 3 |
| `/reception` | [src/app/staff-entry.js](../../src/app/staff-entry.js) | 7 |
| `/reception` | [src/development/StaffEntryRoutes.ts](../../src/development/StaffEntryRoutes.ts) | 29 |
| `/reception` | [src/frontend/staffAccess.ts](../../src/frontend/staffAccess.ts) | 3 |
| `/reception` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/reception` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/reception` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 158 |
| `/reception/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/reception/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 155 |
| `/reception/` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 158 |
| `/reception/print` | [src/app/reception.js](../../src/app/reception.js) | 197 |
| `/reception/print` | [src/frontend/reception/printing.ts](../../src/frontend/reception/printing.ts) | 131 |
| `/reception/print` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 154 |
| `/reception/print` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 157 |
| `/reception/print` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) | 159 |
| `/reception/register/` | [src/app/reception.js](../../src/app/reception.js) | 239 |
| `/reception/register/` | [src/frontend/pages/ReceptionPage.tsx](../../src/frontend/pages/ReceptionPage.tsx) | 1090 |
| `/request/` | [src/email/NotificationEmailWorker.ts](../../src/email/NotificationEmailWorker.ts) | 30 |
| `/request/` | [src/email/NotificationEmailWorker.ts](../../src/email/NotificationEmailWorker.ts) | 33 |
| `/request/` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 27 |
| `/request/` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts) | 31 |

## Configuration names

| Name | Source files |
|---|---|
| `GATEPASS_API_DB_PASSWORD` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_API_DB_USER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_API_MAX_IN_FLIGHT` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_AUTH_DB_PASSWORD` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_AUTH_DB_USER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_BIND_ADDRESS` | [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_DB_NAME` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_DB_PORT` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_DB_SERVER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_DEMO_HEADED` | [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) |
| `GATEPASS_DEMO_ORIGIN` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts), [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) |
| `GATEPASS_DEV_RPC_WORKERS` | [src/development/LocalDevelopmentApiClient.ts](../../src/development/LocalDevelopmentApiClient.ts), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) |
| `GATEPASS_DEV_TLS_CERT_FILE` | [src/development/DevelopmentTls.ts](../../src/development/DevelopmentTls.ts) |
| `GATEPASS_DEV_TLS_KEY_FILE` | [src/development/DevelopmentTls.ts](../../src/development/DevelopmentTls.ts) |
| `GATEPASS_DEV_TLS_PASSWORD_FILE` | [src/development/DevelopmentTls.ts](../../src/development/DevelopmentTls.ts) |
| `GATEPASS_DEV_TLS_PFX_FILE` | [src/development/DevelopmentTls.ts](../../src/development/DevelopmentTls.ts) |
| `GATEPASS_DIRECTORY_MODE` | [src/development/DummyEmployeeSso.ts](../../src/development/DummyEmployeeSso.ts), [src/integrations/directory/DirectoryGateway.ts](../../src/integrations/directory/DirectoryGateway.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/planning-mail.ts](../../tools/planning-mail.ts), [tools/profile-worker-bursts.ts](../../tools/profile-worker-bursts.ts), [tools/seed-development-guard-logins.ts](../../tools/seed-development-guard-logins.ts), [tools/seed-development-staff-logins.ts](../../tools/seed-development-staff-logins.ts), [tools/set-development-test-passwords.ts](../../tools/set-development-test-passwords.ts), [tools/start-development-email.ts](../../tools/start-development-email.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts), [tools/test-coordination-server.ts](../../tools/test-coordination-server.ts), [tools/test-coordination.mjs](../../tools/test-coordination.mjs), [tools/test-planning-mail.ts](../../tools/test-planning-mail.ts) |
| `GATEPASS_DUMMY_PORT` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) |
| `GATEPASS_EMAIL_LINKS_MODULE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_GRAPH_CLIENT_ID` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/connect-personal-outlook.ts](../../tools/connect-personal-outlook.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_GRAPH_CLIENT_SECRET` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_GRAPH_TENANT_ID` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_LOAD_DIAGNOSTICS` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) |
| `GATEPASS_LOAD_RUN_ID` | [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) |
| `GATEPASS_MAIL_AUTH_MODE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_MAIL_DIRECTORY_MODULE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_MAIL_PHOTOS_ROOT` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_MAIL_SENDER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/connect-personal-outlook.ts](../../tools/connect-personal-outlook.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_NAME_READINGS` | [src/development/LocalNameReadings.ts](../../src/development/LocalNameReadings.ts) |
| `GATEPASS_ORIGIN` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_OUTLOOK_ACTIONS_ENABLED` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_OUTLOOK_APPLICATION_ID` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_OUTLOOK_DB_PASSWORD` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_OUTLOOK_DB_USER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_OUTLOOK_KEYS_MODULE` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_OUTLOOK_PROVIDER_ID` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_OUTLOOK_SCOPE` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_OUTLOOK_TENANT_ID` | [src/email/OutlookConfiguration.ts](../../src/email/OutlookConfiguration.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_PUBLIC_MAX_IN_FLIGHT` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_PUBLIC_REQUESTS_PER_MINUTE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts) |
| `GATEPASS_PWSH_PATH` | [tools/launch-dummy-sso.mjs](../../tools/launch-dummy-sso.mjs), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts) |
| `GATEPASS_RETAIN_DEMO` | [tools/check-presentation-links.ts](../../tools/check-presentation-links.ts), [tools/run-presentation-demo.ts](../../tools/run-presentation-demo.ts) |
| `GATEPASS_SHARP_PATH` | [src/development/AdminRoutes.ts](../../src/development/AdminRoutes.ts), [tools/build-pwa-icons.mjs](../../tools/build-pwa-icons.mjs), [tools/build-redesigned-card-preview.ts](../../tools/build-redesigned-card-preview.ts), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/preview-print-cards.ts](../../tools/preview-print-cards.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) |
| `GATEPASS_SOURCE_KEY` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_SSO_MODE` | [src/development/DummyEmployeeSso.ts](../../src/development/DummyEmployeeSso.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/planning-mail.ts](../../tools/planning-mail.ts), [tools/profile-worker-bursts.ts](../../tools/profile-worker-bursts.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-development-email.ts](../../tools/start-development-email.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts), [tools/test-coordination-server.ts](../../tools/test-coordination-server.ts), [tools/test-coordination.mjs](../../tools/test-coordination.mjs), [tools/test-planning-mail.ts](../../tools/test-planning-mail.ts) |
| `GATEPASS_TEST_STORAGE_ROOT` | [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts) |
| `GATEPASS_TLS_CERT_FILE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_TLS_KEY_FILE` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-api.ts](../../tools/start-api.ts) |
| `GATEPASS_WORKER_DB_PASSWORD` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `GATEPASS_WORKER_DB_USER` | [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [tools/start-email-worker.ts](../../tools/start-email-worker.ts) |
| `NODE_ENV` | [src/development/DummyEmployeeSso.ts](../../src/development/DummyEmployeeSso.ts), [src/development/LocalDevelopmentApiClient.ts](../../src/development/LocalDevelopmentApiClient.ts), [src/development/LocalNameReadings.ts](../../src/development/LocalNameReadings.ts), [src/email/NotificationEmailWorker.ts](../../src/email/NotificationEmailWorker.ts), [src/email/PlanningMailRenderer.ts](../../src/email/PlanningMailRenderer.ts), [src/integrations/directory/DirectoryGateway.ts](../../src/integrations/directory/DirectoryGateway.ts), [src/runtime/Environment.ts](../../src/runtime/Environment.ts), [src/security/GuardAuthService.ts](../../src/security/GuardAuthService.ts), [src/storage/LocalPrivateStorage.ts](../../src/storage/LocalPrivateStorage.ts), [src/transport/RegistrationHttpRoutes.ts](../../src/transport/RegistrationHttpRoutes.ts), [tools/create-email-test.ts](../../tools/create-email-test.ts), [tools/frontend-build.mjs](../../tools/frontend-build.mjs), [tools/launch-dummy-sso.mjs](../../tools/launch-dummy-sso.mjs), [tools/load-stress/Runner.ts](../../tools/load-stress/Runner.ts), [tools/planning-mail.ts](../../tools/planning-mail.ts), [tools/preview-email.ts](../../tools/preview-email.ts), [tools/profile-worker-bursts.ts](../../tools/profile-worker-bursts.ts), [tools/seed-development-guard-logins.ts](../../tools/seed-development-guard-logins.ts), [tools/seed-development-staff-logins.ts](../../tools/seed-development-staff-logins.ts), [tools/set-development-test-passwords.ts](../../tools/set-development-test-passwords.ts), [tools/start-api.ts](../../tools/start-api.ts), [tools/start-development-email.ts](../../tools/start-development-email.ts), [tools/start-dummy-sso.ts](../../tools/start-dummy-sso.ts), [tools/test-coordination-server.ts](../../tools/test-coordination-server.ts), [tools/test-coordination.mjs](../../tools/test-coordination.mjs), [tools/test-planning-mail.ts](../../tools/test-planning-mail.ts) |
