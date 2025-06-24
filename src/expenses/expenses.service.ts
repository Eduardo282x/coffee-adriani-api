import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExpensesDTO } from './expenses.dto';

@Injectable()
export class ExpensesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getExpensesFilter(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.getInvoices(expenseFilter);
            const payments = await this.getPayments(expenseFilter);

            return {
                invoices: invoices,
                payments: payments
            };
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoices(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    remaining: {
                        not: 0
                    },
                    dispatchDate: {
                        gte: expenseFilter.startDate,
                        lte: expenseFilter.endDate
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

    async getPayments(expenseFilter: ExpensesDTO) {
        try {
            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { contains: 'Gastos' }
                    },
                    paymentDate: {
                        gte: expenseFilter.startDate,
                        lte: expenseFilter.endDate
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
