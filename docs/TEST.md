# Test System

CozySSH includes integrated (e2e) Go test files. E2E tests use Docker to spawn real "ssh servers" and use [Playwright](https://playwright.dev/) to control real browser instances (Chromium) for UI testing.

To run those test files you need a Linux test server.

## Test Server Requirement

- Ubuntu 24.04 amd64 (tested to work, other distros may work too).
- Go 1.25+, Node.js v24, Docker installed.
- Install Playwright system dependencies:
  ```bash
  # Install through go
  go run github.com/playwright-community/playwright-go/cmd/playwright@latest install-deps

  # Or install through npm
  npx playwright install-deps
  ```

  
## Run Tests

To run tests on Test Server workspace dir:

```bash
go test -v -tags=integration ./test/e2e/...
```
