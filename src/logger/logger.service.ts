import { Injectable, LoggerService } from '@nestjs/common';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as process from 'process';

@Injectable()
export class WinstonLoggerService implements LoggerService {
  private logger: winston.Logger;

  constructor() {
    const environment = process.env.NODE_ENV || 'local';

    // Base configuration for the logger
    const colors = {
      error: 'red',
      warn: 'yellow',
      info: 'green',
      http: 'magenta',
      verbose: 'cyan',
      debug: 'blue',
      silly: 'grey',
    };

    winston.addColors(colors);

    // Create environment-specific transport
    const fileTransport = new DailyRotateFile({
      dirname: `logs/${environment}`,
      filename: `%DATE%-${environment}-application.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: this.getMaxSize(environment),
      maxFiles: this.getMaxFiles(environment),
      level: this.getLogLevel(environment),
    });

    // Console transport configuration varies by environment
    const consoleTransport = new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.simple(),
      ),
      level: this.getLogLevel(environment),
    });

    this.logger = winston.createLogger({
      level: this.getLogLevel(environment),
      format: winston.format.combine(
        winston.format.timestamp({
          format: 'YYYY-MM-DD HH:mm:ss',
        }),
        winston.format.errors({ stack: true }),
        winston.format.splat(),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'inventory-service',
        environment: environment,
      },
      transports: [
        fileTransport,
        ...(this.shouldUseConsole(environment) ? [consoleTransport] : []),
      ],
    });
  }

  private getLogLevel(environment: string): string {
    switch (environment) {
      case 'production':
        return 'warn'; // Only warnings and errors in production
      case 'development':
        return 'info'; // Info and above in development
      default:
        return 'debug'; // All logs in local environment
    }
  }

  private getMaxSize(environment: string): string {
    switch (environment) {
      case 'production':
        return '50m'; // Larger size for production
      case 'development':
        return '30m';
      default:
        return '20m'; // Smaller size for local
    }
  }

  private getMaxFiles(environment: string): string {
    switch (environment) {
      case 'production':
        return '14d'; // Keep logs longer in production
      case 'development':
        return '5d';
      default:
        return '3d'; // Short retention for local
    }
  }

  private shouldUseConsole(environment: string): boolean {
    // Only show console logs in local and development
    return ['local', 'development'].includes(environment);
  }

  private createLogMetadata(companyId: number, service: string) {
    return {
      companyId,
      service,
      environment: process.env.NODE_ENV || 'local',
    };
  }

  log(message: string, companyId: number, service: string) {
    this.logger.info(message, this.createLogMetadata(companyId, service));
  }

  error(message: string, trace: string, companyId: number, service: string) {
    this.logger.error(message, {
      trace,
      ...this.createLogMetadata(companyId, service),
    });
  }

  warn(message: string, companyId: number, service: string) {
    this.logger.warn(message, this.createLogMetadata(companyId, service));
  }

  debug(message: string, companyId: number, service: string) {
    this.logger.debug(message, this.createLogMetadata(companyId, service));
  }

  verbose(message: string, companyId: number, service: string) {
    this.logger.verbose(message, this.createLogMetadata(companyId, service));
  }
}
