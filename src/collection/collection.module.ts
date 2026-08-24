import { Module } from '@nestjs/common';
import { CollectionController } from './collection.controller';
import { CollectionService } from './collection.service';
import { InvoicesService } from 'src/invoices/invoices.service';
import { ProductsService } from 'src/products/products.service';
import { InventoryModule } from 'src/inventory/inventory.module';
import { ClientsService } from 'src/clients/clients.service';
import { WhatsAppModule } from 'src/whatsapp/whatsapp.module';
import { N8nService } from 'src/n8n/n8n.service';

@Module({
  controllers: [CollectionController],
  imports: [WhatsAppModule, InventoryModule],
  providers: [
    CollectionService,
    InvoicesService,
    ProductsService,
    ClientsService,
    N8nService,
  ],
})
export class CollectionModule {}
