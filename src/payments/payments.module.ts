import { Module } from '@nestjs/common';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsModule } from 'src/products/products.module';

@Module({
  imports: [ProductsModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PrismaService]
})
export class PaymentsModule { }
