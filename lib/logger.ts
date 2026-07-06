import pino from "pino";

// DECISION: plain JSON logs to stdout (spec section 18: stdout -> journald),
// no pretty-printer dependency; request-id binding arrives with server actions (stage 1+).
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});
