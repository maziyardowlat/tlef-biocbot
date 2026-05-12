# E2E Reporting

Monocart writes two separate reports:

- `monocart-report/index.html`: Playwright test results, failures, traces, screenshots, videos, and a global coverage artifact link.
- `coverage-reports/e2e/index.html`: line/branch/function coverage for `src/` and `public/`. The coverage HTML is generated with inline assets so it can be served directly.

Useful commands:

```bash
# Generate a report for every spec in tests/e2e
npm run test:monocart

# Generate only the chat/RAG/document-ingestion report
npm run test:monocart:chat-rag

# Open the last generated test-results report
npm run test:report:monocart

# Open the last generated line-coverage report
npm run test:report:coverage
```

`test:report:monocart` and `test:report:coverage` only open the last generated report. They do not run tests. If the last test command targeted one spec file, the test report will only show that spec file.
