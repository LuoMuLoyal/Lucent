import {
  utilities as nestWinstonUtilities,
  WinstonModuleOptions,
} from 'nest-winston';
import * as winston from 'winston';

export function createWinstonLoggerOptions(
  nodeEnv: string,
  logLevel: string,
): WinstonModuleOptions {
  const isProduction = nodeEnv === 'production';

  return {
    level: logLevel || (isProduction ? 'info' : 'debug'),
    transports: [
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
    ],
  };
}
