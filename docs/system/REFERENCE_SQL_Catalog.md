# SQL source catalogue

Updated 4 November 2026; 136 forward migration files. Declaration provenance is lexical source evidence, not a live catalogue or permission audit. Dynamic ALTER migrations may preserve/change existing definitions without a new literal declaration.

## Migration hashes

| Migration | SHA-256 |
|---|---|
| [001_individual_visit_baseline.sql](../../database/migrations/001_individual_visit_baseline.sql) | `976155dd7b5eb1ef15bb13297dfb78dafabda7e6930746f9e3f409b827c6a80d` |
| [002_reference_data.sql](../../database/migrations/002_reference_data.sql) | `825a021ee1c46098fd8030ed4cd3a2fa20e82eb7248502ab0afde72501b97be6` |
| [003_transaction_security_core.sql](../../database/migrations/003_transaction_security_core.sql) | `aabce96bce83cad002a3937366af33491df29e1f5ff3be7b7f6bb26d5a25c978` |
| [004_notification_worker_leases.sql](../../database/migrations/004_notification_worker_leases.sql) | `15e0f3ea5ace50e4228193d5e1e91a15b5d8150f295f0828d9c2208a0cf763bc` |
| [005_worker_contract_hardening.sql](../../database/migrations/005_worker_contract_hardening.sql) | `266d3c607606d31d34d689bc4d018f17657ad8f5309ee47ed27fdfa22857fed7` |
| [006_guard_password_authentication.sql](../../database/migrations/006_guard_password_authentication.sql) | `8fb1e6cacfa92e502d8095d0bb37419f96ea9080171544a6b07298c04f103d45` |
| [007_guard_challenge_generation.sql](../../database/migrations/007_guard_challenge_generation.sql) | `fae0d317bb606ea89845914c25e1dcabb41b1ab03422b8b5bffec7d2126d739c` |
| [008_registration_and_digital_id.sql](../../database/migrations/008_registration_and_digital_id.sql) | `190ac7020bd0e8f17a809e1dea36c19923941ab0ff9f62f5592c7f1c94d4bd26` |
| [009_registration_snapshot_canonicalization.sql](../../database/migrations/009_registration_snapshot_canonicalization.sql) | `9febaabd994b2dd9db2cd607d904e23342f99931ce4661da391073908c7ba330` |
| [010_scoped_visit_reads.sql](../../database/migrations/010_scoped_visit_reads.sql) | `804c34943c557ae94b351ce6118731a2bfda69660d9ba2bc8d92fc55f955c232` |
| [011_reissue_and_print_lifecycle.sql](../../database/migrations/011_reissue_and_print_lifecycle.sql) | `cf65de1fa30ce449bb03d732349c02a9cf08bb3b0b248b8ef01155e75a91e50f` |
| [012_visitor_cards_and_guard_project_context.sql](../../database/migrations/012_visitor_cards_and_guard_project_context.sql) | `204f2bd2d683b621b23dc3edc4790d83cb68d4b243b92d973736967f699bc17f` |
| [013_multi_project_guard_scan.sql](../../database/migrations/013_multi_project_guard_scan.sql) | `b2f5ef92195dea68c117911d6fd855fcb53816a4daae462029cfcd030c311753` |
| [014_trusted_card_details.sql](../../database/migrations/014_trusted_card_details.sql) | `66c3a72ad1c2b901984d521e1bf5d19bf82b3f96f96ed82ba9185b0cb5430d16` |
| [015_individual_cancellation.sql](../../database/migrations/015_individual_cancellation.sql) | `5935993d4f5aaf737f65dbc6ac12b9c765e0e3a3fbd53eb9667b48886de50704` |
| [016_cancelled_occupant_overlap.sql](../../database/migrations/016_cancelled_occupant_overlap.sql) | `1f9fd9f021ff603d3d932fb1efe2c01465d72ddae504275d57ae2fac16b66ddf` |
| [017_scoped_staff_administration.sql](../../database/migrations/017_scoped_staff_administration.sql) | `35d18f9a038710c706b73b25bc74ecd050ab0aaf12c98f868891f0a0ddcca84b` |
| [018_staff_role_audit_scope.sql](../../database/migrations/018_staff_role_audit_scope.sql) | `22b13cf7660a662cc8939cbb56fe69a7027540eac4f26720515f4ead84eede44` |
| [019_scoped_administration_reads.sql](../../database/migrations/019_scoped_administration_reads.sql) | `a1f9e575dcae2b27516f8f9b45b63698d226c881c4e7a2602aab785647bba78b` |
| [020_admin_read_boundaries.sql](../../database/migrations/020_admin_read_boundaries.sql) | `f342a77f380da5c41daeb907d0c6d7ea976d6d0bc2f886b66389f3b348d27893` |
| [021_registration_locations.sql](../../database/migrations/021_registration_locations.sql) | `0053095d3ea97d6d234348686f4fc377ac5a1e22c81380d6a40da43e028ece1c` |
| [022_qr_key_identifier_validation.sql](../../database/migrations/022_qr_key_identifier_validation.sql) | `0ed76a444598fdf56d4b57b007148e87e180a55d734150de607910244fce0a65` |
| [023_registration_project_host_options.sql](../../database/migrations/023_registration_project_host_options.sql) | `30b6498196c4e8df5c00cf1917b4e0a405b909d474d9b360f7da96244d11907e` |
| [024_own_digital_id_image.sql](../../database/migrations/024_own_digital_id_image.sql) | `c33435952229e6e6899743a13197e051982424e978ea9ba0b2ebf012eed9a982` |
| [025_reception_workspace.sql](../../database/migrations/025_reception_workspace.sql) | `c1fa00647be3fcabbc0e9a59d6954fbde2d76d0ed4c11d44ca48370e19367dab` |
| [026_reception_empty_list.sql](../../database/migrations/026_reception_empty_list.sql) | `38d72c842a73e2b9cabac0082715a6f1a6f52c55be47e61fc183affda50c991a` |
| [027_common_staff_entry.sql](../../database/migrations/027_common_staff_entry.sql) | `2b38c57c125cb9b96932709df9f4d77da13089a016390533020f51f31d37a560` |
| [028_guard_email_login.sql](../../database/migrations/028_guard_email_login.sql) | `1457cec2aad1c2048fd4eaae61e39ee0dfe947cc4a92c045eb9cae5579115db3` |
| [029_local_staff_authentication.sql](../../database/migrations/029_local_staff_authentication.sql) | `578e3e9c30402f19f605d51be7945fa9311aee684400a8b2902fa36a23410bb8` |
| [030_staff_login_provider.sql](../../database/migrations/030_staff_login_provider.sql) | `1d49353b68582232914f3df66e54df29fd6134389f3382bccd99086bfa70076c` |
| [031_external_reception_context.sql](../../database/migrations/031_external_reception_context.sql) | `5cd2a84b94ab951163333c046b56e897f8b159de7d9dbb608018d9b9561d2e86` |
| [032_project_lead_identity_policy.sql](../../database/migrations/032_project_lead_identity_policy.sql) | `24c5c1905c74a7b4f10286ff09e6b80385a093e3f1bcdefc242df5e4bd5195c3` |
| [033_platform_and_scoped_delegation.sql](../../database/migrations/033_platform_and_scoped_delegation.sql) | `96426f1ce753f4c55c2b207fc2c9b86fe86570d66c98b3ad062fe506b235e1e2` |
| [034_staff_discovery_scope.sql](../../database/migrations/034_staff_discovery_scope.sql) | `e2d04b43d33ed6b547e08ed8afed41a725d2e917cdf4ad71b6bc7706d2e9ca62` |
| [035_admin_project_lead_workspace.sql](../../database/migrations/035_admin_project_lead_workspace.sql) | `02488d01ee6d8c36645da6ffb36177d5f8c77e4a93a5a1028365868e1142820f` |
| [036_guard_workspace.sql](../../database/migrations/036_guard_workspace.sql) | `0e5637c89d5bfa74dc4f660a883617a868a9fd53db2617ae6545ab3658599f76` |
| [037_guard_pass_lookup.sql](../../database/migrations/037_guard_pass_lookup.sql) | `abada4ad6b0a68ada5a2339ee310dd30469015db756fc855a987fb8385129842` |
| [038_guard_lookup_audit.sql](../../database/migrations/038_guard_lookup_audit.sql) | `722cf78aef82257f79efda28012475c7c3543baff5707fc5f8e96b622221bfb9` |
| [039_guard_dashboard_cards.sql](../../database/migrations/039_guard_dashboard_cards.sql) | `c0c717be5a6d0f49f1d3245da64e1043b1769bb8a901f84cef01e62542379049` |
| [040_guard_visitor_queues.sql](../../database/migrations/040_guard_visitor_queues.sql) | `e6195396a9f8dded7c1645ad296e7106caf1b4417108f8bd68f15d29413b42c9` |
| [041_guard_project_filter.sql](../../database/migrations/041_guard_project_filter.sql) | `fda112288bdaa458ae4d6d6ff8aac64165a8c27a188352349700917c34ae4096` |
| [042_guard_movement_timeline.sql](../../database/migrations/042_guard_movement_timeline.sql) | `e2d5ed62944202ca17cdf42297ece9d4f63e0a9df798ff9517e8915a63f01571` |
| [043_movement_timeline_boundaries.sql](../../database/migrations/043_movement_timeline_boundaries.sql) | `49a244e8afe979de93b242e68d1e1384ac5e4254bf33bbdc994dba3cb2a5e2d9` |
| [044_registration_property_memory.sql](../../database/migrations/044_registration_property_memory.sql) | `994c57fd3fb9e8503c31b63a0e9c3af3b3ed1f5a61d1844a430a6b0f81e218f4` |
| [045_preserve_qr_key_alphabet.sql](../../database/migrations/045_preserve_qr_key_alphabet.sql) | `bcbdc2d825c1f7b1018210b513ed9f2db70ad15814152e10f241b2c73874e92f` |
| [046_guard_host_name.sql](../../database/migrations/046_guard_host_name.sql) | `85160f6bb2a04bc3ef7d57599a7215eb9d0bc14fd39ed4fd51bcb73db5155cd5` |
| [047_guard_employee_projects.sql](../../database/migrations/047_guard_employee_projects.sql) | `de440e17c26b94d9df27e05f2ff8b79262d7977129dd469da4ed9c04c05fdb32` |
| [048_employee_office_authorization.sql](../../database/migrations/048_employee_office_authorization.sql) | `19acc06f3f21057a9b8ba941b5d8d067c14ca5441d32ed00997241d9814ea93a` |
| [049_employee_office_card_lifecycle.sql](../../database/migrations/049_employee_office_card_lifecycle.sql) | `c9db265e981e9693bbe5d84321ea04f688af9137bb73c88156022fbd08972a67` |
| [050_employee_authorization_query_plans.sql](../../database/migrations/050_employee_authorization_query_plans.sql) | `ac8368d8e440140212a8b244cddf202b622a8931abcb64d8e4c49f0cc912cb5f` |
| [051_employee_office_replay_authorization.sql](../../database/migrations/051_employee_office_replay_authorization.sql) | `75f04e499ab5dfc0f7151903e3f31684e69fc978ef4d05596fc501bdf1eec930` |
| [052_scoped_office_card_revalidation.sql](../../database/migrations/052_scoped_office_card_revalidation.sql) | `a98f5d0b5a05b51d999b321086580d5a7e0102240f042789edadda791375dbec` |
| [053_guard_duty_contexts.sql](../../database/migrations/053_guard_duty_contexts.sql) | `8ee85c107dd8aec7d70ddc0f77a4e1060f84af39649d36ce961a760d9ccd9d81` |
| [054_guard_duty_workflows.sql](../../database/migrations/054_guard_duty_workflows.sql) | `e3fcc9d2c68963bffb520dcbb2f7cb5badee0bd2c1cf87fe1c281b23e925d97d` |
| [055_guard_duty_legacy_boundaries.sql](../../database/migrations/055_guard_duty_legacy_boundaries.sql) | `bd0ab1bb076681640bff05656ccc7cf4d735497ff9f4764ea3d41f5a68e8d1b6` |
| [056_common_duty_administration.sql](../../database/migrations/056_common_duty_administration.sql) | `dc2090136b71188f097b48fcff4716f820e3770df488c7d271545d3c821bcc82` |
| [057_guard_duty_inside_owner.sql](../../database/migrations/057_guard_duty_inside_owner.sql) | `7ce04c147ac44f5cbd094f5e7f94d63b10fab395626f56af1d24647a9fc38582` |
| [058_guard_duty_input_and_replay.sql](../../database/migrations/058_guard_duty_input_and_replay.sql) | `7b55e51567f55e162a48c88eedd9c1b46cf3b17ed8fb15331037f916030a615b` |
| [059_employee_project_presence_identity.sql](../../database/migrations/059_employee_project_presence_identity.sql) | `3f4daa1cbe71683c9cfd075b12203fcecfeec6da9835cad872f24d2ae08a6c67` |
| [060_project_presence_conflict_checks.sql](../../database/migrations/060_project_presence_conflict_checks.sql) | `3738401382916c65a659ed93502b7e86fb8da9481def2cc0adc5260c43ec8cae` |
| [061_email_request_workflow.sql](../../database/migrations/061_email_request_workflow.sql) | `c571c70d31d82266b0575aff1b819f7f207b421ecb5523ee5070bb75fde3d7df` |
| [062_outlook_action_decisions.sql](../../database/migrations/062_outlook_action_decisions.sql) | `f09848b9e1dfc2817b5a0af92bbdcb9245baaef2fcf15cde52aaa81f89deb1b8` |
| [063_guard_visitor_reconciliation.sql](../../database/migrations/063_guard_visitor_reconciliation.sql) | `41bf508db0a00f856270fe9ba1af43d7de730fb18e03005ca7fd3b5a97e5b195` |
| [064_presence_reads_and_visitor_mobile.sql](../../database/migrations/064_presence_reads_and_visitor_mobile.sql) | `036f0184ee93c621ff0b3cda27cfed1addf7a19acefdc44ba84744bda3d4f2f7` |
| [065_reception_operations.sql](../../database/migrations/065_reception_operations.sql) | `02b3306b0758412b4fda3bb01d968b48bee78c3adf83563e2652b54c6178357a` |
| [066_reception_intake_audit_type.sql](../../database/migrations/066_reception_intake_audit_type.sql) | `15068f7f20c647953b83f168a893494969e1da7018ea1b00afe3b21ed92c32a5` |
| [067_reception_employee_timeline.sql](../../database/migrations/067_reception_employee_timeline.sql) | `6745d6396979ae6cb87b36cd9a7eecd55505a20bf7509f4f2ad7297bd495ca40` |
| [068_host_reminders.sql](../../database/migrations/068_host_reminders.sql) | `0838c80355fc93bef1ea0c1e58273f1b69c08348adfc45c48edbb43583a14f14` |
| [069_reminder_pass_state.sql](../../database/migrations/069_reminder_pass_state.sql) | `142a62a65515ba5d1f8e92e74a8b575068a1dfec7a266350688ec67352cacf28` |
| [070_admin_console_reads.sql](../../database/migrations/070_admin_console_reads.sql) | `33352a7b26a0ce9af7a9125843968de0acd1978aeca8d30902d51ad9b1056560` |
| [071_printed_pass_returns.sql](../../database/migrations/071_printed_pass_returns.sql) | `7b648178f1b60626e0a9a054a1d3b3f026622e633a52d35ac6473473814743a1` |
| [072_returned_entry_replay.sql](../../database/migrations/072_returned_entry_replay.sql) | `38764388483e07d963cb633af5418df549582e8cec6b932480e623962236fe96` |
| [073_returned_visit_registration.sql](../../database/migrations/073_returned_visit_registration.sql) | `b627dc7f9080e4d7e9b00156049f9762253479c2ab0f72a25be1c87ef0101327` |
| [074_returned_lifecycle_and_scope_guards.sql](../../database/migrations/074_returned_lifecycle_and_scope_guards.sql) | `bf30c1af8cccc423cac074fd4952666ae787aafa9a2dd1b6ec226cf523659b86` |
| [075_common_duty_session_fencing.sql](../../database/migrations/075_common_duty_session_fencing.sql) | `9d0ca77f920eafb8c482eb9fcecf9f8a76670c8156052cc85d1dd3de65baa76a` |
| [076_visitor_company_and_devices.sql](../../database/migrations/076_visitor_company_and_devices.sql) | `da5fc566858e955adb613bdb2c6b18e19d9222a6dacaa182c7d894f328ba6b5b` |
| [077_admin_visit_register.sql](../../database/migrations/077_admin_visit_register.sql) | `59a9f76f78ce80fe6cb2fdc6d2e8cfd01ed4f9be730370d7ddcabf4dac481cd9` |
| [078_register_movements_and_presence.sql](../../database/migrations/078_register_movements_and_presence.sql) | `0c321a346c3cd25ac334f65ddecb4c2281bddc17f07c3444d0c37bef488be7f5` |
| [079_email_visitor_details.sql](../../database/migrations/079_email_visitor_details.sql) | `0d926558059c759927619aa1ac1fc09d78ff0c95a34e53374147cb4917bbca5f` |
| [080_reception_lookup_and_return_correction.sql](../../database/migrations/080_reception_lookup_and_return_correction.sql) | `6aa24e3edb1dfa726d443f60ca10dac2079d393f58cf906f2317d87656748c48` |
| [081_local_staff_onboarding.sql](../../database/migrations/081_local_staff_onboarding.sql) | `87e7058849d24f018ff0f30b4431b9d257da62e907b81ea5d291a789a5017bd6` |
| [082_local_account_authority.sql](../../database/migrations/082_local_account_authority.sql) | `e473934f8e9856e59b2211857bca5a43c1eb528b6cc2471c739a636b6362972d` |
| [083_staff_login_hyphens.sql](../../database/migrations/083_staff_login_hyphens.sql) | `c66e9656ac7baf73d3d45150bddb1dffcad7e59ceb1c84e9686cc0020f58bd67` |
| [084_bounded_device_canonicalization.sql](../../database/migrations/084_bounded_device_canonicalization.sql) | `4eab8817baa68e0e5054735bcad1f5a0c43d3a0f5951d6b72f70ea7d0d241486` |
| [085_audit_window_overflow_guard.sql](../../database/migrations/085_audit_window_overflow_guard.sql) | `eba2c630e7879678c49c8b77817fdea17f3f542e5bf9a1bba5d356ed2f9abfcb` |
| [086_scoped_project_creation.sql](../../database/migrations/086_scoped_project_creation.sql) | `4a89443af907ebf21164dc78ff592e7d2c232748b3091a3fd40d3d03ba58d162` |
| [087_project_code_hyphens.sql](../../database/migrations/087_project_code_hyphens.sql) | `33065ba31a627c1a9f9b1992cff9f7e0adc06af6f976e507c7fea51c1c0fa6db` |
| [088_notification_person_photos.sql](../../database/migrations/088_notification_person_photos.sql) | `49625ca8dfa7ffb97b685772ebaff263caeeeafc60c696e808096fbfc5ddcd64` |
| [089_consistent_register_exports.sql](../../database/migrations/089_consistent_register_exports.sql) | `b13fa231e3b4bbfaeaca65309dd766907b266b0af986617dbd6d7b7e7077d4e3` |
| [090_email_holder_revocation.sql](../../database/migrations/090_email_holder_revocation.sql) | `e210aa4aabe5638bfd1f62190b907841b4757f42f7ce8aa227cdc10137fea4d3` |
| [091_operational_summary_range.sql](../../database/migrations/091_operational_summary_range.sql) | `1462d6f259b467dea65e5fec9ee66597d7e3fd9bb609e85bdb189e3cf36a1b6b` |
| [092_workspace_queue_paging.sql](../../database/migrations/092_workspace_queue_paging.sql) | `bffe70c97c1f79eb1b013b27a1c79a5710543e6981739e57bebcb897c383a6df` |
| [093_action_centre.sql](../../database/migrations/093_action_centre.sql) | `1a64436a921d1b688cedfd3a2e0cf8c91ecc14eb95c8d457ab38dd5f30710b24` |
| [094_action_read_fencing.sql](../../database/migrations/094_action_read_fencing.sql) | `fde8bbdce1d05af1b5a70486a9359d72a7153a7967270a1bf9ac439f1fd5b165` |
| [095_reception_owned_return_followups.sql](../../database/migrations/095_reception_owned_return_followups.sql) | `f4bae57bb56322924e168c52ab3fb6d564da4dc2471e438cd64b730506d08dcd` |
| [096_action_centre_reminders.sql](../../database/migrations/096_action_centre_reminders.sql) | `1ff451401b7a63ba42abc09621957a411f8fe043e9135e58eaec60659c30a6c3` |
| [097_admin_digital_id_detail_presence.sql](../../database/migrations/097_admin_digital_id_detail_presence.sql) | `474454cb64ef5342a7c45341c64a471dc5bdeebd26642875568b8db369e89633` |
| [098_digital_id_presence_followups.sql](../../database/migrations/098_digital_id_presence_followups.sql) | `fc05429d8756fd35fa48df7a88ed5528508edf9b0cb3d3b2032b5d93a7a7a8d4` |
| [099_employee_presence_and_export_authority.sql](../../database/migrations/099_employee_presence_and_export_authority.sql) | `1edcc8a3af34dfe21a32d3d4dd27f1cdfc022a5581a63226d96e969cd815d33e` |
| [100_scoped_read_sets_and_windows.sql](../../database/migrations/100_scoped_read_sets_and_windows.sql) | `e60442bac3d7049303d22b10776602a09b063fd1d571e3ea393ddeea02d82f26` |
| [101_presence_projection_and_guard_photos.sql](../../database/migrations/101_presence_projection_and_guard_photos.sql) | `542aafa2915bd8ccd296907c47ad0d71dcde4815bfa032cfae86e39c9459f018` |
| [102_static_register_paging_and_catalogue_search.sql](../../database/migrations/102_static_register_paging_and_catalogue_search.sql) | `ba442623b119bee5456b84344db4a662454147ec6e14ba7bd1ee9e7cf341f1a1` |
| [103_guard_thumbnail_content_versions.sql](../../database/migrations/103_guard_thumbnail_content_versions.sql) | `8e913e97ed764e942dae54a16a062cd24999d17e798b5f9e1c3f3c8a69f5fb87` |
| [104_bounded_consistent_export_snapshots.sql](../../database/migrations/104_bounded_consistent_export_snapshots.sql) | `70f245a86819c9dc6d0959a0a8a90e6ef9b2d0a29dfc11aa1450deb09d6d9291` |
| [105_ordered_snapshot_slices_and_completion_bounds.sql](../../database/migrations/105_ordered_snapshot_slices_and_completion_bounds.sql) | `ddc560c1abc587c123a941490cbb3bbc6f595bf4afd1ffc44d9bf5732428aa54` |
| [106_owner_bound_export_snapshot_cancellation.sql](../../database/migrations/106_owner_bound_export_snapshot_cancellation.sql) | `0ec832145de061f928c75c667e0f5605a52784cd8ba5f2b2a7c78e3a2167850c` |
| [107_export_snapshot_storage_budget.sql](../../database/migrations/107_export_snapshot_storage_budget.sql) | `1d0a27dd6ea08e5336dce9ca6c1397d3a6dcc3ccc9f2f47c768f052fb21d033f` |
| [108_searchable_catalogue_local_project_freshness.sql](../../database/migrations/108_searchable_catalogue_local_project_freshness.sql) | `51e8778a29b091aa600744e4f1f6e18ee8b7e3d4e380d1a132b071cf3c94025f` |
| [109_empty_workspace_queue_arrays.sql](../../database/migrations/109_empty_workspace_queue_arrays.sql) | `313c321138a5e0c9fe11420a37fb3bd8d61fd257550888b906d757acfa06c866` |
| [110_project_groups_and_guard_assignments.sql](../../database/migrations/110_project_groups_and_guard_assignments.sql) | `e71f37efd64ae81e94ffb0fe20acd8f04c19ac2d9550c18ffbc59664f7f68713` |
| [111_preserve_local_project_group_assignment_policy.sql](../../database/migrations/111_preserve_local_project_group_assignment_policy.sql) | `b7c6a8574f8c1401ed4454f3beb73bfc7c4ee55df49a01aec9a75c91c8644651` |
| [112_narrow_register_ordering_and_memory_grants.sql](../../database/migrations/112_narrow_register_ordering_and_memory_grants.sql) | `aff6cb703ebf87b8810e8f1be94479b9d86020863c50b3c7d5a1ef0b7596e28a` |
| [113_register_json_subquery_compatibility.sql](../../database/migrations/113_register_json_subquery_compatibility.sql) | `8ae1d74d057ef0ecd829ee364e8d9579e574006e7eaf05e3799bbb056853ca38` |
| [114_narrow_register_display_lookups.sql](../../database/migrations/114_narrow_register_display_lookups.sql) | `b69d287d337722e88d8fd83dc42f895470d216ea35d101da17c68a951c45367a` |
| [115_bound_register_utc_projection_width.sql](../../database/migrations/115_bound_register_utc_projection_width.sql) | `932c26d8e9586ac6592511148a4f5f1657e2d4fbaa18bed27031202a27c0b192` |
| [116_individual_visitor_registration.sql](../../database/migrations/116_individual_visitor_registration.sql) | `7b253e365e1e7b6589bbdb41ee67e81afe76347d53fbb7550ade268ee60afe97` |
| [117_multiday_visitor_queues.sql](../../database/migrations/117_multiday_visitor_queues.sql) | `7ce8749bd9c14b592dd9c1ee096a7c9ec38b17f3ddd60d57ec3807fc81381835` |
| [118_preserve_visitor_device_memory_bounds.sql](../../database/migrations/118_preserve_visitor_device_memory_bounds.sql) | `6f4453a576610ed7c95f34f37d46721d9b4b9f02060f0e990fb9398004c39247` |
| [119_account_host_allowlists.sql](../../database/migrations/119_account_host_allowlists.sql) | `124ea32d2262bc6769fc2389e96282ffec224f0dc8a7fe66a8cdd0fcce7cdd3a` |
| [120_account_host_management_visibility.sql](../../database/migrations/120_account_host_management_visibility.sql) | `792e0c216115d73457595fc629c248d1d0d5b6d80f169bd89873cf8041c62533` |
| [121_account_host_audit_details.sql](../../database/migrations/121_account_host_audit_details.sql) | `e8f810acdbdaa40842cd4f1199435c61eab212e80dab4702e84fcfd6cc715c3a` |
| [122_sub_project_planning_catalogue.sql](../../database/migrations/122_sub_project_planning_catalogue.sql) | `48a695a5e35ddb8df00093f380b9571e365489f14168ee0576ee725873d2cb9f` |
| [123_visit_coordination_foundation.sql](../../database/migrations/123_visit_coordination_foundation.sql) | `b159f98a2d1edfeb84dd71a40d50e4def52f24e7e40a8f6aed336b55eb20f429` |
| [124_visit_coordination_permissions.sql](../../database/migrations/124_visit_coordination_permissions.sql) | `6e711926f338f96a77c7d4fe0d88214346812eb40a59c40b1099b4c2ba9a91bf` |
| [125_visit_planning_management.sql](../../database/migrations/125_visit_planning_management.sql) | `fec9eed98fc35c4bab65bf201bf92a9c0468e02d9d52ef15f6d9d1c65ccabf5f` |
| [126_visit_coordination_commands.sql](../../database/migrations/126_visit_coordination_commands.sql) | `80622f68e3ac5cb8825550d043bbb2627130661b18c6d10a577ee954dfada99d` |
| [127_visit_coordination_reads.sql](../../database/migrations/127_visit_coordination_reads.sql) | `719de66518db64271b4bc28f4cb3f876b85aa92e61bf5dfabfc5a9d6c2cd950b` |
| [128_location_sponsored_cross_account_planning.sql](../../database/migrations/128_location_sponsored_cross_account_planning.sql) | `140659d326bf6a7dc85b8d94698fcfcb157bc9e3c63d30da3736b09810ce6706` |
| [129_planned_pass_binding_and_sub_project_movement.sql](../../database/migrations/129_planned_pass_binding_and_sub_project_movement.sql) | `5a261cf5cef028ecf042371858168926ceaa5deec96787519352996205a60a69` |
| [130_planned_pass_cancellation_lifecycle.sql](../../database/migrations/130_planned_pass_cancellation_lifecycle.sql) | `9a4ddfd448af2cc42a3ae029b5ba08f3889cc2ec150f385d82beb3862a92ee82` |
| [131_coordination_only_restore_operational_flow.sql](../../database/migrations/131_coordination_only_restore_operational_flow.sql) | `c5ab735b94bf7fe0b435564510fe31cf3d0b5c3b5519c1afe67cd8d0e056a25a` |
| [132_coordination_notification_dispatch.sql](../../database/migrations/132_coordination_notification_dispatch.sql) | `755603c1d08c1f1f4163edcf7c720a0a3968bb92be7bb9330b5144303494b258` |
| [133_visit_preparation_and_additional_people.sql](../../database/migrations/133_visit_preparation_and_additional_people.sql) | `f4d97bf17a4a0344de23ee6fb6757ae58eeb377f52a04cb72a40a9723bec1013` |
| [134_scoped_planning_routing_and_preparation_reads.sql](../../database/migrations/134_scoped_planning_routing_and_preparation_reads.sql) | `c9c5deacce840e0ccf0ca60c605023219a6c2a418554c87acbe79307b0b2b6ca` |
| [135_visit_routing_groups.sql](../../database/migrations/135_visit_routing_groups.sql) | `f0feccab80a8accf30b7b7360227e3df62a3c9e0a01f000f670ebf1c0789374c` |
| [136_visit_group_catalogue_and_notifications.sql](../../database/migrations/136_visit_group_catalogue_and_notifications.sql) | `3457d1ce16a80bbf119ec7e4f6404225b5e81e83e028a80ebfa46fc95f5feba2` |

