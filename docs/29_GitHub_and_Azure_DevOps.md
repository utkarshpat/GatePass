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

The YAML installs Node 26.8.2, uses `npm ci`, and runs `npm test`. It runs no
deployment and needs no application, database, SSO or photo-storage secrets.
Live SQL tests require the separate isolated test database and are not included
in hosted unit CI. Hosted-agent availability/parallel-job entitlement is an
Azure organisation dependency; a queued run is not a passing build.

Boards integration is optional and can be configured later. Do not import the
GitHub repository into Azure Repos to enable this workflow.
