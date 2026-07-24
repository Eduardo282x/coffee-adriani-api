import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { AssociatePaymentDTO, CreatePaymentForEntryDTO, DisassociatePaymentDTO } from './entry-payments.dto';

@Injectable()
export class EntryPaymentsService {

    constructor(private readonly prismaService: PrismaService) { }

    async associatePaymentToEntry(data: AssociatePaymentDTO) {
        try {
            const entry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: data.inventoryEntryId },
                include: {
                    payments: true
                }
            });

            if (!entry) {
                badResponse.message = 'Entrada de inventario no encontrada';
                return badResponse;
            }

            const payment = await this.prismaService.payment.findUnique({
                where: { id: data.paymentId }
            });

            if (!payment) {
                badResponse.message = 'Pago no encontrado';
                return badResponse;
            }

            const existingAssociation = await this.prismaService.inventoryEntryPayment.findUnique({
                where: {
                    inventoryEntryId_paymentId: {
                        inventoryEntryId: data.inventoryEntryId,
                        paymentId: data.paymentId
                    }
                }
            });

            if (existingAssociation) {
                badResponse.message = 'Este pago ya está asociado a esta entrada';
                return badResponse;
            }

            const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const remaining = Number(entry.totalAmount) - totalPaid;

            if (data.amount > remaining) {
                badResponse.message = `El monto excede el saldo pendiente de $${remaining.toFixed(2)}`;
                return badResponse;
            }

            await this.prismaService.inventoryEntryPayment.create({
                data: {
                    inventoryEntryId: data.inventoryEntryId,
                    paymentId: data.paymentId,
                    amount: data.amount
                }
            });

            const updatedEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: data.inventoryEntryId },
                include: {
                    payments: true
                }
            });

            const newTotalPaid = updatedEntry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const newStatus = newTotalPaid >= Number(updatedEntry.totalAmount) ? 'PAGADO' : 'PENDIENTE';

            await this.prismaService.inventoryEntry.update({
                where: { id: data.inventoryEntryId },
                data: { status: newStatus as any }
            });

            baseResponse.message = 'Pago asociado exitosamente';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async disassociatePaymentFromEntry(data: DisassociatePaymentDTO) {
        try {
            const association = await this.prismaService.inventoryEntryPayment.findUnique({
                where: {
                    inventoryEntryId_paymentId: {
                        inventoryEntryId: data.inventoryEntryId,
                        paymentId: data.paymentId
                    }
                }
            });

            if (!association) {
                badResponse.message = 'Asociación no encontrada';
                return badResponse;
            }

            await this.prismaService.inventoryEntryPayment.delete({
                where: {
                    inventoryEntryId_paymentId: {
                        inventoryEntryId: data.inventoryEntryId,
                        paymentId: data.paymentId
                    }
                }
            });

            const entry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: data.inventoryEntryId },
                include: {
                    payments: true
                }
            });

            const totalPaid = entry.payments
                .filter(p => p.paymentId !== data.paymentId)
                .reduce((sum, p) => sum + Number(p.amount), 0);

            const newStatus = totalPaid >= Number(entry.totalAmount) ? 'PAGADO' :
                             totalPaid > 0 ? 'PENDIENTE' : 'CREADA';

            await this.prismaService.inventoryEntry.update({
                where: { id: data.inventoryEntryId },
                data: { status: newStatus as any }
            });

            baseResponse.message = 'Pago desasociado exitosamente';
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async createPaymentForEntry(data: CreatePaymentForEntryDTO) {
        try {
            const entry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: data.inventoryEntryId },
                include: {
                    payments: true
                }
            });

            if (!entry) {
                badResponse.message = 'Entrada de inventario no encontrada';
                return badResponse;
            }

            const totalPaid = entry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const remaining = Number(entry.totalAmount) - totalPaid;

            if (data.entryAmount > remaining) {
                badResponse.message = `El monto excede el saldo pendiente de $${remaining.toFixed(2)}`;
                return badResponse;
            }

            const getDolar = await this.prismaService.historyDolar.findFirst({
                orderBy: { date: 'desc' }
            });

            const payment = await this.prismaService.payment.create({
                data: {
                    amount: data.amount,
                    accountId: data.accountId,
                    reference: data.reference,
                    description: data.description || '',
                    dolarId: getDolar?.id || 1,
                    paymentDate: data.paymentDate,
                    status: 'CONFIRMED',
                    isProviderPayment: true
                }
            });

            await this.prismaService.inventoryEntryPayment.create({
                data: {
                    inventoryEntryId: data.inventoryEntryId,
                    paymentId: payment.id,
                    amount: data.entryAmount
                }
            });

            const updatedEntry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: data.inventoryEntryId },
                include: {
                    payments: true
                }
            });

            const newTotalPaid = updatedEntry.payments.reduce((sum, p) => sum + Number(p.amount), 0);
            const newStatus = newTotalPaid >= Number(updatedEntry.totalAmount) ? 'PAGADO' : 'PENDIENTE';

            await this.prismaService.inventoryEntry.update({
                where: { id: data.inventoryEntryId },
                data: { status: newStatus as any }
            });

            baseResponse.message = 'Pago creado y asociado exitosamente';
            baseResponse.data = { paymentId: payment.id };
            return baseResponse;
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async getPaymentsByEntry(entryId: number) {
        try {
            const entry = await this.prismaService.inventoryEntry.findUnique({
                where: { id: entryId }
            });

            if (!entry) {
                badResponse.message = 'Entrada de inventario no encontrada';
                return badResponse;
            }

            const entryPayments = await this.prismaService.inventoryEntryPayment.findMany({
                where: { inventoryEntryId: entryId },
                include: {
                    payment: {
                        include: {
                            account: {
                                include: { method: true }
                            },
                            dolar: true
                        }
                    }
                },
                orderBy: { createdAt: 'desc' }
            });

            const payments = entryPayments.map(ep => {
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

            const totalPaid = payments.reduce((sum, p) => sum + Number(p.amountUSD), 0);
            const totalAmount = Number(entry.totalAmount);
            const remaining = totalAmount - totalPaid;

            return {
                entryId: entry.id,
                controlNumber: entry.controlNumber,
                totalAmount: totalAmount.toFixed(2),
                totalPaid: totalPaid.toFixed(2),
                remaining: remaining.toFixed(2),
                payments
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener pagos: ${errMsg}`);
        }
    }
}
