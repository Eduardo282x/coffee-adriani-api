import { Module } from '@nestjs/common';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ProductsModule } from 'src/products/products.module';
import { ClientsModule } from 'src/clients/clients.module';

@Module({
  imports: [ProductsModule, ClientsModule],
  controllers: [InvoicesController],
  providers: [InvoicesService, PrismaService, InventoryService],
  exports: [InvoicesService]
})
export class InvoicesModule { }
