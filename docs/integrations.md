# Integrations

Outbound integrations push product output to external systems. They are a
distinct adapter family from AI providers (spec #81).

## Interface
`IntegrationAdapter { id, label, isConfigured(), send(input) }`. Register in an
`IntegrationRegistry`. Adding Slack/Notion/HubSpot/Salesforce/Linear/Jira/Gmail
is "implement this interface + register" — no product-code changes.

## Shipped reference adapters
- `WebhookIntegration` — generic HTTP POST (Zapier/webhooks). Lowest friction.
- `SlackIntegration` — posts a message (bot token from env).
- `NotionIntegration` — appends heading + paragraph blocks.

Gmail/HubSpot/Salesforce/Linear/Jira follow the same pattern; implement when a
product needs them. Per spec #81, do NOT build every integration before the
core product works — prioritize those with obvious product value (Slack +
shareable links first).

## Secrets
Integration tokens come from env/secure storage, never the bundle. `send` never
throws into the workflow path; failures are returned as `{ ok:false, error }`.