## Object declaration provenance

| Kind | Object | Declaration/change migrations |
|---|---|---|
| FUNCTION | `gp._AccountHostEligible` | 119 |
| FUNCTION | `gp._AdminScopeAllowed` | 019, 033, 034 |
| FUNCTION | `gp._AuditEventReadAllowed` | 019 |
| FUNCTION | `gp._CanProvisionStaff` | 081, 082 |
| FUNCTION | `gp._EmployeeOfficeEligible` | 048, 050 |
| FUNCTION | `gp._EmployeeProjectLocationEligible` | 048, 050 |
| FUNCTION | `gp._EmployeeProjectOccupied` | 099 |
| FUNCTION | `gp._EmployeeProjectSummary` | 047, 048, 050 |
| FUNCTION | `gp._GuardAllocationEligible` | 019, 033 |
| FUNCTION | `gp._GuardDutyAssigned` | 053 |
| FUNCTION | `gp._GuardDutyVisitAllowed` | 053, 059 |
| FUNCTION | `gp._GuardIdentityEligible` | 006 |
| FUNCTION | `gp._GuardPasswordHashValid` | 006 |
| FUNCTION | `gp._HasCapability` | 003, 033, 034 |
| FUNCTION | `gp._LeadWorkspaceScope` | 035 |
| FUNCTION | `gp._OperationsScopeAllowed` | 093 |
| FUNCTION | `gp._PersonInsideOffice` | 071 |
| FUNCTION | `gp._PlanFullManager` | 124 |
| FUNCTION | `gp._PlanLiveApprover` | 124 |
| FUNCTION | `gp._PlanLiveTaskOwner` | 124 |
| FUNCTION | `gp._PlanOfficeParticipant` | 124 |
| FUNCTION | `gp._PlanPolicyFresh` | 124 |
| FUNCTION | `gp._PlanPreparationRead` | 134 |
| FUNCTION | `gp._PlanProjectReadable` | 124 |
| FUNCTION | `gp._PlanReadiness` | 124 |
| FUNCTION | `gp._PlanStepStatus` | 124 |
| FUNCTION | `gp._PlanThreadReadable` | 124 |
| FUNCTION | `gp._PlanVisible` | 124 |
| FUNCTION | `gp._PlannedDestinationReady` | 129 |
| FUNCTION | `gp._PlanningAdmin` | 124 |
| FUNCTION | `gp._PlanningAvailable` | 124 |
| FUNCTION | `gp._PlanningHost` | 124, 128 |
| FUNCTION | `gp._PlanningInternal` | 124 |
| FUNCTION | `gp._PlanningMailAudience` | 132 |
| FUNCTION | `gp._PlanningSponsor` | 128 |
| FUNCTION | `gp._ProjectCurrent` | 086 |
| FUNCTION | `gp._ProjectGroupGuardEligible` | 110 |
| FUNCTION | `gp._RoleCapabilityAllowed` | 017, 029, 033 |
| FUNCTION | `gp._StaffLocalIdentityEligible` | 029, 032, 033 |
| FUNCTION | `gp._StaffRoleDelegationAllowed` | 033 |
| FUNCTION | `gp._VisitGroupProjection` | 136 |
| FUNCTION | `gp._VisitReadAllowed` | 010, 033, 048, 050, 055 |
| PROCEDURE | `gp.AllocateGuard` | 017, 032, 110 |
| PROCEDURE | `gp.AuditReceptionRegistration` | 065, 066 |
| PROCEDURE | `gp.BeginGuardLogin` | 006, 007, 028 |
| PROCEDURE | `gp.BeginPassRender` | 011, 012, 014 |
| PROCEDURE | `gp.BeginStaffLogin` | 029 |
| PROCEDURE | `gp.CancelVisit` | 015, 055, 074, 098 |
| PROCEDURE | `gp.ChangePlannedVisit` | 126 |
| PROCEDURE | `gp.ClaimNotifications` | 004, 005 |
| PROCEDURE | `gp.ClaimPlanningNotifications` | 132 |
| PROCEDURE | `gp.CompleteGuardLogin` | 006 |
| PROCEDURE | `gp.CompleteGuardSetup` | 006 |
| PROCEDURE | `gp.CompleteNotification` | 004 |
| PROCEDURE | `gp.CompletePlanningNotification` | 132 |
| PROCEDURE | `gp.CompleteStaffLogin` | 029 |
| PROCEDURE | `gp.CompleteStaffSetup` | 029 |
| PROCEDURE | `gp.CorrectReceptionReturn` | 080 |
| PROCEDURE | `gp.CreateLocalStaffAccount` | 081 |
| PROCEDURE | `gp.CreatePlannedVisit` | 126 |
| PROCEDURE | `gp.CreateRegistrationIntake` | 008 |
| PROCEDURE | `gp.CreateScopedProject` | 086 |
| PROCEDURE | `gp.DeallocateGuard` | 003, 110 |
| PROCEDURE | `gp.DecideOutlookVisit` | 062 |
| PROCEDURE | `gp.DecideVisit` | 003, 048 |
| PROCEDURE | `gp.DispatchPassPrint` | 011, 014 |
| PROCEDURE | `gp.FailPassPrint` | 011 |
| PROCEDURE | `gp.FindGuardPass` | 037, 038 |
| PROCEDURE | `gp.FinishPassRender` | 011, 014 |
| PROCEDURE | `gp.GetAdminConsoleScope` | 070, 081, 099, 110 |
| PROCEDURE | `gp.GetAdminProjectGroups` | 110 |
| PROCEDURE | `gp.GetAdminWorkspaceContext` | 035, 056 |
| PROCEDURE | `gp.GetCommonDutyAdministration` | 056, 058 |
| PROCEDURE | `gp.GetEmailRequestCard` | 061 |
| PROCEDURE | `gp.GetEmployeeRequestCard` | 061 |
| PROCEDURE | `gp.GetGuardWorkspaceContext` | 036 |
| PROCEDURE | `gp.GetNotificationDispatch` | 004 |
| PROCEDURE | `gp.GetNotificationEmail` | 061, 079 |
| PROCEDURE | `gp.GetOperationalSummary` | 019, 020, 064 |
| PROCEDURE | `gp.GetOperationalSummaryRange` | 091, 100 |
| PROCEDURE | `gp.GetOwnDigitalIdCard` | 024 |
| PROCEDURE | `gp.GetPassPrintJob` | 011 |
| PROCEDURE | `gp.GetPlanningNotification` | 132 |
| PROCEDURE | `gp.GetPublicRegistrationCard` | 116 |
| PROCEDURE | `gp.GetReceptionCardSource` | 025 |
| PROCEDURE | `gp.GetReceptionContext` | 025, 031 |
| PROCEDURE | `gp.GetReceptionEmployeeTimeline` | 067, 074 |
| PROCEDURE | `gp.GetRegistrationOptions` | 023, 048, 116 |
| PROCEDURE | `gp.GetStaffAccessContext` | 027, 033, 035 |
| PROCEDURE | `gp.GetVisitDetail` | 010, 097, 098 |
| PROCEDURE | `gp.GrantStaffRole` | 017, 018, 032, 033, 035 |
| PROCEDURE | `gp.InspectGuardSetup` | 006 |
| PROCEDURE | `gp.InspectStaffSetup` | 029 |
| PROCEDURE | `gp.ListAdminGuardAssignments` | 070, 110 |
| PROCEDURE | `gp.ListAdminGuards` | 019, 020 |
| PROCEDURE | `gp.ListAdminProjectLocations` | 019 |
| PROCEDURE | `gp.ListGuardDuties` | 054 |
| PROCEDURE | `gp.ListGuardDutyVisitors` | 054, 057, 058, 059 |
| PROCEDURE | `gp.ListGuardRecentScans` | 036, 039 |
| PROCEDURE | `gp.ListGuardVisitors` | 040, 041, 046, 047, 048 |
| PROCEDURE | `gp.ListGuardWorkContexts` | 012 |
| PROCEDURE | `gp.ListLeadProjects` | 035, 102, 108 |
| PROCEDURE | `gp.ListProjectHeads` | 035 |
| PROCEDURE | `gp.ListReceptionVisits` | 025, 026, 064, 065, 071, 076 |
| PROCEDURE | `gp.ListRegistrationLocations` | 021 |
| PROCEDURE | `gp.ListScopedAuditEvents` | 019, 020, 081 |
| PROCEDURE | `gp.ListStaffRoles` | 019, 033, 034 |
| PROCEDURE | `gp.ListVisits` | 010 |
| PROCEDURE | `gp.LookupReceptionVisits` | 080 |
| PROCEDURE | `gp.ManageAccountHost` | 119 |
| PROCEDURE | `gp.ManageCommonDuty` | 056, 058, 074, 075 |
| PROCEDURE | `gp.ManageGuardCredential` | 006, 028 |
| PROCEDURE | `gp.ManageProjectGroup` | 110 |
| PROCEDURE | `gp.ManageProjectGroupGuard` | 110 |
| PROCEDURE | `gp.ManageStaffCredential` | 029 |
| PROCEDURE | `gp.ManageVisitPlanning` | 125, 135 |
| PROCEDURE | `gp.PlannedAccess` | 129, 131 |
| PROCEDURE | `gp.PreviewPlanningNotifications` | 132 |
| PROCEDURE | `gp.PurgeGuardAuthTransient` | 006 |
| PROCEDURE | `gp.ReadAccountHosts` | 119 |
| PROCEDURE | `gp.ReadActionCentre` | 093, 094, 095, 098, 100, 109 |
| PROCEDURE | `gp.ReadAdminVisitRegister` | 077, 078, 089, 099, 100, 101, 102, 104, 105, 106, 107, 112, 114 |
| PROCEDURE | `gp.ReadEmailRequest` | 061, 079, 090 |
| PROCEDURE | `gp.ReadGuardDutyPass` | 054, 058 |
| PROCEDURE | `gp.ReadGuardPhotoSource` | 101 |
| PROCEDURE | `gp.ReadGuardQueue` | 092, 100, 103, 109 |
| PROCEDURE | `gp.ReadReceptionQueue` | 092, 094, 100, 101 |
| PROCEDURE | `gp.ReadVisitCoordination` | 127 |
| PROCEDURE | `gp.RecordGuardDutyMovement` | 054, 058, 059, 060, 099 |
| PROCEDURE | `gp.RecordMovement` | 003, 012, 048, 051, 055, 072, 099 |
| PROCEDURE | `gp.RecordRegistrationPhoto` | 008 |
| PROCEDURE | `gp.ReissueLocalStaffSetup` | 081 |
| PROCEDURE | `gp.ReissuePass` | 011 |
| PROCEDURE | `gp.RemindPendingApproval` | 096 |
| PROCEDURE | `gp.RemindVisitHost` | 068, 069 |
| PROCEDURE | `gp.RenewNotificationLease` | 004, 005 |
| PROCEDURE | `gp.RenewPlanningNotificationLease` | 132 |
| PROCEDURE | `gp.RequestPassPrint` | 011 |
| PROCEDURE | `gp.ResolveNotificationPhoto` | 088 |
| PROCEDURE | `gp.ResolveStaffLoginIdentity` | 030 |
| PROCEDURE | `gp.ResolveVisitPhoto` | 010 |
| PROCEDURE | `gp.ReturnReceptionPass` | 071, 074, 076, 080 |
| PROCEDURE | `gp.RevokeEmailRequest` | 090 |
| PROCEDURE | `gp.RevokeGuardSession` | 006 |
| PROCEDURE | `gp.RevokeStaffRole` | 017, 018, 033 |
| PROCEDURE | `gp.RevokeStaffSession` | 029 |
| PROCEDURE | `gp.SearchProjectLeadCandidates` | 035 |
| PROCEDURE | `gp.SearchStaffSubjects` | 019, 033, 034, 081 |
| PROCEDURE | `gp.SubmitRegistration` | 008, 009, 016, 044, 048, 055, 061, 064, 073, 074, 076, 116 |
| PROCEDURE | `gp.TouchGuardSession` | 006 |
| PROCEDURE | `gp.TouchStaffSession` | 029 |
| PROCEDURE | `gp.VerifyGuardPass` | 010, 012, 013 |
| PROCEDURE | `gp._AuditFailure` | 003 |
| PROCEDURE | `gp._BeginOperation` | 003 |
| PROCEDURE | `gp._BeginRegistrationOperation` | 008 |
| PROCEDURE | `gp._BuildVisitPlanBase132` | 133 |
| PROCEDURE | `gp._BuildVisitPlanVersion` | 125, 133, 135 |
| PROCEDURE | `gp._CompleteOperation` | 003 |
| PROCEDURE | `gp._DirectoryCutoff` | 003 |
| PROCEDURE | `gp._GuardDutyJson` | 054, 059, 060, 063, 099 |
| PROCEDURE | `gp._GuardSourceBudget` | 006 |
| PROCEDURE | `gp._ManageVisitRoutingGroup` | 135 |
| PROCEDURE | `gp._NotificationRelevance` | 004, 011, 048, 049, 061, 074 |
| PROCEDURE | `gp._PlanningMailJson` | 132 |
| PROCEDURE | `gp._ReadPrintCardDetails` | 014, 048, 049 |
| PROCEDURE | `gp._RequireActor` | 003, 029 |
| PROCEDURE | `gp._RequireAdminReadCapability` | 019, 033, 034 |
| PROCEDURE | `gp._RequireGuardCredentialAdmin` | 006 |
| PROCEDURE | `gp._RequireOutlookActor` | 062 |
| PROCEDURE | `gp._RequirePrintJob` | 011 |
| PROCEDURE | `gp._RequirePrintablePass` | 011, 049 |
| PROCEDURE | `gp._RequireReceptionLocation` | 025 |
| PROCEDURE | `gp._RequireReceptionPass` | 011, 051, 052, 071 |
| PROCEDURE | `gp._RequireRegistrationEmployee` | 008 |
| PROCEDURE | `gp._RequireRegistrationIntake` | 008 |
| PROCEDURE | `gp._RequireRoleAdministrator` | 017, 033 |
| PROCEDURE | `gp._RequireStaffCredentialAdmin` | 029, 033 |
| PROCEDURE | `gp._TakeLock` | 003 |
| PROCEDURE | `gp._ValidatePlanningPolicy` | 125 |
| PROCEDURE | `gp._VisitReadJson` | 010, 015, 042, 043, 046, 047, 048, 055, 065, 073, 074, 076 |
| ROLE | `gp_api_runtime` | 003 |
| ROLE | `gp_guard_auth_runtime` | 006 |
| ROLE | `gp_media_runtime` | 010 |
| ROLE | `gp_outlook_runtime` | 062 |
| ROLE | `gp_render_runtime` | 011 |
| ROLE | `gp_staff_auth_runtime` | 029 |
| ROLE | `gp_worker_runtime` | 004 |
| TABLE | `gp.AccessEvents` | 001 |
| TABLE | `gp.AccessPasses` | 001 |
| TABLE | `gp.AccountHosts` | 119 |
| TABLE | `gp.AdminExportSnapshots` | 104, 107 |
| TABLE | `gp.ApprovalDecisions` | 001 |
| TABLE | `gp.Capabilities` | 001 |
| TABLE | `gp.CommonAreas` | 053 |
| TABLE | `gp.EmployeeEntraIdentities` | 062 |
| TABLE | `gp.EmployeeOfficeMemberships` | 048, 053 |
| TABLE | `gp.EmployeeProjectAccessEvents` | 053, 059 |
| TABLE | `gp.EmployeeProjectLocationMemberships` | 048 |
| TABLE | `gp.EmployeeProjectMemberships` | 001 |
| TABLE | `gp.EmployeeProjectPresence` | 053, 059 |
| TABLE | `gp.Employees` | 001 |
| TABLE | `gp.GrantCapabilities` | 001 |
| TABLE | `gp.GuardAssignments` | 001, 110 |
| TABLE | `gp.GuardAuthSources` | 006 |
| TABLE | `gp.GuardCommonAreaAssignments` | 053 |
| TABLE | `gp.GuardCredentials` | 006, 028, 083 |
| TABLE | `gp.GuardLoginAttempts` | 006 |
| TABLE | `gp.GuardSetupTickets` | 006 |
| TABLE | `gp.HostReminderOperations` | 068 |
| TABLE | `gp.IdempotencyRequests` | 001 |
| TABLE | `gp.LocationPlanningHosts` | 122 |
| TABLE | `gp.Locations` | 001 |
| TABLE | `gp.NotificationOutbox` | 001 |
| TABLE | `gp.PassDeliveryLinks` | 001 |
| TABLE | `gp.PassPrintJobs` | 001 |
| TABLE | `gp.PassPrintRenderState` | 011, 014 |
| TABLE | `gp.PassReturnCorrections` | 080 |
| TABLE | `gp.PassReturns` | 071, 076 |
| TABLE | `gp.PassScanAttempts` | 001 |
| TABLE | `gp.PassSecrets` | 001 |
| TABLE | `gp.PhotoAssets` | 001 |
| TABLE | `gp.PlannedAccessEventDestinations` | 129 |
| TABLE | `gp.PlannedPassBindings` | 129 |
| TABLE | `gp.PlanningMailDispatch` | 132 |
| TABLE | `gp.ProjectGroupGuardAssignments` | 110 |
| TABLE | `gp.ProjectGroupMembers` | 110 |
| TABLE | `gp.ProjectGroups` | 110 |
| TABLE | `gp.ProjectLocations` | 001 |
| TABLE | `gp.Projects` | 001, 086 |
| TABLE | `gp.RegistrationIntakeAccess` | 008 |
| TABLE | `gp.RegistrationIntakes` | 001 |
| TABLE | `gp.SchemaMigrations` | 001 |
| TABLE | `gp.SecurityAuditEvents` | 001 |
| TABLE | `gp.Sessions` | 001 |
| TABLE | `gp.StaffProfiles` | 029 |
| TABLE | `gp.StaffRoleGrants` | 001, 033 |
| TABLE | `gp.SubProjectHosts` | 122 |
| TABLE | `gp.SubProjectVisitPresence` | 129 |
| TABLE | `gp.SubProjects` | 122 |
| TABLE | `gp.TemporaryIdSlots` | 001 |
| TABLE | `gp.Users` | 001 |
| TABLE | `gp.VisitPlanApprovalSteps` | 123 |
| TABLE | `gp.VisitPlanApprovers` | 123 |
| TABLE | `gp.VisitPlanDecisions` | 123 |
| TABLE | `gp.VisitPlanEvents` | 123 |
| TABLE | `gp.VisitPlanExtraPeople` | 133 |
| TABLE | `gp.VisitPlanGroupReviewers` | 135 |
| TABLE | `gp.VisitPlanGroups` | 135 |
| TABLE | `gp.VisitPlanMentions` | 123 |
| TABLE | `gp.VisitPlanMessages` | 123 |
| TABLE | `gp.VisitPlanNotices` | 123, 136 |
| TABLE | `gp.VisitPlanOperations` | 123 |
| TABLE | `gp.VisitPlanParticipants` | 123 |
| TABLE | `gp.VisitPlanPreparation` | 133 |
| TABLE | `gp.VisitPlanProjects` | 123 |
| TABLE | `gp.VisitPlanServiceTasks` | 133 |
| TABLE | `gp.VisitPlanTaskOwners` | 123 |
| TABLE | `gp.VisitPlanTasks` | 123 |
| TABLE | `gp.VisitPlanThreads` | 123 |
| TABLE | `gp.VisitPlanVersions` | 123 |
| TABLE | `gp.VisitPlanningPolicies` | 122 |
| TABLE | `gp.VisitPlans` | 123 |
| TABLE | `gp.VisitPresence` | 001 |
| TABLE | `gp.VisitRequests` | 001, 076, 116 |
| TABLE | `gp.VisitRoutingGroups` | 135 |
| VIEW | `gp.StaffLocalCredentials` | 029 |
