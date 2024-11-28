import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, LogLevel } from './utils/logger';

async function bootstrap() {
  // Set log level based on environment variable
  Logger.setLogLevel(LogLevel.INFO);

  const app = await NestFactory.create(AppModule);
  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
