import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import { PaymentParseExcel } from 'src/excel/excel.controller';

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
            },
            orderBy: { id: 'asc' }
        }).then(pay =>
            pay.map(data => {
                return {
                    ...data,
                    amount: data.amount.toFixed(2),
                    remaining: data.remaining.toFixed(2)
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
            orderBy: { id: 'asc' },
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
                    amountBs: data.currency === 'BS' ? data.amount.toFixed(2) : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
                    remaining: data.remaining.toFixed(2)
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
                    remaining: payment.amount,
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

    async payInvoice(pay: PayInvoiceDTO) {
        try {
            const findPayment = await this.prismaService.payment.findFirst({
                where: { id: pay.paymentId },
                include: { method: true }
            });

            const findInvoice = await this.prismaService.invoice.findFirst({
                where: { controlNumber: pay.invoiceId },
                include: { invoiceItems: true }
            });

            const products = await this.productService.getProducts();

            if (findPayment.method.name == 'Efectivo') {
                findInvoice.invoiceItems.map(async (det) => {
                    const findProduct = products.find(prod => prod.id === det.productId);

                    const findItemInvoice = await this.prismaService.invoiceProduct.findFirst({
                        where: { invoiceId: findInvoice.id, productId: findProduct.id }
                    })

                    await this.prismaService.invoiceProduct.update({
                        data: {
                            unitPrice: findProduct.priceUSD,
                            subtotal: Number(findProduct.priceUSD) * findItemInvoice.quantity,
                        },
                        where: { id: findItemInvoice.id }
                    })
                })

                const total = findInvoice.invoiceItems.reduce((acc, item) => acc + Number(item.subtotal), 0);

                await this.prismaService.invoice.update({
                    data: {
                        totalAmount: total
                    },
                    where: { id: findInvoice.id }
                })
            }

            await this.prismaService.invoicePayment.create({
                data: {
                    invoiceId: findInvoice.id,
                    paymentId: findPayment.id,
                    amount: pay.amount
                }
            })

            await this.prismaService.payment.update({
                data: { remaining: Number(findPayment.amount) - pay.amount },
                where: { id: findPayment.id }
            })

            await this.prismaService.invoice.update({
                data: {
                    remaining: Number(findInvoice.totalAmount) - pay.amount,
                    status: 'Pagado'
                },
                where: { id: findInvoice.id }
            })

            baseResponse.message = `Pago Asociado a factura ${pay.invoiceId}`
            return baseResponse
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async saveDataExcelPayments(payments: PaymentParseExcel[]) {
        const dataPayments = payments.map(pay => {
            return {
                date: pay.date,
                controlNumber: pay.controlNumber ? pay.controlNumber.toString().padStart(4, '0') : '',
                amount: Number(Number(pay.amount).toFixed(2)),
                bank: pay.bank,
                client: pay.client,
                dolar: Number(Number(pay.dolar).toFixed(2)),
                total: Number(Number(pay.total).toFixed(2)),
                reference: pay.reference
            }
        });

        try {
            dataPayments.map(async (data) => {
                const saveDolar = await this.prismaService.historyDolar.create({
                    data: {
                        dolar: data.dolar,
                        date: data.date
                    }
                })

                const pagoMovil = await this.prismaService.paymentMethod.findFirst({
                    where: { name: 'Pago Movil' }
                })

                const Efectivo = await this.prismaService.paymentMethod.findFirst({
                    where: { name: 'Efectivo Bs' }
                })

                const methodPayments: number = data.bank === 'Bolivares' ? Efectivo.id : pagoMovil.id

                const savePayments = await this.prismaService.payment.create({
                    data: {
                        amount: data.amount,
                        bank: data.bank,
                        currency: 'BS',
                        reference: data.reference ? data.reference.toString() : '',
                        paymentDate: data.date,
                        status: 'CONFIRMED',
                        dolarId: saveDolar.id,
                        methodId: methodPayments,
                    }
                })

                const findInvoice = await this.prismaService.invoice.findFirst({
                    where: {
                        controlNumber: data.controlNumber
                    }
                })

                if (findInvoice) {
                    const totalPayInvoice = Number(data.amount / data.dolar).toFixed(2);

                    const payInvoices = await this.prismaService.invoicePayment.create({
                        data: {
                            invoiceId: findInvoice.id,
                            paymentId: savePayments.id,
                            amount: totalPayInvoice
                        }
                    })

                    const setStatusInvoice = Number(totalPayInvoice) === Number(findInvoice.totalAmount) 
                    ? 'Pagado'
                    : 'Pendiente'

                    await this.prismaService.invoice.update({
                        data: {
                            status: setStatusInvoice
                        },
                        where: { id: findInvoice.id }
                    })
                }
            })
            baseResponse.message = 'Pagos, dolar y asociación guardados exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }
}
