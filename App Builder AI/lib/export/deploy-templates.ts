import type { DetectedBackend } from '@/lib/backend-preview/runtimes';

/**
 * Deployment scaffolding added to the downloadable project ZIP. Strings avoid
 * template-literal interpolation on purpose — they contain shell, nginx and
 * CloudFormation syntax that uses `$`/`{}` heavily.
 */

export function backendDockerfile(backend: DetectedBackend) {
  if (backend.kind === 'spring') {
    return [
      'FROM maven:3.9-eclipse-temurin-21 AS build',
      'WORKDIR /build',
      'COPY pom.xml .',
      'RUN mvn -B -q dependency:go-offline',
      'COPY src ./src',
      'RUN mvn -B -q -DskipTests package',
      '',
      'FROM eclipse-temurin:21-jre',
      'WORKDIR /app',
      'RUN useradd --system --create-home app',
      'COPY --from=build /build/target/*.jar app.jar',
      'USER app',
      'ENV PORT=8080',
      'EXPOSE 8080',
      'CMD ["sh", "-c", "exec java -Dserver.port=$PORT -jar app.jar"]',
      '',
    ].join('\n');
  }

  if (backend.kind === 'node') {
    return [
      'FROM node:22-alpine',
      'WORKDIR /app',
      'COPY package*.json ./',
      'RUN npm install --omit=dev --no-audit --no-fund',
      'COPY . .',
      'USER node',
      'ENV NODE_ENV=production PORT=8080',
      'EXPOSE 8080',
      'CMD ["npm", "start"]',
      '',
    ].join('\n');
  }

  if (backend.kind === 'go') {
    return [
      'FROM golang:1.23-alpine AS build',
      'WORKDIR /src',
      'COPY go.mod go.sum* ./',
      'RUN go mod download',
      'COPY . .',
      'RUN CGO_ENABLED=0 go build -o /out/server .',
      '',
      'FROM alpine:3.20',
      'RUN adduser -D app',
      'COPY --from=build /out/server /server',
      'USER app',
      'ENV PORT=8080',
      'EXPOSE 8080',
      'CMD ["/server"]',
      '',
    ].join('\n');
  }

  return [
    'FROM python:3.12-slim',
    'WORKDIR /app',
    'COPY requirements.txt .',
    'RUN pip install --no-cache-dir -r requirements.txt',
    'COPY . .',
    'RUN useradd --system --create-home app && chown -R app /app',
    'USER app',
    'ENV PORT=8000',
    'EXPOSE 8000',
    'CMD ["sh", "-c", "exec python -m uvicorn ' +
      (backend.asgiApp ?? 'app.main:app') +
      ' --host 0.0.0.0 --port $PORT"]',
    '',
  ].join('\n');
}

export const BACKEND_DOCKERIGNORE = ['target/', '__pycache__/', '.venv/', '*.pyc', 'node_modules/', '.git/', ''].join('\n');

export function backendPort(backend: DetectedBackend) {
  return backend.kind === 'fastapi' ? 8000 : 8080;
}

export const FRONTEND_DOCKERFILE = [
  'FROM nginx:1.27-alpine',
  'COPY nginx.conf.template /etc/nginx/templates/default.conf.template',
  'COPY . /usr/share/nginx/html',
  'EXPOSE 80',
  '',
].join('\n');

export const FRONTEND_DOCKERIGNORE = [
  'Dockerfile',
  'nginx.conf.template',
  '.dockerignore',
  '',
].join('\n');

/** nginx (official image) renders *.template with envsubst at container start. */
export function nginxTemplate(hasBackend: boolean) {
  const lines = ['server {', '  listen 80;', '  root /usr/share/nginx/html;', '  index index.html;', ''];
  if (hasBackend) {
    lines.push(
      '  location /api/ {',
      '    proxy_pass $BACKEND_SCHEME://$BACKEND_HOST;',
      '    proxy_set_header Host $BACKEND_HOST;',
      '    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
      '    proxy_ssl_server_name on;',
      '  }',
      '',
    );
  }
  lines.push('  location / {', '    try_files $uri $uri/ /index.html;', '  }', '}', '');
  return lines.join('\n');
}

