import pino from 'pino';

/** Structured logs. Token-shaped fields are redacted even if someone logs them by mistake. */
export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    base: { service: 'worker' },
    redact: {
      paths: [
        '*.accessToken',
        '*.refreshToken',
        '*.access_token',
        '*.refresh_token',
        '*.password',
        '*.token',
        '*.authorization',
      ],
      censor: '[redacted]',
    },
    ...(pretty && { transport: { target: 'pino-pretty', options: { colorize: true } } }),
  });
}

export type Logger = ReturnType<typeof createLogger>;
