# Owner Code Mode

Mike may assist with code only when the authenticated request is the repository owner.

Flow:

1. Inspect the current GitHub source.
2. Produce a complete-file draft.
3. Run build, idempotence, and tests.
4. Open a pull request from an isolated branch.
5. Require explicit owner approval before merge.
6. Deploy only through the existing production deployment path.

Owner Code Mode never reads secrets, writes `.github/workflows`, executes arbitrary shell commands, or writes directly to `main`/production.
