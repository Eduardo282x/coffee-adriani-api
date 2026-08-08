import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInventory, DTOInventoryDetail, DTOInventorySimple, DTOUpdateInventoryEntry, CreateInventoryEntryDTO, InventoryEntryFilterDTO } from './inventory.dto';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { ProductsService } from 'src/products/products.service';
import { Prisma } from 'src/generated/prisma/client';

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

    private normalizeControlNumber(controlNumber?: string | null): string {
        return (controlNumber ?? '').trimEnd();
    }

    async getInventory() {
        const getDolar = await this.productsService.getDolar();

        try {
            return await this.prismaService.inventory.findMany({
                orderBy: { product: { priorityOrder: 'asc' } },
                include: {
                    product: true
                },
                where: {
                    product: {
                        deleted: false
                    }
                }
            }).then(inv => inv.map(iv => {
                return {
                    ...iv,
                    quantity: Number(iv.quantity),
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

    async getInventoryMovements(filter: {
        page: number;
        limit: number;
        startDate?: string;
        endDate?: string;
        typeMovement?: string;
        typeProduct?: string;
        controlNumber?: string;
    }) {
        const { page, limit, startDate, endDate, typeMovement, typeProduct, controlNumber } = filter;
        const where: any = {};
        const getDolar = await this.productsService.getDolar();
        const safePage = page > 0 ? page : 1;
        const safeLimit = limit > 0 ? Math.min(limit, 100) : 20;
        const skip = (safePage - 1) * safeLimit;

        if (startDate && endDate) {
            where.date = {
                gte: this.getStartOfDayUtc(startDate),
                lte: this.getEndOfDayUtc(endDate),
            };
        }

        if (typeMovement) {
            where.movementType = typeMovement;
        }

        const normalizedControlNumber = this.normalizeControlNumber(controlNumber);
        if (normalizedControlNumber) {
            where.controlNumber = {
                equals: normalizedControlNumber,
                mode: 'insensitive',
            };
        }

        if (typeProduct) {
            where.details = {
                some: {
                    product: {
                        type: {
                            equals: typeProduct,
                            mode: 'insensitive',
                        },
                    },
                },
            };
        }

        const [total, entries] = await Promise.all([
            this.prismaService.inventoryEntry.count({ where }),
            this.prismaService.inventoryEntry.findMany({
                skip,
                take: safeLimit,
                orderBy: [{ date: 'desc' }, { id: 'desc' }],
                where,
                include: {
                    details: {
                        include: {
                            product: true
                        }
                    }
                },
            }),
        ]);

        const history = entries.map(entry => ({
            controlNumber: entry.controlNumber,
            description: entry.description,
            movementType: entry.movementType,
            movementDate: entry.date.toISOString().slice(0, 10),
            details: entry.details.map(detail => ({
                productId: detail.productId,
                name: detail.product.name,
                presentation: detail.product.presentation,
                quantity: Number(detail.quantity),
                priceBs: (Number(detail.product.price) * Number(getDolar.dolar)).toFixed(2),
                priceUSD: detail.product.priceUSD.toFixed(2),
                date: entry.date.toISOString(),
            })),
        }));

        const totalPages = Math.ceil(total / safeLimit);

        return {
            history,
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

    async saveInventory(inventory: DTOInventory) {
        try {
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

            const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { controlNumber: normalizedControlNumber }
            });

            if (existingEntry) {
                badResponse.message = 'Ya existe una entrada de inventario con este número de control';
                return badResponse;
            }

            const productIds = inventory.details.map(detail => detail.productId);
            const products = await this.prismaService.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(products.map(product => [product.id, product]));

            const totalAmount = inventory.details.reduce((sum, detail) => {
                const price = Number(productMap.get(detail.productId)?.price || 0);
                return sum + (price * detail.quantity);
            }, 0);

            const entry = await this.prismaService.inventoryEntry.create({
                data: {
                    controlNumber: normalizedControlNumber,
                    movementType: 'IN',
                    totalAmount,
                    status: 'CREADA',
                    title: inventory.description || 'Entrada de inventario',
                    description: `Entrada de mercancía ${inventory.description ? `- ${inventory.description}` : ''}`,
                    date: inventory.date,
                    supplierId: null,
                }
            });

            for (const detail of inventory.details) {
                const product = productMap.get(detail.productId);
                const unitPrice = Number(product?.price || 0);
                const unitPriceUSD = Number(product?.priceUSD || 0);
                const subtotal = unitPrice * detail.quantity;

                await this.prismaService.inventoryEntryDetail.create({
                    data: {
                        inventoryEntryId: entry.id,
                        productId: detail.productId,
                        quantity: detail.quantity,
                        unitPrice,
                        unitPriceUSD,
                        subtotal,
                    }
                });

                const findProductInInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                });

                if (findProductInInventory) {
                    await this.prismaService.inventory.update({
                        data: {
                            quantity: Number(findProductInInventory.quantity) + Number(detail.quantity)
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
            }

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

    async updateAmountInventory(inventory: DTOInventorySimple, id: number) {
        try {
            const findProductInInventory = await this.prismaService.inventory.findFirst({
                where: { id }
            });

            if (!findProductInInventory) {
                badResponse.message = 'No se encontró el producto en el inventario.';
                return badResponse;
            }

            const findDetail = await this.prismaService.inventoryEntryDetail.findFirst({
                where: {
                    productId: findProductInInventory.productId,
                    inventoryEntry: { movementType: 'IN' }
                },
                orderBy: { inventoryEntry: { date: 'desc' } }
            });

            const oldAmount = findDetail
                ? Number(findProductInInventory.quantity) - Number(findDetail.quantity)
                : Number(findProductInInventory.quantity);
            const updateAmountHistory = inventory.quantity - oldAmount;

            await this.prismaService.inventory.update({
                data: {
                    quantity: inventory.quantity
                },
                where: { id }
            });

            if (findDetail) {
                await this.prismaService.inventoryEntryDetail.update({
                    where: { id: findDetail.id },
                    data: {
                        quantity: updateAmountHistory,
                    }
                })
            }

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

    async updateInventoryEntryControlNumber(inventory: DTOUpdateInventoryEntry) {
        try {
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

            const findHistory = await this.prismaService.inventoryEntry.findMany({
                where: { controlNumber: inventory.controlNumberOld },
                orderBy: { date: 'desc' }
            });
            if (!findHistory || findHistory.length === 0) {
                badResponse.message = 'Numero de control no encontrado.';
                return badResponse;
            }

            await this.prismaService.inventoryEntry.updateMany({
                where: { controlNumber: inventory.controlNumberOld },
                data: {
                    controlNumber: normalizedControlNumber,
                    date: inventory.date
                }
            });

            baseResponse.message = 'Historial de inventario actualizado.';
            return baseResponse;
        }
        catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err instanceof Error ? err.message : String(err), from: 'inventoryService' }
            })
            badResponse.message = err instanceof Error ? err.message : String(err);
            return badResponse;
        }
    }

    async updateInventoryInvoice(inventory: DTOInventory, tx?: Prisma.TransactionClient) {
        try {
            const prisma = tx ?? this.prismaService;
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

            const existingEntry = await prisma.inventoryEntry.findUnique({
                where: { controlNumber: normalizedControlNumber }
            });

            if (existingEntry) {
                badResponse.message = 'Ya existe una entrada de inventario con este número de control';
                return badResponse;
            }

            const productIds = inventory.details.map(detail => detail.productId);
            const products = await prisma.product.findMany({
                where: { id: { in: productIds } }
            });
            const productMap = new Map(products.map(product => [product.id, product]));

            const totalAmount = inventory.details.reduce((sum, detail) => {
                const price = Number(productMap.get(detail.productId)?.price || 0);
                return sum + (price * detail.quantity);
            }, 0);

            const entry = await prisma.inventoryEntry.create({
                data: {
                    controlNumber: normalizedControlNumber,
                    movementType: 'OUT',
                    totalAmount,
                    status: 'CREADA',
                    title: inventory.description || 'Salida de inventario',
                    description: inventory.description || '',
                    date: inventory.date,
                    supplierId: null,
                }
            });

            for (const detail of inventory.details) {
                const product = productMap.get(detail.productId);
                const unitPrice = Number(product?.price || 0);
                const unitPriceUSD = Number(product?.priceUSD || 0);
                const subtotal = unitPrice * detail.quantity;

                await prisma.inventoryEntryDetail.create({
                    data: {
                        inventoryEntryId: entry.id,
                        productId: detail.productId,
                        quantity: detail.quantity,
                        unitPrice,
                        unitPriceUSD,
                        subtotal,
                    }
                });

                const findProductInventory = await prisma.inventory.findFirst({
                    where: { productId: detail.productId }
                });

                if (!findProductInventory) {
                    badResponse.message = `El producto con ID ${detail.productId} no se encontró en el inventario.`;
                    return badResponse;
                }

                await prisma.inventory.update({
                    where: { id: findProductInventory.id },
                    data: {
                        quantity: {
                            decrement: detail.quantity
                        }
                    },
                });
            }

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

    async getInventoryEntries(filter: InventoryEntryFilterDTO) {
        try {
            const { page = 1, limit = 50, startDate, endDate, typeMovement, typeProduct, controlNumber, supplierId } = filter;
            const skip = (page - 1) * limit;

            const where: any = {};

            if (startDate && endDate) {
                where.date = {
                    gte: this.getStartOfDayUtc(startDate as string),
                    lte: this.getEndOfDayUtc(endDate as string),
                };
            }

            if (typeMovement) {
                where.movementType = typeMovement;
            }

            if (controlNumber) {
                where.controlNumber = {
                    contains: controlNumber,
                    mode: 'insensitive'
                };
            }

            if (supplierId) {
                where.supplierId = supplierId;
            }

            if (typeProduct) {
                where.details = {
                    some: {
                        product: {
                            type: {
                                equals: typeProduct,
                                mode: 'insensitive'
                            }
                        }
                    }
                };
            }

            const [entries, totalCount] = await Promise.all([
                this.prismaService.inventoryEntry.findMany({
                    where,
                    include: {
                        details: {
                            include: {
                                product: true
                            }
                        },
                        supplier: true,
                        payments: {
                            include: {
                                payment: {
                                    include: {
                                        account: {
                                            include: { method: true }
                                        },
                                        dolar: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: { date: 'desc' },
                    skip,
                    take: limit
                }),
                this.prismaService.inventoryEntry.count({ where })
            ]);

            const processedEntries = entries.map(entry => {
                const totalBultos = entry.details.reduce((sum, d) => sum + Number(d.quantity), 0);
                const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
                const remaining = Number(entry.totalAmount) - totalPaid;

                return {
                    ...entry,
                    totalBultos,
                    totalPaid: totalPaid.toFixed(2),
                    remaining: remaining.toFixed(2),
                    totalAmount: Number(entry.totalAmount).toFixed(2)
                };
            });

            const totalPages = Math.ceil(totalCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                entries: processedEntries,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext,
                    hasPrev
                }
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener entradas: ${errMsg}`);
        }
    }

    async getInventoryEntryById(id: number) {
        try {
            const entry = await this.prismaService.inventoryEntry.findUnique({
                where: { id },
                include: {
                    details: {
                        include: {
                            product: true
                        }
                    },
                    supplier: true,
                    payments: {
                        include: {
                            payment: {
                                include: {
                                    account: {
                                        include: { method: true }
                                    },
                                    dolar: true
                                }
                            }
                        }
                    }
                }
            });

            if (!entry) {
                throw new Error('Entrada no encontrada');
            }

            const totalBultos = entry.details.reduce((sum, d) => sum + Number(d.quantity), 0);
            const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const remaining = Number(entry.totalAmount) - totalPaid;

            return {
                ...entry,
                totalBultos,
                totalPaid: totalPaid.toFixed(2),
                remaining: remaining.toFixed(2),
                totalAmount: Number(entry.totalAmount).toFixed(2)
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener entrada: ${errMsg}`);
        }
    }

    async createInventoryEntry(data: CreateInventoryEntryDTO) {
        try {
            const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { controlNumber: data.controlNumber }
            });

            if (existingEntry) {
                badResponse.message = 'Ya existe una entrada con este número de control';
                return badResponse;
            }

            const totalAmount = data.details.reduce((sum, detail) => {
                return sum + (detail.unitPrice * detail.quantity);
            }, 0);

            const entry = await this.prismaService.inventoryEntry.create({
                data: {
                    controlNumber: data.controlNumber,
                    movementType: 'IN',
                    totalAmount,
                    status: 'CREADA',
                    title: data.title || '',
                    description: data.description || '',
                    date: data.date,
                    supplierId: data.supplierId || null,
                }
            });

            for (const detail of data.details) {
                const subtotal = detail.unitPrice * detail.quantity;

                await this.prismaService.inventoryEntryDetail.create({
                    data: {
                        inventoryEntryId: entry.id,
                        productId: detail.productId,
                        quantity: detail.quantity,
                        unitPrice: detail.unitPrice,
                        unitPriceUSD: detail.unitPriceUSD || detail.unitPrice,
                        subtotal
                    }
                });

                const existingInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                });

                if (existingInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: existingInventory.id },
                        data: {
                            quantity: Number(existingInventory.quantity) + Number(detail.quantity)
                        }
                    });
                } else {
                    await this.prismaService.inventory.create({
                        data: {
                            productId: detail.productId,
                            quantity: detail.quantity
                        }
                    });
                }
            }

            baseResponse.message = 'Entrada de inventario creada exitosamente';
            baseResponse.data = { id: entry.id, controlNumber: entry.controlNumber };
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async updateInventoryEntry(id: number, data: CreateInventoryEntryDTO) {
        try {
            const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { id },
                include: { details: true }
            });

            if (!existingEntry) {
                badResponse.message = 'Entrada no encontrada';
                return badResponse;
            }

            const duplicateEntry = await this.prismaService.inventoryEntry.findFirst({
                where: {
                    controlNumber: data.controlNumber,
                    id: { not: id }
                }
            });

            if (duplicateEntry) {
                badResponse.message = 'Ya existe otra entrada con este número de control';
                return badResponse;
            }

            for (const oldDetail of existingEntry.details) {
                const existingInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: oldDetail.productId }
                });

                if (existingInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: existingInventory.id },
                        data: {
                            quantity: Math.max(0, Number(existingInventory.quantity) - Number(oldDetail.quantity))
                        }
                    });
                }
            }

            await this.prismaService.inventoryEntryDetail.deleteMany({
                where: { inventoryEntryId: id }
            });

            const totalAmount = data.details.reduce((sum, detail) => {
                return sum + (detail.unitPrice * detail.quantity);
            }, 0);

            await this.prismaService.inventoryEntry.update({
                where: { id },
                data: {
                    controlNumber: data.controlNumber,
                    totalAmount,
                    title: data.title || '',
                    description: data.description || '',
                    date: data.date,
                    supplierId: data.supplierId || null,
                }
            });

            for (const detail of data.details) {
                const subtotal = detail.unitPrice * detail.quantity;

                await this.prismaService.inventoryEntryDetail.create({
                    data: {
                        inventoryEntryId: id,
                        productId: detail.productId,
                        quantity: detail.quantity,
                        unitPrice: detail.unitPrice,
                        unitPriceUSD: detail.unitPriceUSD || detail.unitPrice,
                        subtotal
                    }
                });

                const existingInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                });

                if (existingInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: existingInventory.id },
                        data: {
                            quantity: Number(existingInventory.quantity) + Number(detail.quantity)
                        }
                    });
                } else {
                    await this.prismaService.inventory.create({
                        data: {
                            productId: detail.productId,
                            quantity: detail.quantity
                        }
                    });
                }
            }

            baseResponse.message = 'Entrada de inventario actualizada exitosamente';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async deleteInventoryEntry(id: number) {
        try {
            const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { id },
                include: { details: true, payments: true }
            });

            if (!existingEntry) {
                badResponse.message = 'Entrada no encontrada';
                return badResponse;
            }

            if (existingEntry.payments.length > 0) {
                badResponse.message = 'No se puede eliminar una entrada con pagos asociados';
                return badResponse;
            }

            for (const detail of existingEntry.details) {
                const existingInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: detail.productId }
                });

                if (existingInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: existingInventory.id },
                        data: {
                            quantity: Math.max(0, Number(existingInventory.quantity) - Number(detail.quantity))
                        }
                    });
                }
            }

            await this.prismaService.inventoryEntryDetail.deleteMany({
                where: { inventoryEntryId: id }
            });

            await this.prismaService.inventoryEntry.delete({
                where: { id }
            });

            baseResponse.message = 'Entrada de inventario eliminada exitosamente';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async getEnterpriseEntries(filter: InventoryEntryFilterDTO) {
        try {
            const { page = 1, limit = 50, startDate, endDate, controlNumber, supplierId, typeProduct } = filter;
            const skip = (page - 1) * limit;

            const where: any = {
                movementType: 'IN'
            };

            if (startDate && endDate) {
                where.date = {
                    gte: this.getStartOfDayUtc(startDate as string),
                    lte: this.getEndOfDayUtc(endDate as string),
                };
            }

            if (controlNumber) {
                where.controlNumber = {
                    contains: controlNumber,
                    mode: 'insensitive'
                };
            }

            if (supplierId) {
                where.supplierId = supplierId;
            }

            if (typeProduct) {
                where.details = {
                    some: {
                        product: {
                            type: {
                                equals: typeProduct,
                                mode: 'insensitive'
                            }
                        }
                    }
                };
            }

            const [entries, totalCount] = await Promise.all([
                this.prismaService.inventoryEntry.findMany({
                    where,
                    include: {
                        details: {
                            include: {
                                product: true
                            }
                        },
                        supplier: true,
                        payments: {
                            include: {
                                payment: {
                                    include: {
                                        account: {
                                            include: { method: true }
                                        },
                                        dolar: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: { date: 'desc' },
                    skip,
                    take: limit
                }),
                this.prismaService.inventoryEntry.count({ where })
            ]);

            const processedEntries = entries.map(entry => {
                const totalBultos = entry.details.reduce((sum, d) => sum + Number(d.quantity), 0);
                const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
                const remaining = Number(entry.totalAmount) - totalPaid;

                return {
                    id: entry.id,
                    controlNumber: entry.controlNumber,
                    title: entry.title,
                    description: entry.description,
                    date: entry.date,
                    status: entry.status,
                    totalAmount: Number(entry.totalAmount).toFixed(2),
                    totalBultos,
                    totalPaid: totalPaid.toFixed(2),
                    remaining: remaining.toFixed(2),
                    supplier: entry.supplier,
                    details: entry.details,
                    payments: entry.payments
                };
            });

            const totalPages = Math.ceil(totalCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                entries: processedEntries,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext,
                    hasPrev
                }
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener entradas de empresa: ${errMsg}`);
        }
    }

    async getEnterpriseEntryById(id: number) {
        try {
            const entry = await this.prismaService.inventoryEntry.findFirst({
                where: {
                    id,
                    movementType: 'IN'
                },
                include: {
                    details: {
                        include: {
                            product: true
                        }
                    },
                    supplier: true,
                    payments: {
                        include: {
                            payment: {
                                include: {
                                    account: {
                                        include: { method: true }
                                    },
                                    dolar: true
                                }
                            }
                        }
                    }
                }
            });

            if (!entry) {
                throw new Error('Entrada de empresa no encontrada');
            }

            const totalBultos = entry.details.reduce((sum, d) => sum + Number(d.quantity), 0);
            const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const remaining = Number(entry.totalAmount) - totalPaid;

            const payments = entry.payments.map(ep => {
                const currency = ep.payment.account?.method?.currency;
                const dolarRate = Number(ep.payment.dolar?.dolar || 0);

                let amountUSD = Number(ep.amount);
                let amountBS = 0;

                if (currency === 'BS') {
                    amountUSD = dolarRate > 0 ? Number(ep.amount) / dolarRate : 0;
                    amountBS = Number(ep.amount);
                } else {
                    amountUSD = Number(ep.amount);
                    amountBS = Number(ep.amount) * dolarRate;
                }

                return {
                    id: ep.id,
                    amount: Number(ep.amount).toFixed(2),
                    amountUSD: amountUSD.toFixed(2),
                    amountBS: amountBS.toFixed(2),
                    payment: ep.payment,
                    createdAt: ep.createdAt
                };
            });

            return {
                id: entry.id,
                controlNumber: entry.controlNumber,
                title: entry.title,
                description: entry.description,
                date: entry.date,
                status: entry.status,
                totalAmount: Number(entry.totalAmount).toFixed(2),
                totalBultos,
                totalPaid: totalPaid.toFixed(2),
                remaining: remaining.toFixed(2),
                supplier: entry.supplier,
                details: entry.details,
                payments
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener entrada de empresa: ${errMsg}`);
        }
    }
}
