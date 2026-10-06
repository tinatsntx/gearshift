# Gearshift

A Codex plugin that picks the model and reasoning effort for every subagent, using the OpenAI Decisions API on each user's own API key.

- The plugin, its documentation, and its tests are in [plugins/gearshift](plugins/gearshift/README.md).
- This repository is also a local Codex marketplace: [.agents/plugins/marketplace.json](.agents/plugins/marketplace.json) lists the plugin so `codex plugin marketplace add <this folder>` can find it.

## History

The project began as `codex-decisions-router` 0.1.0, a Python package built in the cloud that recommended settings through an MCP tool and never ran live. That source is preserved in this repository's first commit (`044e536`). The requirements and research written for it are kept in [plugins/gearshift/docs](plugins/gearshift/docs).
