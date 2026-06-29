import { Module } from '@nestjs/common';
import { EntryPaymentsController } from './entry-payments.controller';
import { EntryPaymentsService } from './entry-payments.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [EntryPaymentsController],
  providers: [EntryPaymentsService, PrismaService],
  exports: [EntryPaymentsService]
})
export class EntryPaymentsModule {}
