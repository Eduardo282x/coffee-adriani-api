import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from './filters/exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';

import compression from '@fastify/compress';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { resolveCorsOrigins } from './config/env.validation';
import { CorsIoAdapter } from './websokects/cors-io.adapter';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';
  const trustProxyHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Dokploy/Traefik actua como proxy inverso: sin esto `request.ip` devuelve
      // la IP del proxy y el rate limiting por IP es inútil.
      trustProxy: trustProxyHops,
      // Necesario para que los WebSockets sobrevivan a upgrades a traves del proxy.
      forceCloseConnections: false,
    }),
  );

  app.setGlobalPrefix('api', {
    // El gateway de WebSockets cuelga de /ws, fuera del prefijo HTTP.
    exclude: ['ws'],
  });
  app.enableShutdownHooks();

  const allowedOrigins = resolveCorsOrigins(
    process.env.CORS_ORIGINS,
    isProduction,
  );

  if (isProduction && allowedOrigins.length === 0) {
    throw new Error(
      'CORS_ORIGINS quedo vacio en produccion: se filtraron todos los origenes por defecto.',
    );
  }

  // El CORS del engine de Socket.IO se resuelve aqui, con el `.env` ya
  // cargado por ConfigModule. Sin esto el gateway usaria la lista evaluada al
  // importar el decorador, que todavia no conocia `CORS_ORIGINS`.
  app.useWebSocketAdapter(new CorsIoAdapter(app, allowedOrigins));

  await app.register(helmet, {
    global: true,
    contentSecurityPolicy: isProduction ? undefined : false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

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
      transformOptions: { enableImplicitConversion: false },
      exceptionFactory: (errors) => {
        const message = errors
          .map((error) => `${Object.values(error.constraints).join(', ')}`)
          .join('; ');

        return new BadRequestException(`Errores de validación: ${message}`);
      },
    }),
  );

  await app.register(compression, {
    encodings: ['gzip', 'deflate'],
  });

  if (!isProduction) {
    const config = new DocumentBuilder()
      .setTitle('Cafe-adriani')
      .setDescription('Cafe Adriani description')
      .setVersion('1.0')
      .addTag('coffee')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT token',
          in: 'header',
        },
        'JWT-auth',
      )
      .build();
    const documentFactory = () => SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('docs', app, documentFactory, {
      useGlobalPrefix: true,
    });
  }

  const port = process.env.PORT || 3002;

  await app.listen(port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(
    `Application running on port ${port} | origins=${allowedOrigins.join(',')} | trustProxy=${trustProxyHops}`,
  );
}
bootstrap();
