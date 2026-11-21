# Automated spi3der Cloud Run deployment

## Status and contract

The repository is configured with two GitHub Actions workflows:

1. [spi3der MCP App](../.github/workflows/mcp-app.yml) tests pushes to `main`.
2. [Deploy spi3der to Cloud Run](../.github/workflows/cloud-run-deploy.yml) runs only after that workflow **succeeds** on `main`. A manual `workflow_dispatch` on `main` also permits a redeploy.

The deploy checks out the **exact tested commit**, verifies it still equals the remote `main` HEAD, and deploys the existing `Dockerfile` using Google Cloud Run **source deployment** into service `spi3der` in `europe-west1`. It sets `SPI3DER_GIT_SHA` to that commit, preserves other Cloud Run environment variables, and keeps `--max-instances=1` while workshop sessions are process-local. Finally it queries `GET /api/version` on the returned Cloud Run service URL and fails if `gitHash` is not the deployed SHA.

This is **automatic deployment, not automatic npm publication**. A GitHub push/green CI alone is not evidence that Cloud Run deployed: check the **Deploy spi3der to Cloud Run** workflow and its live SHA verification. A new Cloud Run revision can invalidate existing in-memory workshop sessions.

**One-time prerequisite:** Google Cloud Workload Identity Federation (OIDC), Cloud Run IAM roles, and three GitHub Actions variables must be configured. Until this is done, the workflow will fail fast at its configuration step and no deployment will happen.

## One-time setup

From a spi3der checkout on your Mac, using a Google Cloud project admin and a GitHub account with permission to set repository variables:

```bash
gcloud auth login
gh auth login
bash scripts/setup-cloud-run-oidc.sh YOUR_GOOGLE_CLOUD_PROJECT_ID
```

If you already selected the correct project via `gcloud config set project ...`, you may omit the argument.

The script:

- Confirms that the existing `spi3der` Cloud Run service exists in `europe-west1`.
- Enables required Google Cloud APIs and creates/reuses a dedicated deployer service account, a WIF pool, and an OIDC provider restricted to `Pengeszikra/spi3der` on `refs/heads/main`.
- Grants the deployer Cloud Run Source Developer and Service Usage Consumer on the project, plus Service Account User on the **existing runtime service identity**.
- Grants the default Cloud Build compute service account the Cloud Run Builder role. If your Cloud Build setup uses a custom build service account, its corresponding builder permissions must be handled separately.
- Gives only the federated identity for the named repository permission to impersonate the deployer account.
- Uses `gh variable set` to create/update these GitHub **repository variables** (not secrets, no JSON service-account keys):

| Variable | Value |
| --- | --- |
| `GCP_PROJECT_ID` | Actual Google Cloud project ID |
| `GCP_WIF_PROVIDER` | `projects/<number>/locations/global/workloadIdentityPools/spi3der-github/providers/main` |
| `GCP_DEPLOY_SA` | `spi3der-deploy@<project-id>.iam.gserviceaccount.com` |

If a WIF provider with the same name already exists but has a different trust condition, the script **stops** rather than silently broadening access. It is safe to run again with the same project when the setup matches.

The WIF credentials are short-lived and written temporarily by the Google GitHub Action. `.gitignore`, `.gcloudignore`, and `.dockerignore` must continue to exclude `gha-creds-*.json` so they never enter Git, uploaded source, or Docker images.

## Use and verification

After the one-time setup, each successful CI run on `main` triggers a Cloud Run deploy. If a newer commit has already reached main, the outdated run is skipped.

To deploy the already-tested main HEAD without making another commit, open:

- GitHub → Actions → **Deploy spi3der to Cloud Run** → **Run workflow** → branch `main`.

The deployment logs show the actual service URL. To verify from a terminal:

```bash
URL="$(gcloud run services describe spi3der --project YOUR_GOOGLE_CLOUD_PROJECT_ID --region europe-west1 --format='value(status.url)')"
curl -fsS "$URL/api/version"
```

The JSON must contain the latest expected `gitHash` and a `label` with the spi3der package version. Do not infer deployment from a successful build or a GitHub commit alone.

## Boundaries / troubleshooting

- **CI green, deploy red / Missing variable:** run the setup script and retry the deployment workflow.
- **Google auth denied:** verify the WIF provider, repo/branch condition, `roles/iam.workloadIdentityUser` binding, correct GitHub repo variables, and IAM propagation.
- **Build or deploy forbidden:** verify `roles/run.sourceDeveloper`, `roles/serviceusage.serviceUsageConsumer`, `roles/iam.serviceAccountUser` for the actual runtime service account, and `roles/run.builder` for the Cloud Build identity.
- **Failed live verification:** inspect the Cloud Run revision and `GET /api/version`. Do not claim success without a matching full Git SHA.
- **Other deploy triggers:** check Google Cloud Console for an existing Cloud Build/Cloud Run trigger; disable any competing automatic deploy to the same service to avoid races.
- **Production scaling:** process-local shared workshop sessions are not multi-instance safe; switching to durable shared storage is required before raising the Cloud Run instance limit.
- **Public access:** the workflow preserves the existing Cloud Run service's public access policy; it does not change IAM policy during every deploy. If the service stops being public, restore that setting separately after reviewing IAM.

Reference: [Google Cloud Run source-deploy IAM](https://cloud.google.com/run/docs/deploying-source-code#required_roles) and [google-github-actions/auth](https://github.com/google-github-actions/auth).
