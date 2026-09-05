/** Test database = the dev DATABASE_URL with the `mentors_test` database name. */
export function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL ?? "postgresql://mentors:mentors@localhost:5432/mentors";
  const url = new URL(base);
  url.pathname = "/mentors_test";
  return url.toString();
}
