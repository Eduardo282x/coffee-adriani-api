import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountsDTO, PayDisassociateDTO, PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import { PaymentParseExcel } from 'src/excel/excel.interfaces';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';

// Añadir estos métodos al PaymentsService existente

interface PaymentFilterPaginate extends PaymentFilter {
    page: number;
    limit: number;
}

interface PaymentFilter {
    startDate?: Date;
    endDate?: Date;
    accountId?: number;
    methodId?: number;
    associated?: boolean;
    type?: string;
    credit?: 'credit' | 'noCredit';
}

@Injectable()
export class PaymentsService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService
    ) { }

    // NUEVOS MÉTODOS OPTIMIZADOS EN PaymentsService

    async getPaymentsPaginated(filters: PaymentFilterPaginate) {
        try {
            const { page, limit, startDate, endDate, accountId, methodId, associated, type, credit } = filters;
            const skip = (page - 1) * limit;

            // Construir where clause dinámicamente
            const where: any = {};

            if (startDate && endDate) {
                where.paymentDate = {
                    gte: startDate,
                    lte: endDate
                };
            }

            if (accountId) {
                where.accountId = accountId;
            }

            if (credit) {
                if (credit == 'credit') {
                    where.InvoicePayment = {
                        some: {}
                    }
                    where.AND = {
                        remaining: {
                            gt: 0
                        }
                    }
                } else {
                    where.InvoicePayment = {
                        none: {}
                    }
                }
            }

            if (type) {
                where.InvoicePayment = {
                    some: {
                        invoice: {
                            invoiceItems: {
                                some: {
                                    product: {
                                        type: type
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (methodId) {
                where.account = {
                    methodId: methodId
                };
            }

            if (associated !== undefined) {
                if (associated) {
                    where.InvoicePayment = {
                        some: {}
                    };
                } else {
                    where.InvoicePayment = {
                        none: {}
                    };
                }
            }

            console.log(where);
            

            // Consulta principal con paginación
            const [payments, totalCount] = await Promise.all([
                this.prismaService.payment.findMany({
                    include: {
                        dolar: true,
                        account: {
                            include: { method: true }
                        },
                        InvoicePayment: {
                            include: {
                                invoice: {
                                    include: {
                                        client: {
                                            include: { block: true }
                                        }
                                    }
                                }
                            }
                        },
                    },
                    where,
                    orderBy: { paymentDate: 'desc' },
                    skip,
                    take: limit
                }),
                this.prismaService.payment.count({ where })
            ]);

            // Procesar datos
            const processedPayments = payments.map(data => ({
                ...data,
                associated: data.InvoicePayment.length > 0,
                amount: data.amount.toFixed(2),
                amountUSD: data.account.method.currency === 'USD'
                    ? data.amount.toFixed(2)
                    : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
                amountBs: data.account.method.currency === 'BS'
                    ? data.amount.toFixed(2)
                    : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
                remaining: data.remaining.toFixed(2),
                remainingUSD: data.account.method.currency === 'USD'
                    ? data.remaining.toFixed(2)
                    : (Number(data.remaining) / Number(data.dolar.dolar)).toFixed(2),
                credit: data.InvoicePayment.length > 0 && Number(data.remaining) > 0
            }));

            // Calcular paginación
            const totalPages = Math.ceil(totalCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                payments: processedPayments,
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages,
                    hasNext,
                    hasPrev
                }
            };
        } catch (error) {
            throw new Error(`Error al obtener pagos paginados: ${error.message}`);
        }
    }

    async getPaymentsStatistics(filters: PaymentFilter) {
        try {
            const { startDate, endDate, accountId, methodId, associated, type, credit } = filters;

            // Construir where clause dinámicamente
            const where: any = {};

            if (startDate && endDate) {
                where.paymentDate = {
                    gte: startDate,
                    lte: endDate
                };
            }

            if (credit) {
                if (credit == 'credit') {
                    where.InvoicePayment = {
                        some: {}
                    }
                    where.AND = {
                        remaining: {
                            gt: 0
                        }
                    }
                } else {
                    where.InvoicePayment = {
                        none: {}
                    }
                }
            }

            if (type) {
                where.InvoicePayment = {
                    some: {
                        invoice: {
                            invoiceItems: {
                                some: {
                                    product: {
                                        type: type
                                    }
                                }
                            }
                        }
                    }
                }
            }

            if (accountId) {
                where.accountId = accountId;
            }

            if (methodId) {
                where.account = {
                    methodId: methodId
                };
            }

            if (associated !== undefined) {
                if (associated) {
                    where.InvoicePayment = {
                        some: {}
                    };
                } else {
                    where.InvoicePayment = {
                        none: {}
                    };
                }
            }

            const payments = await this.prismaService.payment.findMany({
                include: {
                    dolar: true,
                    account: {
                        include: { method: true }
                    }
                },
                where
            });

            // Calcular estadísticas
            const totalAmountBs = payments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + Number(data.amount), 0);

            const totalAmountBsInUSD = payments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + (Number(data.amount) / Number(data.dolar.dolar)), 0);

            const totalAmountUSD = payments
                .filter(item => item.account.method.currency === 'USD')
                .reduce((acc, data) => acc + Number(data.amount), 0);

            const totalRemainingBs = payments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + Number(data.remaining), 0);

            const totalRemainingBsInUSD = payments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + (Number(data.remaining) / Number(data.dolar.dolar)), 0);

            const totalRemainingUSD = payments
                .filter(item => item.account.method.currency === 'USD')
                .reduce((acc, data) => acc + Number(data.remaining), 0);

            const associatedPayments = await this.prismaService.payment.count({
                where: {
                    ...where,
                    InvoicePayment: {
                        some: {}
                    }
                }
            });

            const unassociatedPayments = await this.prismaService.payment.count({
                where: {
                    ...where,
                    InvoicePayment: {
                        none: {}
                    }
                }
            });

            // Estadísticas por método de pago
            const paymentsByMethod = await this.prismaService.payment.groupBy({
                by: ['accountId'],
                where,
                _sum: {
                    amount: true
                },
                _count: {
                    id: true
                }
            });

            // Obtener detalles de las cuentas
            const accountsDetails = await this.prismaService.accountsPayments.findMany({
                include: { method: true }
            });

            const methodStatistics = paymentsByMethod.map(stat => {
                const account = accountsDetails.find(acc => acc.id === stat.accountId);
                return {
                    accountId: stat.accountId,
                    accountName: account ? `${account.bank} - ${account.name}` : 'Desconocido',
                    method: account?.method.name || 'Desconocido',
                    currency: account?.method.currency || 'Desconocido',
                    totalAmount: stat._sum.amount || 0,
                    count: stat._count.id
                };
            });

            return {
                totals: {
                    totalBs: totalAmountBs,
                    totalUSD: totalAmountUSD,
                    total: totalAmountBsInUSD + totalAmountUSD,
                    remaining: totalRemainingBsInUSD + totalRemainingUSD,
                    totalRemainingBs,
                    totalRemainingUSD
                },
                counts: {
                    total: payments.length,
                    associated: associatedPayments,
                    unassociated: unassociatedPayments
                },
                byMethod: methodStatistics
            };
        } catch (error) {
            throw new Error(`Error al obtener estadísticas de pagos: ${error.message}`);
        }
    }

    async getPaymentDetails(paymentId: number) {
        try {
            const payment = await this.prismaService.payment.findUnique({
                where: { id: paymentId },
                include: {
                    dolar: true,
                    account: {
                        include: { method: true }
                    },
                    InvoicePayment: {
                        include: {
                            invoice: {
                                include: {
                                    client: {
                                        include: { block: true }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            if (!payment) {
                throw new Error('Pago no encontrado');
            }

            return {
                ...payment,
                associated: payment.InvoicePayment.length > 0,
                amount: payment.amount.toFixed(2),
                amountUSD: payment.account.method.currency === 'USD'
                    ? payment.amount.toFixed(2)
                    : (Number(payment.amount) / Number(payment.dolar.dolar)).toFixed(2),
                amountBs: payment.account.method.currency === 'BS'
                    ? payment.amount.toFixed(2)
                    : (Number(payment.amount) * Number(payment.dolar.dolar)).toFixed(2),
                remaining: payment.remaining.toFixed(2),
                remainingUSD: payment.account.method.currency === 'USD'
                    ? payment.remaining.toFixed(2)
                    : (Number(payment.remaining) / Number(payment.dolar.dolar)).toFixed(2),
                credit: payment.InvoicePayment.length > 0 && Number(payment.remaining) > 0
            };
        } catch (error) {
            throw new Error(`Error al obtener detalles del pago: ${error.message}`);
        }
    }

    async getPayments() {
        const dataPayments = await this.prismaService.payment.findMany({
            include: {
                dolar: true,
                account: {
                    include: { method: true }
                },
                InvoicePayment: {
                    include: { invoice: { include: { client: { include: { block: true } } } } }
                },
            },
            orderBy: { paymentDate: 'desc' }
        }).then(pay =>
            pay.map(data => {
                return {
                    ...data,
                    associated: data.InvoicePayment.length > 0,
                    amount: data.amount.toFixed(2),
                    amountUSD: data.account.method.currency === 'USD' ? data.amount.toFixed(2) : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
                    amountBs: data.account.method.currency === 'BS' ? data.amount.toFixed(2) : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
                    remaining: data.remaining.toFixed(2),
                    remainingUSD: data.account.method.currency === 'USD' ? data.remaining.toFixed(2) : (Number(data.remaining) / Number(data.dolar.dolar)).toFixed(2),
                    credit: data.InvoicePayment.length > 0 && Number(data.remaining) > 0
                }
            })
        )

        const totalAmountBs = dataPayments.filter(item => item.account.method.currency === 'BS').reduce((acc, data) => acc + Number(data.amount), 0)
        const totalAmountUSB = dataPayments.filter(item => item.account.method.currency === 'USD').reduce((acc, data) => acc + Number(data.amount), 0)
        // const totalUsd = dataPayments.reduce((acc, data) => acc + Number(data.amountUSD), 0)

        return {
            payments: dataPayments,
            totalBs: totalAmountBs,
            totalUSD: totalAmountUSB
        }
    }

    async getAccountsPayments() {
        return await this.prismaService.accountsPayments.findMany({
            include: {
                method: true
            }
        })
    }

    async createAccountPayment(account: AccountsDTO) {
        try {
            await this.prismaService.accountsPayments.create({
                data: {
                    name: account.name,
                    bank: account.bank,
                    methodId: account.methodId
                }
            });
            baseResponse.message = 'Cuenta de pago creada correctamente';
            return baseResponse;
        } catch (error) {
            badResponse.message = error.message;
            return badResponse;
        }
    }

    async updateAccountPayment(id: number, account: AccountsDTO) {
        try {
            await this.prismaService.accountsPayments.update({
                data: {
                    name: account.name,
                    bank: account.bank,
                    methodId: account.methodId
                },
                where: { id }
            });
            baseResponse.message = 'Cuenta de pago actualizada correctamente';
            return baseResponse;
        } catch (error) {
            badResponse.message = error.message;
            return badResponse;
        }
    }

    async getPaymentsFilter(filter: DTODateRangeFilter) {
        const dataPayments = await this.prismaService.payment.findMany({
            include: {
                dolar: true,
                account: {
                    include: { method: true }
                },
                InvoicePayment: {
                    include: { invoice: { include: { client: { include: { block: true } } } } }
                }
            },
            orderBy: { paymentDate: 'desc' },
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
                    associated: data.InvoicePayment.length > 0,
                    amount: data.amount.toFixed(2),
                    amountUSD: data.account.method.currency === 'USD' ? data.amount.toFixed(2) : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
                    amountBs: data.account.method.currency === 'BS' ? data.amount.toFixed(2) : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
                    remaining: data.remaining.toFixed(2),
                    remainingUSD: data.account.method.currency === 'USD' ? data.remaining.toFixed(2) : (Number(data.remaining) / Number(data.dolar.dolar)).toFixed(2),
                    credit: data.InvoicePayment.length > 0 && Number(data.remaining) > 0
                }
            })
        )

        const totalAmountBs = dataPayments.filter(item => item.account.method.currency === 'BS').reduce((acc, data) => acc + Number(data.amount), 0)
        const totalAmountUSB = dataPayments.filter(item => item.account.method.currency === 'USD').reduce((acc, data) => acc + Number(data.amount), 0)

        return {
            payments: dataPayments,
            totalBs: totalAmountBs,
            totalUSD: totalAmountUSB
        }
    }

    async getPaymentsMethod() {
        return await this.prismaService.paymentMethod.findMany()
    }

    getBanks() {
        return BankData;
    }

    async registerPayment(payment: PaymentDTO) {
        try {
            const accountZelle = await this.prismaService.accountsPayments.findFirst({
                where: { id: payment.accountId },
                include: { method: true }
            });
            const getDolar = await this.productService.getDolar()

            await this.prismaService.payment.create({
                data: {
                    amount: payment.amount,
                    remaining: payment.amount,
                    reference: payment.reference,
                    dolarId: getDolar.id,
                    paymentDate: payment.paymentDate,
                    status: accountZelle.method.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    accountId: payment.accountId,
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

    async updatePayment(id: number, payment: PaymentDTO) {
        try {
            const accountZelle = await this.prismaService.accountsPayments.findFirst({
                where: { id: payment.accountId },
                include: { method: true }
            });
            const getDolar = await this.productService.getDolar()

            await this.prismaService.payment.update({
                data: {
                    amount: payment.amount,
                    remaining: payment.amount,
                    reference: payment.reference,
                    dolarId: getDolar.id,
                    paymentDate: payment.paymentDate,
                    status: accountZelle.method.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    accountId: payment.accountId,
                },
                where: { id }
            })

            baseResponse.message = 'Pago actualizado correctamente';
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
            const totalInvoices = pay.details.reduce((acc, payments) => acc + payments.amount, 0);

            const findPayment = await this.prismaService.payment.findFirst({
                where: { id: pay.paymentId },
                include: { account: { include: { method: true } }, dolar: true }
            });

            if (!findPayment) {
                badResponse.message = 'Pago no encontrado.';
                return badResponse;
            }

            if (Number(totalInvoices) > Number(findPayment.amount)) {
                badResponse.message = 'La cantidad a pagar excede la cantidad del pago.';
                return badResponse;
            }

            // Procesar cada detalle de pago secuencialmente para evitar problemas de concurrencia
            for (const payDetail of pay.details) {
                const findInvoice = await this.prismaService.invoice.findFirst({
                    where: { id: payDetail.invoiceId },
                    include: { invoiceItems: true }
                });

                if (!findInvoice) {
                    throw new Error(`Factura con ID ${payDetail.invoiceId} no encontrada.`);
                }

                if (findInvoice.status === 'Pagado') {
                    throw new Error(`La factura #${findInvoice.controlNumber} ya está pagada.`);
                }

                // Buscar el último pago de esta factura para determinar el tipo de moneda
                const findLastPaymentInvoice = await this.prismaService.invoicePayment.findFirst({
                    where: {
                        invoiceId: payDetail.invoiceId
                    },
                    orderBy: {
                        createdAt: 'desc'
                    }
                });

                let typeLastPay = '';
                if (findLastPaymentInvoice) {
                    const lastPayment = await this.prismaService.payment.findFirst({
                        where: {
                            id: findLastPaymentInvoice.paymentId
                        },
                        include: {
                            account: {
                                include: {
                                    method: true
                                }
                            }
                        }
                    });
                    typeLastPay = lastPayment.account.method.currency;
                }

                // Recalcular total si el pago actual es en USD
                if (findPayment.account.method.currency === 'USD') {
                    // Obtener el primer elemento para los cálculos (asumiendo precios uniformes)
                    const firstElement = findInvoice.invoiceItems.filter(item => item.type !== 'GIFT')[0];
                    if (!firstElement) {
                        throw new Error(`No se encontraron elementos en la factura ${findInvoice.controlNumber}`);
                    }

                    // Calcular total de bultos en la factura
                    const cantidadBultosTotal = findInvoice.invoiceItems.filter(item => item.type !== 'GIFT').reduce((acc, item) => acc + item.quantity, 0);

                    let nuevoTotal = 0;
                    let nuevoPagadoTotal = 0;

                    // Si existe historial de pagos, usar tu lógica de nuevoTotal2
                    if (findLastPaymentInvoice && typeLastPay !== '') {
                        // Calcular bultos que faltan por pagar basándose en el último tipo de pago
                        const calculateBultosPagados = typeLastPay === 'USD'
                            ? Number(firstElement.unitPriceUSD)
                            : Number(firstElement.unitPrice);

                        const bultosFaltanPagar = Number(findInvoice.remaining) / calculateBultosPagados;

                        // Calcular cuántos bultos corresponden al pago actual en USD
                        const bultosPagoUSD = payDetail.amount / Number(firstElement.unitPriceUSD);

                        // Validar que no se exceda la cantidad de bultos que faltan por pagar
                        if (bultosPagoUSD > bultosFaltanPagar) {
                            throw new Error(`El pago excede la cantidad de bultos restantes (${bultosFaltanPagar.toFixed(2)}) en la factura.`);
                        }

                        // Aplicar tu lógica de nuevoTotal2
                        const bultosYaPagados = cantidadBultosTotal - bultosFaltanPagar;
                        const recalculateBS2 = (bultosYaPagados * Number(firstElement.unitPrice)) +
                            ((bultosFaltanPagar - bultosPagoUSD) * Number(firstElement.unitPrice));
                        const recalculateUSD2 = bultosPagoUSD * Number(firstElement.unitPriceUSD);
                        nuevoTotal = recalculateBS2 + recalculateUSD2;

                        // El pagado total es lo que ya se había pagado más este pago
                        nuevoPagadoTotal = Number(findInvoice.totalAmount) - Number(findInvoice.remaining) + payDetail.amount;
                    } else {
                        // Primera vez pagando en USD - lógica original
                        const totalPagado = Number(findInvoice.totalAmount) - Number(findInvoice.remaining);
                        nuevoPagadoTotal = totalPagado + payDetail.amount;

                        // Calcular bultos pagados en USD (incluyendo este pago)
                        const bultosPagadosUSD = nuevoPagadoTotal / Number(firstElement.unitPriceUSD);

                        // Validar que no se exceda la cantidad de bultos
                        if (bultosPagadosUSD > cantidadBultosTotal) {
                            throw new Error(`El pago excede la cantidad total de productos en la factura.`);
                        }

                        // Calcular bultos restantes que se pagarán en BS
                        const cantidadBultosBS = cantidadBultosTotal - bultosPagadosUSD;

                        // Recalcular totales
                        const recalculateBS = cantidadBultosBS * Number(firstElement.unitPrice);
                        const recalculateUSD = bultosPagadosUSD * Number(firstElement.unitPriceUSD);
                        nuevoTotal = recalculateBS + recalculateUSD;
                    }

                    // Validaciones del nuevo total
                    const totalEnUSD = cantidadBultosTotal * Number(firstElement.unitPriceUSD);
                    const totalEnBS = cantidadBultosTotal * Number(firstElement.unitPrice);

                    if (nuevoTotal < totalEnUSD || nuevoTotal > totalEnBS) {
                        throw new Error(`El nuevo total calculado (${nuevoTotal.toFixed(2)}) no está en el rango válido entre USD total (${totalEnUSD}) y BS total (${totalEnBS}).`);
                    }

                    // Calcular nuevo restante
                    const nuevoRestante = nuevoTotal - nuevoPagadoTotal;

                    // Actualizar la factura con el nuevo total y restante
                    await this.prismaService.invoice.update({
                        where: { id: findInvoice.id },
                        data: {
                            totalAmount: nuevoTotal,
                            remaining: nuevoRestante,
                            status: nuevoRestante <= 2 ? 'Pagado' : 'Pendiente'
                        }
                    });

                    // Si la factura queda pagada, eliminar recordatorio del cliente
                    if (nuevoRestante <= 2) {
                        const findClientReminder = await this.prismaService.clientReminder.findFirst({
                            where: { clientId: findInvoice.clientId }
                        });

                        if (findClientReminder) {
                            await this.prismaService.clientReminder.delete({
                                where: { id: findClientReminder.id }
                            });
                        }
                    }
                } else {
                    // Pago en BS - solo actualizar remaining y status
                    const nuevoRestante = Number(findInvoice.remaining) - payDetail.amount;
                    const statusInvoice = nuevoRestante <= 2 ? 'Pagado' : 'Pendiente';

                    await this.prismaService.invoice.update({
                        where: { id: findInvoice.id },
                        data: {
                            remaining: nuevoRestante,
                            status: statusInvoice
                        }
                    });

                    // Si la factura queda pagada, eliminar recordatorio del cliente
                    if (statusInvoice === 'Pagado') {
                        const findClientReminder = await this.prismaService.clientReminder.findFirst({
                            where: { clientId: findInvoice.clientId }
                        });

                        if (findClientReminder) {
                            await this.prismaService.clientReminder.delete({
                                where: { id: findClientReminder.id }
                            });
                        }
                    }
                }

                // Crear el registro de pago
                await this.prismaService.invoicePayment.create({
                    data: {
                        invoiceId: findInvoice.id,
                        paymentId: findPayment.id,
                        amount: payDetail.amount
                    }
                });

                const calculateRemaining = findPayment.account.method.currency === 'BS'
                    ? Number(payDetail.amount) * Number(findPayment.dolar.dolar)
                    : Number(payDetail.amount);

                // Actualizar el remaining del pago
                await this.prismaService.payment.update({
                    where: { id: findPayment.id },
                    data: {
                        remaining: {
                            decrement: calculateRemaining
                        }
                    }
                });
            }

            baseResponse.message = 'Pago asociado a factura exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async payDisassociate(pay: PayDisassociateDTO) {
        try {
            const findPaymentAssociate = await this.prismaService.invoicePayment.findFirst({
                where: { id: pay.id }
            });

            if (!findPaymentAssociate) {
                throw new Error(`No se encontró la asociación de pago con ID ${pay.id}`);
            }

            await this.prismaService.invoice.update({
                data: {
                    remaining: { increment: findPaymentAssociate.amount },
                    status: 'Pendiente'
                },
                where: { id: pay.invoiceId }
            });

            const findPayment = await this.prismaService.payment.findFirst({
                where: { id: pay.paymentId },
                include: { account: { include: { method: true } }, dolar: true }
            });

            const calculateRemaining = findPayment.account.method.currency == 'BS'
                ? Number(findPaymentAssociate.amount) * Number(findPayment.dolar.dolar)
                : Number(findPayment.amount);

            await this.prismaService.payment.update({
                data: { remaining: { increment: calculateRemaining } },
                where: { id: findPayment.id }
            });

            await this.prismaService.invoicePayment.delete({
                where: { id: pay.id }
            });

            baseResponse.message = `Pago Desasociado de factura exitosamente.`
            return baseResponse
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async saveDataExcelPaymentsLocal(payments: PaymentParseExcel[]) {

    }

    async deletePayment(id: number) {
        try {
            const findPaymentAssociate = await this.prismaService.invoicePayment.findFirst({
                where: { paymentId: id }
            })

            if (findPaymentAssociate) {
                await this.prismaService.invoice.update({
                    data: {
                        remaining: { increment: findPaymentAssociate.amount },
                        status: 'Pendiente'
                    },
                    where: { id: findPaymentAssociate.invoiceId }
                })
                await this.prismaService.invoicePayment.delete({
                    where: { id: findPaymentAssociate.id }
                })
            }
            await this.prismaService.payment.delete({
                where: { id }
            })
            baseResponse.message = 'Pago eliminado exitosamente';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async deleteAccountsPayments(id: number) {
        try {
            await this.prismaService.accountsPayments.delete({
                where: { id }
            })
            baseResponse.message = 'Cuenta eliminada exitosamente';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async validateAssociatedPaymentsInvoices() {
        try {
            let invoicesAffected = 0;
            let invoicesAffectedData = [];
            let messages = [];
            // Obtener todas las facturas con sus pagos
            const allInvoices = await this.prismaService.invoice.findMany({
                include: {
                    InvoicePayment: true,
                },
                where: {
                    status: {
                        notIn: ['Pagado', 'Cancelada', 'Creada']
                    }
                }
            });

            for (const invoice of allInvoices) {
                // Sumar los montos pagados
                const totalPaid = invoice.InvoicePayment.reduce((sum, payment) => {
                    return sum + Number(payment.amount);
                }, 0);

                // Calcular lo que queda por pagar
                const remaining = Number(invoice.totalAmount) - totalPaid;
                if (remaining < 0) {
                    messages.push(`Factura #${invoice.controlNumber} tiene un saldo negativo: ${remaining}`);
                    continue; // O manejar el error de otra manera
                }
                // Determinar nuevo estado
                const newStatus = remaining === 0 ? 'Pagado' : 'Pendiente';

                // Verificar si hay cambios necesarios
                if (Number(invoice.remaining) !== remaining || invoice.status !== newStatus) {
                    invoicesAffected++;
                    invoicesAffectedData.push(invoice)
                    await this.prismaService.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            remaining: remaining,
                            status: newStatus,
                        },
                    });
                }
            }

            console.log('Validación de facturas completada exitosamente.');
            // baseResponse.data = { invoices: invoicesAffectedData, message: messages };
            baseResponse.message = `Se actualizaron ${invoicesAffected} facturas.`;
            return baseResponse;
        } catch (error) {
            console.error('Error al validar facturas:', error);
            throw new Error('No se pudo completar la validación de facturas');
        }
    }

    async saveDataExcelPaymentsNew(payments: PaymentParseExcel[]) {
        const accounts = await this.prismaService.accountsPayments.findMany();
        const dolarHistory = await this.prismaService.historyDolar.findMany();
        const invoicesDB = await this.prismaService.invoice.findMany();
        const dolarBase = await this.productService.getDolar();
        // const dolarData = payments.map(item => {
        //     return {
        //         dolar: item.dolar,
        //         date: item.date
        //     }
        // })

        // const removeDolarDuplicate: DolarData[] = this.removeDuplicateDolarEntries(dolarData)

        // return await this.saveDolarHistory(removeDolarDuplicate);
        try {
            payments.map(async (item) => {
                let findAccount;
                const normalizeBank = item.bank ? item.bank.toString().toLowerCase().trim() : ''
                const findDolar = dolarHistory.find(data => Number(data.dolar).toFixed(2) == Number(item.dolar).toFixed(2));

                switch (normalizeBank) {
                    case 'bnscfrancs':
                        findAccount = accounts.find(data => data.bank == 'Banesco' && data.name == 'Francisco')
                        break;
                    case 'bnc':
                        findAccount = accounts.find(data => data.bank == 'BNC' && data.name == 'Adriani')
                        break;
                    case 'bncant':
                        findAccount = accounts.find(data => data.bank == 'BNC' && data.name == 'Antonio')
                        break;
                    case 'bnscjose':
                        findAccount = accounts.find(data => data.bank == 'Banesco' && data.name == 'Jose')
                        break;
                    case 'divisa':
                        findAccount = accounts.find(data => data.bank == 'Divisa' && data.name == 'Adriani')
                        break;
                    case 'bolivares':
                        findAccount = accounts.find(data => data.bank == 'Divisa Bs' && data.name == 'Adriani')
                        break;
                    case 'mercantil':
                        findAccount = accounts.find(data => data.bank == 'Mercantil' && data.name == 'Adriani')
                        break;
                    case 'provincial':
                        findAccount = accounts.find(data => data.bank == 'Provincial' && data.name == 'Adriani')
                        break;
                    case 'venezuela':
                        findAccount = accounts.find(data => data.bank == 'Venezuela' && data.name == 'Adriani')
                        break;
                    case 'vnzlfrancs':
                        findAccount = accounts.find(data => data.bank == 'Venezuela' && data.name == 'Francisco')
                        break;
                    case 'zelle':
                        findAccount = accounts.find(data => data.bank == 'Zelle' && data.name == 'Adriani')
                        break;
                    default:
                        findAccount = {
                            id: 13,
                            method: {
                                currency: 'USD'
                            }
                        }
                }

                if (!item.controlNumber) {
                    return;
                }
                const findInvoices = invoicesDB.find(data => data.controlNumber === item.controlNumber.toString().padStart(4, '0'))

                if (!findInvoices) {
                    return;
                }

                const savePayments = await this.prismaService.payment.create({
                    data: {
                        amount: item.amount ? item.amount : item.total,
                        remaining: item.amount ? item.amount : item.total,
                        reference: item.reference ? item.reference.toString() : '',
                        accountId: findAccount.id,
                        dolarId: findDolar ? findDolar.id : dolarBase.id,
                        status: 'CONFIRMED' as PaymentStatus,
                        paymentDate: new Date(item.date),
                    }
                })

                const associate = await this.prismaService.invoicePayment.create({
                    data: {
                        invoiceId: findInvoices.id,
                        paymentId: savePayments.id,
                        amount: savePayments.amount
                    }
                })

                const setStatus = Number(findInvoices.totalAmount).toFixed(2) == Number(findAccount.method.currency === 'USD' ? savePayments.amount : Number(savePayments.amount) / Number(findDolar.dolar)).toFixed(2) ? 'Pagado' : 'Pendiente'

                await this.prismaService.invoice.update({
                    data: { status: setStatus },
                    where: { id: associate.invoiceId }
                })
            })


            baseResponse.message = 'Pagos, dolar y asociación guardados exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async saveDataExcelPaymentsAssociate(payments: PaymentParseExcel[]) {
        const accounts = await this.prismaService.accountsPayments.findMany();
        const dolarHistory = await this.prismaService.historyDolar.findMany();
        const invoicesDB = await this.prismaService.invoice.findMany();
        const paymentsDB = await this.prismaService.payment.findMany();
        const paymentsBsDB = await this.prismaService.payment.findMany({ where: { account: { method: { currency: 'BS' } } } });

        const paymentsData = payments.map(item => {
            let findAccount;
            const normalizeBank = item.bank.toLowerCase().trim()
            const findDolar = dolarHistory.find(data => Number(data.dolar).toFixed(2) == Number(item.dolar).toFixed(2));
            const findInvoices = invoicesDB.find(data => data.controlNumber === item.controlNumber.toString().padStart(4, '0'))

            switch (normalizeBank) {
                case 'bnscfrancs':
                    findAccount = accounts.find(data => data.bank == 'Banesco' && data.name == 'Francisco')
                    break;
                case 'bnc':
                    findAccount = accounts.find(data => data.bank == 'BNC' && data.name == 'Adriani')
                    break;
                case 'bncant':
                    findAccount = accounts.find(data => data.bank == 'BNC' && data.name == 'Antonio')
                    break;
                case 'bnscjose':
                    findAccount = accounts.find(data => data.bank == 'Banesco' && data.name == 'Jose')
                    break;
                case 'divisa':
                    findAccount = accounts.find(data => data.bank == 'Divisa' && data.name == 'Adriani')
                    break;
                case 'bolivares':
                    findAccount = accounts.find(data => data.bank == 'Divisa Bs' && data.name == 'Adriani')
                    break;
                case 'mercantil':
                    findAccount = accounts.find(data => data.bank == 'Mercantil' && data.name == 'Adriani')
                    break;
                case 'provincial':
                    findAccount = accounts.find(data => data.bank == 'Provincial' && data.name == 'Adriani')
                    break;
                case 'venezuela':
                    findAccount = accounts.find(data => data.bank == 'Venezuela' && data.name == 'Adriani')
                    break;
                case 'vnzlfrancs':
                    findAccount = accounts.find(data => data.bank == 'Venezuela' && data.name == 'Francisco')
                    break;
                case 'zelle':
                    findAccount = accounts.find(data => data.bank == 'Zelle' && data.name == 'Adriani')
                    break;
                default:
                    findAccount = { id: 13 }
            }

            if (!findInvoices) {
                console.log(`No se encontro factura ${item.controlNumber.toString().padStart(4, '0')}, total: ${item.amount}`);
                return;
            }

            const parseAmountPay = Number(item.amount ? (item.amount / Number(findDolar.dolar)) : item.total).toFixed(2);

            const findPayments = paymentsDB.find(data =>
                data.accountId == findAccount.id &&
                data.dolarId == findDolar.id &&
                data.paymentDate == new Date(item.date) &&
                Number(findAccount.method.currency == 'USD' ? data.amount : (Number(data.amount) * Number(findDolar.dolar)).toFixed(2) == parseAmountPay)
            )

            const findPaymentsBs = paymentsBsDB.find(data => data.reference == item.reference)

            const selectedPayment = findPaymentsBs || findPayments;

            if (!selectedPayment) {
                const dataFilter = {
                    accounts: findAccount.id,
                    dolar: findDolar?.id,
                    date: new Date(item.date),
                    amount: item.amount,
                    amountParse: parseAmountPay,
                    other: findPaymentsBs,
                };
                console.log(dataFilter);

                throw new Error(`No se encontró el pago para la factura #${item.controlNumber}`);
            }

            if (!findDolar) console.warn('❌ Dólar no encontrado:', item.dolar);
            if (!findInvoices) console.warn('❌ Factura no encontrada:', item.controlNumber);
            if (!findPayments && !findPaymentsBs) console.warn('❌ Pago no encontrado:', item);


            return {
                invoiceId: findInvoices.id,
                paymentId: selectedPayment.id,
                amount: selectedPayment.amount,
                status: Number(findInvoices.totalAmount).toFixed(2) === Number(findPayments.amount).toFixed(2) ? 'Pagada' : 'Pendiente'
            }
        })

        try {
            await this.prismaService.invoicePayment.createMany({
                data: paymentsData
            })

            paymentsData.filter(item => item != null).map(async (data) => {
                await this.prismaService.invoice.update({
                    data: { status: data.status as InvoiceStatus },
                    where: { id: data.invoiceId }
                })
            })

            baseResponse.message = 'Pagos asociación guardados exitosamente.';
            return baseResponse;
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
                reference: pay.reference ? pay.reference : ''
            }
        });

        const methodPaymentsDB = await this.prismaService.paymentMethod.findMany();
        const historyDolarDB = await this.prismaService.historyDolar.findMany();
        const invoicesDB = await this.prismaService.invoice.findMany();
        const paymentsDB = await this.prismaService.payment.findMany();
        const paymentsInvoiceDB = await this.prismaService.invoicePayment.findMany({
            include: {
                invoice: true,
                payment: true
            }
        });
        try {
            // const savePayments = dataPayments.map((data) => {
            //     const findDolar = historyDolarDB.find(item => Number(item.dolar).toFixed(2) === Number(data.dolar).toFixed(2));
            //     const pagoMovil = methodPaymentsDB.find(item => item.name === 'Pago Movil');
            //     const Efectivo = methodPaymentsDB.find(item => item.name === 'Efectivo Bs');

            //     const methodPayments = data.bank === 'Bolivares' ? Efectivo?.id : pagoMovil?.id;

            //     if (!pagoMovil || !Efectivo) {
            //         throw new Error(`Metodo de pago no encontrado para la factura ${data.controlNumber}`)
            //     }
            //     if (!findDolar) {
            //         throw new Error(`Tasa de dolar no encontrada para pago ${data.reference} - factura: ${data.controlNumber}`)
            //     }
            //     return {
            //         amount: data.amount,
            //         bank: data.bank,
            //         currency: 'BS' as Currency,
            //         reference: data.reference ? data.reference.toString() : '',
            //         paymentDate: data.date,
            //         status: 'CONFIRMED' as PaymentStatus,
            //         dolarId: findDolar.id,
            //         methodId: methodPayments
            //     }
            // });

            // const savePaymentInvoices = dataPayments.map(data => {
            //     const findInvoice = invoicesDB.find(item => item.controlNumber == data.controlNumber);

            //     if(data.reference == '' ){
            //         return 
            //     }
            //     const findPayment = paymentsDB.filter(pay => pay.reference != null || pay.reference != '').find(item => item.reference == data.reference);
            //     const totalPayInvoice = Number(data.amount / data.dolar).toFixed(2);

            //     if(!findInvoice) {
            //         return 
            //     }
            //     if(!findPayment) {
            //         throw new Error(`No se encontro el pago con referencia ${data.reference}`)
            //     }
            //     return {
            //         invoiceId: findInvoice.id,
            //         paymentId: findPayment.id,
            //         amount: totalPayInvoice
            //     }
            // })

            const updatePaymentsInvoices = dataPayments.map(data => {
                const totalPayInvoice = Number(data.amount / data.dolar).toFixed(2);
                const findInvoice = invoicesDB.find(item => item.controlNumber == data.controlNumber);
                const findPayment = paymentsDB.filter(pay => pay.reference != null || pay.reference != '').find(item => item.reference == data.reference);

                if (!findInvoice) {
                    return null
                }
                const setStatusInvoice = Number(totalPayInvoice) === Number(findInvoice.totalAmount)
                    ? 'Pagado'
                    : 'Pendiente';

                return {
                    invoiceId: findInvoice.id,
                    paymentId: findPayment.id,
                    status: setStatusInvoice
                }
            })

            updatePaymentsInvoices.filter(item => item != null).map(async (data) => {
                await this.prismaService.invoice.update({
                    data: { status: data.status as InvoiceStatus },
                    where: { id: data.invoiceId }
                })
            })
            baseResponse.message = 'Pagos, dolar y asociación guardados exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async saveDolarHistory(dolarData: DolarData[]) {
        try {
            await this.prismaService.historyDolar.createMany({
                data: dolarData
            });

            baseResponse.message = 'Historial del dolar cargado';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message
            return badResponse;
        }
    }

    removeDuplicateDolarEntries(data: DolarData[]): DolarData[] {
        const map = new Map<number, DolarData>();

        for (const item of data) {
            const current = map.get(item.dolar);
            const currentDate = current ? new Date(current.date) : null;
            const newDate = new Date(item.date);

            // Si no existe o si esta fecha es más reciente
            if (!current || newDate > currentDate) {
                map.set(item.dolar, item);
            }
        }

        return Array.from(map.values());
    }
}


interface DolarData {
    dolar: number;
    date: Date; // o Date, si ya está parseado
}