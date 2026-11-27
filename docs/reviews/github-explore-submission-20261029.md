# github-explore 3.1.2: author-submitted review evidence

This is a request for a fixed-source admission review of [github-explore](https://github.com/Fectivnfy112357/github-explore),
[`6ee754470c23f71204f26ebbd6b8bb1d36915d5f`](https://github.com/Fectivnfy112357/github-explore/commit/6ee754470c23f71204f26ebbd6b8bb1d36915d5f)
related to [#585](https://github.com/AI-Scarlett/DSH-Store/issues/585).
This document is an author submission, not a Store approval; it does not change
the Catalog status, installation policy, or independent audit status.

- Manifest: `package.json`; bundle: `cordis.patch.yml`; entry: `github-explore-skill`; license: MIT.
- The per-version declarations include the current official window: `0.2.1-rc.3`, `0.2.1-rc.4`, and `0.2.2-alpha.2`. The Node declaration is `26.8.1`.
- Author-side validation: on Linux with Node 26.8.1 and a separate DSH_HOME per version, a local checkout was installed with each of the three current releases. After the host started, a temporary probe found the skill in `ctx.skills.list()`; each removal command exited successfully. The host was stopped by a timeout. The same checks were performed for three releases in the previous window. Interactive agent invocation, rollback, and other systems and Node versions were not tested.
- The local DSH-Store submission preflight passed against the fixed commit, scanning 18/18 files and reporting a file-access capability signal at `lib/index.js:14`. This bounded static preflight is not a complete admission review, security audit, or independent Store runtime validation.
- The skill depends on `gh` and Python. Commands and scripts invoked at the user's request may access files, the network, and credentials managed by `gh`. The manifest includes a `prepack` script; the preflight's `preinstall`, `install`, `postinstall`, and `prepare` lifecycle scripts are not declared.

Please review the fixed source, entry, permissions, and applicable policy, and
decide whether to update the Catalog and which installation policy to use.
The Profile results are author-side evidence; independent Store validation and
security audit remain incomplete.
