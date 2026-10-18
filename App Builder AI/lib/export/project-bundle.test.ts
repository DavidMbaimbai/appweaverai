import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';

import { detectBackend } from '@/lib/backend-preview/runtimes';
import { BACKEND_PROXY_SHIM_SCRIPT } from '@/lib/preview/backend-proxy-shim';
import { buildProjectZip } from '@/lib/export/project-bundle';

const enc = (s: string) => new TextEncoder().encode(s);

describe('detectBackend', () => {
  it('detects Spring Boot and FastAPI layouts', () => {
    expect(detectBackend(['index.html', 'backend/pom.xml'])?.kind).toBe('spring');
    expect(
      detectBackend(['backend/requirements.txt', 'backend/app/main.py']),
    ).toEqual({ kind: 'fastapi', asgiApp: 'app.main:app' });
    expect(detectBackend(['index.html'])).toBeNull();
    expect(detectBackend(['backend/requirements.txt'])).toBeNull();
    expect(detectBackend(['backend/package.json'])?.kind).toBe('node');
    expect(detectBackend(['backend/go.mod', 'backend/main.go'])?.kind).toBe('go');
  });
});

describe('buildProjectZip', () => {
  it('lays out frontend, backend, compose and AWS deploy files', () => {
    const zip = unzipSync(
      buildProjectZip({
        projectName: 'Demo',
        files: {
          'index.html': enc('<html></html>'),
          'README.md': enc('# hi'),
          'backend/pom.xml': enc('<project/>'),
          'backend/Dockerfile': enc('FROM custom'),
        },
      }),
    );

    expect(Object.keys(zip)).toEqual(
      expect.arrayContaining([
        'frontend/index.html',
        'frontend/Dockerfile',
        'frontend/nginx.conf.template',
        'backend/pom.xml',
        'docker-compose.yml',
        'deploy/aws/cloudformation.yml',
        'deploy/aws/deploy.sh',
        'README.md',
      ]),
    );
    expect(strFromU8(zip['backend/Dockerfile'])).toBe('FROM custom');
    expect(strFromU8(zip['docker-compose.yml'])).toContain('backend:8080');
    expect(strFromU8(zip['deploy/aws/cloudformation.yml'])).toContain('BackendService');
    const ci = strFromU8(zip['.github/workflows/ci.yml']);
    expect(ci).toContain('mvn -B verify');
    expect(ci).toContain('docker compose build');
  });

  it('runs pytest in CI for FastAPI backends', () => {
    const zip = unzipSync(
      buildProjectZip({
        projectName: 'Demo',
        files: {
          'index.html': enc('x'),
          'backend/requirements.txt': enc('fastapi'),
          'backend/app/main.py': enc('app = None'),
        },
      }),
    );
    expect(strFromU8(zip['.github/workflows/ci.yml'])).toContain('pytest');
    expect(strFromU8(zip['.github/dependabot.yml'])).toContain('pip');
  });

  it('omits backend resources for frontend-only artifacts', () => {
    const zip = unzipSync(
      buildProjectZip({
        projectName: 'Demo',
        files: { 'index.html': enc('x') },
      }),
    );
    expect(strFromU8(zip['docker-compose.yml'])).not.toContain('backend');
    expect(strFromU8(zip['frontend/nginx.conf.template'])).not.toContain('/api/');
  });
});

describe('backend proxy shim', () => {
  it('is syntactically valid JavaScript', () => {
    const js = BACKEND_PROXY_SHIM_SCRIPT.replace(/^<script>|<\/script>$/g, '');
    expect(() => new Function(js)).not.toThrow();
  });
});
