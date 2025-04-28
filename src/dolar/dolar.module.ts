import { Module } from '@nestjs/common';
import { ProductsModule } from 'src/products/products.module';
import { InvoicesModule } from 'src/invoices/invoices.module';
import { DolarService } from './dolar.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [ProductsModule, InvoicesModule],
  providers: [DolarService, PrismaService]
})
export class DolarModule { }
