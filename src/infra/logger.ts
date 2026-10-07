import pino from 'pino';
import { env } from '../config/env.js';

const isMcpStdioProcess = process.argv.some((arg) =>
  /(?:^|[\\/])(?:src[\\/]mcp[\\/]server\.ts|dist[\\/]mcp[\\/]server\.js)$/.test(arg)
);

export const logger =
  env.NODE_ENV === 'development'
    ? pino({
        level: 'debug',
        transport: {
          target: 'pino-pretty',
          options: {
            destination: isMcpStdioProcess ? 2 : 1,
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname'
          }
        }
      })
    : pino(
        { level: 'info' },
        isMcpStdioProcess ? process.stderr : process.stdout
      );
