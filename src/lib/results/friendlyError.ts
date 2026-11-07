interface DbError { message?: string; code?: string }

/**
 * The ONE place database errors become sentences for office staff.
 * A server message is shown only when it is our own plain-English raise (Postgres P0001).
 * Everything else is mapped from its code, or falls back to the caller's sentence.
 */
export function friendlyError(error: DbError | null | undefined, fallback = "That did not work. Please try again."): Error {
  const code = error?.code;
  const m = error?.message ?? "";
  if (code === "P0001" && m.trim()) return new Error(m.trim());
  if (code === "57014" || /statement timeout/i.test(m)) return new Error("This took too long. Please try again in a minute, or ask the administrator.");
  if (code === "23505") return new Error("This was already saved by someone else. Please refresh.");
  if (code === "23514") return new Error("One of the values is not allowed. Check the name, the number and the percentage, then try again.");
  if (code === "22P02") return new Error("One of the items chosen is not valid any more. Please refresh the page and try again.");
  if (code === "PGRST202" || code === "42883") return new Error("This feature is not available yet. Please tell the administrator.");
  if (code === "42501" || /row-level security|permission denied/i.test(m)) return new Error("You do not have permission to do this.");
  if (/failed to fetch|networkerror|load failed/i.test(m)) return new Error("We could not reach the server. Check the internet connection and try again.");
  return new Error(fallback);
}
