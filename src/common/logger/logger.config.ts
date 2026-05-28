import {
  utilities as nestWinstonUtilities,
  WinstonModuleOptions,
} from 'nest-winston';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';

const LOG_DIR = path.resolve(process.cwd(), 'logs');

function createDailyRotateTransport(
  level: string,
  filename: string,
): DailyRotateFile {
  return new DailyRotateFile({
    level,
    dirname: LOG_DIR,
    filename: `${filename}-%DATE%.log`,
    datePattern: 'YYYY-MM-DD',
    zippedArchive: true,
    maxSize: '20m',
    maxFiles: '30d', // 保留 30 天
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
  });
}

export function createWinstonLoggerOptions(
  nodeEnv: string,
  logLevel: string,
): WinstonModuleOptions {
  const isProduction = nodeEnv === 'production';
  const level = logLevel || (isProduction ? 'info' : 'debug');

  const transports: winston.transport[] = [
    // ── 控制台 ──
    new winston.transports.Console({
      format: isProduction
        ? winston.format.combine(
            winston.format.timestamp(),
            winston.format.json(),
          )
        : winston.format.combine(
            winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
            nestWinstonUtilities.format.nestLike('Lucent', {
              colors: true,
              prettyPrint: true,
            }),
          ),
    }),

    // ── 按天滚动：全量日志 ──
    createDailyRotateTransport(level, 'app'),

    // ── 按天滚动：错误日志（只记录 error 及以上） ──
    createDailyRotateTransport('error', 'error'),
  ];

  return { level, transports };
}
