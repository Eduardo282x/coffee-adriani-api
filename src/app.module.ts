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
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthGuard } from './guards/auth/auth.guard';
import { RolesGuard } from './guards/roles/roles.guard';
import { APP_GUARD } from '@nestjs/core';
import { ExcelModule } from './excel/excel.module';
import { ExpensesModule } from './expenses/expenses.module';

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
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'], // primero busca en .env.local
    }),
    ExcelModule,
    ExpensesModule,
  ],
  controllers: [AppController],
  providers: [
    AppService, 
    PrismaService, 
    JwtService,
    {
      provide: APP_GUARD,
      useClass: AuthGuard, // se ejecuta primero
    },
    {
      provide: APP_GUARD,
      useClass: RolesGuard, // se ejecuta después, depende del user ya autenticado
    },
  ],
})

export class AppModule { }
