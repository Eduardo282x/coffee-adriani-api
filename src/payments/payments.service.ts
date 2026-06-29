import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountsDTO, PayDisassociateDTO, PayInvoiceDTO, PaymentDTO, PaymentEnterpriseDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import { PaymentParseExcel } from 'src/excel/excel.interfaces';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';
import { calculateInvoiceRemainingUsd, calculatePaymentRemaining } from 'src/common/remaining-calculator';
import { InvoicesService } from 'src/invoices/invoices.service';

// Añadir estos métodos al PaymentsService existente

interface DolarData {
    dolar: number;
    date: Date; // o Date, si ya está parseado
}

interface PaymentFilterPaginate extends PaymentFilter {
    page: number;
    limit: number;
}

interface PaymentFilter {
    startDate?: string;
    endDate?: string;
    accountId?: number;
    methodId?: number;
    associated?: boolean;
    type?: string;
    typeDescription?: string;
    search?: string;
    credit?: 'credit' | 'noCredit';
}

interface EnterpriseFilter {
    startDate?: string;
    endDate?: string;
    type?: string;
    controlNumber?: string;
}

interface PaymentEnterpriseFilter extends EnterpriseFilter {
    page: number;
    limit: number;
}

@Injectable()
export class PaymentsService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService,
        private readonly invoicesService: InvoicesService,
    ) { }

    private getStartOfDayUtc(date: string) {
        return new Date(`${date}T00:00:00.000Z`);
    }

    private getEndOfDayUtc(date: string) {
        return new Date(`${date}T23:59:59.999Z`);
    }

    // NUEVOS MÉTODOS OPTIMIZADOS EN PaymentsService

    async getPaymentsPaginated(filters: PaymentFilterPaginate) {
        try {
            const { page, limit, startDate, endDate, accountId, methodId, associated, type, typeDescription, credit, search } = filters;
            const skip = (page - 1) * limit;

            // Construir where clause dinámicamente
            const where: any = {};

            if (startDate && endDate) {
                where.paymentDate = {
                    gte: this.getStartOfDayUtc(startDate),
                    lte: this.getEndOfDayUtc(endDate)
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
                } else {
                    where.InvoicePayment = {
                        none: {}
                    }
                }
            }

            if (type) {
                where.OR = [
                    {
                        InvoicePayment: {
                            none: {}
                        }
                    },
                    {
                        InvoicePayment: {
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
                ]
            }

            if (search) {
                const searchAsNumber = parseFloat(search);
                const isValidNumber = !isNaN(searchAsNumber);

                where.OR = [
                    {
                        account: {
                            name: {
                                contains: search,
                                mode: 'insensitive'
                            }
                        }
                    },
                    {
                        InvoicePayment: {
                            some: {
                                invoice: {
                                    client: {
                                        name: {
                                            contains: search,
                                            mode: 'insensitive'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        reference: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    },
                    ...(isValidNumber ? [{
                        amount: {
                            gte: searchAsNumber,
                            lt: searchAsNumber + 1
                        }
                    }] : [])
                ]
            }

            if (typeDescription) {
                where.description = {
                    contains: typeDescription,
                    mode: 'insensitive'
                };
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

            // Consulta principal con paginación
            const [payments, totalCount] = await Promise.all([
                this.prismaService.payment.findMany({
                    select: {
                        id: true,
                        amount: true,
                        reference: true,
                        description: true,
                        paymentDate: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        accountId: true,
                        dolar: {
                            select: {
                                id: true,
                                dolar: true,
                                date: true
                            }
                        },
                        account: {
                            select: {
                                id: true,
                                name: true,
                                bank: true,
                                method: {
                                    select: {
                                        id: true,
                                        name: true,
                                        currency: true
                                    }
                                }
                            }
                        },
                        InvoicePayment: {
                            // Si viene `type`, traer sólo las asociaciones cuyo invoice
                            // tenga items con productos de ese tipo.
                            where: type ? {
                                invoice: {
                                    invoiceItems: {
                                        some: {
                                            product: {
                                                type: type
                                            }
                                        }
                                    }
                                }
                            } : undefined,
                            select: {
                                id: true,
                                invoiceId: true,
                                paymentId: true,
                                amount: true,
                                createdAt: true,
                                invoice: {
                                    select: {
                                        id: true,
                                        controlNumber: true,
                                        dispatchDate: true,
                                        dueDate: true,
                                        totalAmount: true,
                                        consignment: true,
                                        status: true,
                                        deleted: true,
                                        client: {
                                            select: {
                                                id: true,
                                                name: true,
                                                rif: true,
                                                block: {
                                                    select: {
                                                        id: true,
                                                        name: true
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                    where,
                    orderBy: { paymentDate: 'desc' },
                    skip,
                    take: limit
                }),
                this.prismaService.payment.count({ where })
            ]);

            const processedPayments = payments.map(data => {
                // Nota: `InvoicePayment` ya viene filtrado por `type` desde Prisma.
                const filteredInvoicePayments = data.InvoicePayment
                const paymentBalance = calculatePaymentRemaining(
                    data.amount,
                    data.account.method.currency,
                    data.dolar.dolar,
                    filteredInvoicePayments
                );

                return {
                    ...data,
                    InvoicePayment: filteredInvoicePayments,
                    associated: filteredInvoicePayments.length > 0,
                    amount: data.amount.toFixed(2),
                    amountUSD: data.account.method.currency === 'USD'
                        ? data.amount.toFixed(2)
                        : (Number(data.amount) / Number(data.dolar.dolar)).toFixed(2),
                    amountBs: data.account.method.currency === 'BS'
                        ? data.amount.toFixed(2)
                        : (Number(data.amount) * Number(data.dolar.dolar)).toFixed(2),
                    remaining: paymentBalance.remainingOriginal.toFixed(2),
                    remainingUSD: paymentBalance.remainingUSD.toFixed(2),
                    credit: filteredInvoicePayments.length > 0 && paymentBalance.remainingOriginal > 0
                };
            });

            const filteredByCredit = credit === 'credit'
                ? processedPayments.filter(item => item.credit)
                : processedPayments;

            // Calcular paginación
            const totalPages = Math.ceil(filteredByCredit.length / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                payments: filteredByCredit,
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
            throw new Error(`Error al obtener pagos paginados: ${errMsg}`);
        }
    }

    async getPaymentsStatistics(filters: PaymentFilter) {
        try {
            const { startDate, endDate, accountId, methodId, associated, type, typeDescription, credit, search } = filters;

            // Construir where clause dinámicamente
            const where: any = {};

            if (startDate && endDate) {
                where.paymentDate = {
                    gte: this.getStartOfDayUtc(startDate),
                    lte: this.getEndOfDayUtc(endDate)
                };
            }

            if (credit) {
                if (credit == 'credit') {
                    where.InvoicePayment = {
                        some: {}
                    }
                } else {
                    where.InvoicePayment = {
                        none: {}
                    }
                }
            }

            if (type) {
                where.OR = [
                    {
                        InvoicePayment: {
                            none: {}
                        }
                    },
                    {
                        InvoicePayment: {
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
                ]
            }

            if (search) {
                const searchAsNumber = parseFloat(search);
                const isValidNumber = !isNaN(searchAsNumber);

                where.OR = [
                    {
                        account: {
                            name: {
                                contains: search,
                                mode: 'insensitive'
                            }
                        }
                    },
                    {
                        InvoicePayment: {
                            some: {
                                invoice: {
                                    client: {
                                        name: {
                                            contains: search,
                                            mode: 'insensitive'
                                        }
                                    }
                                }
                            }
                        }
                    },
                    {
                        reference: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    },
                    ...(isValidNumber ? [{
                        amount: {
                            gte: searchAsNumber,
                            lt: searchAsNumber + 1
                        }
                    }] : [])
                ]
            }
            if (typeDescription) {
                where.description = {
                    contains: typeDescription,
                    mode: 'insensitive'
                };
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
                    },
                    InvoicePayment: {
                        include: {
                            invoice: {
                                include: {
                                    client: { include: { block: true } },
                                    invoiceItems: { include: { product: true } }
                                }
                            }
                        }
                    }
                },
                where
            });

            // Si se proporcionó `type`, mantener sólo las InvoicePayment cuya
            // factura contiene productos de ese tipo. Esto evita contar/mostrar
            // facturas de otros tipos cuando un pago está asociado a varias.
            const processedPayments = payments.map(data => {
                const filteredInvoicePayments = type
                    ? data.InvoicePayment.filter((ip: any) =>
                        !!ip.invoice &&
                        Array.isArray(ip.invoice.invoiceItems) &&
                        ip.invoice.invoiceItems.some((ii: any) => ii.product?.type === type)
                    )
                    : data.InvoicePayment;
                return {
                    ...data,
                    InvoicePayment: filteredInvoicePayments
                } as any;
            });

            const processedPaymentsNotType = payments.map(data => {
                const filteredInvoicePayments = type
                    ? data.InvoicePayment.filter((ip: any) =>
                        !!ip.invoice &&
                        Array.isArray(ip.invoice.invoiceItems) &&
                        ip.invoice.invoiceItems.some((ii: any) => ii.product?.type !== type)
                    )
                    : data.InvoicePayment;
                return {
                    ...data,
                    InvoicePayment: filteredInvoicePayments
                } as any;
            });

            const paymentInvoiceWithType = payments.filter(data => data.InvoicePayment.some((ip: any) => !!ip.invoice && Array.isArray(ip.invoice.invoiceItems) && ip.invoice.invoiceItems.some((ii: any) => ii.product?.type === type)));
            const paymentInvoiceWithoutType = payments.filter(data => data.InvoicePayment.some((ip: any) => !!ip.invoice && Array.isArray(ip.invoice.invoiceItems) && ip.invoice.invoiceItems.every((ii: any) => ii.product?.type !== type)));
            const controlNumberInvoicesWihoutType = paymentInvoiceWithoutType.map(item => item.InvoicePayment.map(inv => inv.invoice.controlNumber)).flat();
            const sumInvoiceWithoutType = paymentInvoiceWithoutType.reduce((acc, data) => acc + Number(data.amount), 0);
            // console.log(`Facturas de tipo seleccionado: ${paymentInvoiceWithType.length}`);
            // console.log(`Facturas sin tipo seleccionado: ${paymentInvoiceWithoutType.length}`);
            // console.log(`Monto total de facturas sin tipo seleccionado: ${paymentInvoiceWithoutType.reduce((acc, data) => acc + Number(data.amount), 0)}`);
            // console.log(`Facturas sin tipo: ${[...new Set(controlNumberInvoicesWihoutType)].join(', ')}`);
            // console.log(`Suma de las facturas sin tipo: ${sumInvoiceWithoutType}`);



            const totalAmountBsNot = paymentInvoiceWithoutType
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + Number(data.amount), 0);

            const totalAmountBsInUSDNot = paymentInvoiceWithoutType
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + (Number(data.amount) / Number(data.dolar.dolar)), 0);

            // Calcular estadísticas
            const totalAmountBs = processedPayments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + Number(data.amount), 0);

            const totalAmountBsInUSD = processedPayments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + (Number(data.amount) / Number(data.dolar.dolar)), 0);

            const valores = {
                originals: {
                    totalAmountBs,
                    totalAmountBsInUSD
                },
                alter: {
                    totalAmountBs: totalAmountBsNot,
                    totalAmountBsInUSD: totalAmountBsInUSDNot
                }
            }

            const totalAmountUSD = processedPayments
                .filter(item => item.account.method.currency === 'USD')
                .reduce((acc, data) => acc + Number(data.amount), 0);

            const totalRemainingBs = processedPayments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal, 0);

            const totalRemainingBsInUSD = processedPayments
                .filter(item => item.account.method.currency === 'BS')
                .reduce((acc, data) => acc + calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingUSD, 0);

            const totalRemainingUSD = processedPayments
                .filter(item => item.account.method.currency === 'USD')
                .reduce((acc, data) => acc + calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal, 0);

            const totalGrossUSD = totalAmountBsInUSD + totalAmountUSD;

            // Si viene `type`, restar del total los montos asignados a facturas
            // que NO tengan el tipo solicitado.
            const otherTypeAllocatedUSD = type
                ? payments.reduce((acc, payment: any) => {
                    const invoicePayments = Array.isArray(payment.InvoicePayment) ? payment.InvoicePayment : [];

                    const otherAssigned = invoicePayments.reduce((sum: number, ip: any) => {
                        const items = ip?.invoice?.invoiceItems;
                        const hasSelectedType = Array.isArray(items)
                            && items.some((ii: any) => ii?.product?.type === type);

                        // Considerar "otros tipos" sólo si la factura NO tiene
                        // ningún item del tipo seleccionado.
                        if (!hasSelectedType) {
                            return sum + Number(ip.amount);
                        }

                        return sum;
                    }, 0);

                    const otherAssignedUSD = payment.account?.method?.currency === 'USD'
                        ? otherAssigned
                        : (otherAssigned / Number(payment.dolar?.dolar));

                    return acc + otherAssignedUSD;
                }, 0)
                : 0;

            const totalNetUSD = type
                ? (totalGrossUSD - otherTypeAllocatedUSD)
                : totalGrossUSD;

            // Contar asociados/no asociados a partir de los pagos procesados
            const associatedPayments = processedPayments.filter(p => p.InvoicePayment && p.InvoicePayment.length > 0).length;
            const unassociatedPayments = processedPayments.filter(p => !p.InvoicePayment || p.InvoicePayment.length === 0).length;

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
                    total: totalNetUSD,
                    remaining: totalRemainingBsInUSD + totalRemainingUSD,
                    totalRemainingBs,
                    totalRemainingUSD
                },
                counts: {
                    total: payments.length,
                    associated: associatedPayments,
                    unassociated: unassociatedPayments
                },
                byMethod: methodStatistics,
                valores: valores,
                paymentInvoiceWithoutType: paymentInvoiceWithoutType
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener estadísticas de pagos: ${errMsg}`);
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
                remaining: calculatePaymentRemaining(payment.amount, payment.account.method.currency, payment.dolar.dolar, payment.InvoicePayment).remainingOriginal.toFixed(2),
                remainingUSD: calculatePaymentRemaining(payment.amount, payment.account.method.currency, payment.dolar.dolar, payment.InvoicePayment).remainingUSD.toFixed(2),
                credit: payment.InvoicePayment.length > 0 && calculatePaymentRemaining(payment.amount, payment.account.method.currency, payment.dolar.dolar, payment.InvoicePayment).remainingOriginal > 0
            };
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            throw new Error(`Error al obtener detalles del pago: ${errMsg}`);
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
                    remaining: calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal.toFixed(2),
                    remainingUSD: calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingUSD.toFixed(2),
                    credit: data.InvoicePayment.length > 0 && calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal > 0
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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
                    remaining: calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal.toFixed(2),
                    remainingUSD: calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingUSD.toFixed(2),
                    credit: data.InvoicePayment.length > 0 && calculatePaymentRemaining(data.amount, data.account.method.currency, data.dolar.dolar, data.InvoicePayment).remainingOriginal > 0
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
    async getTypeDescription() {
        return await this.prismaService.payment.groupBy({
            by: ['description'],
            where: {
                description: {
                    not: ''
                }
            }
        })
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
            const getDolar = await this.productService.getDolar();

            await this.prismaService.payment.create({
                data: {
                    amount: payment.amount,
                    reference: payment.reference,
                    dolarId: getDolar.id,
                    description: payment.description,
                    paymentDate: payment.paymentDate,
                    status: accountZelle.method.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    accountId: payment.accountId,
                }
            })

            baseResponse.message = 'Pago guardado correctamente';
            return baseResponse;
        }
        catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
                    reference: payment.reference,
                    dolarId: getDolar.id,
                    description: payment.description,
                    paymentDate: payment.paymentDate,
                    status: accountZelle.method.name !== 'Zelle' ? 'CONFIRMED' : 'PENDING',
                    accountId: payment.accountId,
                },
                where: { id }
            })

            baseResponse.message = 'Pago actualizado correctamente';
            return baseResponse;
        }
        catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
        catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async payInvoice(pay: PayInvoiceDTO) {
        try {
            const totalInvoices = pay.details.reduce((acc, payments) => acc + payments.amount, 0);

            const findPayment = await this.prismaService.payment.findFirst({
                where: { id: pay.paymentId },
                include: {
                    account: { include: { method: true } },
                    dolar: true,
                    InvoicePayment: {
                        select: { amount: true }
                    }
                }
            });

            if (!findPayment) {
                badResponse.message = 'Pago no encontrado.';
                return badResponse;
            }

            const paymentBalance = calculatePaymentRemaining(
                findPayment.amount,
                findPayment.account.method.currency,
                findPayment.dolar.dolar,
                findPayment.InvoicePayment
            );

            if (Number(totalInvoices) > paymentBalance.remainingUSD) {
                badResponse.message = 'La cantidad a pagar excede la cantidad del pago.';
                return badResponse;
            }

            let paymentUpdated;
            const paidInvoices: { id: number; clientId: number; controlNumber: string; totalAmount: number }[] = [];

            // Usar transacción Prisma para atomicidad
            await this.prismaService.$transaction(async (prisma) => {
                for (const payDetail of pay.details) {
                    const findInvoice = await prisma.invoice.findFirst({
                        where: { id: payDetail.invoiceId },
                        include: {
                            invoiceItems: true,
                            InvoicePayment: {
                                select: { amount: true }
                            }
                        }
                    });

                    if (!findInvoice) {
                        throw new Error(`Factura con ID ${payDetail.invoiceId} no encontrada.`);
                    }

                    const currentInvoiceRemaining = calculateInvoiceRemainingUsd(
                        findInvoice.totalAmount,
                        findInvoice.InvoicePayment
                    );

                    if (findInvoice.status === 'Pagado' || currentInvoiceRemaining <= 0) {
                        throw new Error(`La factura #${findInvoice.controlNumber} ya está pagada.`);
                    }

                    if (payDetail.amount > currentInvoiceRemaining) {
                        throw new Error(`El monto excede el saldo pendiente de la factura #${findInvoice.controlNumber}.`);
                    }

                    // Crear el registro de pago
                    await prisma.invoicePayment.create({
                        data: {
                            invoiceId: findInvoice.id,
                            paymentId: findPayment.id,
                            amount: payDetail.amount
                        }
                    });

                    const invoicePaymentsAfter = await prisma.invoicePayment.findMany({
                        where: { invoiceId: findInvoice.id },
                        select: { amount: true }
                    });

                    const remainingAfter = calculateInvoiceRemainingUsd(
                        findInvoice.totalAmount,
                        invoicePaymentsAfter
                    );

                    const statusInvoice: InvoiceStatus = remainingAfter <= 2 ? 'Pagado' : 'Pendiente';

                    await prisma.invoice.update({
                        where: { id: findInvoice.id },
                        data: {
                            status: statusInvoice
                        }
                    });

                    if (statusInvoice === 'Pagado') {
                        const findClientReminder = await prisma.clientReminder.findFirst({
                            where: { clientId: findInvoice.clientId }
                        });
                        if (findClientReminder) {
                            await prisma.clientReminder.delete({ where: { id: findClientReminder.id } });
                        }
                        paidInvoices.push({
                            id: findInvoice.id,
                            clientId: findInvoice.clientId,
                            controlNumber: findInvoice.controlNumber,
                            totalAmount: Number(findInvoice.totalAmount),
                        });
                    }
                }

                paymentUpdated = await prisma.payment.findUnique({
                    where: { id: findPayment.id },
                    select: {
                        id: true,
                        amount: true,
                        reference: true,
                        description: true,
                        paymentDate: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        accountId: true,
                        dolar: {
                            select: {
                                id: true,
                                dolar: true,
                                date: true
                            }
                        },
                        account: {
                            select: {
                                id: true,
                                name: true,
                                bank: true,
                                method: {
                                    select: {
                                        id: true,
                                        name: true,
                                        currency: true
                                    }
                                }
                            }
                        },
                        InvoicePayment: {
                            select: {
                                id: true,
                                invoiceId: true,
                                paymentId: true,
                                amount: true,
                                createdAt: true,
                                invoice: {
                                    select: {
                                        id: true,
                                        controlNumber: true,
                                        dispatchDate: true,
                                        dueDate: true,
                                        totalAmount: true,
                                        consignment: true,
                                        status: true,
                                        deleted: true,
                                        InvoicePayment: {
                                            select: { amount: true }
                                        },
                                        client: {
                                            select: {
                                                id: true,
                                                name: true,
                                                rif: true,
                                                block: {
                                                    select: {
                                                        id: true,
                                                        name: true
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    },
                })
            });

            for (const invoice of paidInvoices) {
                this.invoicesService.notifyInvoiceCreated(
                    invoice.id,
                    invoice.clientId,
                    invoice.controlNumber,
                    invoice.totalAmount,
                );
            }

            const paymentUpdatedParse = paymentUpdated ? {
                ...paymentUpdated,
                remaining: calculatePaymentRemaining(
                    paymentUpdated.amount,
                    paymentUpdated.account.method.currency,
                    paymentUpdated.dolar.dolar,
                    paymentUpdated.InvoicePayment
                ).remainingOriginal.toFixed(2),
                remainingUSD: calculatePaymentRemaining(
                    paymentUpdated.amount,
                    paymentUpdated.account.method.currency,
                    paymentUpdated.dolar.dolar,
                    paymentUpdated.InvoicePayment
                ).remainingUSD.toFixed(2),
                InvoicePayment: paymentUpdated.InvoicePayment.map(item => ({
                    ...item,
                    invoice: {
                        ...item.invoice,
                        remaining: calculateInvoiceRemainingUsd(item.invoice.totalAmount, item.invoice.InvoicePayment).toFixed(2)
                    }
                }))
            } : null;

            baseResponse.message = 'Pago asociado a factura exitosamente.';
            baseResponse.data = paymentUpdatedParse;
            return baseResponse;
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            badResponse.message = errMsg;
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

            await this.prismaService.invoicePayment.delete({
                where: { id: pay.id }
            });

            const invoiceAfter = await this.prismaService.invoice.findUnique({
                where: { id: pay.invoiceId },
                include: {
                    InvoicePayment: {
                        select: { amount: true }
                    }
                }
            });

            if (invoiceAfter) {
                const remaining = calculateInvoiceRemainingUsd(
                    invoiceAfter.totalAmount,
                    invoiceAfter.InvoicePayment
                );

                await this.prismaService.invoice.update({
                    where: { id: invoiceAfter.id },
                    data: {
                        status: remaining <= 2 ? 'Pagado' : 'Pendiente'
                    }
                });
            }

            baseResponse.message = `Pago Desasociado de factura exitosamente.`
            return baseResponse
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async deletePayment(id: number) {
        try {
            const findPaymentAssociate = await this.prismaService.invoicePayment.findMany({
                where: { paymentId: id }
            })

            if (findPaymentAssociate.length > 0) {
                const invoiceIds = [...new Set(findPaymentAssociate.map(item => item.invoiceId))];

                await this.prismaService.invoicePayment.deleteMany({
                    where: { paymentId: id }
                });

                for (const invoiceId of invoiceIds) {
                    const invoice = await this.prismaService.invoice.findUnique({
                        where: { id: invoiceId },
                        include: {
                            InvoicePayment: {
                                select: { amount: true }
                            }
                        }
                    });

                    if (!invoice) {
                        continue;
                    }

                    const remaining = calculateInvoiceRemainingUsd(invoice.totalAmount, invoice.InvoicePayment);
                    await this.prismaService.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            status: remaining <= 2 ? 'Pagado' : 'Pendiente'
                        }
                    });
                }
            }

            await this.prismaService.payment.delete({
                where: { id }
            })
            baseResponse.message = 'Pago eliminado exitosamente';
            return baseResponse;
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            badResponse.message = errMsg;
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
        } catch (err: unknown) {
            const errMsg = err instanceof Error ? err.message : String(err);
            badResponse.message = errMsg;
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
                if (invoice.status !== newStatus) {
                    invoicesAffected++;
                    invoicesAffectedData.push(invoice)
                    await this.prismaService.invoice.update({
                        where: { id: invoice.id },
                        data: {
                            status: newStatus,
                        },
                    });
                }
            }

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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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

        const invoicesDB = await this.prismaService.invoice.findMany();
        const paymentsDB = await this.prismaService.payment.findMany();

        try {
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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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
        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
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

    async getPaymentsEnterprise({ page, limit, startDate, endDate, controlNumber, type }: PaymentEnterpriseFilter) {
        try {
            const skip = (page - 1) * limit;

            const where: any = {};

            if (startDate && endDate) {
                where.paymentDate = {
                    gte: this.getStartOfDayUtc(startDate),
                    lte: this.getEndOfDayUtc(endDate)
                };
            }
            if (controlNumber) {
                where.controlNumber = controlNumber;
            }
            if (type) {
                where.items = {
                    some: {
                        product: {
                            type: type
                        }
                    }
                }
            }

            const [paymentEnterprise, totalCount] = await Promise.all([
                this.prismaService.paymentEnterprise.findMany({
                    where,
                    skip,
                    take: limit,
                    include: {
                        dolar: true,
                        items: {
                            include: {
                                product: {
                                    select: {
                                        id: true,
                                        name: true,
                                        presentation: true,
                                        type: true,
                                    }
                                }
                            }
                        }
                    }
                }).then(data => data.map(item => ({
                    ...item,
                    quantity: item.items.reduce((acc, curr) => acc + Number(curr.quantity), 0),
                    dolar: Number(item.dolar.dolar).toFixed(2),
                    amount: Number(item.amount).toFixed(2),
                    total: item.currency === 'BS' ? Number(Number(item.amount) / Number(item.dolar.dolar)).toFixed(2) : Number(item.amount).toFixed(2)
                }))),
                this.prismaService.paymentEnterprise.count({ where })
            ])

            const totalPages = Math.ceil(totalCount / limit);
            const hasNext = page < totalPages;
            const hasPrev = page > 1;

            return {
                paymentEnterprise: paymentEnterprise,
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
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async createPaymentsEnterprise(paymentEnterpriseData: PaymentEnterpriseDTO) {
        try {
            const getDolar = await this.productService.getDolar();

            const paymentEnterprise = await this.prismaService.paymentEnterprise.create({
                data: {
                    amount: paymentEnterpriseData.amount,
                    paymentDate: paymentEnterpriseData.paymentDate,
                    currency: paymentEnterpriseData.currency,
                    controlNumber: paymentEnterpriseData.controlNumber,
                    description: paymentEnterpriseData.description,
                    dolarId: getDolar.id,
                }
            });

            const items = paymentEnterpriseData.items.map((item) => {
                return {
                    ...item,
                    paymentEnterpriseId: paymentEnterprise.id,
                }
            });

            await this.prismaService.paymentEnterpriseItems.createMany({
                data: items
            });

            baseResponse.message = 'Pago empresarial guardado exitosamente.';
            return baseResponse;

        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }

    async updatePaymentsEnterprise(id: number, paymentEnterpriseData: PaymentEnterpriseDTO) {
        try {
            const getDolar = await this.productService.getDolar();
            await this.prismaService.paymentEnterprise.update({
                where: { id },
                data: {
                    amount: paymentEnterpriseData.amount,
                    paymentDate: paymentEnterpriseData.paymentDate,
                    currency: paymentEnterpriseData.currency,
                    controlNumber: paymentEnterpriseData.controlNumber,
                    description: paymentEnterpriseData.description,
                    dolarId: getDolar.id,
                }
            });

            await this.prismaService.paymentEnterpriseItems.deleteMany({
                where: {
                    paymentEnterpriseId: id
                }
            });

            const items = paymentEnterpriseData.items.map((item) => {
                return {
                    ...item,
                    paymentEnterpriseId: id,
                }
            });

            await this.prismaService.paymentEnterpriseItems.createMany({
                data: items
            });

            baseResponse.message = 'Pago empresarial actualizado exitosamente.';
            return baseResponse;

        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }


    async deletePaymentsEnterprise(id: number) {
        try {
            await this.prismaService.paymentEnterpriseItems.deleteMany({
                where: {
                    paymentEnterpriseId: id
                }
            });

            await this.prismaService.paymentEnterprise.delete({
                where: {
                    id: id
                }
            });

            baseResponse.message = 'Pago empresarial eliminado exitosamente.';
            return baseResponse;

        } catch (error: unknown) {
            const errMsg = error instanceof Error ? error.message : String(error);
            badResponse.message = errMsg;
            return badResponse;
        }
    }
}