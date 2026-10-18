export type BackendKind = 'spring' | 'fastapi' | 'node' | 'go';

export type DetectedBackend = {
  kind: BackendKind;
  /** FastAPI only: `module:attribute` handed to uvicorn. */
  asgiApp?: string;
};

export type BackendRuntime = {
  label: string;
  image: string;
  port: number;
  memory: string;
  /** Runs in /app/backend inside the container. */
  command: (backend: DetectedBackend) => string;
  /** Runs the generated unit/integration tests (embedded DB, no services). */
  testCommand: string;
};

export const BACKEND_RUNTIMES: Record<BackendKind, BackendRuntime> = {
  spring: {
    label: 'Spring Boot',
    image: 'maven:3.9-eclipse-temurin-21',
    port: 8080,
    memory: '1536m',
    command: () =>
      'mvn -B -q -Dmaven.repo.local=/m2 -DskipTests spring-boot:run',
    testCommand: 'mvn -B -Dmaven.repo.local=/m2 test',
  },
  fastapi: {
    label: 'FastAPI',
    image: 'python:3.12-slim',
    port: 8000,
    memory: '512m',
    command: (backend) =>
      `pip install --no-cache-dir --target /pydeps -r requirements.txt && PYTHONPATH=/pydeps python -m uvicorn ${backend.asgiApp ?? 'app.main:app'} --host 0.0.0.0 --port 8000`,
    testCommand:
      'pip install --no-cache-dir --target /pydeps -r requirements.txt pytest httpx && PYTHONPATH=/pydeps:. python -m pytest -q',
  },
  node: {
    label: 'Node.js (Express)',
    image: 'node:22-alpine',
    port: 8080,
    memory: '768m',
    command: () =>
      'export npm_config_cache=/m2/npm PORT=8080 && npm install --no-audit --no-fund && npm start',
    testCommand:
      'export npm_config_cache=/m2/npm && npm install --no-audit --no-fund && npm test',
  },
  go: {
    label: 'Go',
    image: 'golang:1.23-alpine',
    port: 8080,
    memory: '768m',
    command: () =>
      'export GOMODCACHE=/m2/gomod GOCACHE=/tmp/gocache GOFLAGS=-buildvcs=false PORT=8080 && go run .',
    testCommand:
      'export GOMODCACHE=/m2/gomod GOCACHE=/tmp/gocache GOFLAGS=-buildvcs=false && go test ./...',
  },
};

/** Finds the backend the agent generated under `backend/`, if any. */
export function detectBackend(relativePaths: string[]): DetectedBackend | null {
  const paths = new Set(relativePaths);

  if (paths.has('backend/pom.xml')) return { kind: 'spring' };
  if (paths.has('backend/go.mod')) return { kind: 'go' };
  if (paths.has('backend/package.json')) return { kind: 'node' };

  if (paths.has('backend/requirements.txt')) {
    if (paths.has('backend/app/main.py')) {
      return { kind: 'fastapi', asgiApp: 'app.main:app' };
    }
    if (paths.has('backend/main.py')) {
      return { kind: 'fastapi', asgiApp: 'main:app' };
    }
  }

  return null;
}