export function dockerCompose(backend: DetectedBackend | null) {
  const lines = ['services:'];
  if (backend) {
    const port = backendPort(backend);
    lines.push(
      '  db:',
      '    image: postgres:16-alpine',
      '    environment:',
      '      POSTGRES_USER: app',
      '      POSTGRES_PASSWORD: app',
      '      POSTGRES_DB: app',
      '    volumes:',
      '      - db_data:/var/lib/postgresql/data',
      '    healthcheck:',
      '      test: ["CMD-SHELL", "pg_isready -U app -d app"]',
      '      interval: 5s',
      '      timeout: 5s',
      '      retries: 10',
      '    restart: unless-stopped',
      '',
      '  backend:',
      '    build: ./backend',
      '    ports:',
      '      - "' + port + ':' + port + '"',
      '    environment:',
      '      DATABASE_URL: postgresql://app:app@db:5432/app',
      '      DATABASE_JDBC_URL: jdbc:postgresql://db:5432/app',
      '      DATABASE_USERNAME: app',
      '      DATABASE_PASSWORD: app',
      '    depends_on:',
      '      db:',
      '        condition: service_healthy',
      '    restart: unless-stopped',
      '',
    );
  }
  lines.push('  frontend:', '    build: ./frontend', '    ports:', '      - "3000:80"');
  if (backend) {
    lines.push(
      '    environment:',
      '      BACKEND_SCHEME: http',
      '      BACKEND_HOST: backend:' + backendPort(backend),
      '    depends_on:',
      '      - backend',
    );
  }
  lines.push('    restart: unless-stopped', '');
  if (backend) lines.push('volumes:', '  db_data:', '');
  return lines.join('\n');
}

const DB_PARAMS = ['DatabaseUrl', 'DatabaseJdbcUrl', 'DatabaseUsername', 'DatabasePassword'] as const;
const DB_ENV: Record<(typeof DB_PARAMS)[number], string> = {
  DatabaseUrl: 'DATABASE_URL',
  DatabaseJdbcUrl: 'DATABASE_JDBC_URL',
  DatabaseUsername: 'DATABASE_USERNAME',
  DatabasePassword: 'DATABASE_PASSWORD',
};

