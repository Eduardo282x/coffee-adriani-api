import { Module } from '@nestjs/common';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsService } from 'src/products/products.service';

@Module({
  controllers: [InventoryController],
  providers: [InventoryService, PrismaService,ProductsService]
})
export class InventoryModule {}
