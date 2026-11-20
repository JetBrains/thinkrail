# Rate-limit login attempts per IP

## Why

Credential stuffing runs thousands of guesses a minute against the login endpoint from a few addresses.

## What Changes

- Limit login attempts per IP address.

## Capabilities

### New Capabilities
- `rate-limits`: login throttling

## Impact

The login API and its settings page.
