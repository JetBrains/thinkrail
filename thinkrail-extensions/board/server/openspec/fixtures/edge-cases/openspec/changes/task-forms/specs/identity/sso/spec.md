## RENAMED Requirements

- FROM: `### Requirement: SAML login`
- TO: `### Requirement: SAML sign-in`

## ADDED Requirements

### Requirement: OIDC login
The system SHALL accept an OpenID Connect ID token from the configured provider.

#### Scenario: an employee returns with
- **WHEN** an employee returns with a valid ID token
- **THEN** a session starts for that employee

```md
### Requirement: Fenced example is no requirement
```
