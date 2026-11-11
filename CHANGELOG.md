# Changelog

All notable changes to this project are documented in this file.

## [0.2.1] - 2026-11-11

### Changed

- Split the single sync progress bar into two independent tracks: image upload (`current/total`) and conversation deletion (`deleted/deletedTotal`). Previously one merged bar diluted upload percentage with the deletion denominator and toggled labels mid-run.
- Popup renders separate "Uploading images" and "Deleting conversations" bars; the delete bar appears only while deletion is active.

## [0.2.0] - 2026-11-11

### Added

- Concurrent sync processing via a bounded pool (`mapWithConcurrency`, `SYNC_CONCURRENCY=4`), porting the collect-then-aggregate model.
- Live, verbose progress: per-conversation discovery, duplicate-check progress, per-record upload/skip/fail updates, and per-conversation deletion progress.
- Monotonic progress bar spanning processing and deletion phases, so the bar never reports premature 100% or freezes during cleanup.
- `findExistingNames` optional `onProgress(done, total)` callback.

### Changed

- State updates serialized through a chained promise queue, so concurrent workers never lose increments.
- Conversation deletion decision extracted to a pure, unit-tested helper (`conversationsToDelete`).
- Abort listener is removed when the pool exits (no leak).

## [0.1.1] - 2026-10-??

- Initial published release.
