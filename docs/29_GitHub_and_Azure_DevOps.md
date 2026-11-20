# GitHub and Azure DevOps

Updated 20 November 2026. GatePass keeps the same Git commits in GitHub and Azure Repos.

## Repositories and pushes

- GitHub repository [utkarshpat/GatePass](https://github.com/utkarshpat/GatePass).
- Azure repository [soprasteria/GatePass](https://dev.azure.com/soprasteria/GatePass/_git/GatePass).
- The current checkout fetches GitHub through `origin` and Azure Repos through `ado`. `origin` has both repositories as push destinations.

```powershell
git push origin main
```

The command pushes the same local branch to both destinations. Git reports each destination independently. If one push fails, resolve its authentication or divergent branch, retry, then compare both remote SHAs before reporting synchronization complete.

```powershell
git rev-parse HEAD
git ls-remote https://github.com/utkarshpat/GatePass.git refs/heads/main
git ls-remote https://soprasteria@dev.azure.com/soprasteria/GatePass/_git/GatePass refs/heads/main
```

Remote configuration belongs to each clone. Configure a fresh clone once with these commands. Inspect `git remote -v` first and retain any existing destinations.

```powershell
git remote add ado https://soprasteria@dev.azure.com/soprasteria/GatePass/_git/GatePass
git remote set-url --add --push origin https://github.com/utkarshpat/GatePass.git
git remote set-url --add --push origin https://soprasteria@dev.azure.com/soprasteria/GatePass/_git/GatePass
```

The initial Azure push included `main` and the three existing local historical branches. Subsequent work uses the same local commits for both repositories. A change made independently through a repository web editor needs fetching and reconciliation before the next synchronized push.

## Azure pipeline

[GatePass pipeline 1333](https://dev.azure.com/soprasteria/GatePass/_build?definitionId=1333) reads `/azure-pipelines.yml` from Azure Repos `GatePass`, default branch `main`. Its initial execution is [run 260554](https://dev.azure.com/soprasteria/GatePass/_build/results?buildId=260554). The pre-existing GitHub-connected pipeline `utkarshpat.GatePass` has definition ID 1322.

The automatic Quality stage installs pinned Node 26.8.2 and locked dependencies, scans Git history, audits high/critical dependency findings, checks TypeScript/lint/architecture/migration integrity, builds seven frontend bundles and publishes Node test results, coverage and a source candidate artifact. CI batches `main` updates and excludes `docs/**` and root `README.md` according to YAML.

Azure Repos PR validation uses a branch build policy. The `main` policy `GatePass CI` selects pipeline 1333 and runs automatically, with expiration when target code changes and path filter `/*;!/docs/*;!/README.md`. Its requirement is Optional so the current direct dual-repository push workflow remains available. The YAML `pr` section controls the existing GitHub-connected pipeline. [Microsoft trigger documentation](https://learn.microsoft.com/en-us/azure/devops/pipelines/repos/azure-repos-git)

In Run pipeline, select the branch and enable `runIntegration` to add isolated Windows LocalDB, real SQL security/concurrency/HTTP suites, Chromium workflows/accessibility and the coordination SQL/browser harness. This parameter defaults to false. Synthetic integration fixtures use the hosted test database.

`runStagingSmoke` additionally accepts an existing approved HTTPS origin. Configure actual hosting, identity, directory, mail and protected storage using the [production requirements](87_Organization_Production_Requirements.md) and [operations handbook](system/09_Deployment_Operations_and_Recovery.md).

## Verification and operation

Check each run's source SHA, stage result, Tests, coverage and artifact before recording success. Queue/access/resource authorization failures require the specific Azure project or organization owner to resolve the reported setting. Keep credentials in the platform credential manager and approved secret stores.

The initial Azure Repos Quality run 260554 completed on 20 November 2026 in 3m 44s for source commit `67b2be9`. Its test publisher logged “No Result Found to Publish” because native Node JUnit placed testcases directly under testsuites. The CI runner now adds the testsuite container required by Azure, preserves individual failure/skip details and rejects empty reports. Publication errors also fail the pipeline. Local verification passed 728 Node tests with one platform skip out of 729, plus typecheck, lint, architecture and migration integrity. The GatePass Team Overview dashboard now includes Build History and Test Results Trend widgets connected to pipeline 1333. [CI dashboard](https://dev.azure.com/soprasteria/GatePass/_dashboards/dashboard/4ea9aa23-dab9-46d8-88aa-688c10b66c75)
