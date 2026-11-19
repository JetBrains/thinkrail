# auth Specification

## Purpose

Sign users in to their accounts and keep each session bound to the person who started it.

## Requirements

### Requirement: Password login
The system SHALL authenticate a user with an email and a password.

#### Scenario: a user submits a
- **WHEN** a user submits a matching email and password
- **THEN** a session starts for that user
