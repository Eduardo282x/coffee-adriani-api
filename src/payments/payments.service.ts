import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaymentDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';

@Injectable()
export class PaymentsService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService
    ) { }

    async getPayments() {
        return await this.prismaService.payment.findMany({
            include: {
                method: true,
                dolar: true
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
                method: true,
                dolar: true
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
                    amount: data.amount.toFixed(2),
                    amountUSD: data.currency === 'USD' ? data.amount.toFixed(2) : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
                    amountBs: data.currency === 'BS' ? data.amount.toFixed(2) : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2)
                }
            })
        )
    }

    async getPaymentsMethod() {
        return await this.prismaService.paymentMethod.findMany()
    }

    getBanks() {
        return BankData;
    }

    async registerPayment(payment: PaymentDTO) {
        try {
            const zelle = await this.prismaService.paymentMethod.findFirst({
                where: { id: payment.methodId }
            })

            const getDolar = await this.productService.getDolar()

            await this.prismaService.payment.create({
                data: {
                    amount: payment.amount,
                    currency: payment.currency === 'USD' ? 'USD' : 'BS',
                    reference: payment.reference,
                    bank: zelle.name == 'Zelle' ? 'Zelle' : payment.bank,
                    dolarId: getDolar.id,
                    paymentDate: new Date(),
                    status: zelle.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    methodId: payment.methodId,
                }
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
