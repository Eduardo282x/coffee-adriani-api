import { Module } from '@nestjs/common';
import { EntryPaymentsController } from './entry-payments.controller';
import { EntryPaymentsService } from './entry-payments.service';

@Module({
  controllers: [EntryPaymentsController],
  providers: [EntryPaymentsService],
  exports: [EntryPaymentsService],
})
export class EntryPaymentsModule {}
