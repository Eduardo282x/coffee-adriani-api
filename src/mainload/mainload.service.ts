import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

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
                    { name: 'Pago Movil' },
                    { name: 'Transferencia' },
                    { name: 'Efectivo' },
                    { name: 'Zelle' },
                ]
            })

            await this.prismaService.role.createMany({
                data: [
                    { rol: 'Administrador' },
                    { rol: 'Asistente' },
                    { rol: 'Cobranza' },
                ]
            })
            baseResponse.message = 'Data cargada exitosamente';
            return baseResponse
        } catch(err){
            badResponse.message = err.message
            return badResponse;
        }
    }
}
