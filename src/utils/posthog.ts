import { PostHog } from 'posthog-node'

export const client = new PostHog(
    process.env.POSTHOG_API_KEY,
    { host: 'https://us.i.posthog.com' }
)