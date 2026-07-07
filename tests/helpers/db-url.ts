/** Test database = the dev DATABASE_URL with the `mentors_test` database name. */
export function testDatabaseUrl(): string {
  const base = process.env.DATABASE_URL ?? "postgresql://mentors:mentors@localhost:5432/mentors";
  const url = new URL(base);
  url.pathname = "/mentors_test";
  return url.toString();
}
