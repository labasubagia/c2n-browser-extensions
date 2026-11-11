# Changelog

All notable changes to this project are documented in this file.

## [0.2.0] - 2026-11-11

### Added

- Concurrent sync processing via a bounded pool (`mapWithConcurrency`, `SYNC_CONCURRENCY=4`), porting the collect-then-aggregate model.
- Live, verbose progress: per-conversation discovery, duplicate-check progress, per-record upload/skip/fail updates, and per-conversation deletion progress.
- Monotonic progress bar spanning processing and deletion phases — no premature 100%, no frozen bar during cleanup.
- `findExistingNames` optional `onProgress(done, total)` callback.

### Changed

- Conversation deletion decision extracted to a pure, unit-tested helper (`conversationsToDelete`).

### Fixed

- Progress bar no longer freezes at 100% while conversation deletion runs.
- State updates serialized through a chained promise queue — no lost increments under concurrency; worker rejection drains the queue before surfacing errors.
- Abort listener removed on pool exit (no leak).

## [0.1.1] - 2026-10-??

- Initial published release.
