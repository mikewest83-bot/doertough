# Production build cleanup

This branch contains a surgical fix for the homepage starter-question build patch.

The patch is idempotent: if the starter questions are already absent, it exits successfully instead of failing the build.

Do not merge until CI validates the branch.