# billing Specification

## Purpose
Charge customers and give money back when an order is returned in part or in full.

## Requirements

### Requirement: Partial refund
The system SHALL refund any amount up to the captured total of an order.

#### Scenario: an agent refunds part
- **WHEN** an agent refunds part of a captured order
- **THEN** the customer is credited that amount
