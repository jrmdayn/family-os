import * as DateTime from "effect/DateTime";
import * as Schema from "effect/Schema";

/** The household's time zone: "today" and every date are local to it. */
export const TIME_ZONE = "Europe/Paris";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const isCalendarDate = (value: string): boolean => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

/** A calendar day, `YYYY-MM-DD`, in the household's time zone. */
export const IsoDate = Schema.String.check(
  Schema.isPattern(ISO_DATE),
  Schema.makeFilter((value: string) => isCalendarDate(value) || `${value} is not a calendar date`),
).annotate({ description: "A calendar date, YYYY-MM-DD, in the Europe/Paris time zone." });
export type IsoDate = typeof IsoDate.Type;

/** A duration of work in whole minutes, at most one day. */
export const Minutes = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: 24 * 60 }),
).annotate({ description: "A duration in whole minutes (4 hours = 240), from 1 to 1440." });
export type Minutes = typeof Minutes.Type;

const dayFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The household's calendar day at `now`. */
export const todayAt = (now: DateTime.Utc): IsoDate =>
  dayFormat.format(DateTime.toEpochMillis(now));
