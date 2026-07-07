// Client-safe shared constants (no node imports — client components use these).

// DECISION: «+1 месяц» / «+3 месяца» are 30/90 days — access_extensions.days is
// day-granular by schema (spec 6), calendar months would not fit the field.
export const EXTENSION_MONTH_DAYS = 30;
