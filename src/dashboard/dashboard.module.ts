import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { InvoicesService } from 'src/invoices/invoices.service';
import { PaymentsService } from 'src/payments/payments.service';
import { ProductsService } from 'src/products/products.service';
import { InventoryModule } from 'src/inventory/inventory.module';
import { ClientsService } from 'src/clients/clients.service';
import { N8nService } from 'src/n8n/n8n.service';

@Module({
  controllers: [DashboardController],
  imports: [InventoryModule],
  providers: [
    DashboardService,
    InvoicesService,
    PaymentsService,
    ClientsService,
    ProductsService,
    N8nService,
  ],
})
export class DashboardModule {}
