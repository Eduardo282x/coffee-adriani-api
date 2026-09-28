import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';

function intFromEnv(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const max = intFromEnv('DB_POOL_MAX', 20);
    const idleTimeoutMillis = intFromEnv('DB_POOL_IDLE_TIMEOUT', 30_000);
    const connectTimeout = intFromEnv('DB_CONNECT_TIMEOUT', 10_000);

    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL as string,
      max,
      idleTimeoutMillis,
      connectionTimeoutMillis: connectTimeout,
    });

    super({
      adapter,
      log:
        process.env.NODE_ENV === 'development'
          ? [
              { emit: 'event', level: 'warn' },
              { emit: 'event', level: 'error' },
            ]
          : [{ emit: 'event', level: 'error' }],
    });

    const onError = (event: { message: string }) =>
      this.logger.error(`Prisma: ${event.message}`);
    this.$on('error', onError as never);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(
      `Conectado a PostgreSQL (pool max=${intFromEnv('DB_POOL_MAX', 20)})`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Conexion a PostgreSQL cerrada');
  }
}
