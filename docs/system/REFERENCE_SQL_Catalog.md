# Reference A. SQL source catalog

Generated 22 October 2026 from migration declarations. This is not live drift inspection, dynamic SQL resolution or latest column/index/permission reconstruction. Later declaration entries track revisions. Inspect migrations and deployed catalog.

## Migrations

| Migration | SHA-256 |
|---|---|
| 001_individual_visit_baseline.sql | 976155dd7b5eb1ef15bb13297dfb78dafabda7e6930746f9e3f409b827c6a80d |
| 002_reference_data.sql | 825a021ee1c46098fd8030ed4cd3a2fa20e82eb7248502ab0afde72501b97be6 |
| 003_transaction_security_core.sql | aabce96bce83cad002a3937366af33491df29e1f5ff3be7b7f6bb26d5a25c978 |
| 004_notification_worker_leases.sql | 15e0f3ea5ace50e4228193d5e1e91a15b5d8150f295f0828d9c2208a0cf763bc |
| 005_worker_contract_hardening.sql | 266d3c607606d31d34d689bc4d018f17657ad8f5309ee47ed27fdfa22857fed7 |
| 006_guard_password_authentication.sql | 8fb1e6cacfa92e502d8095d0bb37419f96ea9080171544a6b07298c04f103d45 |
| 007_guard_challenge_generation.sql | fae0d317bb606ea89845914c25e1dcabb41b1ab03422b8b5bffec7d2126d739c |
| 008_registration_and_digital_id.sql | 190ac7020bd0e8f17a809e1dea36c19923941ab0ff9f62f5592c7f1c94d4bd26 |
| 009_registration_snapshot_canonicalization.sql | 9febaabd994b2dd9db2cd607d904e23342f99931ce4661da391073908c7ba330 |
| 010_scoped_visit_reads.sql | 804c34943c557ae94b351ce6118731a2bfda69660d9ba2bc8d92fc55f955c232 |
| 011_reissue_and_print_lifecycle.sql | cf65de1fa30ce449bb03d732349c02a9cf08bb3b0b248b8ef01155e75a91e50f |
| 012_visitor_cards_and_guard_project_context.sql | 204f2bd2d683b621b23dc3edc4790d83cb68d4b243b92d973736967f699bc17f |
| 013_multi_project_guard_scan.sql | b2f5ef92195dea68c117911d6fd855fcb53816a4daae462029cfcd030c311753 |
| 014_trusted_card_details.sql | 66c3a72ad1c2b901984d521e1bf5d19bf82b3f96f96ed82ba9185b0cb5430d16 |
| 015_individual_cancellation.sql | 5935993d4f5aaf737f65dbc6ac12b9c765e0e3a3fbd53eb9667b48886de50704 |
| 016_cancelled_occupant_overlap.sql | 1f9fd9f021ff603d3d932fb1efe2c01465d72ddae504275d57ae2fac16b66ddf |
| 017_scoped_staff_administration.sql | 35d18f9a038710c706b73b25bc74ecd050ab0aaf12c98f868891f0a0ddcca84b |
| 018_staff_role_audit_scope.sql | 22b13cf7660a662cc8939cbb56fe69a7027540eac4f26720515f4ead84eede44 |
| 019_scoped_administration_reads.sql | a1f9e575dcae2b27516f8f9b45b63698d226c881c4e7a2602aab785647bba78b |
| 020_admin_read_boundaries.sql | f342a77f380da5c41daeb907d0c6d7ea976d6d0bc2f886b66389f3b348d27893 |
| 021_registration_locations.sql | 0053095d3ea97d6d234348686f4fc377ac5a1e22c81380d6a40da43e028ece1c |
| 022_qr_key_identifier_validation.sql | 0ed76a444598fdf56d4b57b007148e87e180a55d734150de607910244fce0a65 |
| 023_registration_project_host_options.sql | 30b6498196c4e8df5c00cf1917b4e0a405b909d474d9b360f7da96244d11907e |
| 024_own_digital_id_image.sql | c33435952229e6e6899743a13197e051982424e978ea9ba0b2ebf012eed9a982 |
| 025_reception_workspace.sql | c1fa00647be3fcabbc0e9a59d6954fbde2d76d0ed4c11d44ca48370e19367dab |
| 026_reception_empty_list.sql | 38d72c842a73e2b9cabac0082715a6f1a6f52c55be47e61fc183affda50c991a |
| 027_common_staff_entry.sql | 2b38c57c125cb9b96932709df9f4d77da13089a016390533020f51f31d37a560 |
| 028_guard_email_login.sql | 1457cec2aad1c2048fd4eaae61e39ee0dfe947cc4a92c045eb9cae5579115db3 |
| 029_local_staff_authentication.sql | 578e3e9c30402f19f605d51be7945fa9311aee684400a8b2902fa36a23410bb8 |
| 030_staff_login_provider.sql | 1d49353b68582232914f3df66e54df29fd6134389f3382bccd99086bfa70076c |
| 031_external_reception_context.sql | 5cd2a84b94ab951163333c046b56e897f8b159de7d9dbb608018d9b9561d2e86 |
| 032_project_lead_identity_policy.sql | 24c5c1905c74a7b4f10286ff09e6b80385a093e3f1bcdefc242df5e4bd5195c3 |
| 033_platform_and_scoped_delegation.sql | 96426f1ce753f4c55c2b207fc2c9b86fe86570d66c98b3ad062fe506b235e1e2 |
| 034_staff_discovery_scope.sql | e2d04b43d33ed6b547e08ed8afed41a725d2e917cdf4ad71b6bc7706d2e9ca62 |
| 035_admin_project_lead_workspace.sql | 02488d01ee6d8c36645da6ffb36177d5f8c77e4a93a5a1028365868e1142820f |
| 036_guard_workspace.sql | 0e5637c89d5bfa74dc4f660a883617a868a9fd53db2617ae6545ab3658599f76 |
| 037_guard_pass_lookup.sql | abada4ad6b0a68ada5a2339ee310dd30469015db756fc855a987fb8385129842 |
| 038_guard_lookup_audit.sql | 722cf78aef82257f79efda28012475c7c3543baff5707fc5f8e96b622221bfb9 |
| 039_guard_dashboard_cards.sql | c0c717be5a6d0f49f1d3245da64e1043b1769bb8a901f84cef01e62542379049 |
| 040_guard_visitor_queues.sql | e6195396a9f8dded7c1645ad296e7106caf1b4417108f8bd68f15d29413b42c9 |
| 041_guard_project_filter.sql | fda112288bdaa458ae4d6d6ff8aac64165a8c27a188352349700917c34ae4096 |
| 042_guard_movement_timeline.sql | e2d5ed62944202ca17cdf42297ece9d4f63e0a9df798ff9517e8915a63f01571 |
| 043_movement_timeline_boundaries.sql | 49a244e8afe979de93b242e68d1e1384ac5e4254bf33bbdc994dba3cb2a5e2d9 |
| 044_registration_property_memory.sql | 994c57fd3fb9e8503c31b63a0e9c3af3b3ed1f5a61d1844a430a6b0f81e218f4 |
| 045_preserve_qr_key_alphabet.sql | bcbdc2d825c1f7b1018210b513ed9f2db70ad15814152e10f241b2c73874e92f |
| 046_guard_host_name.sql | 85160f6bb2a04bc3ef7d57599a7215eb9d0bc14fd39ed4fd51bcb73db5155cd5 |
| 047_guard_employee_projects.sql | de440e17c26b94d9df27e05f2ff8b79262d7977129dd469da4ed9c04c05fdb32 |
| 048_employee_office_authorization.sql | 19acc06f3f21057a9b8ba941b5d8d067c14ca5441d32ed00997241d9814ea93a |
| 049_employee_office_card_lifecycle.sql | c9db265e981e9693bbe5d84321ea04f688af9137bb73c88156022fbd08972a67 |
| 050_employee_authorization_query_plans.sql | ac8368d8e440140212a8b244cddf202b622a8931abcb64d8e4c49f0cc912cb5f |
| 051_employee_office_replay_authorization.sql | 75f04e499ab5dfc0f7151903e3f31684e69fc978ef4d05596fc501bdf1eec930 |
| 052_scoped_office_card_revalidation.sql | a98f5d0b5a05b51d999b321086580d5a7e0102240f042789edadda791375dbec |
| 053_guard_duty_contexts.sql | 8ee85c107dd8aec7d70ddc0f77a4e1060f84af39649d36ce961a760d9ccd9d81 |
| 054_guard_duty_workflows.sql | e3fcc9d2c68963bffb520dcbb2f7cb5badee0bd2c1cf87fe1c281b23e925d97d |
| 055_guard_duty_legacy_boundaries.sql | bd0ab1bb076681640bff05656ccc7cf4d735497ff9f4764ea3d41f5a68e8d1b6 |
| 056_common_duty_administration.sql | dc2090136b71188f097b48fcff4716f820e3770df488c7d271545d3c821bcc82 |
| 057_guard_duty_inside_owner.sql | 7ce04c147ac44f5cbd094f5e7f94d63b10fab395626f56af1d24647a9fc38582 |
| 058_guard_duty_input_and_replay.sql | 7b55e51567f55e162a48c88eedd9c1b46cf3b17ed8fb15331037f916030a615b |
| 059_employee_project_presence_identity.sql | 3f4daa1cbe71683c9cfd075b12203fcecfeec6da9835cad872f24d2ae08a6c67 |
| 060_project_presence_conflict_checks.sql | 3738401382916c65a659ed93502b7e86fb8da9481def2cc0adc5260c43ec8cae |
| 061_email_request_workflow.sql | c571c70d31d82266b0575aff1b819f7f207b421ecb5523ee5070bb75fde3d7df |
| 062_outlook_action_decisions.sql | f09848b9e1dfc2817b5a0af92bbdcb9245baaef2fcf15cde52aaa81f89deb1b8 |

