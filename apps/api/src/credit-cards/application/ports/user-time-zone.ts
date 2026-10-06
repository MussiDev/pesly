/** The IANA time zone of the caller, used to compute "today" (PRD 01 FR-24). */
export interface UserTimeZone {
  timeZoneOf(userId: string): Promise<string>;
}
