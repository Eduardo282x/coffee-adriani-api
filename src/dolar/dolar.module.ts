import { Module } from '@nestjs/common';
import { ProductsModule } from 'src/products/products.module';
import { InvoicesModule } from 'src/invoices/invoices.module';
import { DolarService } from './dolar.service';

@Module({
  imports: [ProductsModule, InvoicesModule],
  providers: [DolarService],
})
export class DolarModule {}
