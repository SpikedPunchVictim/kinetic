## Core Principles

### I. Incremental Progress Over Big Bangs

Every feature MUST be delivered through small, incremental changes that compile and pass tests at each step.

- Changes MUST be small enough to be reviewed and understood in under 30 minutes
- Each commit MUST leave the codebase in a working state (compiles, tests pass)
- Large features MUST be broken into 3-5 stages with documented success criteria
- Integration MUST happen continuously, not at the end of a project phase

**Rationale**: Small changes reduce risk, make rollback easier, enable faster feedback loops, and prevent the accumulation of technical debt from long-running branches.

### II. Test-First Development (NON-NEGOTIABLE)

All functionality MUST be developed following the Test-First discipline.

- Tests MUST be written before implementation code
- Tests MUST fail before implementation (red phase)
- Implementation MUST be minimal to pass tests (green phase)
- Refactoring MUST occur only with passing tests
- Integration tests are REQUIRED for: library contracts, contract changes, inter-service communication, shared schemas
- Tests MUST be deterministic and not depend on external state

**Rationale**: Test-First development ensures requirements are understood before implementation, provides immediate feedback on correctness, creates living documentation, and enables confident refactoring.

### III. Production-Ready by Default

All code MUST be production-ready when merged. There is no "we'll fix it later."

- Every commit MUST compile without warnings
- Error handling MUST be explicit - no silent failures
- Logging and structured error messages MUST be included
- Security considerations MUST be addressed for any user input or external data
- Performance characteristics MUST be documented for resource-intensive operations
- Feature flags MUST be used for incomplete functionality

**Rationale**: Infrastructure tools operate in critical environments. Production-ready practices prevent incidents, reduce operational burden, and maintain user trust.

### IV. Simplicity and YAGNI

Complexity MUST be justified. Prefer the boring solution.

- Abstractions MUST have clear, single responsibilities
- Features MUST solve a demonstrated problem, not anticipated future needs
- If code requires explanation, it MUST be simplified
- Dependencies MUST be justified - each adds operational burden
- Composition MUST be preferred over inheritance

**Rationale**: Simple code is easier to understand, test, maintain, and modify. YAGNI prevents over-engineering and keeps the codebase approachable.

## Development Workflow

### Code Quality Gates

Before any code is considered complete:

- [ ] Code compiles without warnings
- [ ] All existing tests pass
- [ ] New functionality has tests
- [ ] Project formatter and linter are satisfied
- [ ] Error handling is explicit and tested
- [ ] Commit message explains "why," not just "what"

### When Stuck (Maximum 3 Attempts Rule)

After 3 failed attempts on any issue:

1. Document what was tried, specific errors, and hypotheses
2. Research 2-3 similar implementations for alternative approaches
3. Question fundamentals - is this the right abstraction?
4. Try a different angle or simpler approach

**Rationale**: Prevents spinning on blocked problems, forces learning from existing code, and encourages simpler solutions.

## Governance

### Constitutional Authority

This constitution supersedes all other development practices. All specifications, implementation plans, and code reviews MUST verify compliance with these principles.

### Amendment Process

1. Proposed amendments MUST be documented with rationale
2. Amendment MUST be approved by project maintainer
3. Migration plan MUST be provided for existing non-compliant code
4. This document must be versioned with semantic versioning:
   - MAJOR: Backward incompatible principle removals or redefinitions
   - MINOR: New principle/section added or materially expanded guidance
   - PATCH: Clarifications, wording, typo fixes

### Compliance Review

- All feature specifications MUST reference relevant principles in the Constitution Check section
- Implementation plans MUST document any justified violations of principles with complexity tracking
- Code reviews MUST verify principle adherence or document justified exceptions