# GitHub and Azure DevOps

Source of record: private GitHub repository `utkarshpat/GatePass`.
Azure project: https://dev.azure.com/soprasteria/GatePass/

Azure Repos is not required. Boards tracks tasks and bugs; Pipelines builds and
tests the GitHub source; Dashboards displays project progress.

## Connect the pipeline

1. Open the GatePass project in your existing signed-in browser.
2. Open **Pipelines → Pipelines → New pipeline** (or **Create Pipeline**).
3. Select **GitHub** as the code source and sign in to GitHub if prompted.
4. Review the Azure Pipelines GitHub app permissions. Select only the GatePass
   repository rather than all repositories. Organisation policy may require an
   administrator to approve this connection.
5. Select `utkarshpat/GatePass`.
6. Select **Existing Azure Pipelines YAML file**, branch `main`, path
   `/azure-pipelines.yml`.
7. Review and run. Verify the run uses the expected GitHub commit and that all
   steps pass. Connecting the repository alone does not verify the pipeline.

The automatic Quality stage uses Node 26.8.2 and locked dependencies, scans full
Git history for secrets, audits dependencies, checks TypeScript/lint/migration
integrity, and publishes unit test/coverage results plus an allowlisted source
release candidate. It does not deploy the application.

In **Run pipeline**, enable **Run integration checks** for a fresh private
Windows LocalDB schema, SQL security/concurrency/HTTP checks and Chromium
workflow/accessibility checks. This is manual by default to control shared
hosted-agent minutes. All data is synthetic; no application secrets are needed.
The hosted image's LocalDB engine version is logged; this is a SQL 2022+
compatibility check, not proof of a SQL 2025 Linux production rollout.

The staging probe is separately disabled by default and requires an approved,
already deployed HTTPS site. There is no staging VM configured by this package.
Hosted-agent availability/parallel-job entitlement is an Azure organisation
dependency; a queued run is not a passing build. No paid capacity is enabled.

Boards integration is optional and can be configured later. Do not import the
GitHub repository into Azure Repos to enable this workflow.
