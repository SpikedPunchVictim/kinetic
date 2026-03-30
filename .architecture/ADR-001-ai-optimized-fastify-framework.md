# ADR-001: AI-Optimized Fastify Application Framework

## Status
**Accepted**

## Context

Kluster is a platform that generates backend applications using AI. The user specifies requirements through a natural language interface, and Kluster generates, deploys, and manages the resulting applications. The applications are hosted by Kluster; users never see the code. Kluster performs security scanning, compliance checking, and automatic updates to meet evolving standards.

To support this architecture, we need a Fastify-based framework designed specifically for AI-generated code that prioritizes:
1. Token efficiency (AI context limits)
2. Code minimization (concise expression of features)
3. Reduced hallucination (schema-first generation)
4. Decision safety (guardrails and validation)
5. Observability and auditability (enterprise security requirements)

## Decision

We will build an AI-Optimized Fastify Application Framework with a **minimal core and pluggable add-ons** architecture.

### Core Principles

1. **AI as the Developer**: The framework's primary user is AI, not humans. All design decisions prioritize AI comprehension and code generation over human ergonomics.

2. **Schema-First Ground Truth**: All type definitions, validation rules, and API contracts derive from a single Zod schema to prevent hallucination.

3. **Optional Add-on Architecture**: All non-essential features (OAuth, API keys, sessions, MFA) are implemented as optional add-on packages, not core framework code.

4. **Centralized Compliance**: Audit logs, security scanning, and compliance checking occur at the Kluster platform level, not within individual applications.

5. **Introspection-First**: The framework provides APIs for AI to query current state, available services, and registered routes.

## Requirements

### 1. Token Efficiency (TE)

| ID | Requirement | Priority |
|----|-------------|----------|
| TE-01 | Minimize tokens required to express application features | High |
| TE-02 | Provide declarative DSL for common patterns (CRUD, auth, integrations) | High |
| TE-03 | Use convention over configuration with sensible defaults | High |
| TE-04 | Support module blueprints (reusable, pre-defined modules) | High |
| TE-05 | Express features as intent prompts (natural language templates) | High |

### 2. Code Minimization (CM)

| ID | Requirement | Priority |
|----|-------------|----------|
| CM-01 | Single source of truth for data models, validation, and API contracts | High |
| CM-02 | CRUD operations auto-generated with opt-in override capability | High |
| CM-03 | Auto-generate OpenAPI 3.1 specifications from code | High |
| CM-04 | Auto-generate TypeScript types for frontend clients | High |
| CM-05 | Support declarative middleware chaining | High |

### 3. AppContext & Dependency Injection (AC)

| ID | Requirement | Priority |
|----|-------------|----------|
| AC-01 | Create AppContext at service startup containing all services/stores | High |
| AC-02 | Support typed dependency injection (type-safe service access) | High |
| AC-03 | Support singleton and request-scoped services | High |
| AC-04 | Register services dynamically from add-on packages | Medium |
| AC-05 | Allow custom service registration with type inference | High |
| AC-06 | Services must be testable with mock injection | Medium |

### 4. Authentication & Authorization (OA)

| ID | Requirement | Priority |
|----|-------------|----------|
| OA-01 | **Framework Core**: Provide hooks for authentication middleware | High |
| OA-02 | **Framework Core**: Provide RBAC/ABAC policy hooks | High |
| OA-03 | **Add-on**: OAuth 2.0 / OpenID Connect package | Medium |
| OA-04 | **Add-on**: SAML 2.0 package | Medium |
| OA-05 | **Add-on**: API key authentication package | Medium |
| OA-06 | **Add-on**: JWT with refresh token package | Medium |
| OA-07 | **Add-on**: MFA enforcement package | Medium |
| OA-08 | **Add-on**: Session management with Redis package | Medium |
| OA-09 | Auth packages self-register with AppContext | Medium |

### 5. Anti-Hallucination Measures (AH)

| ID | Requirement | Priority |
|----|-------------|----------|
| AH-01 | Schema-first code generation (Zod/OpenAPI as ground truth) | Critical |
| AH-02 | Compile-time type checking with strict TypeScript | Critical |
| AH-03 | Template-based code generation (not freeform) | Critical |
| AH-04 | Introspection API for available routes/endpoints | High |
| AH-05 | Service registry showing available AppContext services | High |
| AH-06 | Route blueprints with pre-defined patterns | High |
| AH-07 | AI-specific debugging API (query current state, available modules) | High |

### 6. Decision Safety & Guardrails (DS)

| ID | Requirement | Priority |
|----|-------------|----------|
| DS-01 | Validation gates before code generation (type check, schema validation) | Critical |
| DS-02 | Security scanning integration (SAST, dependency audit) | Critical |
| DS-03 | Policy engine for allowed/disallowed patterns | High |
| DS-04 | Rate limiting built-in (configurable per route) | High |
| DS-05 | Input sanitization and validation at framework level | Critical |
| DS-06 | Sensible defaults for all security features | Critical |
| DS-07 | Clear error messages for policy violations (AI-consumable) | High |

### 7. Observability (OB)

