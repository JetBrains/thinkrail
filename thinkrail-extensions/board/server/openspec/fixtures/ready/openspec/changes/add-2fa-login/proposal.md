# Add TOTP two-factor login

## Why

Passwords alone are phished every week; a second factor stops a stolen password from opening an account.

## What Changes

- Add TOTP enrollment on the security page.
- Ask for a TOTP code after the password once enrolled.

## Capabilities

### New Capabilities
- `audit-log`: a record of security events

### Modified Capabilities
- `auth`: login asks for a second factor

## Impact

The login API and its settings page.
