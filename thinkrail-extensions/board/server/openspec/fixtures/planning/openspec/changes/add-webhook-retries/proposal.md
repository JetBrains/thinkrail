# Retry failed webhook deliveries with backoff

## Why

A receiver that is down for a minute loses every event sent meanwhile, and nobody notices until a customer asks.

## What Changes

- Retry a failed delivery with exponential backoff for a day.

## Capabilities

### New Capabilities
- `webhooks`: delivery and retries

## Impact

The login API and its settings page.