## Table declarations (41)

| Object | Declaration / revision migrations |
|---|---|
| gp.AccessEvents | 001 |
| gp.AccessPasses | 001 |
| gp.ApprovalDecisions | 001 |
| gp.Capabilities | 001 |
| gp.CommonAreas | 053 |
| gp.EmployeeEntraIdentities | 062 |
| gp.EmployeeOfficeMemberships | 048 |
| gp.EmployeeProjectAccessEvents | 053 |
| gp.EmployeeProjectLocationMemberships | 048 |
| gp.EmployeeProjectMemberships | 001 |
| gp.EmployeeProjectPresence | 053 |
| gp.Employees | 001 |
| gp.GrantCapabilities | 001 |
| gp.GuardAssignments | 001 |
| gp.GuardAuthSources | 006 |
| gp.GuardCommonAreaAssignments | 053 |
| gp.GuardCredentials | 006 |
| gp.GuardLoginAttempts | 006 |
| gp.GuardSetupTickets | 006 |
| gp.IdempotencyRequests | 001 |
| gp.Locations | 001 |
| gp.NotificationOutbox | 001 |
| gp.PassDeliveryLinks | 001 |
| gp.PassPrintJobs | 001 |
| gp.PassPrintRenderState | 011 |
| gp.PassScanAttempts | 001 |
| gp.PassSecrets | 001 |
| gp.PhotoAssets | 001 |
| gp.ProjectLocations | 001 |
| gp.Projects | 001 |
| gp.RegistrationIntakeAccess | 008 |
| gp.RegistrationIntakes | 001 |
| gp.SchemaMigrations | 001 |
| gp.SecurityAuditEvents | 001 |
| gp.Sessions | 001 |
| gp.StaffProfiles | 029 |
| gp.StaffRoleGrants | 001 |
| gp.TemporaryIdSlots | 001 |
| gp.Users | 001 |
| gp.VisitPresence | 001 |
| gp.VisitRequests | 001 |

