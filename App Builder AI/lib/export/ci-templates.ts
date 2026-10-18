import type { DetectedBackend } from '@/lib/backend-preview/runtimes';

/**
 * GitHub Actions workflow added to the exported ZIP: runs the generated
 * backend tests and verifies the Docker images still build. Strings avoid
 * template interpolation so GitHub's own `${{ }}` syntax stays untouched.
 */
export function githubCiWorkflow(backend: DetectedBackend | null) {
  const lines = [
    'name: CI',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '  pull_request:',
    '',
    'permissions:',
    '  contents: read',
    '',
    'jobs:',
  ];

  if (backend?.kind === 'spring') {
    lines.push(
      '  backend-tests:',
      '    runs-on: ubuntu-latest',
      '    defaults:',
      '      run:',
      '        working-directory: backend',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-java@v4',
      '        with:',
      '          distribution: temurin',
      "          java-version: '21'",
      '          cache: maven',
      '      - run: mvn -B verify',
      '',
    );
  } else if (backend?.kind === 'fastapi') {
    lines.push(
      '  backend-tests:',
      '    runs-on: ubuntu-latest',
      '    defaults:',
      '      run:',
      '        working-directory: backend',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-python@v5',
      '        with:',
      "          python-version: '3.12'",
      '          cache: pip',
      '          cache-dependency-path: backend/requirements.txt',
      '      - run: pip install -r requirements.txt pytest httpx',
      '      - run: python -m pytest -q',
      '',
    );
  } else if (backend?.kind === 'node') {
    lines.push(
      '  backend-tests:',
      '    runs-on: ubuntu-latest',
      '    defaults:',
      '      run:',
      '        working-directory: backend',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-node@v4',
      '        with:',
      "          node-version: '22'",
      '      - run: npm install --no-audit --no-fund',
      '      - run: npm test',
      '',
    );
  } else if (backend?.kind === 'go') {
    lines.push(
      '  backend-tests:',
      '    runs-on: ubuntu-latest',
      '    defaults:',
      '      run:',
      '        working-directory: backend',
      '    steps:',
      '      - uses: actions/checkout@v4',
      '      - uses: actions/setup-go@v5',
      '        with:',
      '          go-version-file: backend/go.mod',
      '      - run: go vet ./...',
      '      - run: go test ./...',
      '',
    );
  }

  lines.push(
    '  docker-build:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - run: docker compose build',
    '',
  );
  return lines.join('\n');
}

/** Keeps dependencies and CI actions patched in the exported repo. */
export function dependabotConfig(backend: DetectedBackend | null) {
  const lines = ['version: 2', 'updates:'];
  const entry = (ecosystem: string, directory: string) =>
    lines.push(
      '  - package-ecosystem: ' + ecosystem,
      '    directory: ' + directory,
      '    schedule:',
      '      interval: weekly',
    );
  entry('github-actions', '/');
  if (backend?.kind === 'spring') entry('maven', '/backend');
  if (backend?.kind === 'fastapi') entry('pip', '/backend');
  if (backend?.kind === 'node') entry('npm', '/backend');
  if (backend?.kind === 'go') entry('gomod', '/backend');
  lines.push('');
  return lines.join('\n');
}
