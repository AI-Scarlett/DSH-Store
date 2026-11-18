# Author-requested fixed-Commit review: dsh-deepseek-cost

## Request and source binding

- Managed request: [DSH-Store #1653, comment 6967944300](https://github.com/AI-Scarlett/DSH-Store/issues/1653#issuecomment-6967944300), GitHub user ID `4898852` (`skyrocks`).
- The comment is unchanged at `2026-11-18T03:16:30Z`; its exact body SHA-256 is `2202189d4edecf4d746d4aa780c52d2eed34ab89ae0ce417b0db82cd0aa2bb60`.
- Reviewed the current default-branch fixed Commit `2835b855d00685f29d5e2514ff471c4cbd89d01d` (version `0.2.5`). It includes the requested `0.2.4` change that stopped shipping `test/`.
- Complete bounded-source review: engine `bounded-source-v3`; 11 of 11 runtime files scanned (66,894 bytes); source digest `334c2fbe846e3bfda8ca11f280718443bf8513d2f1c3513b1432d08d94f04c43`; source contract verified; static security scan passed with no findings.

## Findings

- The `package.json` `files` allowlist at lines 16–31 excludes `test/`. The complete packaged runtime scan reports `files=false`; the prior `node:fs` signal from the test fixture is gone.
- The project declares MIT and the fixed source includes `LICENSE`. The manifest declares Node `>=18` and DSH `>=0.2.1-rc.2 <0.3.0`; it has no `dependencies` or `optionalDependencies`, and no install lifecycle scripts. Its test script is not an install lifecycle script and `test/` is not in the package allowlist.
- The remaining `network` signal is real: `index.js:372–379` sends a bearer-authenticated request to configurable `baseUrl`; `official.js:183–199` sends account and usage requests to the DSH session origin. The bounded scanner also records `official.js:158` as a network call.
- The remaining `credentials` signal is real: `index.js:315–323` reads the account session token and headers; `index.js:343–365` resolves stored credential references or configured environment keys; `index.js:376–379` sends the API key as a bearer token.
- The exact official DSH latest-three window at review time is `0.2.2-rc.2`, `0.2.2-rc.3`, and `0.2.2-rc.4`. All three exact compatibility results are `unknown`; there is no compatible exact-release result. Declaring a DSH version range alone is not exact-release evidence.
- The old Catalog record's package name `dsh-deepseek-cost` does not match the current manifest name `@skyrocks/dsh-deepseek-cost`. The reviewed identity migration is bound to the old Catalog identity hash and this exact source Commit; it does not grant installability.

## Final admission decision

**Blocked; `external-only`; not installable.** The removed `files` signal is cleared, but the real network and credential capabilities remain outside the automatic approval allowlist. Current exact DSH release compatibility also remains unverified. No third-party install, build, test, package execution, or DSH runtime acceptance was performed or inferred.

The dedicated Catalog workflow must apply the fixed source update and the #581 withdrawal from a fresh main-bound plan. After that PR merges, public surfaces and the final admission binding must be read back before publishing a terminal author resolution or using the one request-bound reply reservation.
