# Changelog

All notable changes to this project will be documented in this file.

# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] - 2026-04-12
- Apply dynamic and duration settings to API routes.
- Enable autonomous tool execution and update Gemini models.
- Rename `GEMINI.md` to `RULES.md` in documentation.
- Update smoke and stream tests.
- Add system instructions for native image interpretation in chat.
- Enhance tool output type handling for API chat.
- Improve prompt route handling and logging in chat API.
- Render assistant messages as markdown in chat.
- Enhance Git and documentation automation.

## [Unreleased] - 2026-03-26
- Add typecheck script.
- Extract and display used model from Gemini hub response in examples.
- Add models field to token usage tracking in server events.
- Refactor commit script to remove explicit model parameter.
- Upgrade Gemini CLI dependencies and update example scripts.
- Separate folder authorization from session warm-up in trust registry.
- Update project version and dependencies.

## [Unreleased] - 2026-03-04
- Migrate default server port to 2999 and add environment variable support for port configuration.
- Enhance automated commit scripts with hint flag support and non-interactive mode.
- Replace `jq` with Node.js for JSON processing in scripts to reduce external dependencies and improve reliability.
- Standardize scripting toolchain on Bash and Node.js and introduce a documentation update utility.
- Update project README with refined architectural pillars and comprehensive developer usage guides.

## [Unreleased] - 2026-02-21
- Add retry generation capability and the ability to stop assistant responses in the chat playground.
- Implement real-time thought streaming and display with collapsible UI blocks for model reasoning.
- Harden streaming API stability by consolidating and safely handling stream controller closures.

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

## [Unreleased] - 2026-03-04
- Migrate default server port to 2999 and add environment variable support for port configuration.
- Enhance automated commit scripts with hint flag support and non-interactive mode.
- Replace `jq` with Node.js for JSON processing in scripts to reduce external dependencies and improve reliability.
- Standardize scripting toolchain on Bash and Node.js and introduce a documentation update utility.
- Update project README with refined architectural pillars and comprehensive developer usage guides.

## [Unreleased] - 2026-02-21
- Add retry generation capability and the ability to stop assistant responses in the chat playground.
- Implement real-time thought streaming and display with collapsible UI blocks for model reasoning.
- Harden streaming API stability by consolidating and safely handling stream controller closures.

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

