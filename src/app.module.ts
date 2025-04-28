import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { ClientsModule } from './clients/clients.module';
import { InvoicesModule } from './invoices/invoices.module';
import { ProductsModule } from './products/products.module';
import { InvoiceProductsModule } from './invoice-products/invoice-products.module';
import { PaymentsModule } from './payments/payments.module';
import { NotificationsModule } from './notifications/notifications.module';
import { InventoryModule } from './inventory/inventory.module';
import { SellersModule } from './sellers/sellers.module';
import { SalesModule } from './sales/sales.module';
import { WebsocketModule } from './websokects/websokect.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { ScheduleModule } from '@nestjs/schedule';
import { DolarModule } from './dolar/dolar.module';
import { MainloadModule } from './mainload/mainload.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ClientsModule,
    InvoicesModule,
    ProductsModule,
    InvoiceProductsModule,
    PaymentsModule,
    NotificationsModule,
    InventoryModule,
    SellersModule,
    SalesModule,
    WebsocketModule,
    AuthModule,
    UsersModule,
    DolarModule,
    MainloadModule,
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService],
})

export class AppModule { }
