import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, LogLevel } from './utils/logger';

import posthog from 'posthog-js'


async function bootstrap() {
  // Set log level based on environment variable
  Logger.setLogLevel(LogLevel.INFO);

  const posthogApiKey = process.env.POSTHOG_API_KEY;
  if (posthogApiKey) {
    posthog.init(posthogApiKey,
      {
          api_host: 'https://us.i.posthog.com',
          person_profiles: 'identified_only' // or 'always' to create profiles for anonymous users as well
      }
    )
  }

  const app = await NestFactory.create(AppModule);
  const port = process.env.API_PORT || 3000;
  await app.listen(port);
  Logger.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
