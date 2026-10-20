# Scheduled jobs on AWS

`vercel.json` crons only run on Vercel. On AWS (or the VPS) nothing calls `/api/cron/*`, so ads,
social posts, replies, backups, reminders and the content pipeline do not run until you do this.

EventBridge calls each endpoint with `Authorization: Bearer <CRON_SECRET>`. All times are UTC.

```powershell
node scripts/aws-cron-template.mjs > infra/aws-crons.json
aws cloudformation deploy --template-file infra/aws-crons.json --stack-name appweaver-crons `
  --capabilities CAPABILITY_IAM `
  --parameter-overrides BaseUrl=https://appweaverai.com CronSecret=<same value as the app's CRON_SECRET>
```

Re-run both commands whenever `vercel.json` crons change.

## Checks
- The app's `CRON_SECRET` must be set and identical to the stack parameter.
- `curl -H "Authorization: Bearer $CRON_SECRET" https://<host>/api/cron/ads` should return 200 (it returns `enabled:false` until `META_ADS_ENABLED=true`).
- EventBridge > Rules shows invocation and failed-invocation metrics per rule.
- The app must be reachable from the internet over HTTPS (ALB/CloudFront), not only via a private address.
- Not tested against a real AWS account.
