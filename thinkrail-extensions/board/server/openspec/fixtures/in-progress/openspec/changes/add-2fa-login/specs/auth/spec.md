## ADDED Requirements

### Requirement: TOTP enrollment
The system SHALL let a user enroll a TOTP authenticator.

#### Scenario: a user scans the
- **WHEN** a user scans the QR code and confirms a valid code
- **THEN** two-factor login is enabled and recovery codes are shown once

### Requirement: Recovery codes
The system SHALL accept a single-use recovery code in place of a TOTP code.

#### Scenario: a user enters an
- **WHEN** a user enters an unused recovery code
- **THEN** the login completes and that code is spent

## MODIFIED Requirements

### Requirement: Password login
The system SHALL authenticate a user with an email and a password and, once enrolled, a TOTP code.

#### Scenario: a user submits a
- **WHEN** a user submits a matching email and password
- **THEN** a session starts for that user
