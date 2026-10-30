# DSH Store production refresh: pinned GitHub API fallback

## Finding

After Catalog PR #1639 merged and GitHub Pages published source Commit `6604dbbe06d81ed89cd9404ed12ecd516ae2e859`, the international server refreshed successfully. The domestic refresh passed its Catalog candidate check but failed while fetching `scripts/build-server-articles.py` from `raw.githubusercontent.com`; the server received TLS timeouts and connection resets. The previous domestic release remained active.

The domestic server can retrieve the same fixed-Commit file from the GitHub Contents API with `Accept: application/vnd.github.raw+json`. The response was HTTP 200 and 25,282 bytes. The existing SHA-256 check remains the acceptance gate before the builder runs.

## Change

- Fetch the server article builder from the GitHub Contents API pinned to the Pages artifact's full `source_sha`.
- Fall back to the existing raw GitHub URL if the API request fails.
- Keep the build-manifest SHA-256 comparison before executing the builder.
- Add a disposable source-contract test that checks the fixed ref, raw MIME type, fallback ordering, and post-download hash check.

## Server rollout plan

- Target: the registered `dsh-store-cn-814823065` production host for `dsh-store.cn`.
- Existing helper: `/opt/dsh-store/bin/refresh-from-pages.sh`, SHA-256 `494d655e647ff319f0d4558bd9e89d82c28ed90d91685c342d0e7a8830282f9d`.
- Exact rollout preconditions: current release `/opt/dsh-store-cn/releases/20261029T094832Z-pages-763db1b7624b`, manifest SHA-256 `445352ae167deffad76f99482bb771439e6b4a02c815566d0e8c51c32a173155`, 12 preserved article pages with source-set hash `d0624d96366faefea54dee70ef9c81e108c4fa3414900a91dc855abfb068d9c7`, and the domestic refresh timer active and enabled.
- Exact helper deployment: pin source Commit `485ec1da18c60783b87512d9851e5b466cf21bbd`, require SHA-256 `06deab3c3c99e71b46413c2948d62e9267cf90df12469a963a50c23ca8f70ee3`, preserve the original helper at `/opt/dsh-store-cn/backups/server-refresh-api-20261030-before/refresh-from-pages.sh` (directory must be absent), then atomically replace `/opt/dsh-store/bin/refresh-from-pages.sh`.
- Existing public release: `763db1b7624be0d83641c1c7c7ac10c9efd50c1d`.
- After this PR merges, verify the helper's replacement SHA-256 against the plan and a full Commit, save the old helper under the server's backup directory, then install the replacement through an atomic rename.
- Run `dsh-store-refresh@domestic.service`; require the service health check, a `DSH_STORE_REFRESH_OK` record for the new source, and public readback of Store `0.9.12` at source Commit `8837c09f4546735475cfdfd6b1669e701b3a40fd`.
- If install or health validation fails, restore the helper backup atomically. The refresh service itself keeps the previous site release active when candidate validation or public health checks fail.

No real DSH Profile or Desktop package is changed by this deployment.
