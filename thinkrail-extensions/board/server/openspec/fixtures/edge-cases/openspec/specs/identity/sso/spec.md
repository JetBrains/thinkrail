# identity/sso Specification

## Purpose

Let employees sign in through the company identity provider instead of a password of their own.

## Requirements

### Requirement: SAML login
The system SHALL accept a signed SAML assertion from the configured provider.

#### Scenario: an employee returns from
- **WHEN** an employee returns from the provider with a valid assertion
- **THEN** a session starts for that employee
