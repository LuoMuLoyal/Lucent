/**
 * Fixture contracts (`application/ports`).
 *
 * The record-lane fixture seeds a user and a handful of dependant rows; it needs
 * the *request shape* but has no business importing the HTTP DTO it arrives in.
 * Declaring the shape here lets both the controller's zod schema and the fixture
 * implementation depend on this module instead of on each other.
 */

/** Request body of `POST /testing/fullstack-e2e/record-lane/prepare`. */
export interface PrepareFullstackRecordLaneRequest {
  email: string;
  password: string;
  /** Date the seeded record belongs to, `YYYY-MM-DD`. */
  date: string;
  nickname?: string | undefined;
}

/** What the fixture returns once the lane is ready to drive the app. */
export interface PrepareFullstackRecordLaneResult {
  /** Whether this run created the user (false when it reused an existing one). */
  createdUser: boolean;
  userId: string;
  email: string;
  nickname: string | null;
  /** The date the seeded record belongs to. */
  date: string;
  /** How many pre-existing records for that date were cleared first. */
  clearedRecordCount: number;
}

/** DI token — string so a Nest resolution error names the port readably. */
export const RECORD_LANE_FIXTURE = 'RECORD_LANE_FIXTURE';

/**
 * The fixture operation the HTTP adapter invokes.
 *
 * The implementation seeds several tables inside one transaction, so it lives in
 * `infrastructure/fixtures/`; the adapter depends on this interface instead of on
 * that class (`ddd-adapters-no-infrastructure`).
 */
export interface RecordLaneFixturePort {
  prepareFullstackRecordLane(
    request: PrepareFullstackRecordLaneRequest,
  ): Promise<PrepareFullstackRecordLaneResult>;
}
