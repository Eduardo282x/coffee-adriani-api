import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import compression from '@fastify/compress';
import cors from '@fastify/cors';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  app.setGlobalPrefix('api');

  const allowedOrigins = process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',').map((origin) => origin.trim())
    : true;

  // Fastify: manejar correctamente los preflight (OPTIONS) de PUT/DELETE
  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: (errors) => {
        const message = errors
          .map((error) => `${Object.values(error.constraints).join(', ')}`)
          .join('; ');

        return new BadRequestException(`Errores de validación: ${message}`);
      },
    }),
  );

  await app.register(compression, {
    encodings: ['gzip', 'deflate'], // Brotli es genial pero gzip es estándar
  });

  if (process.env.NODE_ENV !== 'production') {
    const config = new DocumentBuilder()
      .setTitle('Cafe-adriani')
      .setDescription('Cafe Adriani description')
      .setVersion('1.0')
      .addTag('coffee')
      // Agregar configuración de seguridad Bearer
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth', // Este nombre es importante, lo usarás en los decoradores
      )
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, documentFactory, {
      useGlobalPrefix: true,
    });
  }

  const port = process.env.PORT || 3000;

  // Es CRUCIAL añadir '0.0.0.0' para que sea accesible externamente
  await app.listen(port, '0.0.0.0');

  console.log(`🚀 Application is running on: http://localhost:${port}`);
}
bootstrap();
