# DSH 0.1.5-alpha.2 compatibility audit — 2026-09-10

Official target: `deepseek-ai/deepseek-harness` tag `dsh-v0.1.5-alpha.2`, Commit `b2e3b2a0125854567a4a5fcba75782e42fe84901`. The preceding release `dsh-v0.1.5-alpha.1` is Commit `5dda764ed3aa172535a7967b06ff95d9cbfe536a`; the current official latest-three window also contains `0.1.3-alpha.2` (Commit `82a5fd61a7cf5c293cec4bdff68f455398d685e9`).

DSH STORE uses the public `webServer` injection, `settings.section`, `settings.plugins.tab`, `shell.overlay`, runtime status and official CLI seams. The 0.1.5 changes to Session V3, Sidebar/main panel registration, `agent.inbox` and removal of `ctx.agent` do not intersect this bundle. Static source and contract tests were re-run against the updated public contract; no DSH source or `@deepseek-ai/*` package was changed.

The package now records the resolved latest-three window explicitly. `0.1.5-alpha.1` and `0.1.5-alpha.2` are marked compatible from source review; `0.1.3-alpha.2` remains `unknown` until a separate runtime evidence run. This does not claim real Profile installation, restart, browser/UI readback, or public marketplace merge.
