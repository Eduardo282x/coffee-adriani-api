import { Module } from '@nestjs/common';
import { ExcelController } from './excel.controller';
import { ExcelService } from './excel.service';
import { InvoicesService } from 'src/invoices/invoices.service';
import { InvoicesModule } from 'src/invoices/invoices.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';
import { PaymentsService } from 'src/payments/payments.service';
import { PaymentsModule } from 'src/payments/payments.module';
import { N8nService } from 'src/n8n/n8n.service';

@Module({
  imports: [InvoicesModule, PaymentsModule],
  controllers: [ExcelController],
  providers: [
    ExcelService, 
    InvoicesService, 
    PrismaService, 
    ProductsService, 
    InventoryService, 
    ClientsService,
    PaymentsService,
    N8nService
  ]
})
export class ExcelModule { }
