# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Myway, please report it responsibly. **Do not open a public GitHub issue.**

Instead, use one of the following:

- **Email:** [security@myway.sh](mailto:security@myway.sh)
- **GitHub Security Advisories:** [Report a vulnerability](https://github.com/uchibeke/myway/security/advisories/new)

Please include as much detail as possible: steps to reproduce, affected versions, and potential impact.

## What Counts as a Security Issue

Security issues include, but are not limited to:

- Authentication or authorization bypasses
- Path traversal or unauthorized file system access
- Injection vulnerabilities (XSS, SQL injection, command injection)
- Exposure of sensitive data (credentials, tokens, personal information)
- Server-side request forgery (SSRF)
- Insecure defaults that could lead to data exposure

**Not security issues** (please open a regular GitHub issue instead):

- UI bugs or visual glitches
- Feature requests
- Performance issues
- Compatibility problems with specific browsers or environments

## Response Timeline

- **Acknowledgment:** Within 48 hours of your report.
- **Initial assessment:** Within 5 business days.
- **Resolution target:** Critical issues within 14 days; others within 30 days, depending on complexity.

You will be kept informed of progress throughout the process.

## Scope

This policy covers:

- The Myway application source code in the [uchibeke/myway](https://github.com/uchibeke/myway) repository
- The hosted Myway service at myway.sh
- Official Docker images and deployment configurations

Out of scope:

- Third-party dependencies (please report those to the respective maintainers, but feel free to let us know)
- Self-hosted instances misconfigured by the operator

## Recognition

We appreciate the security research community. With your permission, we will acknowledge your contribution in the release notes when a fix is published.

Thank you for helping keep Myway safe.

-- Uchi
