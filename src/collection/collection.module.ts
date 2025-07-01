import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { InvoicesService } from 'src/invoices/invoices.service';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';

@Module({
  controllers: [CollectionController],
  providers: [CollectionService, PrismaService, InvoicesService, ProductsService, InventoryService, ClientsService]
})
export class CollectionModule {}
