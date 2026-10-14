# Rust / Tauri Application

- Validate command/API boundaries, Tauri capability permissions, input validation and Rust error handling.
- Respect workspace Cargo.toml/Cargo.lock and existing ownership conventions.
- Minimize shared Rust crate changes; surface cross-package effects.
- Do not author tests unless requested. Use focused existing cargo checks only when applicable.
