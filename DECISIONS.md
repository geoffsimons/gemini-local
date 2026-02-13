# Architecture Decision Records (ADR)

## ADR-001: Next.js Monorepo Structure
- **Status:** Accepted
- **Context:** We needed a simplified way to distribute the API and UI together.
- **Decision:** Use Next.js App Router to serve both the API routes (backend) and React components (frontend) in a single process.
- **Consequences:** Simplified deployment; Shared type definitions; Global Singleton pattern required for CLI persistence.

