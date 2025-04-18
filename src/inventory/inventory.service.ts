import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInventory } from './inventory.dto';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { ProductsService } from 'src/products/products.service';

@Injectable()
export class InventoryService {

    constructor(private readonly prismaService: PrismaService, private readonly productsService: ProductsService) {

    }

    async getInventory() {
        const getDolar = await this.productsService.getDolar();
        return await this.prismaService.inventory.findMany({
            include: {
                product: true
            }
        }).then(inv => inv.map(iv => {
            return {
                ...iv,
                product: {
                    ...iv.product,
                    priceBs: (iv.product.price * Number(getDolar.dolar)).toFixed(2)
                }
            }
        }))
    }
    async getInventoryHistory() {
        const getDolar = await this.productsService.getDolar();
        return await this.prismaService.historyInventory.findMany({
            include: {
                product: true
            }
        }).then(inv => inv.map(iv => {
            return {
                ...iv,
                product: {
                    ...iv.product,
                    priceBs: (iv.product.price * Number(getDolar.dolar)).toFixed(2)
                }
            }
        }))
    }

    async saveInventory(inventory: DTOInventory) {
        try {
            const findProductInInventory = await this.prismaService.inventory.findFirst({
                where: { productId: inventory.productId }
            })

            if (findProductInInventory) {

                await this.prismaService.inventory.update({
                    data: {
                        quantity: findProductInInventory.quantity + inventory.quantity
                    },
                    where: {
                        id: findProductInInventory.id
                    }
                })
            } else {
                await this.prismaService.inventory.create({
                    data: {
                        productId: inventory.productId,
                        quantity: inventory.quantity,
                        createdAt: new Date()
                    }
                })
            }

            await this.prismaService.historyInventory.create({
                data: {
                    productId: inventory.productId,
                    quantity: inventory.quantity,
                    movementType: 'IN'
                }
            })

            baseResponse.message = 'Producto guardado en inventario.'
            return baseResponse
        }
        catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
