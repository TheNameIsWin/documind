export const HANDBOOK = `# Engineering Handbook

## Deployments
All production deployments go through the CI/CD pipeline in GitHub Actions. Every merge to main triggers a build, the full test suite and a Docker image push. Releases are deployed with a blue-green strategy so rollbacks take under a minute.

## On-call
The on-call rotation is weekly and starts every Monday at 10:00 IST. The primary on-call engineer must acknowledge pages within 15 minutes. Escalate to the secondary after 30 minutes without progress.

## Error codes
Error ERR_4012 means the payment provider rejected the token. Retry once, then surface a friendly message to the user. Error ERR_5001 indicates the database connection pool is exhausted.

## Time off
Engineers receive 24 days of paid leave per year. Leave requests should be submitted at least two weeks in advance through the HR portal.`;

export const RECIPES = `# Weekend Recipes

Masala chai is brewed with black tea, milk, ginger, cardamom and sugar. Simmer the spices for five minutes before adding tea leaves.

A quick dal tadka uses yellow lentils tempered with cumin, garlic and dried red chillies in ghee.`;
