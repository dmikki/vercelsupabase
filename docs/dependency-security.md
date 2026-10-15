# Dependency audit — 2026-10-15

Next.js and eslint-config-next are pinned to 16.4.1. ESLint uses the compatible 9.x peer range required by the current lint plugins. The lockfile was regenerated with npm, without audit fix --force.

The audit now reports zero production vulnerabilities (npm audit --omit=dev). The full audit still reports five high-severity entries in one development-only chain: eslint-config-next → @next/eslint-plugin-next → fast-glob → micromatch → braces. GHSA-vfj7-8cjw-p6xm has no patched braces release at verification time. Do not downgrade eslint-config-next to 14.x just to clear the count on a Next 16 app. Recheck the upstream fix before updating this chain; do not feed untrusted glob patterns to lint tools.

After pulling main: npm ci, npm audit --omit=dev, npm audit. Full audit is expected to remain nonzero until the upstream development dependency is fixed. Runtime audit success is not a guarantee that all application security issues are absent.
