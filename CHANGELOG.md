# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-02-20
- Implement server-side tool execution using the SDK `ToolRegistry` for automated and manual flows.
- Support multiple tool calls per interaction turn with persistent YOLO mode state.
- Enable dynamic model selection and switching for active project sessions.
- Harden streaming API responses and history management for complex tool-use sequences.
- Enhance smoke test suite with multi-round tool fulfillment and human-in-the-loop validation.
- Synchronize codebase project rules with ADR-defined agentic workflows.

## [Unreleased] - 2026-02-18
- Add support for ephemeral sessions and custom session IDs for isolated API interactions.
- Enhance playground UI with improved chat input interaction and focus management.
- Introduce AI-powered CLI utilities for automated commits, documentation sync, and project onboarding.
- Refactor integration scripts to use `jq` for robust JSON payload construction and handling.
- Overhaul technical documentation with comprehensive guides and ecosystem overview.
- Remove deprecated legacy projects and streamline repository structure.
- Add project brand iconography and configure favicon metadata.

## [Unreleased] - 2026-02-14
- Implement Chat Playground and Project Registry Dashboard for UI-based session management.
- Implement folder registration, listing, and unregistration API endpoints.
- Introduce persistent "Trusted Folders" registry with auto-trust policy and existence validation.
- Migrate trusted folder storage to a map-based format with self-healing legacy support.
- Add support for horizontal multi-image stitching in the frontend playground.
- Enhance smoke test suite to verify project governance and trust lifecycle.

## [Unreleased] - 2026-02-13
- Implement client registry for managing persistent, stateful project sessions.
- Add session clearing functionality and refined registry purging logic.
- Implement core chat, health, and status API endpoints.
- Extract and optimize server-side image stitching for multi-modal analysis.
- Add colored logging utility and enhanced error handling for client sessions.
- Provision `.geminiignore` support to ensure clean client reloads.
- Introduce comprehensive integration and visual smoke test suites.

## [1.0.0] - 2026-02-13
- Initial release of Gemini Local API.
- Re-architected as a Next.js application.

