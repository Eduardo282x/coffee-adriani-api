import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsModule } from 'src/products/products.module';
import { InvoicesModule } from 'src/invoices/invoices.module';

@Module({
  imports: [ProductsModule, InvoicesModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaService],
  exports: [PaymentsService]
})
export class PaymentsModule { }
