export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  ERROR = 2,
}

export class Logger {
  private static logLevel: LogLevel = LogLevel.INFO;

  static setLogLevel(level: LogLevel) {
    Logger.logLevel = level;
  }

  static debug(message: string) {
    if (Logger.logLevel <= LogLevel.DEBUG) {
      console.debug(`[${new Date().toISOString()}] [DEBUG] ${message}`);
    }
  }

  static log(message: string) {
    if (Logger.logLevel <= LogLevel.INFO) {
      console.log(`[${new Date().toISOString()}] [INFO] ${message}`);
    }
  }

  static error(message: string, error?: any) {
    if (Logger.logLevel <= LogLevel.ERROR) {
      console.error(`[${new Date().toISOString()}] [ERROR] ${message}`, error);
    }
  }
}
