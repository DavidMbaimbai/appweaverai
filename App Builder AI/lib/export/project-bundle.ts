import { zipSync } from 'fflate';

import {
  BACKEND_DOCKERIGNORE,
  FRONTEND_DOCKERFILE,
  FRONTEND_DOCKERIGNORE,
  backendDockerfile,
  cloudFormation,
  deployPowerShell,
  deployReadme,
  deployShell,
  dockerCompose,
  nginxTemplate,
} from '@/lib/export/deploy-templates';
import { detectBackend } from '@/lib/backend-preview/runtimes';
import { dependabotConfig, githubCiWorkflow } from '@/lib/export/ci-templates';

const enc = (text: string) => new TextEncoder().encode(text);

export type BundleInput = {
  projectName: string;
  /** Artifact workspace files keyed by relative path. */
  files: Record<string, Uint8Array>;
  /** For React/ESM frontends: the pre-built static page and script. */
  builtFrontend?: { indexHtml: string; bundleJs: string };
};

/**
 * Lays the artifact out as a deployable project:
 *   backend/   generated API + Dockerfile
 *   frontend/  static site + nginx Dockerfile (proxies /api to the backend)
 *   docker-compose.yml, deploy/aws/* (App Runner via CloudFormation)
 * Files the agent already wrote are never overwritten.
 */
export function buildProjectZip({
  projectName,
  files,
  builtFrontend,
}: BundleInput) {
  const out: Record<string, Uint8Array> = {};
  const backend = detectBackend(Object.keys(files));

  const add = (filePath: string, content: Uint8Array | string) => {
    if (!(filePath in out)) {
      out[filePath] = typeof content === 'string' ? enc(content) : content;
    }
  };

  for (const [filePath, content] of Object.entries(files)) {
    if (filePath.startsWith('backend/')) {
      add(filePath, content);
    } else if (filePath === 'README.md') {
      add(filePath, content);
    } else if (builtFrontend) {
      add(`frontend/source/${filePath}`, content);
    } else {
      add(`frontend/${filePath}`, content);
    }
  }

  if (builtFrontend) {
    add('frontend/index.html', builtFrontend.indexHtml);
    add('frontend/app.bundle.js', builtFrontend.bundleJs);
  }

  if (backend) {
    add('backend/Dockerfile', backendDockerfile(backend));
    add('backend/.dockerignore', BACKEND_DOCKERIGNORE);
  }

  add('frontend/Dockerfile', FRONTEND_DOCKERFILE);
  add('frontend/.dockerignore', FRONTEND_DOCKERIGNORE);
  add('frontend/nginx.conf.template', nginxTemplate(Boolean(backend)));
  add('docker-compose.yml', dockerCompose(backend));
  add('deploy/aws/cloudformation.yml', cloudFormation(Boolean(backend)));
  add('deploy/aws/deploy.sh', deployShell(backend));
  add('deploy/aws/deploy.ps1', deployPowerShell(backend));
  add('DEPLOY.md', deployReadme(projectName, backend));
  add('.github/workflows/ci.yml', githubCiWorkflow(backend));
  add('.github/dependabot.yml', dependabotConfig(backend));

  return zipSync(out);
}
