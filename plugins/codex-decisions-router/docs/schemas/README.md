# Vendored validation schemas

Fetched read-only on 2026-10-06 from:

- https://agent-plugins.org/schemas/1.0.0/plugin.schema.json
- https://agent-plugins.org/schemas/1.0.0/mcp.schema.json

Validation uses jsonschema Draft202012Validator offline, without remote-reference resolution. These schemas cover portable manifests only. Semantic containment, derived legacy equivalence, skill presence and package integrity are separately checked. Marketplace shape follows the official OpenAI example rather than an invented official marketplace-file JSON Schema.
