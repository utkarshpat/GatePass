# 01. Product and workflows

> Current source documentation: **28 October 2026**, migrations **001–118**. See [current release/configuration evidence](../88_Documentation_And_Release_28_October_2026.md), [individual visitor flow](../85_Individual_Visitor_Registration_27_October_2026.md), [runtime .env configuration](../86_Runtime_Environment_Configuration.md) and [organization requirements](../87_Organization_Production_Requirements.md). Earlier exported PDFs, screenshots and dated reports are historical.

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
| EXTERNAL | External visitor, one visitor per registration | Assigned host, independently per person | Starts today; visitor selects inclusive final day; host routing is private |

Employee date input is rejected by the service, not merely hidden. Calendar calculations use Asia/Kolkata. Validity ends at the next local midnight as an exclusive boundary; all pass validity labels display the final included date at 23:59, without changing the stored expiry. External date bounds come from server options, not a client-invented booking limit.

## Employee flow
1. Scan office QR and choose SSI Employee.
2. Authenticate. Corporate SSO/MFA is intended; the current adapter uses an employee test email/password.
3. Fetch identity, primary office, eligible offices and exact project-location memberships from trusted data.
4. For temporary ID, select reason and capture a photo using the live camera. Review, submit, display the digital card and download PNG.
5. For another project, open Add project access, select project, search eligible host by name/email and enter purpose. Host must match the exact requested project-office. This creates an independent approval request.
6. Backend checks reuse an eligible same-day ID. Stale or unauthorized replay cannot bypass revoked entitlement.

A Noida employee does not gain Bengaluru access because the same project operates there. Primary office is directory-supplied, not inferred from the QR/array order. Office membership is explicit. Hosted access does not create permanent directory membership.

## Visitor flow
1. Open office QR and choose Visitor Check-in.
2. Enter name, country-aware mobile and optional email. Flags are local assets; installed phone-library validation does not call a public country API.
3. Each visitor registers separately. Add/remove participant controls and multi-person photo selection are removed; API and SQL reject grouped submissions.
4. Select Valid until, search/select a host in the QR office by name/email, and enter purpose. No public project catalogue/filter is returned. SQL privately resolves the host route; multiple eligible project routes use the lowest project-location key consistently.
5. Capture and adjust the visitor photo using the camera, then review. Desktop places Valid until and Host on one row; mobile stacks them.
6. Submit one independent request and display/download its digital card without requiring email. Pending cards do not bypass approval. The current intake authorizes the card; after intake expiry, supplied-email links or reception lookup remain the retrieval paths.

## Approval and status
External/project requests queue host notices. Ordinary email links open authenticated detail; GET/mail scanners never approve. Explicit POST binds current host authorization, immutable snapshot and retry key. Native Outlook actions are a separate optional implementation, disabled pending organization onboarding.

Temporary ID manager notices are informational. Internal holders reopen authenticated request links; external holders receive signed expiring individual fragment capabilities. Reference numbers alone cannot authorize reads. No employee/host workspace is introduced.

## Explicit exclusions
No floors/zones/checkpoint inventory, face recognition, lost-card replacement portal, mandatory Redis, offline entry decisions or proof of physical printer success in v1. Admin exposes overview, projects/areas/groups, staff permissions, guard assignments, office QR, visit register/export, audit and the action centre. Production wiring and corporate provider acceptance remain incomplete.

Sources: docs/33_Employee_Office_Authorization.md; docs/34_Guard_Duties_and_Project_Presence.md; docs/35_Email_Driven_Request_Workflow.md; src/registration/RegistrationDates.ts; src/app/employee-portal.js.
