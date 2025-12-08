import { Module } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { DashboardController } from './dashboard.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { InvoicesService } from 'src/invoices/invoices.service';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';

@Module({
  controllers: [DashboardController],
  providers: [DashboardService, InvoicesService, InventoryService, ClientsService, ProductsService, PrismaService],
})
export class DashboardModule {}