## Procedure declarations (97)

| Object | Declaration / revision migrations |
|---|---|
| gp.AllocateGuard | 017, 032 |
| gp.BeginGuardLogin | 006, 007, 028 |
| gp.BeginPassRender | 011, 012, 014 |
| gp.BeginStaffLogin | 029 |
| gp.CancelVisit | 015, 055 |
| gp.ClaimNotifications | 004, 005 |
| gp.CompleteGuardLogin | 006 |
| gp.CompleteGuardSetup | 006 |
| gp.CompleteNotification | 004 |
| gp.CompleteStaffLogin | 029 |
| gp.CompleteStaffSetup | 029 |
| gp.CreateRegistrationIntake | 008 |
| gp.DeallocateGuard | 003 |
| gp.DecideOutlookVisit | 062 |
| gp.DecideVisit | 003, 048 |
| gp.DispatchPassPrint | 011, 014 |
| gp.FailPassPrint | 011 |
| gp.FindGuardPass | 037, 038 |
| gp.FinishPassRender | 011, 014 |
| gp.GetAdminWorkspaceContext | 035, 056 |
| gp.GetCommonDutyAdministration | 056, 058 |
| gp.GetEmailRequestCard | 061 |
| gp.GetEmployeeRequestCard | 061 |
| gp.GetGuardWorkspaceContext | 036 |
| gp.GetNotificationDispatch | 004 |
| gp.GetNotificationEmail | 061 |
| gp.GetOperationalSummary | 019, 020 |
| gp.GetOwnDigitalIdCard | 024 |
| gp.GetPassPrintJob | 011 |
| gp.GetReceptionCardSource | 025 |
| gp.GetReceptionContext | 025, 031 |
| gp.GetRegistrationOptions | 023, 048 |
| gp.GetStaffAccessContext | 027, 033, 035 |
| gp.GetVisitDetail | 010 |
| gp.GrantStaffRole | 017, 018, 032, 033, 035 |
| gp.InspectGuardSetup | 006 |
| gp.InspectStaffSetup | 029 |
| gp.ListAdminGuards | 019, 020 |
| gp.ListAdminProjectLocations | 019 |
| gp.ListGuardDuties | 054 |
| gp.ListGuardDutyVisitors | 054, 057, 058, 059 |
| gp.ListGuardRecentScans | 036, 039 |
| gp.ListGuardVisitors | 040, 041, 046, 047, 048 |
| gp.ListGuardWorkContexts | 012 |
| gp.ListLeadProjects | 035 |
| gp.ListProjectHeads | 035 |
| gp.ListReceptionVisits | 025, 026 |
| gp.ListRegistrationLocations | 021 |
| gp.ListScopedAuditEvents | 019, 020 |
| gp.ListStaffRoles | 019, 033, 034 |
| gp.ListVisits | 010 |
| gp.ManageCommonDuty | 056, 058 |
| gp.ManageGuardCredential | 006, 028 |
| gp.ManageStaffCredential | 029 |
| gp.PurgeGuardAuthTransient | 006 |
| gp.ReadEmailRequest | 061 |
| gp.ReadGuardDutyPass | 054, 058 |
| gp.RecordGuardDutyMovement | 054, 058, 059, 060 |
| gp.RecordMovement | 003, 012, 048, 051, 055 |
| gp.RecordRegistrationPhoto | 008 |
| gp.ReissuePass | 011 |
| gp.RenewNotificationLease | 004, 005 |
| gp.RequestPassPrint | 011 |
| gp.ResolveStaffLoginIdentity | 030 |
| gp.ResolveVisitPhoto | 010 |
| gp.RevokeGuardSession | 006 |
| gp.RevokeStaffRole | 017, 018, 033 |
| gp.RevokeStaffSession | 029 |
| gp.SearchProjectLeadCandidates | 035 |
| gp.SearchStaffSubjects | 019, 033, 034 |
| gp.SubmitRegistration | 008, 009, 016, 044, 048, 055, 061 |
| gp.TouchGuardSession | 006 |
| gp.TouchStaffSession | 029 |
| gp.VerifyGuardPass | 010, 012, 013 |
| gp._AuditFailure | 003 |
| gp._BeginOperation | 003 |
| gp._BeginRegistrationOperation | 008 |
| gp._CompleteOperation | 003 |
| gp._DirectoryCutoff | 003 |
| gp._GuardDutyJson | 054, 059, 060 |
| gp._GuardSourceBudget | 006 |
| gp._NotificationRelevance | 004, 011, 048, 049, 061 |
| gp._ReadPrintCardDetails | 014, 048, 049 |
| gp._RequireActor | 003, 029 |
| gp._RequireAdminReadCapability | 019, 033, 034 |
| gp._RequireGuardCredentialAdmin | 006 |
| gp._RequireOutlookActor | 062 |
| gp._RequirePrintJob | 011 |
| gp._RequirePrintablePass | 011, 049 |
| gp._RequireReceptionLocation | 025 |
| gp._RequireReceptionPass | 011, 051, 052 |
| gp._RequireRegistrationEmployee | 008 |
| gp._RequireRegistrationIntake | 008 |
| gp._RequireRoleAdministrator | 017, 033 |
| gp._RequireStaffCredentialAdmin | 029, 033 |
| gp._TakeLock | 003 |
| gp._VisitReadJson | 010, 015, 042, 043, 046, 047, 048, 055 |

