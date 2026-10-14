---
name: tauri-security-review
description: Focused, read-only Tauri/Rust trust-boundary and capability review; activate explicitly for Tauri projects.
---

# Tauri Security Review

Review a specified Tauri/Rust change without editing files. Start from the concrete patch and declared Tauri version. Inspect only necessary files. Check: command argument validation, JS-to-Rust trust boundaries, Tauri capability/permission scoping, file/path handling, secret exposure, serialization, process invocation and Rust error propagation. Report findings with file paths, severity, exploitability/impact and actionable fixes. Do not invent vulnerabilities or create tests unless requested.
