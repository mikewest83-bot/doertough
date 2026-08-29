# Realtime voice reconciliation

This branch is based directly on current `main` and carries the verified Realtime voice changes from PR #17.

Validation gate:

1. build
2. build idempotency
3. test suite
4. Railway PR environment deployment
5. end-to-end Mike voice test
6. merge only after all gates pass

Production is not changed by this branch alone.
