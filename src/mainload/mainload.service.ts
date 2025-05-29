import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountsDB, ProductsDB } from './mainload.data';

@Injectable()
export class MainloadService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async mainLoad() {
        try {
            await this.prismaService.block.createMany({
                data: [
                    { name: 'Bloque 1', address: '' },
                    { name: 'Bloque 2', address: '' },
                    { name: 'Bloque 3', address: '' },
                    { name: 'Bloque 4', address: '' },
                    { name: 'Bloque 5', address: '' },
                    { name: 'Bloque 6', address: '' },
                    { name: 'Bloque 7', address: '' },
                    { name: 'Bloque 8', address: '' },
                ]
            })

            await this.prismaService.paymentMethod.createMany({
                data: [
                    { name: 'Pago Movil', currency: 'BS' },
                    { name: 'Transferencia', currency: 'BS' },
                    { name: 'Efectivo $', currency: 'USD' },
                    { name: 'Efectivo Bs', currency: 'BS' },
                    { name: 'Zelle', currency: 'USD' },
                ]
            })

            await this.prismaService.product.createMany({
                data: ProductsDB
            })

            await this.prismaService.accountsPayments.createMany({
                data: AccountsDB
            })

            await this.prismaService.role.createMany({
                data: [
                    { rol: 'Administrador' },
                    { rol: 'Asistente' },
                    { rol: 'Cobranza' },
                ]
            })

            await this.prismaService.users.create({
                data: {
                    name: 'admin',
                    lastName: 'admin',
                    password: 'admin',
                    username: 'admin',
                    rolId: 1
                }
            })
            baseResponse.message = 'Data cargada exitosamente';
            return baseResponse
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }
}
