import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DTOInventory, DTOInventoryHistory, DTOInventorySimple, DTOUpdateHistoryInventory, CreateInventoryEntryDTO, InventoryEntryFilterDTO } from './inventory.dto';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { ProductsService } from 'src/products/products.service';

interface InventoryHistoryFilter {
    page: number;
    limit: number;
    startDate?: string;
    endDate?: string;
    typeMovement?: 'IN' | 'OUT' | 'EDIT' | 'ADJUSTMENT' | '';
    typeProduct?: string;
    controlNumber?: string;
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

    private normalizeControlNumber(controlNumber?: string | null): string {
        return (controlNumber ?? '').trimEnd();
    }

    private extractControlFromDescription(description: string): string | null {
        if (!description) return null;
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
                },
                where: {
                    product: {
                        deleted: false
                    }
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
        const { page, limit, startDate, endDate, typeMovement, typeProduct, controlNumber } = filter;
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

        const normalizedControlNumber = this.normalizeControlNumber(controlNumber);
        if (normalizedControlNumber) {
            where.controlNumber = {
                equals: normalizedControlNumber,
                mode: 'insensitive',
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

        const groupedMap = new Map<string, {
            controlNumber: string;
            description: string;
            movementType: 'IN' | 'OUT' | 'EDIT' | 'ADJUSTMENT';
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
        }>();

        for (const item of history) {
            const day = item.movementDate.toISOString().slice(0, 10);
            const control = this.normalizeControlNumber(item.controlNumber);
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
                    const extracted = this.extractControlFromDescription(row.description);
                    if (extracted) {
                        controlNumber = extracted;
                    } else {
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

                controlNumber = this.normalizeControlNumber(controlNumber);

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
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

            const saveHistory = await this.prismaService.historyInventory.createMany({
                data: inventory.details.map(detail => ({
                    productId: detail.productId,
                    quantity: detail.quantity,
                    controlNumber: normalizedControlNumber,
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
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

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
                        controlNumber: normalizedControlNumber,
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

    async updateHistoryInventory(inventory: DTOUpdateHistoryInventory) {
        try {
            const normalizedControlNumber = this.normalizeControlNumber(inventory.controlNumber);

            const findHistory = await this.prismaService.historyInventory.findMany({
                where: { controlNumber: inventory.controlNumberOld },
                orderBy: { movementDate: 'desc' }
            });
            if (!findHistory || findHistory.length === 0) {
                badResponse.message = 'Numero de control no encontrado.';
                return badResponse;
            }

            findHistory.forEach(async (history) => {
                await this.prismaService.historyInventory.update({
                    where: { id: history.id },
                    data: {
                        controlNumber: normalizedControlNumber,
                        movementDate: inventory.date
                    }
                });
            })

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

    async migrateHistoryInventory() {
        try {
            const historyRecords = await this.prismaService.historyInventory.findMany({
                include: { product: true },
                orderBy: { id: 'asc' }
            });

            if (historyRecords.length === 0) {
                return { message: 'No hay registros para migrar', migrated: 0 };
            }

            const grouped = new Map<string, typeof historyRecords>();

            for (const record of historyRecords) {
                const day = record.movementDate.toISOString().slice(0, 10);
                const key = `${record.controlNumber}-${day}`;

                if (!grouped.has(key)) {
                    grouped.set(key, []);
                }
                grouped.get(key)!.push(record);
            }

            let migratedEntries = 0;
            let migratedDetails = 0;

            for (const [key, records] of grouped) {
                const firstRecord = records[0];
                const controlNumber = firstRecord.controlNumber || `MIG-${key}`;

                const existingEntry = await this.prismaService.inventoryEntry.findUnique({
                    where: { controlNumber }
                });

                if (existingEntry) {
                    continue;
                }

                const totalAmount = records.reduce((sum, r) => {
                    const price = Number(r.product?.price || 0);
                    return sum + (price * r.quantity);
                }, 0);

                const movementType = firstRecord.movementType;

                const entry = await this.prismaService.inventoryEntry.create({
                    data: {
                        controlNumber,
                        movementType,
                        totalAmount,
                        status: 'CREADA',
                        title: `Migrado - ${controlNumber}`,
                        description: firstRecord.description || '',
                        date: firstRecord.movementDate,
                    }
                });

                const productAggregated = new Map<number, { quantity: number; price: number; priceUSD: number }>();

                for (const record of records) {
                    const productId = record.productId;
                    const price = Number(record.product?.price || 0);
                    const priceUSD = Number(record.product?.priceUSD || 0);

                    if (productAggregated.has(productId)) {
                        const existing = productAggregated.get(productId)!;
                        existing.quantity += record.quantity;
                    } else {
                        productAggregated.set(productId, {
                            quantity: record.quantity,
                            price,
                            priceUSD
                        });
                    }
                }

                for (const [productId, data] of productAggregated) {
                    const subtotal = data.price * data.quantity;

                    await this.prismaService.inventoryEntryDetail.create({
                        data: {
                            inventoryEntryId: entry.id,
                            productId,
                            quantity: data.quantity,
                            unitPrice: data.price,
                            unitPriceUSD: data.priceUSD,
                            subtotal
                        }
                    });
                    migratedDetails++;
                }

                migratedEntries++;
            }

            return {
                message: 'Migración completada exitosamente',
                migratedEntries,
                migratedDetails,
                totalRecordsProcessed: historyRecords.length
            };

        } catch (error: any) {
            throw new Error(`Error en la migración: ${error.message}`);
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
                const totalBultos = entry.details.reduce((sum, d) => sum + d.quantity, 0);
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

            const totalBultos = entry.details.reduce((sum, d) => sum + d.quantity, 0);
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
                            quantity: existingInventory.quantity + detail.quantity
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
                            quantity: Math.max(0, existingInventory.quantity - oldDetail.quantity)
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
                            quantity: existingInventory.quantity + detail.quantity
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
                            quantity: Math.max(0, existingInventory.quantity - detail.quantity)
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
                const totalBultos = entry.details.reduce((sum, d) => sum + d.quantity, 0);
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

            const totalBultos = entry.details.reduce((sum, d) => sum + d.quantity, 0);
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
