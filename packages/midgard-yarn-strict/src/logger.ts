import winston, { format } from "winston";

const defaultLogLevel = process.env.LOG_LEVEL || "info";

const logger = winston.createLogger({
  level: defaultLogLevel,
  format: format.json(),
  transports: [],
});

// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new winston.transports.Console({
      format: format.combine(
        format.printf(({ message }) => {
          if (typeof message === "object") {
            return JSON.stringify(message, null, 2);
          }
          return message;
        }),
        format.colorize(),
        format.timestamp()
      ),
    })
  );
}
export type Logger = winston.Logger;
export { logger };
