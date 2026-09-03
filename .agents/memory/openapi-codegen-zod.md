---
name: OpenAPI and Zod compatibility
description: Compatibility guardrail for generated API validation schemas in this workspace.
---

OpenAPI `format` keywords can make the current generator emit Zod 4-style helpers even though this workspace resolves Zod 3 at runtime.

**Why:** Code generation itself succeeds, but the chained library typecheck fails on helpers such as `zod.email()`, `zod.url()`, and `zod.uuid()`.

**How to apply:** Before adding `format` constraints to `lib/api-spec/openapi.yaml`, confirm the installed Zod major version and generator output. If the runtime is Zod 3, keep the generated contract structural and add format validation in server-side route schemas where needed.