import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { SellersDto } from './sellers.dto';

@Injectable()
export class SellersService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getSellers() {
        try {
            return await this.prismaService.seller.findMany();
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    };

    async createSellers(newSeller: SellersDto) {
        try {
            await this.prismaService.seller.create({
                data: {
                    name: newSeller.name,
                    phone: newSeller.phone,
                    commission: 0
                },
            })

            baseResponse.message = 'Vendedor agregado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }

    async updateSellers(id: number, newSeller: SellersDto) {
        try {
            await this.prismaService.seller.update({
                data: {
                    name: newSeller.name,
                    phone: newSeller.phone,
                    commission: 0
                },
                where: { id }
            })

            baseResponse.message = 'Vendedor eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }
    async deleteSellers(id: number) {
        try {
            await this.prismaService.seller.delete({
                where: { id }
            })

            baseResponse.message = 'Vendedor eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }
}
