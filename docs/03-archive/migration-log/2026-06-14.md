# Migration Log - 2026-06-14

## GitHub Actions Pure Artifact Deployment

- Replaced the old Gitee Go deployment path with GitHub Actions CD plus Tencent TCR image push.
- Removed the server-side git checkout requirement; production now deploys from
  `/opt/lucent/releases/<git-sha>` and a `/opt/lucent/releases/current` pointer.
- Added remote deploy-asset sync workflow and updated docs/checklists to the new server layout.

## Repo + Runtime Deployment Split

- Switched server deployment to a split layout: tracked app repo at `/opt/lucent/app`, server-local
  runtime files at `/opt/lucent/server`.
- Updated compose and deploy workflow so the server now `git pull --ff-only`, then reads
  env/certs/Nginx runtime files from `/opt/lucent/server`.
- Removed the old template-driven Nginx deploy path and replaced it with a concrete repo baseline
  config at `deploy/nginx/nginx.conf`.
- Stopped treating monitoring assets as runtime-local files; Prometheus, Grafana provisioning, and
  synthetic checker assets now stay under tracked repo path `monitoring/**`.

## Deployment Docs Boundary Cleanup

- Added `docs/deployment-checklist.md` for executable deployment and go-live verification steps
  only.
- Narrowed `docs/tencent-cloud-cicd.md` to Tencent Cloud / TCR workflow setup and deploy-chain
  behavior only.
- Narrowed `docs/deployment-files.md` to file ownership and directory boundaries only.
- Removed stale Nginx env fields from production env docs and templates so runtime config now
  reflects the real compose/deploy model.
