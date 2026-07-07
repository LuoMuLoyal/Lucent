/**
 * Extracts a human-readable message and optional stack trace from any caught
 * error, suitable for structured logging.
 *
 * Replaces the repeated `error instanceof Error ? error.message : String(error)`
 * pattern scattered across catch blocks.
 */
export function extractErrorInfo(error: unknown): {
  message: string;
  stack?: string | undefined;
} {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: String(error) };
}
