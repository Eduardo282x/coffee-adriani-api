import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTODolar, DTOProducts } from './product.dto';
import { Dolar, parseCustomDate } from 'src/dolar/dolar.service';
import axios from 'axios';

@Injectable()
export class ProductsService {

    constructor(private readonly prismaService: PrismaService) { }

    async getDolar() {
        return await this.prismaService.historyDolar.findFirst({ orderBy: { date: 'desc' } })
    }

    async saveDolarAutomatic() {
        const response: Dolar = await axios.get('https://pydolarve.org/api/v2/tipo-cambio?currency=usd&format_date=default&rounded_price=true').then(res => res.data);
        const parseResponse = {
            dolar: response.price,
            date: parseCustomDate(response.last_update)
        }
        return await this.saveDolar(parseResponse);
    }

    async saveDolar(dolar: DTODolar) {
        try {
            await this.prismaService.historyDolar.create({
                data: {
                    dolar: dolar.dolar,
                    date: dolar.date
                }
            })
            baseResponse.message = 'Tasa de dolar guardada exitosamente.';
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getProducts() {
        try {
            const getDolar = await this.getDolar();
            
            return await this.prismaService.product.findMany({
                orderBy: { id: 'asc' }
            }).then(res =>
                res.map(data => {
                    return {
                        ...data,
                        price: data.price.toFixed(2),
                        priceUSD: data.priceUSD.toFixed(2),
                        purchasePrice: data.purchasePrice.toFixed(2),
                        priceBs: (Number(data.price) * Number(getDolar.dolar)).toFixed(2)
                    }
                })
            )
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
            return [];
        }
    }

    async getProductHistory() {
        try {
            const getDolar = await this.getDolar();

            return await this.prismaService.historyProduct.findMany({
                orderBy: { id: 'asc' }
            }).then(res =>
                res.map(data => {
                    return {
                        ...data,
                        price: data.price.toFixed(2),
                        priceUSD: data.priceUSD.toFixed(2),
                        purchasePrice: data.purchasePrice.toFixed(2),
                        priceBs: (Number(data.price) * Number(getDolar.dolar)).toFixed(2)
                    }
                })
            )
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
            return [];
        }
    }

    async createProduct(product: DTOProducts): Promise<DTOBaseResponse> {
        try {
            await this.prismaService.product.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount,
                    purchasePrice: product.purchasePrice
                }
            })

            await this.prismaService.historyProduct.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount,
                    purchasePrice: product.purchasePrice
                }
            })

            baseResponse.message = 'Producto agregado exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
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
                    amount: product.amount,
                    purchasePrice: product.purchasePrice
                }
            })

            await this.prismaService.historyProduct.create({
                data: {
                    name: product.name,
                    presentation: product.presentation,
                    price: product.price,
                    priceUSD: product.priceUSD,
                    amount: product.amount,
                    purchasePrice: product.purchasePrice
                }
            })

            baseResponse.message = 'Producto actualizado exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
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
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'ProductService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
