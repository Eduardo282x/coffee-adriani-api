import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaymentDTO } from './payment.dto';

@Injectable()
export class PaymentsService {

    constructor(private readonly prismaService: PrismaService) {

    }

    async getPayments() {
        return await this.prismaService.payment.findMany({
            include: {
                invoice: {
                    include: { client: true }
                },
                method: true
            }
        }).then(pay =>
            pay.map(data => {
                return {
                    ...data,
                    amount: data.amount.toFixed(2)
                }
            })
        )
    }

    async getPaymentsFilter(filter: DTODateRangeFilter) {
        return await this.prismaService.payment.findMany({
            include: {
                invoice: {
                    include: { client: true }
                },
                method: true
            },
            where: {
                paymentDate: {
                    gte: filter.startDate,
                    lte: filter.endDate
                }
            }
        }).then(pay => 
            pay.map(data => {
                return {
                    ...data,
                    amount: data.amount.toFixed(2)
                }
            })
        )
    }

    async getPaymentsMethod() {
        return await this.prismaService.paymentMethod.findMany()
    }

    async savePayment(payment: PaymentDTO) {
        try {
            const zelle = await this.prismaService.paymentMethod.findFirst({
                where: { id: payment.methodId }
            })

            await this.prismaService.payment.create({
                data: {
                    invoiceId: payment.invoiceId,
                    amount: payment.amount,
                    paymentDate: new Date(),
                    status: zelle.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    methodId: payment.methodId,
                }
            })

            const findInvoice = await this.prismaService.invoice.findFirst({
                where: { id: payment.invoiceId },
            })

            await this.prismaService.invoice.update({
                data: { status: Number(payment.amount) !== Number(findInvoice.totalAmount) || zelle.name === 'Zelle' ? 'Pendiente' : 'Pagado' },
                where: { id: payment.invoiceId }
            })

            baseResponse.message = 'Pago guardado correctamente';
            return baseResponse;
        }
        catch (error) {
            badResponse.message = error.message;
            return badResponse;
        }
    }

    async updatePaymentZelle(id: number) {
        try {
            const payment = await this.prismaService.payment.findFirst({
                where: { id: id }
            })

            await this.prismaService.payment.update({
                data: { status: 'CONFIRMED' },
                where: { id: id }
            })

            baseResponse.message = 'Pago actualizado correctamente';
            return baseResponse;
        }
        catch (error) {
            badResponse.message = error.message;
            return badResponse;
        }
    }
}
