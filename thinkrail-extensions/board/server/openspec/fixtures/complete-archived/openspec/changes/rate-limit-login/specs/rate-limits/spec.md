## ADDED Requirements

### Requirement: Login throttle
The system SHALL refuse more than ten login attempts per minute from one IP address.

#### Scenario: an address sends an
- **WHEN** an address sends an eleventh attempt within a minute
- **THEN** the attempt is refused with a retry time
