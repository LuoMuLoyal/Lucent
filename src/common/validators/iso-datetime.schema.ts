import { z } from 'zod';

/**
 * Zod fragment for fields whose wire shape accepts either an ISO 8601
 * calendar date (`YYYY-MM-DD`) or an ISO 8601 datetime.
 *
 * Rendered as a plain `string` in the OpenAPI conversion (the `refine` step
 * is not part of the standard JSON schema) — unions of `z.iso.date()` /
 * `z.iso.datetime()` would otherwise surface as `anyOf` and break the
 * Luminous OpenAPI client generator's per-parameter model expansion.
 *
 * Runtime validation stays native: `z.iso.*` is used inside the refine.
 */
export interface IsoDateOrDatetimeSchemaOptions {
  /** Accept datetimes without a timezone offset/local designator. Default: false. */
  allowLocal?: boolean;
  /** Custom error message. */
  message?: string;
}

export function isoDateOrDatetimeSchema(
  options: IsoDateOrDatetimeSchemaOptions = {},
) {
  const { allowLocal = false, message } = options;
  const datetimeOptions = allowLocal
    ? { offset: true, local: true }
    : { offset: true };

  return z.string().refine(
    (value) => {
      const asDate = z.iso.date().safeParse(value).success;
      if (asDate) return true;
      return z.iso.datetime(datetimeOptions).safeParse(value).success;
    },
    {
      message:
        message ??
        `Invalid date. Expected YYYY-MM-DD or an ISO 8601 datetime${
          allowLocal ? '' : ' with a UTC offset'
        }.`,
    },
  );
}
