# 01. Product and workflows

> Current local changes and presentation evidence (23 October 2026): [retained browser rehearsal](../55_Presentation_Rehearsal_23_October_2026.md). Source migrations are 001–087. The original 22 October export and snapshot remain historical.

The current visitor flow collects optional company and device types independently for each person. Reception-assisted intake uses the same form in an isolated staff-authorized frame. Final printed-pass return requires the holder to be outside and every declared device to be confirmed; a mistaken return can be corrected with a reason while retaining both audit records. Administration now includes local account onboarding, office/project rosters, a scoped visit register/Excel download and movement timelines. Today's presentation dataset is retained rather than cleaned after its rehearsal.

## Purpose and scope
GatePass manages visitor requests, temporary employee identity, host-authorized project visits, online pass verification, project entry/exit and reception printing. The local application uses actual SQL and private media storage. Corporate authentication and directory integration remain development adapters. A working local application is not a completed production deployment.

Office contexts are Noida, Bengaluru, Chennai and Pune. The office QR opens `/office/<office-code>` and binds office context on the server. Users do not choose an office inside the form. The supplied Noida photograph is currently reused for every office by product decision.

There are four interfaces: Self-service, Reception, Guard and Admin. Employee and Host remain identities and authorization actors, without separate dashboards, profile pages or approval inboxes. Email links lead to minimal status/approval pages.

## Request types
| Type | Who requests | Decision | Date and scope |
|---|---|---|---|
| DIGITAL_ID | Authenticated employee with forgotten/lost card | Auto-approved when currently eligible | Current India office day; office and memberships rechecked |
| EMPLOYEE_PROJECT | Authenticated employee visiting another project/office | Assigned eligible host | Current day; exact requested project-location |
| EXTERNAL | External visitor, optionally entered as a group | Assigned host, independently per person | Visitor selects an allowed date; exact project-location |

Employee date input is rejected by the service, not merely hidden. Calendar calculations use Asia/Kolkata. Validity ends at the next local midnight as an exclusive boundary; displaying the following date at 00:00 does not grant that day's access. External date bounds come from server options, not a client-invented booking limit.

## Employee flow
1. Scan office QR and choose SSI Employee.
2. Authenticate. Corporate SSO/MFA is intended; the current adapter uses an employee test email/password.
3. Fetch identity, primary office, eligible offices and exact project-location memberships from trusted data.
4. For temporary ID, select reason and capture/upload a photo. Review, submit, display the digital card and download PNG.
5. For another project, open Add project access, select project, search eligible host by name/email and enter purpose. Host must match the exact requested project-office. This creates an independent approval request.
6. Backend checks reuse an eligible same-day ID. Stale or unauthorized replay cannot bypass revoked entitlement.

A Noida employee does not gain Bengaluru access because the same project operates there. Primary office is directory-supplied, not inferred from the QR/array order. Office membership is explicit. Hosted access does not create permanent directory membership.

## Visitor flow
1. Open office QR and choose Visitor Check-in.
2. Enter name, country-aware mobile and optional email. Flags are local assets; installed phone-library validation does not call a public country API.
3. Add another person if needed. Completed details collapse into an editable short card.
4. Select project, allowed date, eligible host and purpose. Host results display name/email.
5. Capture/upload and adjust each person's photo, then review.
6. Submit independent requests. Each person has a distinct decision/pass/presence history. Missing optional email does not guarantee email retrieval; reception remains an operational path.

## Approval and status
External/project requests queue host notices. Ordinary email links open authenticated detail; GET/mail scanners never approve. Explicit POST binds current host authorization, immutable snapshot and retry key. Native Outlook actions are a separate optional implementation, disabled pending organization onboarding.

Temporary ID manager notices are informational. Internal holders reopen authenticated request links; external holders receive signed expiring individual fragment capabilities. Reference numbers alone cannot authorize reads. No employee/host workspace is introduced.

## Explicit exclusions
No floors/zones/checkpoint inventory, face recognition, lost-card replacement portal, mandatory Redis, offline entry decisions or proof of physical printer success in v1. Reports/audit backend contracts extend beyond the exposed Admin Projects UI; not every service has a finished screen.

Sources: docs/33_Employee_Office_Authorization.md; docs/34_Guard_Duties_and_Project_Presence.md; docs/35_Email_Driven_Request_Workflow.md; src/registration/RegistrationDates.ts; src/app/employee-portal.js.
