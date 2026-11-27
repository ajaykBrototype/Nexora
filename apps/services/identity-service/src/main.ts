
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }),
);

  app.setGlobalPrefix(process.env.API_PREFIX ?? 'api/v1');

  // CORS configuration
  app.enableCors({
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  // Start service
  const port = Number(process.env.PORT) || 3001;

  await app.listen(port);

  console.log(`Identity Service running on port ${port}`);
}

await bootstrap();
