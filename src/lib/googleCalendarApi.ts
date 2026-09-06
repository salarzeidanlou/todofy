/** Calendar lookups may be recreated only when Google says the resource is gone. */
export function isMissingCalendarStatus(status: number): boolean {
  return status === 404 || status === 410;
}

/** Deleting an already-missing calendar is idempotent and counts as success. */
export function calendarDeleteSucceeded(status: number): boolean {
  return (status >= 200 && status < 300) || isMissingCalendarStatus(status);
}
