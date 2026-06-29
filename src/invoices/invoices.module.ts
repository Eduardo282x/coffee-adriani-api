import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ProductsModule } from 'src/products/products.module';
import { ClientsModule } from 'src/clients/clients.module';
import { N8nModule } from 'src/n8n/n8n.module';
import { N8nService } from 'src/n8n/n8n.service';

@Module({
  imports: [ProductsModule, ClientsModule, N8nModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, PrismaService, InventoryService],
  exports: [InvoicesService]
})
export class InvoicesModule { }
