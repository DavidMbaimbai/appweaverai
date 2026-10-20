// Generates an AWS CloudFormation template that runs every cron in vercel.json
// through EventBridge (rule -> API destination -> GET <BaseUrl><path> with a Bearer CRON_SECRET).
// Usage: node scripts/aws-cron-template.mjs > infra/aws-crons.json
import { readFileSync } from 'node:fs';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function field(value, name) {
  if (value === '*') return '*';
  const step = /^\*\/(\d+)$/.exec(value);
  if (step) return name === 'dom' || name === 'month' ? `1/${step[1]}` : `0/${step[1]}`;
  if (/^\d+(,\d+)*$/.test(value)) return value;
  throw new Error(`Unsupported cron field "${value}"`);
}

/** Converts a 5-field unix cron (UTC) into the 6-field EventBridge form. */
export function toEventBridgeCron(expr) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`Unsupported cron "${expr}"`);
  const [min, hour, dom, month, dow] = parts;
  const dowOut = dow === '*' ? '?' : dow.split(',').map((d) => DAYS[Number(d) % 7]).join(',');
  const domOut = dow === '*' ? field(dom, 'dom') : '?';
  return `cron(${field(min, 'min')} ${field(hour, 'hour')} ${domOut} ${field(month, 'month')} ${dowOut} *)`;
}

function logicalId(path) {
  return 'Cron' + path.replace(/^\/api\/cron\//, '').replace(/(^|[^a-zA-Z0-9]+)([a-zA-Z0-9])/g, (_, __, c) => c.toUpperCase());
}

export function buildTemplate(crons) {
  const resources = {
    CronConnection: {
      Type: 'AWS::Events::Connection',
      Properties: {
        AuthorizationType: 'API_KEY',
        AuthParameters: {
          ApiKeyAuthParameters: { ApiKeyName: 'Authorization', ApiKeyValue: { 'Fn::Sub': 'Bearer ${CronSecret}' } },
        },
      },
    },
    CronInvokeRole: {
      Type: 'AWS::IAM::Role',
      Properties: {
        AssumeRolePolicyDocument: {
          Version: '2012-10-17',
          Statement: [{ Effect: 'Allow', Principal: { Service: 'events.amazonaws.com' }, Action: 'sts:AssumeRole' }],
        },
        Policies: [
          {
            PolicyName: 'invoke-api-destinations',
            PolicyDocument: {
              Version: '2012-10-17',
              Statement: [{ Effect: 'Allow', Action: 'events:InvokeApiDestination', Resource: { 'Fn::Sub': 'arn:aws:events:${AWS::Region}:${AWS::AccountId}:api-destination/*' } }],
            },
          },
        ],
      },
    },
  };

  for (const { path, schedule } of crons) {
    const id = logicalId(path);
    resources[`${id}Destination`] = {
      Type: 'AWS::Events::ApiDestination',
      Properties: {
        ConnectionArn: { 'Fn::GetAtt': ['CronConnection', 'Arn'] },
        HttpMethod: 'GET',
        InvocationEndpoint: { 'Fn::Sub': `\${BaseUrl}${path}` },
        InvocationRateLimitPerSecond: 5,
      },
    };
    resources[`${id}Rule`] = {
      Type: 'AWS::Events::Rule',
      Properties: {
        ScheduleExpression: toEventBridgeCron(schedule),
        State: 'ENABLED',
        Targets: [
          {
            Id: 'call',
            Arn: { 'Fn::GetAtt': [`${id}Destination`, 'Arn'] },
            RoleArn: { 'Fn::GetAtt': ['CronInvokeRole', 'Arn'] },
            RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 300 },
          },
        ],
      },
    };
  }

  return {
    AWSTemplateFormatVersion: '2010-09-09',
    Description: 'AppWeaver AI scheduled jobs (generated from vercel.json by scripts/aws-cron-template.mjs)',
    Parameters: {
      BaseUrl: { Type: 'String', Description: 'Public origin without trailing slash, e.g. https://appweaverai.com' },
      CronSecret: { Type: 'String', NoEcho: true, Description: 'Must equal the CRON_SECRET env var of the app' },
    },
    Resources: resources,
  };
}

if (process.argv[1] && process.argv[1].endsWith('aws-cron-template.mjs')) {
  const { crons = [] } = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  process.stdout.write(JSON.stringify(buildTemplate(crons), null, 2) + '\n');
}
