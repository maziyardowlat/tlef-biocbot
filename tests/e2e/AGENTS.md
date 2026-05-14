# AGENTS.md

## Testing Rules

When writing tests:

- Do not change production code.
- Only edit files under `tests/` or existing test fixtures/helpers unless explicitly told otherwise.
- Write tests that expose faults in existing code.
- If a test exposes a product bug or security gap, leave it failing and report it.
- Before Playwright runs, type-check changed JS tests with:
  `npx tsc --noEmit --allowJs --checkJs <changed-test-files>`

## Focused Coverage Work

For coverage tasks:

- Keep investigation narrow.
- Inspect only the target source file, the page/component that loads it, related specs found with `rg`, and helpers/fixtures only as needed.
- Use Monocart output if available:
  - `coverage-reports/e2e/coverage-summary.json`
  - `coverage-reports/e2e/coverage-report.json`
- Prefer meaningful browser-level behavior.
- Use compact Playwright browser harnesses only for high-value helper/error branches.
- Mock only expensive, flaky, or branch-forcing endpoints.

## Type-Check Patterns

For test-only browser globals, use local casts instead of production typings:

```js
const testWindow = /** @type {any} */ (window);
```
