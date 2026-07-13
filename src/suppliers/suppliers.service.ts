import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { CreateSupplierDTO, SupplierFilterDTO, SupplierPaymentFilterDTO, UpdateSupplierDTO } from './suppliers.dto';

interface SupplierFilter {
    page?: number;
    limit?: number;
    search?: string;
    active?: boolean;
}

interface SupplierPaymentFilter {
    supplierId: number;
    startDate?: Date | string;
    endDate?: Date | string;
    page?: number;
    limit?: number;
}

@Injectable()
export class SuppliersService {

    constructor(private readonly prismaService: PrismaService) { }

    private getStartOfDayUtc(date: string | Date) {
        const d = new Date(date);
        return new Date(`${d.toISOString().slice(0, 10)}T00:00:00.000Z`);
    }

    private getEndOfDayUtc(date: string | Date) {
        const d = new Date(date);
        return new Date(`${d.toISOString().slice(0, 10)}T23:59:59.999Z`);
    }

    async getSuppliers(filter: SupplierFilterDTO) {
        try {
            const { page = 1, limit = 50, search, active } = filter;
            const skip = (page - 1) * limit;

            const where: any = {};

            if (active !== undefined) {
                where.active = active;
            }

            if (search) {
                where.OR = [
                    {
                        name: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    },
                    {
                        rif: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    }
                ];
            }

            const [suppliers, totalCount] = await Promise.all([
                this.prismaService.supplier.findMany({
                    where,
                    orderBy: { name: 'asc' },
                    skip,
                    take: limit
                }),
                this.prismaService.supplier.count({ where })
            ]);

            const totalPages = Math.ceil(totalCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                suppliers,
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
            throw new Error(`Error al obtener proveedores: ${errMsg}`);
        }
    }

    async createSupplier(data: CreateSupplierDTO) {
        try {
            const existingSupplier = await this.prismaService.supplier.findFirst({
                where: {
                    name: {
                        equals: data.name,
                        mode: 'insensitive'
                    }
                }
            });

            if (existingSupplier) {
                badResponse.message = 'Ya existe un proveedor con este nombre';
                return badResponse;
            }

            await this.prismaService.supplier.create({
                data: {
                    name: data.name,
                    rif: data.rif || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    email: data.email || null,
                    rubro: data.rubro || null,
                }
            });

            baseResponse.message = 'Proveedor creado exitosamente.';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async updateSupplier(id: number, data: UpdateSupplierDTO) {
        try {
            const existingSupplier = await this.prismaService.supplier.findUnique({
                where: { id }
            });

            if (!existingSupplier) {
                badResponse.message = 'Proveedor no encontrado';
                return badResponse;
            }

            const duplicateName = await this.prismaService.supplier.findFirst({
                where: {
                    name: {
                        equals: data.name,
                        mode: 'insensitive'
                    },
                    id: { not: id }
                }
            });

            if (duplicateName) {
                badResponse.message = 'Ya existe otro proveedor con este nombre';
                return badResponse;
            }

            await this.prismaService.supplier.update({
                where: { id },
                data: {
                    name: data.name,
                    rif: data.rif || null,
                    phone: data.phone || null,
                    address: data.address || null,
                    email: data.email || null,
                    rubro: data.rubro || null,
                }
            });

            baseResponse.message = 'Proveedor actualizado exitosamente.';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async deleteSupplier(id: number) {
        try {
            const existingSupplier = await this.prismaService.supplier.findUnique({
                where: { id }
            });

            if (!existingSupplier) {
                badResponse.message = 'Proveedor no encontrado';
                return badResponse;
            }

            await this.prismaService.supplier.update({
                where: { id },
                data: { active: false }
            });

            baseResponse.message = 'Proveedor eliminado exitosamente.';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    // async getSupplierPayments(filter: SupplierPaymentFilterDTO) {
    //     try {
    //         const { supplierId, startDate, endDate, page = 1, limit = 50 } = filter;
    //         const skip = (page - 1) * limit;

    //         const where: any = {
    //             supplierId
    //         };

    //         if (startDate && endDate) {
    //             where.paymentDate = {
    //                 gte: this.getStartOfDayUtc(startDate),
    //                 lte: this.getEndOfDayUtc(endDate)
    //             };
    //         }

    //         const [payments, totalCount] = await Promise.all([
    //             this.prismaService.supplierPayment.findMany({
    //                 where,
    //                 include: {
    //                     dolar: true,
    //                     account: {
    //                         include: { method: true }
    //                     },
    //                     supplier: true,
    //                     inventoryEntries: true
    //                 },
    //                 orderBy: { paymentDate: 'desc' },
    //                 skip,
    //                 take: limit
    //             }),
    //             this.prismaService.supplierPayment.count({ where })
    //         ]);

    //         const processedPayments = payments.map(payment => {
    //             const currency = payment.account?.method?.currency;
    //             const dolarRate = Number(payment.dolar?.dolar || 0);

    //             let amountUSD = Number(payment.amount);
    //             let amountBS = 0;

    //             if (currency === 'BS') {
    //                 amountUSD = dolarRate > 0 ? Number(payment.amount) / dolarRate : 0;
    //                 amountBS = Number(payment.amount);
    //             } else {
    //                 amountUSD = Number(payment.amount);
    //                 amountBS = Number(payment.amount) * dolarRate;
    //             }

    //             return {
    //                 ...payment,
    //                 amount: Number(payment.amount).toFixed(2),
    //                 amountUSD: amountUSD.toFixed(2),
    //                 amountBS: amountBS.toFixed(2),
    //                 dolarRate: dolarRate.toFixed(2)
    //             };
    //         });

    //         const totalPages = Math.ceil(totalCount / limit);
    //         const hasNext = page < totalPages;
    //         const hasPrev = page > 1;

    //         const totalAmountUSD = processedPayments.reduce((acc, p) => acc + Number(p.amountUSD), 0);
    //         const totalAmountBS = processedPayments.reduce((acc, p) => acc + Number(p.amountBS), 0);

    //         return {
    //             payments: processedPayments,
    //             totals: {
    //                 totalAmountUSD: totalAmountUSD.toFixed(2),
    //                 totalAmountBS: totalAmountBS.toFixed(2),
    //                 count: totalCount
    //             },
    //             pagination: {
    //                 page,
    //                 limit,
    //                 totalCount,
    //                 totalPages,
    //                 hasNext,
    //                 hasPrev
    //             }
    //         };
    //     } catch (error: unknown) {
    //         const errMsg = error instanceof Error ? error.message : String(error);
    //         throw new Error(`Error al obtener pagos del proveedor: ${errMsg}`);
    //     }
    // }
}
