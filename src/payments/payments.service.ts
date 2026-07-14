import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountsDTO, PayDisassociateDTO, PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import { calculateInvoiceRemainingUsd, calculatePaymentRemaining } from 'src/common/remaining-calculator';
import { InvoicesService } from 'src/invoices/invoices.service';
import { InvoiceStatus, PaymentStatus } from 'src/generated/prisma/enums';

interface PaymentInvoiceItem {
    amount: number | string;
}

interface PaymentUpdatedInvoicePayment {
    id: number;
    invoiceId: number;
    paymentId: number;
    amount: number;
    createdAt: Date;
    invoice: {
        id: number;
        controlNumber: string;
        totalAmount: number;
        status: string;
        clientId?: number;
        InvoicePayment: PaymentInvoiceItem[];
        client: {
            id: number;
            name: string;
            block: {
                id: number;
                name: string;
            } | null;
        } | null;
    } | null;
}

interface PaymentUpdatedData {
    InvoicePayment: PaymentUpdatedInvoicePayment[];
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
    accountType?: string;
    typeDescription?: string;
    search?: string;
    credit?: 'credit' | 'noCredit';
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
            const { page, limit, startDate, endDate, accountId, methodId, associated, type, typeDescription, accountType, credit, search } = filters;
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

            if (accountType) {
                where.account = {
                    ...where.account,
                    type: accountType
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
            const { startDate, endDate, accountId, methodId, associated, type, accountType, typeDescription, credit, search } = filters;

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

            if (accountType) {
                where.account = {
                    ...where.account,
                    type: accountType
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

            const [paymentsByMethod, accountsDetails] = await Promise.all([
                this.prismaService.payment.groupBy({
                    by: ['accountId'],
                    where,
                    _sum: { amount: true },
                    _count: { id: true }
                }),
                this.prismaService.accountsPayments.findMany({
                    include: { method: true }
                })
            ]);

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
                    methodId: account.methodId,
                    type: account.type || 'INCOME'
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
                    methodId: account.methodId,
                    type: account.type || 'INCOME'
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
            const [accountZelle, getDolar] = await Promise.all([
                this.prismaService.accountsPayments.findFirst({
                    where: { id: payment.accountId },
                    include: { method: true }
                }),
                this.productService.getDolar()
            ]);

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

            return { message: 'Pago guardado correctamente', success: true };
        }
        catch (error: unknown) {
            return { message: error instanceof Error ? error.message : String(error), success: false };
        }
    }

    async updatePayment(id: number, payment: PaymentDTO) {
        try {
            const [accountZelle, getDolar] = await Promise.all([
                this.prismaService.accountsPayments.findFirst({
                    where: { id: payment.accountId },
                    include: { method: true }
                }),
                this.productService.getDolar()
            ]);

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

            return { message: 'Pago actualizado correctamente', success: true };
        }
        catch (error: unknown) {
            return { message: error instanceof Error ? error.message : String(error), success: false };
        }
    }

    async updatePaymentZelle(id: number) {
        try {
            await this.prismaService.payment.update({
                data: { status: 'CONFIRMED' },
                where: { id }
            })

            return { message: 'Pago actualizado correctamente', success: true };
        }
        catch (error: unknown) {
            return { message: error instanceof Error ? error.message : String(error), success: false };
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

            const invoiceAfter = await this.prismaService.$transaction(async (tx) => {
                await tx.invoicePayment.delete({ where: { id: pay.id } });

                const invoice = await tx.invoice.findUnique({
                    where: { id: pay.invoiceId },
                    include: { InvoicePayment: { select: { amount: true } } }
                });

                if (invoice) {
                    const remaining = calculateInvoiceRemainingUsd(invoice.totalAmount, invoice.InvoicePayment);
                    await tx.invoice.update({
                        where: { id: invoice.id },
                        data: { status: remaining <= 2 ? 'Pagado' : 'Pendiente' }
                    });
                }

                return invoice;
            });

            return { message: 'Pago Desasociado de factura exitosamente.', success: true };
        } catch (err: unknown) {
            return { message: err instanceof Error ? err.message : String(err), success: false };
        }
    }

    async deletePayment(id: number) {
        try {
            const findPaymentAssociate = await this.prismaService.invoicePayment.findMany({
                where: { paymentId: id }
            })

            if (findPaymentAssociate.length > 0) {
                const invoiceIds = [...new Set(findPaymentAssociate.map(item => item.invoiceId))];

                const invoicesWithPayments = await this.prismaService.invoice.findMany({
                    where: { id: { in: invoiceIds } },
                    include: { InvoicePayment: { select: { amount: true } } }
                });

                const invoiceUpdates = invoicesWithPayments.map(invoice => {
                    const remaining = calculateInvoiceRemainingUsd(invoice.totalAmount, invoice.InvoicePayment);
                    return {
                        id: invoice.id,
                        status: (remaining <= 2 ? 'Pagado' : 'Pendiente') as InvoiceStatus
                    };
                });

                await this.prismaService.$transaction(async (tx) => {
                    await tx.invoicePayment.deleteMany({ where: { paymentId: id } });

                    for (const update of invoiceUpdates) {
                        await tx.invoice.update({
                            where: { id: update.id },
                            data: { status: update.status }
                        });
                    }
                });
            }

            await this.prismaService.payment.delete({ where: { id } });
            return { message: 'Pago eliminado exitosamente', success: true };
        } catch (err: unknown) {
            return { message: err instanceof Error ? err.message : String(err), success: false };
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
            const messages: string[] = [];

            const allInvoices = await this.prismaService.invoice.findMany({
                include: { InvoicePayment: true },
                where: {
                    status: { notIn: ['Pagado', 'Cancelada', 'Creada'] }
                }
            });

            const toUpdate: { id: number; status: InvoiceStatus }[] = [];

            for (const invoice of allInvoices) {
                const totalPaid = invoice.InvoicePayment.reduce((sum, payment) => sum + Number(payment.amount), 0);
                const remaining = Number(invoice.totalAmount) - totalPaid;

                if (remaining < 0) {
                    messages.push(`Factura #${invoice.controlNumber} tiene un saldo negativo: ${remaining}`);
                    continue;
                }

                const newStatus = (remaining === 0 ? 'Pagado' : 'Pendiente') as InvoiceStatus;
                if (invoice.status !== newStatus) {
                    toUpdate.push({ id: invoice.id, status: newStatus });
                    invoicesAffected++;
                }
            }

            if (toUpdate.length > 0) {
                await this.prismaService.$transaction(
                    toUpdate.map(u =>
                        this.prismaService.invoice.update({
                            where: { id: u.id },
                            data: { status: u.status }
                        })
                    )
                );
            }

            return { message: `Se actualizaron ${invoicesAffected} facturas.`, success: true };
        } catch (error) {
            throw new Error('No se pudo completar la validación de facturas');
        }
    }
}