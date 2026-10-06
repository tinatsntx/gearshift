# Codex Decisions Router

A local plugin under development that selects a coding model, its **reasoning effort**, and an appropriate delegation strategy as work progresses.

The product requirement is **each user pays for their own usage**. Distribution must contain no publisher credentials, and routing must never fall back to the publisher's account. A user connects their own account or API project once; subsequent authorized routing should run automatically.

The imported v0.1.0 package currently recommends model/effort pairs before delegated coding tasks. It includes a local MCP server, a routing skill, offline fixtures, and a dormant Decisions HTTP adapter. It does not yet provide continuous orchestration, parent-model switching, or verified changes to running agents.

- [Product requirements and billing design](plugins/codex-decisions-router/docs/product-requirements.md)
- [Imported package README](plugins/codex-decisions-router/README.md)
- [Prior cloud verification report](plugins/codex-decisions-router/docs/verification.md)

The cloud report describes earlier offline checks; it is not proof of installation or Windows runtime verification. Local installation, secure onboarding, live Decisions access, native application of settings, and public distribution still need implementation or verification.
