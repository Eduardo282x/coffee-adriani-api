import { Module } from '@nestjs/common';
import { ClientsController } from './clients.controller';
import { ClientsService } from './clients.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [ClientsController],
  providers: [ClientsService, PrismaService],
  exports: [ClientsService]
})
export class ClientsModule {}
