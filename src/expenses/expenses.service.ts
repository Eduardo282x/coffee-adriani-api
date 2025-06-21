import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ExpensesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getExpenses() {
        try {
            const invoices = await this.getInvoices();
            const payments = await this.getPayments();

            return {
                invoices: invoices,
                payments: payments
            };
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoices() {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    remaining: {
                        not: 0
                    }
                },
                include: { client: true }
            })

            return invoices;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getPayments() {
        try {
            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { contains: 'Gastos' }
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    }
                }
            })

            return payments;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getEarning() {
        try {
            const invoicesPayed = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado'
                },
                include: {
                    invoiceItems: { include: { product: true } }
                }
            })

            return invoicesPayed;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