## Role declarations (7)

| Object | Declaration / revision migrations |
|---|---|
| gp_api_runtime | 003 |
| gp_guard_auth_runtime | 006 |
| gp_media_runtime | 010 |
| gp_outlook_runtime | 062 |
| gp_render_runtime | 011 |
| gp_staff_auth_runtime | 029 |
| gp_worker_runtime | 004 |

## View declarations (1)

| Object | Declaration / revision migrations |
|---|---|
| gp.StaffLocalCredentials | 029 |

## Function declarations (16)

| Object | Declaration / revision migrations |
|---|---|
| gp._AdminScopeAllowed | 019, 033, 034 |
| gp._AuditEventReadAllowed | 019 |
| gp._EmployeeOfficeEligible | 048, 050 |
| gp._EmployeeProjectLocationEligible | 048, 050 |
| gp._EmployeeProjectSummary | 047, 048, 050 |
| gp._GuardAllocationEligible | 019, 033 |
| gp._GuardDutyAssigned | 053 |
| gp._GuardDutyVisitAllowed | 053, 059 |
| gp._GuardIdentityEligible | 006 |
| gp._GuardPasswordHashValid | 006 |
| gp._HasCapability | 003, 033, 034 |
| gp._LeadWorkspaceScope | 035 |
| gp._RoleCapabilityAllowed | 017, 029, 033 |
| gp._StaffLocalIdentityEligible | 029, 032, 033 |
| gp._StaffRoleDelegationAllowed | 033 |
| gp._VisitReadAllowed | 010, 033, 048, 050, 055 |