export function cloudFormation(hasBackend: boolean) {
  const lines = [
    "AWSTemplateFormatVersion: '2010-09-09'",
    'Description: AppWeaver AI project on AWS App Runner',
    'Parameters:',
    '  FrontendImage:',
    '    Type: String',
  ];
  if (hasBackend) {
    lines.push('  BackendImage:', '    Type: String', '  BackendPort:', '    Type: String', "    Default: '8080'");
    for (const param of DB_PARAMS) {
      lines.push('  ' + param + ':', '    Type: String', "    Default: ''", '    NoEcho: true');
    }
    lines.push(
      'Conditions:',
      "  HasDatabase: !Not [!Equals [!Ref DatabaseUrl, '']]",
    );
  }
  lines.push(
    'Resources:',
    '  EcrAccessRole:',
    '    Type: AWS::IAM::Role',
    '    Properties:',
    '      AssumeRolePolicyDocument:',
    "        Version: '2012-10-17'",
    '        Statement:',
    '          - Effect: Allow',
    '            Principal:',
    '              Service: build.apprunner.amazonaws.com',
    '            Action: sts:AssumeRole',
    '      ManagedPolicyArns:',
    '        - arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess',
  );
  if (hasBackend) {
    lines.push(
      '  BackendService:',
      '    Type: AWS::AppRunner::Service',
      '    Properties:',
      '      ServiceName: !Join ["-", [!Ref "AWS::StackName", backend]]',
      '      InstanceConfiguration:',
      "        Cpu: '1024'",
      "        Memory: '2048'",
      '      SourceConfiguration:',
      '        AutoDeploymentsEnabled: false',
      '        AuthenticationConfiguration:',
      '          AccessRoleArn: !GetAtt EcrAccessRole.Arn',
      '        ImageRepository:',
      '          ImageRepositoryType: ECR',
      '          ImageIdentifier: !Ref BackendImage',
      '          ImageConfiguration:',
      '            Port: !Ref BackendPort',
      '            RuntimeEnvironmentVariables:',
      ...DB_PARAMS.flatMap((param) => [
        '              - Fn::If:',
        '                  - HasDatabase',
        '                  - Name: ' + DB_ENV[param],
        '                    Value: !Ref ' + param,
        '                  - !Ref AWS::NoValue',
      ]),
    );
  }
  lines.push(
    '  FrontendService:',
    '    Type: AWS::AppRunner::Service',
    '    Properties:',
    '      ServiceName: !Join ["-", [!Ref "AWS::StackName", frontend]]',
    '      SourceConfiguration:',
    '        AutoDeploymentsEnabled: false',
    '        AuthenticationConfiguration:',
    '          AccessRoleArn: !GetAtt EcrAccessRole.Arn',
    '        ImageRepository:',
    '          ImageRepositoryType: ECR',
    '          ImageIdentifier: !Ref FrontendImage',
    '          ImageConfiguration:',
    "            Port: '80'",
  );
  if (hasBackend) {
    lines.push(
      '            RuntimeEnvironmentVariables:',
      '              - Name: BACKEND_SCHEME',
      '                Value: https',
      '              - Name: BACKEND_HOST',
      '                Value: !GetAtt BackendService.ServiceUrl',
    );
  }
  lines.push(
    'Outputs:',
    '  AppUrl:',
    '    Value: !Join ["", ["https://", !GetAtt FrontendService.ServiceUrl]]',
    '',
  );
  return lines.join('\n');
}

export function deployShell(backend: DetectedBackend | null) {
  const services = backend ? ['backend', 'frontend'] : ['frontend'];
  const lines = [
    '#!/usr/bin/env bash',
    '# One-command deploy to AWS App Runner. Requires: AWS CLI (logged in), Docker.',
    '# Usage: ./deploy/aws/deploy.sh [stack-name]',
    'set -euo pipefail',
    'cd "$(dirname "$0")/../.."',
    '',
    'STACK="${1:-appweaver-app}"',
    'REGION="${AWS_REGION:-$(aws configure get region)}"',
    'ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"',
    'REGISTRY="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"',
    'TAG="$(date +%s)"',
    '',
    'aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$REGISTRY"',
    '',
  ];
  for (const service of services) {
    lines.push(
      'aws ecr describe-repositories --region "$REGION" --repository-names "$STACK-' + service + '" >/dev/null 2>&1 \\',
      '  || aws ecr create-repository --region "$REGION" --repository-name "$STACK-' + service + '" >/dev/null',
      'docker build --platform linux/amd64 -t "$REGISTRY/$STACK-' + service + ':$TAG" ./' + service,
      'docker push "$REGISTRY/$STACK-' + service + ':$TAG"',
      '',
    );
  }
  const overrides = services.map((s) =>
    s === 'backend'
      ? 'BackendImage="$REGISTRY/$STACK-backend:$TAG" BackendPort=' + (backend ? backendPort(backend) : 8080) +
        ' DatabaseUrl="${DATABASE_URL:-}" DatabaseJdbcUrl="${DATABASE_JDBC_URL:-}" DatabaseUsername="${DATABASE_USERNAME:-}" DatabasePassword="${DATABASE_PASSWORD:-}"'
      : 'FrontendImage="$REGISTRY/$STACK-frontend:$TAG"',
  );
  lines.push(
    'aws cloudformation deploy --region "$REGION" --stack-name "$STACK" \\',
    '  --template-file deploy/aws/cloudformation.yml --capabilities CAPABILITY_IAM \\',
    '  --parameter-overrides ' + overrides.join(' '),
    '',
    'aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \\',
    '  --query "Stacks[0].Outputs[?OutputKey==\'AppUrl\'].OutputValue" --output text',
    '',
  );
  return lines.join('\n');
}