| ID | Requirement | Priority |
|----|-------------|----------|
| OB-01 | Built-in OpenTelemetry tracing (distributed traces) | High |
| OB-02 | Structured JSON logging (Pino) with correlation IDs | High |
| OB-03 | Prometheus metrics exposure (RED: Rate, Errors, Duration) | High |
| OB-04 | Health check endpoints (`/health`, `/ready`) | High |
| OB-05 | Queryable trace/log API for AI debugging | High |

### 8. Audit & Transparency (AU)

| ID | Requirement | Priority |
|----|-------------|----------|
| AU-01 | Emit structured audit events for all CRUD operations | High |
| AU-02 | Audit events sent to configured central Kluster endpoint | High |
| AU-03 | Security event stream (auth failures, permission denials) | High |
| AU-04 | Ability to query own audit trail for AI debugging | High |

### 9. Security & Compliance (SC)

| ID | Requirement | Priority |
|----|-------------|----------|
| SC-01 | Encryption at rest (framework-level helpers) | High |
| SC-02 | Encryption in transit (TLS 1.3) | High |
| SC-03 | CORS configuration | Medium |
| SC-04 | Content Security Policy (CSP) headers | Medium |
| SC-05 | CSRF token protection | Medium |
| SC-06 | Secure headers (HSTS, X-Frame-Options) | Medium |
| SC-07 | Secrets management (no hardcoded secrets pattern) | Critical |
| SC-08 | CVE scanning on dependencies | Critical |

### 10. Performance & Scalability (PS)

| ID | Requirement | Priority |
|----|-------------|----------|
| PS-01 | Connection pooling for databases | High |
| PS-02 | Caching layer hooks (optional Redis add-on) | Medium |
| PS-03 | Request/response compression | Medium |
| PS-04 | Graceful shutdown handling | High |
| PS-05 | Circuit breaker pattern for external calls | High |

### 11. AI Developer Experience (AI)

| ID | Requirement | Priority |
|----|-------------|----------|
| AI-01 | Structured error responses with actionable guidance | Critical |
| AI-02 | Query current routes, services, and registered features | High |
| AI-03 | Reflection API to understand AppContext contents | High |
| AI-04 | Dry-run mode to validate code before generation | High |
| AI-05 | Hot reload in development | Medium |
| AI-06 | Clear stack traces with AI-actionable messages | High |
| AI-07 | Test utilities (test context, mocks) | Medium |

## Architecture

### Core vs Add-Ons

**Core Framework** contains:
- AppContext DI container
- Schema system (Zod integration)
- Security hooks and base validation
- OpenTelemetry observability
- Health check endpoints
- AI introspection APIs
- Audit event emission (to external endpoint)

**Add-On Packages** contain:
- OAuth 2.0 / OIDC
- SAML 2.0
- API Key authentication
- JWT with refresh tokens
- Session management (Redis)
- MFA enforcement
- PII redaction/logging

Each add-on:
- Self-registers with AppContext
- Provides hooks for AI intent prompts
- Contains all necessary code, tests, and documentation

### AI Intent System

```
User Requirements → Kluster AI → Intent Parser → Code Generator
                                          ↓
                        ┌─────────────────────────────────────┐
                        │      Framework Introspection         │
                        │  • Available blueprints              │
                        │  • Registered add-ons                │
                        │  • Current app state               │
                        └─────────────────────────────────────┘
```

### Schema-First Example

```typescript
// Single source of truth
const CustomerSchema = defineModel({
  name: 'Customer',
  fields: {
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string().min(1),
  },
  classification: { email: 'PII' },
});

// Generates:
// - TypeScript interface
// - Zod validation middleware
// - Database schema
// - OpenAPI components
// - CRUD routes (configurable)
// - Audit event hooks
```

## Decisions Not Taken (Out of Scope)

| Feature | Reason |
|---------|--------|
| Multi-tenancy | Handled at Kluster platform level |
| Human IDE support | AI writes all code |
| Built-in auth stores | Available as add-ons |
| In-application security scanning | Performed by Kluster platform |
| Local audit storage | Sent to central Kluster store |

## Consequences

### Positive
- **AI Efficiency**: Schema-first and template-based generation reduces token usage and hallucination
- **Security by Default**: Core framework provides hooks and guardrails; add-ons provide implementation
- **Maintainability**: Clear separation of concerns; add-ons can be updated independently
- **Compliance**: Centralized audit and security scanning via Kluster platform
- **Debugging**: AI-specific introspection APIs enable self-correction

### Negative
- **Learning Curve**: AI must understand framework patterns and blueprints
- **Add-on Ecosystem**: Requires development of multiple auth packages
- **Dependency Management**: Applications may have many add-on dependencies
- **Debugging Indirection**: Audit logs in central store require platform access

### Neutral
- **Flexibility vs Opinionation**: Optional add-ons provide flexibility but require explicit opt-in
- **AI Context**: Introspection APIs add surface area but enable better AI self-correction

## References

- Fastify: https://www.fastify.io/
- Zod: https://zod.dev/
- OpenTelemetry: https://opentelemetry.io/
- OpenAPI 3.1: https://spec.openapis.org/oas/v3.1.0

---

**Author**: Claude (Architecture Designer)
**Date**: 2026-03-26
**Status**: Accepted
