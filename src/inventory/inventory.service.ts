import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInventory, DTOInventoryHistory, DTOInventorySimple } from './inventory.dto';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { ProductsService } from 'src/products/products.service';

interface InventoryHistoryFilter {
    page: number;
    limit: number;
    startDate?: string;
    endDate?: string;
    typeMovement?: 'IN' | 'OUT' | 'EDIT' | '';
    typeProduct?: string;
}

@Injectable()
export class InventoryService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productsService: ProductsService) { }

    private getStartOfDayUtc(date: string) {
        if (date.length > 10) {
            return new Date(date);
        }
        return new Date(`${date}T00:00:00.000Z`);
    }

    private getEndOfDayUtc(date: string) {
        if (date.length > 10) {
            return new Date(date);
        }
        return new Date(`${date}T23:59:59.999Z`);
    }

    private formatControlDate(date: Date): string {
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const year = String(date.getFullYear()).slice(-2);
        return `${month}${day}${year}`;
    }

    private extractControlFromDescription(description: string): string | null {
        if (!description) return null;

        // Ejemplos que cubre:
        // "Salida de producto por factura 0001"
        // "Salida de inventario por factura #A-123"
        // "Factura 1234"
        const match = description.match(/factura\s*#?\s*([a-zA-Z0-9-]+)/i);
        return match?.[1] ?? null;
    }

    async getInventory() {
        const getDolar = await this.productsService.getDolar();

        try {
            return await this.prismaService.inventory.findMany({
                orderBy: { id: 'asc' },
                include: {
                    product: true
                }
            }).then(inv => inv.map(iv => {
                return {
                    ...iv,
                    product: {
                        ...iv.product,
                        price: iv.product.price.toFixed(2),
                        priceUSD: iv.product.priceUSD.toFixed(2),
                        priceBs: (Number(iv.product.price) * Number(getDolar.dolar)).toFixed(2)
                    }
                }
            }))
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return [];
        }
    }

    async getInventoryHistory(filter: InventoryHistoryFilter) {
        const { page, limit, startDate, endDate, typeMovement, typeProduct } = filter;

        const where: any = {};
        const getDolar = await this.productsService.getDolar();
        const safePage = page > 0 ? page : 1;
        const safeLimit = limit > 0 ? Math.min(limit, 100) : 20;
        const skip = (safePage - 1) * safeLimit;

        if (startDate && endDate) {
            where.movementDate = {
                gte: this.getStartOfDayUtc(startDate),
                lte: this.getEndOfDayUtc(endDate),
            };
        }

        if (typeMovement) {
            where.movementType = typeMovement;
        }

        if (typeProduct) {
            where.product = {
                type: {
                    equals: typeProduct,
                    mode: 'insensitive',
                },
            };
        }

        const [total, history] = await Promise.all([
            this.prismaService.historyInventory.count({ where }),
            this.prismaService.historyInventory.findMany({
                skip,
                take: safeLimit,
                orderBy: [{ movementDate: 'desc' }, { id: 'desc' }],
                where,
                include: {
                    product: true,
                },
            }),
        ]);

        const groupedMap = new Map<
            string,
            {
                controlNumber: string;
                description: string;
                movementType: 'IN' | 'OUT' | 'EDIT';
                movementDate: string;
                details: Array<{
                    productId: number;
                    name: string;
                    presentation: string;
                    quantity: number;
                    priceBs: string;
                    priceUSD: string;
                    date: string;
                }>;
            }
        >();

        for (const item of history) {
            const day = item.movementDate.toISOString().slice(0, 10);
            const control = item.controlNumber || '';
            const key = `${control}-${day}`;

            if (!groupedMap.has(key)) {
                groupedMap.set(key, {
                    controlNumber: control,
                    description: item.description,
                    movementType: item.movementType,
                    movementDate: day,
                    details: [],
                });
            }

            groupedMap.get(key)!.details.push({
                productId: item.productId,
                name: item.product.name,
                presentation: item.product.presentation,
                quantity: item.quantity,
                priceBs: (Number(item.product.price) * Number(getDolar.dolar)).toFixed(2),
                priceUSD: item.product.priceUSD.toFixed(2),
                date: item.movementDate.toISOString(),
            });
        }

        const data = Array.from(groupedMap.values());
        const totalPages = Math.ceil(total / safeLimit);

        return {
            history: data,
            pagination: {
                total,
                page: safePage,
                limit: safeLimit,
                totalPages,
                hasNextPage: safePage < totalPages,
                hasPreviousPage: safePage > 1,
            },
        };
    }

    async updateHistoryData() {
        try {
            const records = await this.prismaService.historyInventory.findMany({
                where: {
                    OR: [
                        { controlNumber: '' },
                        { controlNumber: { equals: '' } },
                    ],
                },
                orderBy: { id: 'asc' },
                select: {
                    id: true,
                    movementType: true,
                    movementDate: true,
                    description: true,
                    controlNumber: true,
                },
            });

            if (!records.length) {
                return {
                    success: true,
                    message: 'No hay registros sin número de control.',
                    updatedCount: 0,
                };
            }

            let updatedCount = 0;

            for (const row of records) {
                let controlNumber = '';

                if (row.movementType === 'OUT') {
                    // 1) intentar extraerlo desde la descripción
                    const extracted = this.extractControlFromDescription(row.description);
                    if (extracted) {
                        controlNumber = extracted;
                    } else {
                        // 2) fallback si no viene en texto
                        controlNumber = `OUT-${this.formatControlDate(row.movementDate)}`;
                    }
                } else if (row.movementType === 'IN') {
                    controlNumber = `Entrada-${this.formatControlDate(row.movementDate)}`;
                } else if (row.movementType === 'EDIT') {
                    controlNumber = `Edit-${this.formatControlDate(row.movementDate)}`;
                }

                if (!controlNumber) {
                    controlNumber = `MOV-${this.formatControlDate(row.movementDate)}`;
                }

                await this.prismaService.historyInventory.update({
                    where: { id: row.id },
                    data: { controlNumber },
                });

                updatedCount++;
            }

            return {
                success: true,
                message: 'Historial actualizado correctamente.',
                updatedCount,
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            });
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }

    async saveInventory(inventory: DTOInventory) {
        try {
            const saveHistory = await this.prismaService.historyInventory.createMany({
                data: inventory.details.map(detail => ({
                    productId: detail.productId,
                    quantity: detail.quantity,
                    controlNumber: inventory.controlNumber,
                    movementType: 'IN',
                    description: `Entrada de mercancía ${inventory.description ? `- ${inventory.description}` : ''}`,
                    movementDate: inventory.date
                }))
            });

            inventory.details.map(async (detail) => {
                const findProductInInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                })

                if (findProductInInventory) {

                    await this.prismaService.inventory.update({
                        data: {
                            quantity: findProductInInventory.quantity + detail.quantity
                        },
                        where: {
                            id: findProductInInventory.id
                        }
                    })
                } else {
                    await this.prismaService.inventory.create({
                        data: {
                            productId: detail.productId,
                            quantity: detail.quantity,
                        }
                    })
                }
            })

            baseResponse.message = 'Productos guardados en inventario.'
            return baseResponse
        }
        catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }

    async updateInventory(inventory: DTOInventorySimple, id: number) {
        try {
            const findProductInInventory = await this.prismaService.inventory.findFirst({
                where: { id }
            })

            if (findProductInInventory) {
                await this.prismaService.inventory.update({
                    data: {
                        quantity: inventory.quantity
                    },
                    where: {
                        id: findProductInInventory.id
                    }
                })

                await this.prismaService.historyInventory.create({
                    data: {
                        productId: findProductInInventory.productId,
                        quantity: inventory.quantity,
                        description: inventory.description,
                        movementType: 'OUT'
                    }
                })
            } else {
                badResponse.message = 'No se encontró el producto en el inventario.';
                return badResponse;
            }

            baseResponse.message = 'Producto actualizado en inventario.'
            return baseResponse
        }
        catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }

    async updateInventoryInvoice(inventory: DTOInventory) {
        try {
            inventory.details.map(async (detail) => {
                const findProductInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                })

                const findProductInInventory = await this.prismaService.inventory.update({
                    where: { id: findProductInventory.id },
                    data: {
                        quantity: {
                            decrement: detail.quantity
                        }
                    },
                });

                await this.prismaService.historyInventory.create({
                    data: {
                        productId: findProductInInventory.productId,
                        controlNumber: inventory.controlNumber,
                        quantity: detail.quantity,
                        description: inventory.description,
                        movementDate: inventory.date,
                        movementType: 'OUT'
                    }
                });
            })

            baseResponse.message = 'Productos actualizados en inventario.'
            return baseResponse
        }
        catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }

    async updateAmountInventory(inventory: DTOInventorySimple, id: number) {
        try {
            const findProductInInventory = await this.prismaService.inventory.findFirst({
                where: { id }
            });

            const findHistory = await this.prismaService.historyInventory.findFirst({
                where: { productId: findProductInInventory.productId, movementType: 'IN' },
                orderBy: { movementDate: 'desc' }
            });

            const oldAmount = findProductInInventory.quantity - findHistory.quantity;
            const updateAmountHistory = inventory.quantity - oldAmount;

            await this.prismaService.inventory.update({
                data: {
                    quantity: inventory.quantity
                },
                where: { id }
            });

            await this.prismaService.historyInventory.update({
                where: { id: findHistory.id },
                data: {
                    quantity: updateAmountHistory,
                }
            })

            baseResponse.message = 'Inventario modificado.'
            return baseResponse
        }
        catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }
}