export function deployPowerShell(backend: DetectedBackend | null) {
  const services = backend ? ['backend', 'frontend'] : ['frontend'];
  const lines = [
    '# One-command deploy to AWS App Runner. Requires: AWS CLI (logged in), Docker.',
    '# Usage: ./deploy/aws/deploy.ps1 [-Stack appweaver-app]',
    'param([string]$Stack = "appweaver-app")',
    '$ErrorActionPreference = "Stop"',
    'Set-Location (Join-Path $PSScriptRoot "../..")',
    '',
    '$Region = if ($env:AWS_REGION) { $env:AWS_REGION } else { aws configure get region }',
    '$Account = aws sts get-caller-identity --query Account --output text',
    '$Registry = "$Account.dkr.ecr.$Region.amazonaws.com"',
    '$Tag = [int][double]::Parse((Get-Date -UFormat %s))',
    '',
    'aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin $Registry',
    '',
  ];
  for (const service of services) {
    lines.push(
      'aws ecr describe-repositories --region $Region --repository-names "$Stack-' + service + '" 2>$null | Out-Null',
      'if ($LASTEXITCODE -ne 0) { aws ecr create-repository --region $Region --repository-name "$Stack-' + service + '" | Out-Null }',
      'docker build --platform linux/amd64 -t "$Registry/$Stack-' + service + ':$Tag" ./' + service,
      'docker push "$Registry/$Stack-' + service + ':$Tag"',
      '',
    );
  }
  const overrides = services.map((s) =>
    s === 'backend'
      ? '"BackendImage=$Registry/$Stack-backend:$Tag" "BackendPort=' + (backend ? backendPort(backend) : 8080) + '" "DatabaseUrl=$env:DATABASE_URL" "DatabaseJdbcUrl=$env:DATABASE_JDBC_URL" "DatabaseUsername=$env:DATABASE_USERNAME" "DatabasePassword=$env:DATABASE_PASSWORD"'
      : '"FrontendImage=$Registry/$Stack-frontend:$Tag"',
  );
  lines.push(
    'aws cloudformation deploy --region $Region --stack-name $Stack --template-file deploy/aws/cloudformation.yml --capabilities CAPABILITY_IAM --parameter-overrides ' +
      overrides.join(' '),
    '',
    'aws cloudformation describe-stacks --region $Region --stack-name $Stack --query "Stacks[0].Outputs[?OutputKey==\'AppUrl\'].OutputValue" --output text',
    '',
  );
  return lines.join('\n');
}

export function deployReadme(projectName: string, backend: DetectedBackend | null) {
  return [
    '# Deploying ' + projectName,
    '',
    '## Run locally with Docker',
    '',
    '    docker compose up --build',
    '',
    'Open http://localhost:3000' + (backend ? ' (the frontend proxies /api to the backend).' : '.'),
    '',
    '## Deploy to AWS (App Runner)',
    '',
    'Prerequisites: an AWS account, the AWS CLI logged in (`aws configure`), and Docker.',
    '',
    '    bash deploy/aws/deploy.sh my-stack       # macOS / Linux',
    '    ./deploy/aws/deploy.ps1 -Stack my-stack  # Windows PowerShell',
    '',
    'The script creates ECR repositories, builds and pushes the image' + (backend ? 's' : '') + ', then creates a CloudFormation stack with ' + (backend ? 'two App Runner services (backend + frontend)' : 'an App Runner service') + ' and prints the public URL. Re-run it to deploy updates. Delete the stack and ECR repositories to tear everything down.',
    '',
    'Note: App Runner and ECR are billed by AWS.' + (backend ? ' `docker compose up` starts a local Postgres and wires the backend to it. For AWS, set `DATABASE_URL`, `DATABASE_JDBC_URL`, `DATABASE_USERNAME` and `DATABASE_PASSWORD` in your shell before running the deploy script (the AppWeaver editor can copy these for a managed production database); otherwise the backend uses its embedded database, which is not persistent.' : ''),
    '',
  ].join('\n');
}
