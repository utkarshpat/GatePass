# GatePass End-to-End Test Scenarios & Audit Matrix

This folder contains the complete, end-to-end test scenario catalog for Sopra Steria GatePass across all four operational surfaces (**Self-Service Portal**, **Reception Desk**, **Guard Workspace**, and **Admin Console**), email/approval links, and database/API security boundaries.

## Scenario Catalog

| Document | Scope | Total Test Cases |
|---|---|---|
| [01_Public_and_Employee_Registration.md](01_Public_and_Employee_Registration.md) | Office QR entry, Employee Digital ID (primary/eligible vs cross-office), Employee Project Access, Single & Group Visitor Check-in, Photo Capture/Crop, Same-Day Reuse, Post-Return Re-registration | 18 |
| [02_Email_and_Approval_Workflows.md](02_Email_and_Approval_Workflows.md) | Host Approval (`/approval/<id>`), Employee Request Status (`/request/<id>`), External Signed Holder Capability (`#link=...`), Snapshot Fencing, Host Reminders, Post-Return Cancellation Fence | 12 |
| [03_Reception_Desk_and_Pass_Returns.md](03_Reception_Desk_and_Pass_Returns.md) | Reception KPIs & Filters, View Pass / Read-Only Summary, Direct Print & Reprint Coordinator, Host Reminder Cooldown, Manual Visitor Registration (iframe isolation), History Date Range, Final Pass Return (`gp.ReturnReceptionPass`) | 16 |
| [04_Guard_Workspace_and_Movements.md](04_Guard_Workspace_and_Movements.md) | Project vs Common Area Duty Selection, Expected & Inside Queues, QR Scan / Manual Verification, Project Entry & Exit, Independent Multi-Project Presence, Reconcile Exit for Cancelled/Revoked Occupants, Bilingual UI (`English + हिन्दी`) | 15 |
| [05_Admin_Console_and_Delegation.md](05_Admin_Console_and_Delegation.md) | Overview KPIs & Presence, Projects & Leads, Staff & Access (Grant/Revoke across scopes), Guard Project Assignments, Common Area Creation & Duty Allocation, Office QR Generation, Visits & Reports, Security Audit Log | 16 |
| [06_Security_and_Concurrency_Findings.md](06_Security_and_Concurrency_Findings.md) | Database-First Execute-Only Boundaries, CSRF & Session Isolation, Idempotency & Lock-Wait Races, Audit Findings & Applied Fixes (Migration 074), Live Browser E2E Verification Report | 15 |

## Test Accounts (Local Development / Synthetic Directory)

- **Staff Entry (`/`)**:
  - Admin (Platform/India/Location): `admin1@example.com` / `Sopra@123` (or `admin2@example.com`)
  - Reception: `reception1@example.com` / `Sopra@123` (or `employee21@example.com`)
  - Guard: `gaurd1@example.com` / `Sopra@123`
- **Office Self-Service (`/office/noida`, `/office/bengaluru`, `/office/chennai`, `/office/pune`)**:
  - Noida Primary Employee: `employee1@example.com` / `Sopra@123`, `employee2@example.com` / `Sopra@123`
  - Host Employees: `employee19@example.com` / `Sopra@123` (Project 1 Noida)
