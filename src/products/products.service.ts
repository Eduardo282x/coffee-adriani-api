import { Injectable } from '@nestjs/common';
import { HistoryProduct, Product } from '@prisma/client';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOProducts } from './product.dto';

@Injectable()
export class ProductsService {

    constructor(private prismaService: PrismaService) {

    }

    async getDolar() {
        return await this.prismaService.historyDolar.findFirst({ orderBy: { date: 'desc' } })
    }

    async getProducts(): Promise<Product[]> {
        const getDolar = await this.getDolar();

        return await this.prismaService.product.findMany({
            orderBy: { id: 'asc' }
        }).then(res =>
            res.map(data => {
                return {
                    ...data,
                    priceBs: (data.price * Number(getDolar.dolar)).toFixed(2)
                }
            })
        )
    }

    async getProductHistory(): Promise<HistoryProduct[]> {
        const getDolar = await this.getDolar();

        return await this.prismaService.historyProduct.findMany({
            orderBy: { id: 'asc' }
        }).then(res =>
            res.map(data => {
                return {
                    ...data,
                    priceBs: (data.price * Number(getDolar.dolar)).toFixed(2)
                }
            })
        )
    }

    async createProduct(product: DTOProducts): Promise<DTOBaseResponse> {
        try {
            const findProductExist = await this.prismaService.product.findFirst({
                where: { name: { equals: product.name, mode: 'insensitive' } }
            })

            if (findProductExist) {
                badResponse.message = 'Este producto ya esta registrado.'
                return badResponse;
            }

            await this.prismaService.product.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount
                }
            })

            await this.prismaService.historyProduct.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount
                }
            })

            baseResponse.message = 'Producto agregado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateProduct(id: number, product: DTOProducts): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.product.update({
                where: { id },
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount
                }
            })

            await this.prismaService.historyProduct.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount
                }
            })

            baseResponse.message = 'Producto actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
    async deleteProduct(id: number): Promise<DTOBaseResponse> {
        try {
            const findProductInInventory = await this.prismaService.inventory.findFirst({
                where: { productId: id }
            })

            if (findProductInInventory) {
                badResponse.message = 'Este producto se encuentra en el inventario';
                return badResponse;
            }

            await this.prismaService.product.delete({
                where: { id }
            })

            baseResponse.message = 'Producto eliminado exitosamente.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
