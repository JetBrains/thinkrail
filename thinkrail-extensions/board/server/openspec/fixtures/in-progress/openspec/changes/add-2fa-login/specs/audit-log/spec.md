## ADDED Requirements

### Requirement: Security events
The system SHALL record every second-factor enrollment and login attempt.

#### Scenario: a user enrolls a
- **WHEN** a user enrolls a TOTP authenticator
- **THEN** an audit entry names the user and the time
