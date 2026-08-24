import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { InventoryModule } from 'src/inventory/inventory.module';
import { ProductsModule } from 'src/products/products.module';
import { ClientsModule } from 'src/clients/clients.module';
import { N8nModule } from 'src/n8n/n8n.module';

@Module({
  imports: [ProductsModule, ClientsModule, N8nModule, InventoryModule],
  controllers: [InvoicesController],
  providers: [InvoicesService],
  exports: [InvoicesService],
})
export class InvoicesModule {}
