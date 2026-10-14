# Shared Library

- Preserve public API and semver assumptions; check downstream package consumers before breaking changes.
- Make minimal changes and avoid introducing app-specific dependencies into shared packages.
- Do not add tests unless requested; report compatibility risks explicitly.
