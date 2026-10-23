# GatePass End-to-End Test Scenarios & Audit Matrix

> 23 October presentation run: [current evidence and retained demo data](../55_Presentation_Rehearsal_23_October_2026.md). Earlier execution counts/cleanup statements in this catalog describe their dated runs; this presentation dataset is retained.

This folder contains the complete, end-to-end test scenario catalog for Sopra Steria GatePass across all four operational surfaces (**Self-Service Portal**, **Reception Desk**, **Guard Workspace**, and **Admin Console**), email/approval links, and database/API security boundaries.

## Scenario Catalog

| Document | Scope | Total Test Cases |
|---|---|---|
| [01_Public_and_Employee_Registration.md](01_Public_and_Employee_Registration.md) | Office QR entry, Employee Digital ID (primary/eligible vs cross-office), Employee Project Access, Single & Group Visitor Check-in, Optional Company & Declared Devices, Camera-Only Photo Capture/Crop, Same-Day Reuse, Post-Return Re-registration | 12 |
| [02_Email_and_Approval_Workflows.md](02_Email_and_Approval_Workflows.md) | Host Approval (`/approval/<id>`), Employee Request Status (`/request/<id>`), External Signed Holder Capability (`#link=...`), Company & Device Rendering in Emails/Cards/Status, Snapshot Fencing, Host Reminders, Post-Return Cancellation Fence | 8 |
| [03_Reception_Desk_and_Pass_Returns.md](03_Reception_Desk_and_Pass_Returns.md) | Reception KPIs & Filters, All-Date Live Lookup & QR Scan (`gp.LookupReceptionVisits`), View Pass / Read-Only Summary, Direct Print & Reprint Coordinator, Host Reminder Cooldown, Manual Visitor Registration (iframe isolation), History Date Range, Final Pass Return, Device Checklist & Mistaken-Return Correction (`gp.ReturnReceptionPass`, `gp.CorrectReceptionReturn`) | 10 |
| [04_Guard_Workspace_and_Movements.md](04_Guard_Workspace_and_Movements.md) | Project vs Common Area Duty Selection, Common Duty Session Fencing (`075`), Expected & Inside Queues, QR Scan / Manual Verification, Project Entry & Exit, Independent Multi-Project Presence, Reconcile Exit, Bilingual UI (`hi`, `kn`, `ta`, `mr`) with Company & Device Labels | 9 |
| [05_Admin_Console_and_Delegation.md](05_Admin_Console_and_Delegation.md) | Overview KPIs & Server-Date Initialization, Projects & Leads, Staff & Access, Guard Project Assignments, Common Area Creation & Duty Allocation, Office QR Standee Poster & Download, Scoped Visit Register (`077`–`078`), Security Audit Log, 403 Redaction | 9 |
| [06_Security_and_Concurrency_Findings.md](06_Security_and_Concurrency_Findings.md) | Database-First Execute-Only Boundaries, CSRF & Session Isolation, Idempotency & Lock-Wait Races, Audit Findings & Applied Fixes (Migrations `074`–`080`), Live Browser E2E Verification Report | 19 |

## Test Accounts (Local Development / Synthetic Directory)

- **Staff Entry (`/`)**:
  - Admin: `platformadmin1@example.com` (Platform), `admin1@example.com` (India), `admin2@example.com` (Noida Location); local password `Sopra@123`
  - Reception: `reception1@example.com` / `Sopra@123` (Noida local staff account)
  - Guard: `gaurd1@example.com` / `Sopra@123`
- **Office Self-Service (`/office/noida`, `/office/bengaluru`, `/office/chennai`, `/office/pune`)**:
  - Noida Primary Employee: `employee1@example.com` / `Sopra@123`, `employee2@example.com` / `Sopra@123`
  - Host Employees: `employee19@example.com` / `Sopra@123` (Project 1 Noida)
