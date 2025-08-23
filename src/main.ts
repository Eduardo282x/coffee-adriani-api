import { NestFactory, Reflector } from '@nestjs/core';
import { AppModule } from './app.module';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { AuthGuard } from './guards/auth/auth.guard';
import { JwtService } from '@nestjs/jwt';
import { RolesGuard } from './guards/roles/roles.guard';
import { AllExceptionsFilter } from './filters/exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('/api');
  app.enableCors();
  app.useGlobalGuards(new AuthGuard(app.get(JwtService)), new RolesGuard(app.get(Reflector)))
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    exceptionFactory: (errors) => {
      const message = errors
        .map(
          (error) =>
            `${Object.values(error.constraints).join(', ')}`
        )
        .join('; ');

      return new BadRequestException(`Errores de validación: ${message}`);
    },
  }));
  await app.listen(3000);
  console.log('🚀 Application is running on: http://localhost:3000');
}
bootstrap();
