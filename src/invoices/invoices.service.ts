import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTOBaseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { DetProducts, DTOInvoice, IInvoiceWithDetails, InvoiceStatistics, OptionalFilterInvoices, ResponseInvoice } from './invoice.dto';
import { ProductsService } from 'src/products/products.service';
import { InventoryService } from 'src/inventory/inventory.service';
import { ClientsService } from 'src/clients/clients.service';
import { ClientExcel, DetInvoiceDataExcel, ExcelTransformV2 } from 'src/excel/excel.interfaces';
import { InvoiceStatus } from '@prisma/client';
// import * as XLSX from 'xlsx';
import * as ExcelJS from 'exceljs';
import { addDays } from 'date-fns/addDays';
import { format } from 'date-fns/format';

@Injectable()
export class InvoicesService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService,
        private readonly inventoryService: InventoryService,
        private readonly clientService: ClientsService,
    ) {

    }

    async getInvoicesPaginated(
        page: number = 1,
        limit: number = 50,
        startDate?: string,
        endDate?: string,
        search?: string,
        blockId?: string,
        status?: string,
        filter?: OptionalFilterInvoices
    ) {
        try {
            const offset = (page - 1) * limit;
            const where: any = {};

            if (filter?.status || status) {
                const setStatusFilter = filter ? filter.status : status;
                if (status == 'Abonadas') {
                    where.OR = [
                        {
                            status: {
                                notIn: ['Cancelada', 'Pagado']
                            }
                        },
                    ];
                    where.AND = {
                        InvoicePayment: {
                            some: {}
                        }
                    };
                } else {
                    where.status = setStatusFilter as InvoiceStatus
                }
            }

            if (search) {
                where.OR = [
                    {
                        client: {
                            name: {
                                contains: search,
                                mode: 'insensitive'
                            }
                        }
                    },
                    {
                        controlNumber: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    }
                ]
            }
            if (blockId) {
                where.client = {
                    blockId: Number(blockId)
                };
            }

            if (startDate && endDate) {
                where.dispatchDate = {
                    gte: new Date(startDate),
                    lte: new Date(endDate)
                }
            }

            // Consulta optimizada con menos includes iniciales
            const [invoices, totalCount] = await Promise.all([
                this.prismaService.invoice.findMany({
                    include: {
                        client: {
                            include: { block: true }
                        }
                    },
                    orderBy: {
                        dispatchDate: 'desc'
                    },
                    where,
                    skip: offset,
                    take: limit,
                }),
                this.prismaService.invoice.count({ where })
            ]);

            // Formatear datos
            const formattedInvoices = invoices.map(invoice => ({
                ...invoice,
                totalAmount: invoice.totalAmount.toFixed(2)
            }));

            // Agrupar por cliente
            const groupedByClient = formattedInvoices.reduce((acc, invoice) => {
                const clientId = invoice.client.id;

                if (!acc[clientId]) {
                    acc[clientId] = {
                        client: invoice.client,
                        invoices: [],
                    };
                }

                const invoiceWithoutClient = { ...invoice };
                delete invoiceWithoutClient.client;
                acc[clientId].invoices.push(invoiceWithoutClient);
                return acc;
            }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: any[] }>);

            return {
                invoices: Object.values(groupedByClient),
                pagination: {
                    page,
                    limit,
                    totalCount,
                    totalPages: Math.ceil(totalCount / limit),
                    hasNext: page < Math.ceil(totalCount / limit),
                    hasPrev: page > 1
                }
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            });
            badResponse.message = err.message;
            return badResponse;
        }
    }

    // 2. Endpoint separado para estadísticas (solo cuando se necesite)
    async getInvoiceStatistics(
        startDate?: string,
        endDate?: string,
        search?: string,
        blockId?: string,
        status?: string,
    ): Promise<InvoiceStatistics | DTOBaseResponse> {
        try {
            const where: any = {};
            if (status) {
                if (status == 'Abonadas') {
                    where.OR = [
                        {
                            status: {
                                notIn: ['Cancelada', 'Pagado']
                            }
                        },
                    ];
                    where.AND = {
                        InvoicePayment: {
                            some: {}
                        }
                    };
                } else {
                    where.status = status as InvoiceStatus
                }
            }

            if (search) {
                where.OR = [
                    {
                        client: {
                            name: {
                                contains: search,
                                mode: 'insensitive'
                            }
                        }
                    },
                    {
                        controlNumber: {
                            contains: search,
                            mode: 'insensitive'
                        }
                    }
                ]
            }
            if (blockId) {
                where.client = {
                    blockId: Number(blockId)
                };
            }

            if (startDate && endDate) {
                where.dispatchDate = {
                    gte: new Date(startDate),
                    lte: new Date(endDate)
                }
            }


            // Obtener productos y tasa de cambio actual
            const [products, currentDolar] = await Promise.all([
                this.prismaService.product.findMany(),
                this.productService.getDolar() // Asumiendo que tienes este método
            ]);

            // Consulta completa de facturas con todos los datos necesarios
            const invoicesWithDetails = await this.prismaService.invoice.findMany({
                where,
                select: {
                    id: true,
                    totalAmount: true,
                    remaining: true,
                    status: true,
                    exchangeRate: true, // Para saber si fue pagada en USD
                    invoiceItems: {
                        select: {
                            productId: true,
                            quantity: true,
                            unitPrice: true,    // Precio en BS
                            unitPriceUSD: true, // Precio en USD
                            subtotal: true,
                            type: true
                        }
                    },
                    InvoicePayment: {
                        select: {
                            amount: true,
                            payment: {
                                select: {
                                    amount: true,
                                    dolar: {
                                        select: {
                                            dolar: true
                                        }
                                    },
                                    account: {
                                        select: {
                                            method: {
                                                select: {
                                                    currency: true
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            });

            // Calcular estadísticas por producto con separación de monedas
            const productStatsMap = new Map<number, {
                productId: number;
                product: string;
                totalQuantity: number;
                paidQuantity: number;
                pendingQuantity: number;
                paidQuantityUSD: number;    // NUEVO: Cantidad pagada en USD
                paidQuantityBS: number;     // NUEVO: Cantidad pagada en BS
                pendingQuantityUSD: number; // NUEVO: Cantidad pendiente en USD
                pendingQuantityBS: number;  // NUEVO: Cantidad pendiente en BS
            }>();

            let totalCash = 0;
            let totalPending = 0;
            let totalPackages = 0;

            // Variables para totales por moneda
            let totalPaidPackagesUSD = 0;
            let totalPaidPackagesBS = 0;
            let totalPendingPackagesUSD = 0;
            let totalPendingPackagesBS = 0;

            // Procesar cada factura
            for (const invoice of invoicesWithDetails) {
                const invoiceTotal = Number(invoice.totalAmount);
                const invoiceRemaining = Number(invoice.remaining);
                const invoicePaid = invoiceTotal - invoiceRemaining;

                totalCash += invoiceTotal;
                totalPending += invoiceRemaining;

                // Determinar si la factura fue pagada en USD o BS
                const wasInvoiceInUSD = invoice.exchangeRate && invoice.exchangeRate > 0;
                const exchangeRateUsed = currentDolar;
                // Obtener información detallada de los pagos por moneda
                const paymentsByCurrency = this.analyzeInvoicePaymentsByCurrency(invoice.InvoicePayment);
                // Procesar cada producto de la factura
                for (const item of invoice.invoiceItems) {
                    // Solo contar productos de venta, no regalos
                    // if (item.type === 'GIFT') continue;

                    const product = products.find(p => p.id === item.productId);
                    if (!product) continue;

                    const productKey = item.productId;
                    const productName = `${product.name} ${product.presentation}`;

                    // Determinar el precio unitario correcto según la moneda de pago
                    let unitPriceToUse: number;
                    let unitPriceUSD: number;
                    let unitPriceBS: number;

                    if (wasInvoiceInUSD) {
                        // Si la factura fue en USD, usar precio USD
                        unitPriceToUse = Number(item.unitPriceUSD) || Number(item.unitPrice) / Number(exchangeRateUsed);
                        unitPriceUSD = unitPriceToUse;
                        unitPriceBS = unitPriceToUse * Number(exchangeRateUsed);
                    } else {
                        // Si la factura fue en BS, usar precio BS
                        unitPriceToUse = Number(item.unitPrice);
                        unitPriceBS = unitPriceToUse;
                        unitPriceUSD = unitPriceToUse / Number(exchangeRateUsed);
                    }

                    // Calcular cuánto se ha pagado de este producto específico
                    const itemSubtotal = Number(item.subtotal);
                    const proportionPaid = invoiceTotal > 0 ? invoicePaid / invoiceTotal : 0;
                    const itemPaidAmount = itemSubtotal * proportionPaid;

                    // Calcular cantidad pagada en unidades (con decimales)
                    const paidQuantity = unitPriceToUse > 0 ? itemPaidAmount / unitPriceToUse : 0;
                    const pendingQuantity = Math.max(0, item.quantity - paidQuantity);

                    // NUEVO: Calcular cantidades pagadas y pendientes por moneda
                    let paidQuantityUSD = 0;
                    let paidQuantityBS = 0;
                    let pendingQuantityUSD = 0;
                    let pendingQuantityBS = 0;

                    // Distribuir las cantidades pagadas según los pagos recibidos por moneda
                    if (paymentsByCurrency.totalPaidUSD > 0 && paymentsByCurrency.totalPaidBS > 0) {
                        // Factura pagada con ambas monedas - distribuir proporcionalmente
                        const totalPaidInvoice = paymentsByCurrency.totalPaidUSD + paymentsByCurrency.totalPaidBS;
                        const proportionUSD = paymentsByCurrency.totalPaidUSD / totalPaidInvoice;
                        const proportionBS = paymentsByCurrency.totalPaidBS / totalPaidInvoice;

                        paidQuantityUSD = paidQuantity * proportionUSD;
                        paidQuantityBS = paidQuantity * proportionBS;
                    } else if (paymentsByCurrency.totalPaidUSD > 0) {
                        // Solo pagos en USD
                        paidQuantityUSD = paidQuantity;
                        paidQuantityBS = 0;
                    } else {
                        // Solo pagos en BS (o sin pagos)
                        paidQuantityUSD = 0;
                        paidQuantityBS = paidQuantity;
                    }

                    // Para cantidades pendientes, usar la moneda original de la factura
                    if (wasInvoiceInUSD) {
                        pendingQuantityUSD = pendingQuantity;
                        pendingQuantityBS = 0;
                    } else {
                        pendingQuantityUSD = 0;
                        pendingQuantityBS = pendingQuantity;
                    }

                    // Actualizar totales generales por moneda
                    totalPaidPackagesUSD += paidQuantityUSD;
                    totalPaidPackagesBS += paidQuantityBS;
                    totalPendingPackagesUSD += pendingQuantityUSD;
                    totalPendingPackagesBS += pendingQuantityBS;

                    // Actualizar o crear estadísticas del producto
                    const existing = productStatsMap.get(productKey);
                    if (existing) {
                        existing.totalQuantity += item.quantity;
                        existing.paidQuantity += paidQuantity;
                        existing.pendingQuantity += pendingQuantity;
                        existing.paidQuantityUSD += paidQuantityUSD;
                        existing.paidQuantityBS += paidQuantityBS;
                        existing.pendingQuantityUSD += pendingQuantityUSD;
                        existing.pendingQuantityBS += pendingQuantityBS;
                    } else {
                        productStatsMap.set(productKey, {
                            productId: item.productId,
                            totalQuantity: item.quantity,
                            paidQuantity: paidQuantity,
                            pendingQuantity: pendingQuantity,
                            paidQuantityUSD: paidQuantityUSD,
                            paidQuantityBS: paidQuantityBS,
                            pendingQuantityUSD: pendingQuantityUSD,
                            pendingQuantityBS: pendingQuantityBS,
                            product: productName,
                        });
                    }

                    totalPackages += item.quantity;
                }
            }

            // Convertir Map a Array y formatear decimales
            const detPackage = Array.from(productStatsMap.values()).map(stats => ({
                productId: stats.productId,
                product: stats.product,
                totalQuantity: stats.totalQuantity,
                paidQuantity: stats.paidQuantity,
                pendingQuantity: stats.pendingQuantity,
                // NUEVOS CAMPOS: Separación por moneda
                paidQuantityUSD: stats.paidQuantityUSD,
                paidQuantityBS: stats.paidQuantityBS,
                pendingQuantityUSD: stats.pendingQuantityUSD,
                pendingQuantityBS: stats.pendingQuantityBS,
            }));

            // Calcular totales de paquetes pagados y pendientes
            const totalPaidPackages = detPackage.reduce((sum, item) => sum + item.paidQuantity, 0);
            const totalPendingPackages = detPackage.reduce((sum, item) => sum + item.pendingQuantity, 0);

            return {
                package: totalPackages,
                packagePaid: totalPaidPackages,
                packagePending: totalPendingPackages,
                // NUEVOS TOTALES POR MONEDA
                packagePaidUSD: totalPaidPackagesUSD,
                packagePaidBS: totalPaidPackagesBS,
                packagePendingUSD: totalPendingPackagesUSD,
                packagePendingBS: totalPendingPackagesBS,
                detPackage: detPackage.sort((a, b) => b.totalQuantity - a.totalQuantity),
                payments: {
                    debt: 0,
                    remaining: (totalCash - totalPending),
                    total: totalCash,
                    totalPaid: (totalCash - totalPending),
                    totalPending: totalPending,
                },
                summary: {
                    invoiceCount: invoicesWithDetails.length,
                    averageInvoiceValue: invoicesWithDetails.length > 0 ?
                        Math.round((totalCash / invoicesWithDetails.length) * 100) / 100 : 0,
                    paymentPercentage: totalCash > 0 ?
                        Math.round(((totalCash - totalPending) / totalCash) * 10000) / 100 : 0
                }
            };

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: {
                    message: err.message,
                    from: 'InvoiceService',
                }
            });

            badResponse.message = err.message || 'Error calculating invoice statistics';
            return badResponse;
        }
    }

    // NUEVO MÉTODO AUXILIAR: Analizar pagos por moneda
    private analyzeInvoicePaymentsByCurrency(invoicePayments: any[]): {
        totalPaidUSD: number;
        totalPaidBS: number;
        paymentsUSD: number;
        paymentsBS: number;
    } {
        let totalPaidUSD = 0;
        let totalPaidBS = 0;
        let paymentsUSD = 0;
        let paymentsBS = 0;

        for (const invPayment of invoicePayments) {
            const paymentAmount = Number(invPayment.amount);
            const paymentCurrency = invPayment.payment?.account?.method?.currency;

            if (paymentCurrency === 'USD') {
                totalPaidUSD += paymentAmount;
                paymentsUSD++;
            } else {
                // BS o cualquier otra moneda se considera BS
                totalPaidBS += paymentAmount;
                paymentsBS++;
            }
        }

        return {
            totalPaidUSD: Math.round(totalPaidUSD * 100) / 100,
            totalPaidBS: Math.round(totalPaidBS * 100) / 100,
            paymentsUSD,
            paymentsBS
        };
    }

    // 3. Endpoint para obtener detalles de factura individual (lazy loading)
    async getInvoiceDetails(invoiceId: number) {
        try {
            const invoice = await this.prismaService.invoice.findUnique({
                where: { id: invoiceId },
                include: {
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: {
                            payment: {
                                include: {
                                    account: true
                                }
                            }
                        }
                    }
                }
            });

            if (!invoice) {
                return { ...badResponse, message: 'Invoice not found' };
            }

            return {
                ...invoice,
                totalAmount: invoice.totalAmount.toFixed(2)
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            });
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoices(filter?: OptionalFilterInvoices): Promise<ResponseInvoice | DTOBaseResponse> {
        try {
            const where: any = {};
            if (filter && filter.status) {
                where.status = filter.status as InvoiceStatus;
            }

            const dolar = await this.productService.getDolar();
            const invoices = await this.prismaService.invoice.findMany({
                include: {
                    client: {
                        include: { block: true }
                    },
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: { payment: { include: { account: true } } }
                    }
                },
                orderBy: {
                    dispatchDate: 'desc'
                },
                where
            }).then(inv =>
                inv.map(data => {
                    return {
                        ...data,
                        totalAmount: data.totalAmount.toFixed(2)
                    }
                })
            )

            const groupedByClient = invoices.reduce((acc, invoice) => {
                const clientId = invoice.client.id;

                if (!acc[clientId]) {
                    acc[clientId] = {
                        client: invoice.client,
                        invoices: [],
                    };
                }

                const invoiceWithoutClient = { ...invoice };
                delete invoiceWithoutClient.client; // Eliminar la propiedad client del objeto invoice
                acc[clientId].invoices.push(invoiceWithoutClient);
                return acc;
            }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: any[] }>);

            const result = Object.values(groupedByClient);
            const totalPackageDetCount = this.groupProductCountInvoices(invoices);

            const totalCashInvoices = invoices.reduce((acc, item) => acc + Number(item.totalAmount), 0)
            const totalCashInvoicesPending = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)

            const realPending = totalCashInvoices - totalCashInvoicesPending;

            return {
                invoices: result,
                package: totalPackageDetCount.reduce((acc, item: any) => acc + item.totalQuantity, 0),
                detPackage: totalPackageDetCount,
                payments: {
                    total: totalCashInvoices,
                    totalPending: totalCashInvoicesPending,
                    debt: 0,
                    remaining: realPending,
                },
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesFilter(invoice: DTODateRangeFilter): Promise<ResponseInvoice | DTOBaseResponse> {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                include: {
                    client: {
                        include: { block: true }
                    },
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    },
                    InvoicePayment: {
                        include: { payment: { include: { account: true } } }
                    }
                },
                orderBy: {
                    dispatchDate: 'desc'
                },
                where: {
                    dispatchDate: {
                        gte: invoice.startDate,
                        lte: invoice.endDate
                    }
                }
            }).then(inv =>
                inv.map(data => {
                    return {
                        ...data,
                        totalAmount: data.totalAmount.toFixed(2)
                    }
                })
            )

            const groupedByClient = invoices.reduce((acc, invoice) => {
                const clientId = invoice.client.id;

                if (!acc[clientId]) {
                    acc[clientId] = {
                        client: invoice.client,
                        invoices: [],
                    };
                }

                const invoiceWithoutClient = { ...invoice };
                delete invoiceWithoutClient.client; // Eliminar la propiedad client del objeto invoice
                acc[clientId].invoices.push(invoiceWithoutClient);

                return acc;
            }, {} as Record<number, { client: typeof invoices[number]['client'], invoices: any[] }>);

            const result = Object.values(groupedByClient);
            const totalPackageDetCount = this.groupProductCountInvoices(invoices);

            const totalCashInvoices = invoices.reduce((acc, item) => acc + Number(item.totalAmount), 0)
            const totalCashInvoicesPending = invoices.filter(data => data.status == 'Creada' || data.status == 'Pendiente' || data.status == 'Vencida').reduce((acc, item) => acc + Number(item.remaining), 0)
            const realPending = totalCashInvoices - totalCashInvoicesPending;

            return {
                invoices: result,
                package: totalPackageDetCount.reduce((acc, item: any) => acc + item.totalQuantity, 0),
                detPackage: totalPackageDetCount,
                payments: {
                    total: totalCashInvoices,
                    totalPending: totalCashInvoicesPending,
                    debt: 0,
                    remaining: realPending,
                },
            };
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoicesExpired(): Promise<ResponseInvoice | DTOBaseResponse> {
        try {
            return await this.getInvoices({ status: 'Vencida' }) as ResponseInvoice
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async getInvoiceWithDetails() {
        try {
            const invoice = await this.prismaService.invoice.findMany({
                include: {
                    client: {
                        include: { block: true }
                    },
                    invoiceItems: {
                        include: {
                            product: true
                        }
                    }
                },
                where: {
                    status: {
                        notIn: ['Cancelada', 'Pagado']
                    }
                }
            }).then(item => item.map(data => {
                return {
                    ...data,
                    specialPrice: data.invoiceItems.filter(item => item.type == 'SALE').reduce((acc, det) => acc + (Number(det.unitPriceUSD) * det.quantity), 0),
                }
            }))

            if (!invoice) {
                badResponse.message = 'No se han encontrado facturas.'
                return badResponse;
            }

            return invoice;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async checkInvoice() {
        try {
            const invoices = await this.prismaService.invoice.findMany({
                include: {
                    client: true,
                    invoiceItems: true
                },
                where: {
                    status: {
                        not: {
                            in: ['Pagado', 'Cancelada']
                        }
                    }
                }
            });

            const clientReminderList = await this.prismaService.clientReminder.findMany();

            const invoicesModify = {
                pending: 0,
                expired: 0
            }

            invoices.map(async (inv) => {
                if (this.isDateExpired(inv.dispatchDate) && inv.status == 'Creada') {
                    await this.prismaService.invoice.update({
                        where: { id: inv.id },
                        data: { status: 'Pendiente' }
                    });

                    invoicesModify.pending += 1;
                }

                if (this.isDateExpired(inv.dueDate) && (inv.status == 'Pendiente' || inv.status == 'Creada' || inv.status == 'Vencida')) {
                    await this.prismaService.invoice.update({
                        where: { id: inv.id },
                        data: { status: 'Vencida' }
                    });

                    const findClientReminder = clientReminderList.find(item => item.clientId == inv.clientId);

                    if (findClientReminder) {
                        return;
                    }

                    await this.prismaService.clientReminder.create({
                        data: {
                            clientId: inv.clientId,
                            messageId: 1,
                            send: true,
                        }
                    })

                    invoicesModify.expired += 1;
                }
            });

            await this.generateInactivityNotifications();
            baseResponse.message = 'Facturas verificadas y agregadas a cobranza.'
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async generateInactivityNotifications() {
        try {
            const clients = await this.prismaService.client.findMany({
                include: {
                    invoices: {
                        orderBy: { dueDate: 'desc' },
                        take: 1,
                    },
                },
            });

            const now = new Date();

            for (const client of clients) {
                const lastInvoice = client.invoices && client.invoices[0];
                if (!lastInvoice) continue;

                const threshold = addDays(new Date(lastInvoice.dueDate), 7);
                if (threshold > now) continue;

                // Eliminar notificaciones previas de inactividad para este cliente
                await this.prismaService.notification.deleteMany({
                    where: {
                        clientId: client.id,
                        type: 'inactivity',
                    },
                });

                const message = `El Cliente ${client.name} no tiene pedidos desde ${format(
                    new Date(lastInvoice.dueDate),
                    'dd/MM/yyyy',
                )}`;

                await this.prismaService.notification.create({
                    data: {
                        clientId: client.id,
                        type: 'inactivity',
                        message,
                        seen: false,
                    },
                });
            }
        } catch (error) {
            await this.prismaService.errorMessages.create({
                data: { message: error.message, from: 'ClientService - InactivityNotifications' }
            });
            console.error('Error generating inactivity notifications:', error);
        }
    }

    async checkInvoicePayments(invoiceId: number) {
        try {
            const findInvoice = await this.prismaService.invoice.findFirst({
                where: { id: invoiceId }
            });

            if (!findInvoice) {
                badResponse.message = 'No se encontró la factura';
                return badResponse;
            }

            const findPaymentInvoice = await this.prismaService.invoicePayment.findMany({
                where: { invoiceId: invoiceId }
            });

            const calculateRemaining = findPaymentInvoice.reduce((acc, item) => acc + Number(item.amount), 0);
            const newRemaining = Number(findInvoice.totalAmount) - calculateRemaining;
            await this.prismaService.invoice.update({
                data: {
                    remaining: newRemaining,
                    status: newRemaining < 2 ? 'Pagado' : findInvoice.status
                }, where: {
                    id: invoiceId
                }
            });

            const findInvoicesClient = await this.prismaService.invoice.findMany({
                where: {
                    clientId: findInvoice.clientId,
                    status: 'Vencida'
                }
            });

            if (!findInvoicesClient) {
                const findClientReminder = await this.prismaService.clientReminder.findFirst({
                    where: { clientId: findInvoice.clientId }
                });

                if (findClientReminder) {
                    await this.prismaService.clientReminder.delete({
                        where: { id: findClientReminder.id }
                    })
                }
            }

        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    // groupProductInvoices(invoicesFilter) {
    //     return invoicesFilter.reduce((acc, invoice) => {
    //         invoice.invoiceItems.forEach(item => {
    //             const productId = item.product.id;

    //             if (!acc[productId]) {
    //                 acc[productId] = {
    //                     productId: item.product.id,
    //                     product: item.product,
    //                     totalQuantity: 0,
    //                 };
    //             }

    //             acc[productId].totalQuantity += Number(item.quantity);
    //         })
    //         return acc;
    //     }, {} as Record<number, { product: typeof invoicesFilter[number]['invoiceItems'][number]['product'], totalQuantity: number }>);
    // }

    groupProductCountInvoices(invoicesFilter) {
        const calculateProducts = invoicesFilter.reduce((acc, invoice) => {
            const parseRemaining = invoice.status == 'Pagado' ? 0 : Number(invoice.remaining);
            let paidRemaining = Number(invoice.totalAmount) - parseRemaining;

            invoice.invoiceItems.forEach(item => {
                const productId = item.product.id;
                const unitPrice = Number(item.unitPrice);
                let quantity = Number(item.quantity);
                let quantityPaid = 0;

                // Calcular cuántas unidades se han pagado por este producto
                while (quantity > 0 && paidRemaining >= unitPrice) {
                    quantityPaid += 1;
                    paidRemaining -= unitPrice;
                    quantity -= 1;
                }

                // Si queda un pago parcial para una unidad (ej. 0.5 producto)
                if (quantity > 0 && paidRemaining > 0) {
                    const partialFraction = paidRemaining / unitPrice;
                    quantityPaid += partialFraction;
                    paidRemaining -= unitPrice * partialFraction;
                    quantity -= partialFraction;
                }

                // Agregar al acumulador
                if (!acc[productId]) {
                    acc[productId] = {
                        productId: item.product.id,
                        product: item.product,
                        totalQuantity: 0,
                        paidQuantity: 0,
                        total: 0,
                    };
                }

                acc[productId].totalQuantity += Number(item.quantity);
                acc[productId].paidQuantity += quantityPaid;
                acc[productId].total = acc[productId].totalQuantity - quantityPaid;
            });

            return acc;
        }, {} as Record<number, {
            product: typeof invoicesFilter[number]['invoiceItems'][number]['product'],
            totalQuantity: number,
            paidQuantity: number
        }>);
        const parseProducts: DetProducts[] = Object.values(calculateProducts);

        const calculateFinalTotal = parseProducts.map((data: DetProducts) => {
            return {
                ...data,
                total: data.totalQuantity - data.paidQuantity
            }
        })
        return calculateFinalTotal;
    }

    setTotalProducts = (invoices: IInvoiceWithDetails[], type: string) => {
        const totalPackage = invoices.reduce((acc, invoice) => {
            const total = invoice.status === 'Creada' || invoice.status == 'Pendiente'
                ? invoice.invoiceItems.reduce((acc, item) => acc + Number(item.quantity), 0)
                : 0;
            return acc + total;
        }, 0);

    }

    // async checkInvoice() {
    //     const invoices = await this.prismaService.invoice.findMany({
    //         include: {
    //             client: true,
    //             invoiceItems: true
    //         }
    //     })

    //     invoices.map(async (inv) => {
    //         if (this.isDateExpired(inv.dueDate)) {
    //             await this.prismaService.invoice.update({
    //                 where: { id: inv.id },
    //                 data: { status: 'Vencida' }
    //             })
    //         }
    //     })
    // }

    isDateExpired(dueDate: Date): boolean {
        const today = new Date();
        const cleanDueDate = new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate());
        const cleanToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        return cleanDueDate < cleanToday;
    }

    async findInvoiceWithoutDetails() {
        const invoices = await this.prismaService.invoice.findMany({
            where: {
                invoiceItems: {
                    none: {}
                }
            },
            include: {
                client: true,
                invoiceItems: true
            }
        })

        return invoices;
    }

    async InvoiceValidateTotal() {
        const invoices = await this.prismaService.invoice.findMany({
            include: {
                client: true,
                invoiceItems: true
            }
        })

        const invoicesFailed = invoices.map(inv => {
            const total = inv.invoiceItems.reduce((acc, item) => acc + Number(item.subtotal), 0);

            if (total.toFixed(2) !== inv.totalAmount.toFixed(2)) {
                return {
                    ...inv,
                    totalAmount: total
                }
            }
        })

        return invoicesFailed.filter(inv => inv != null);
    }

    async createInvoice(newInvoice: DTOInvoice) {
        try {
            const findDuplicateControlNumber = await this.prismaService.invoice.findFirst({
                where: { controlNumber: newInvoice.controlNumber },
                include: { client: true }
            })

            if (findDuplicateControlNumber) {
                badResponse.message = `Ya existe una factura con ese numero de control del cliente ${findDuplicateControlNumber.client.name}`
                return badResponse;
            }

            const products = await this.productService.getProducts();
            const inventory = await this.inventoryService.getInventory();

            const productInvalid = newInvoice.details.map(det => {
                const findProduct = inventory.find(prod => prod.productId === det.productId);

                if (det.quantity > findProduct.quantity) {
                    return {
                        product: findProduct.product.name,
                        quantity: findProduct.quantity,
                        amount: det.quantity
                    }
                } else {
                    return null
                }
            })

            if (productInvalid.filter(pro => pro !== null).length > 0) {
                badResponse.message = 'Estos productos exceden la cantidad que existe en inventario.'
                return badResponse;
            }

            const saveInvoice = await this.prismaService.invoice.create({
                data: {
                    clientId: newInvoice.clientId,
                    controlNumber: newInvoice.controlNumber,
                    status: 'Creada',
                    dispatchDate: newInvoice.dispatchDate,
                    dueDate: newInvoice.dueDate,
                    consignment: newInvoice.consignment,
                    totalAmount: 0
                }
            })

            const dataDetailsInvoice = newInvoice.details.map(det => {
                return {
                    invoiceId: saveInvoice.id,
                    productId: det.productId,
                    quantity: det.quantity,
                    type: det.type || 'SALE', // Default to 'SALE' if not provided
                    unitPrice: Number(newInvoice.priceUSD ? det.priceUSD : det.price),
                    unitPriceUSD: Number(det.priceUSD),
                    subtotal: Number(newInvoice.priceUSD ? Number(det.priceUSD) * det.quantity : Number(det.price) * det.quantity),
                }
            })

            await this.prismaService.invoiceProduct.createMany({
                data: dataDetailsInvoice
            })

            newInvoice.details.map(async (det) => {
                const dataInventory = {
                    productId: det.productId,
                    price: det.price,
                    priceUSD: det.priceUSD,
                    quantity: det.quantity,
                    description: `Salida de producto por factura ${saveInvoice.controlNumber}`
                }
                await this.inventoryService.updateInventoryInvoice(dataInventory)
            });

            const calculateTotalInvoice = dataDetailsInvoice.filter(item => item.type == 'SALE').reduce((acc, item) => acc + Number(item.subtotal), 0);

            await this.prismaService.invoice.update({
                where: { id: saveInvoice.id },
                data: {
                    status: calculateTotalInvoice == 0 ? 'Pagado' : 'Creada',
                    totalAmount: calculateTotalInvoice,
                    remaining: calculateTotalInvoice,
                }
            });

            // Eliminar notificación de inactividad si existe
            await this.prismaService.notification.deleteMany({
                where: {
                    clientId: newInvoice.clientId,
                    type: 'inactivity',
                },
            });

            baseResponse.message = 'Factura creada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateInvoice(id: number, newInvoice: DTOInvoice) {
        try {
            const products = await this.productService.getProducts();

            const invoice = await this.prismaService.invoice.findUnique({
                where: { id },
                include: {
                    invoiceItems: true
                }
            });

            if (!invoice) {
                badResponse.message = 'Factura no encontrada';
                return badResponse;
            }

            await this.prismaService.invoice.update({
                where: { id },
                data: {
                    clientId: newInvoice.clientId,
                    controlNumber: newInvoice.controlNumber,
                    dispatchDate: newInvoice.dispatchDate,
                    dueDate: newInvoice.dueDate,
                    consignment: newInvoice.consignment,
                }
            });

            // if (invoice.invoiceItems.length === newInvoice.details.length) {
            const dataDetailsInvoice = newInvoice.details.map(det => {
                return {
                    invoiceId: id,
                    productId: det.productId,
                    quantity: det.quantity,
                    type: det.type || 'SALE', // Default to 'SALE' if not provided
                    unitPrice: Number(newInvoice.priceUSD ? det.priceUSD : det.price),
                    unitPriceUSD: Number(det.priceUSD),
                    subtotal: Number(newInvoice.priceUSD ? det.priceUSD : Number(det.price) * det.quantity),
                }
            });

            await this.prismaService.invoiceProduct.deleteMany({
                where: { invoiceId: id }
            })

            await this.prismaService.invoiceProduct.createMany({
                data: dataDetailsInvoice
            });

            const totalAmount = dataDetailsInvoice.filter(item => item.type == 'SALE').reduce((acc, item) => acc + Number(item.subtotal), 0)

            await this.prismaService.invoice.update({
                data: {
                    totalAmount: totalAmount,
                    remaining: totalAmount
                },
                where: { id }
            })

            baseResponse.message = 'Factura actualizada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async updateInvoiceDet() {
        try {
            const getDetailsInvoice = await this.prismaService.invoiceProduct.findMany();
            const historyProduct = await this.prismaService.historyProduct.findMany();

            let notFound = 0;
            getDetailsInvoice.map(async (item) => {
                const findProductHistory = historyProduct.find(data =>
                    Number(data.price).toFixed(2) === Number(item.unitPrice).toFixed(2)
                )

                if (!findProductHistory || !findProductHistory.priceUSD) {
                    notFound += 1;
                } else {
                    await this.prismaService.invoiceProduct.update({
                        data: { unitPriceUSD: findProductHistory.priceUSD },
                        where: { id: item.id }
                    })
                }
            })

            baseResponse.message = 'Detalles actualizados.'
            return baseResponse;

        } catch (err) {
            badResponse.message = err.message;
            return badResponse
        }
    }

    async markPayed(id: number) {
        try {
            await this.prismaService.invoice.update({
                where: { id },
                data: { status: 'Pagado' }
            })
            baseResponse.message = 'Factura marcada como pagada.'
            return baseResponse;
        } catch (err) {
            baseResponse.message = err.message;
            return badResponse
        }
    }
    async markPending(id: number) {
        try {
            await this.prismaService.invoice.update({
                where: { id },
                data: { status: 'Pendiente' }
            })
            baseResponse.message = 'Factura marcada como pendiente.'
            return baseResponse;
        } catch (err) {
            baseResponse.message = err.message;
            return badResponse
        }
    }
    async markClean(id: number) {
        try {
            await this.prismaService.invoice.update({
                where: { id },
                data: { remaining: 0 }
            })
            baseResponse.message = 'Factura Limpiada.'
            return baseResponse;
        } catch (err) {
            baseResponse.message = err.message;
            return badResponse
        }
    }

    async deleteInvoice(id: number) {
        try {
            const invoice = await this.prismaService.invoice.findFirst({
                where: { id }
            });

            if (!invoice) {
                badResponse.message = 'Factura no encontrada';
                return badResponse;
            }

            const findInvoicePayment = await this.prismaService.invoicePayment.findFirst({
                where: { invoiceId: id }
            })

            if (findInvoicePayment) {
                badResponse.message = 'Esta factura ya se encuentra paga.';
                return badResponse;
            }

            const detInvoice = await this.prismaService.invoiceProduct.findMany({
                where: { invoiceId: id }
            });

            detInvoice.map(async (det) => {
                const findInventory = await this.prismaService.inventory.findFirst({
                    where: { productId: det.productId }
                });

                if (findInventory) {
                    await this.prismaService.inventory.update({
                        where: { id: findInventory.id },
                        data: { quantity: findInventory.quantity + det.quantity }
                    })
                    await this.prismaService.historyInventory.create({
                        data: {
                            productId: findInventory.productId,
                            quantity: det.quantity,
                            description: `Devolución de producto por cancelación de factura ${invoice.controlNumber}`,
                            movementType: 'IN'
                        }
                    })
                }
            })

            await this.prismaService.invoiceProduct.deleteMany({
                where: { invoiceId: invoice.id }
            })

            await this.prismaService.invoice.delete({
                where: { id: invoice.id }
            })

            baseResponse.message = 'Factura eliminada correctamente';
            return baseResponse;

        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { message: err.message, from: 'InvoiceService' }
            })
            badResponse.message = err.message;
            return badResponse;
        }
    }

    // ----------------------------------------------------------------

    async syncInvoiceExcel(invoices: ExcelTransformV2[]) {
        const existingInvoices = await this.prismaService.invoice.findMany();

        // Normalizamos los controlNumbers existentes con padding
        const existingControlNumbers = new Set(
            existingInvoices.map(inv => inv.controlNumber.toString().padStart(4, '0'))
        );

        // Filtramos solo los que no existen aún
        const newInvoices = invoices.filter(inv => {
            const controlNum = inv.controlNumber.toString().padStart(4, '0');
            return !existingControlNumbers.has(controlNum);
        });

        // Si no hay facturas nuevas, salimos
        if (newInvoices.length === 0) {
            return {
                success: false,
                message: 'Todas las facturas ya existen en la base de datos.',
            };
        }

        try {
            const clients = await this.clientService.getClients();

            const dataInvoice = invoices.map((data, index) => {
                const findClient = clients.find(item => item.name.toLowerCase().trim() == data.client.toLowerCase().trim());

                if (!findClient) {
                    throw new Error(`Cliente no encontrado para la factura #${data.controlNumber} (cliente: ${data.client})`);
                }

                return {
                    consignment: data.consignment,
                    controlNumber: data.controlNumber.toString().padStart(4, '0'),
                    dispatchDate: new Date(data.dispatchDate),
                    dueDate: new Date(data.dueDate),
                    status: 'Creada' as InvoiceStatus,
                    totalAmount: data.totalAmount,
                    clientId: findClient.id,
                    remaining: data.totalAmount
                }
            })

            await this.prismaService.invoice.createMany({
                data: dataInvoice
            });

            baseResponse.message = 'Facturas guardadas exitosamente.';
            return baseResponse;
        } catch (err) {
            badResponse.message = err.message;
            return badResponse;
        }
    }

    async validateClient(invoice: ExcelTransformV2[]) {
        const clients = await this.clientService.getClients();

        const dataInvoice = invoice.map(data => {
            const findClient = clients.find(item => item.name.trim() == data.client.trim());

            return {
                consignment: data.consignment,
                controlNumber: data.controlNumber.toString().padStart(4, '0'),
                dispatchDate: new Date(data.dispatchDate),
                dueDate: new Date(data.dueDate),
                status: 'Creada' as InvoiceStatus,
                totalAmount: data.totalAmount,
                clientId: findClient ? findClient.id : 0,
                remaining: data.totalAmount
            }
        })
        return dataInvoice
    }

    findDuplicateControlNumbers(data: ExcelTransformV2[]): ExcelTransformV2[] {
        const countMap = new Map<number, number>();
        const duplicates: ExcelTransformV2[] = [];

        // Contamos cuántas veces aparece cada controlNumber
        for (const item of data) {
            countMap.set(item.controlNumber, (countMap.get(item.controlNumber) || 0) + 1);
        }

        // Filtramos los elementos que están duplicados
        for (const item of data) {
            if (countMap.get(item.controlNumber)! > 1) {
                duplicates.push(item);
            }
        }

        return duplicates;
    };

    async syncDetInvoiceExcel(devInvoice: DetInvoiceDataExcel[]) {
        const validDevInvoice = devInvoice.filter(d => d.product && d.invoice);
        const products = await this.productService.getProducts();
        const invoices = await this.prismaService.invoice.findMany();

        const findDuplicate = this.findDuplicateInvoiceProducts(validDevInvoice);
        if (findDuplicate.duplicates.length > 0) {
            return {
                data: findDuplicate
            }
        }

        const dataDetInvoice = validDevInvoice.map(data => {
            const findProduct = products.find(item => item.name.toString().toLowerCase().trim() == data.product.toString().toLowerCase().trim());
            const findInvoice = invoices.find(item => item.controlNumber.toString().padStart(4, '0') == data.invoice.toString().padStart(4, '0'));

            if (!findInvoice || !findProduct) {
                throw new Error(`Producto no encontrado para la factura #${data.invoice} (producto: ${data.product})`);
            }

            return {
                invoiceId: findInvoice.id,
                productId: findProduct.id,
                quantity: data.quantity,
                subtotal: data.subtotal,
                unitPrice: data.unitPrice,
                unitPriceUSD: data.unitPrice,
            }
        })

        try {
            await this.prismaService.invoiceProduct.createMany({
                data: dataDetInvoice
            });

            baseResponse.message = 'Facturas y detalles agregados exitosamente.'
            return baseResponse;
        } catch (err) {
            await this.prismaService.errorMessages.create({
                data: { from: 'InvoiceServiceExcel', message: err.message }
            })
            badResponse.message = `Ah ocurrido un error ${err.message}`
            return badResponse;
        }
    }

    async syncClientExcelLocal(client: ClientExcel[]) {
        const parseDataClient = client.map(cli => {
            return {
                name: cli.name,
                rif: cli.rif ? cli.rif.toString() : 'J',
                address: cli.address ? cli.address : '',
                phone: cli.phone ? cli.phone.toString().padStart(11, '0') : '',
                zone: cli.zone,
                blockId: cli.blockId,
                active: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            }
        })

        try {
            await this.prismaService.client.createMany({
                data: parseDataClient
            })
            baseResponse.message = 'Clientes agregados exitosamente';
            return baseResponse;
        } catch (err) {
            return {
                message: err.message,
                success: false,
                data: parseDataClient
            }
        }
    }

    findDuplicateInvoiceProducts(data: DetInvoiceDataExcel[]) {
        const seen = new Map<string, number>();
        const duplicates: DetInvoiceDataExcel[] = [];

        for (const item of data) {
            const key = `${item.invoice}-${item.product.trim().toLowerCase()}`;

            if (seen.has(key)) {
                duplicates.push(item);
            } else {
                seen.set(key, 1);
            }
        }

        // Lista de invoice únicos que tienen productos duplicados
        const duplicateInvoices = Array.from(
            new Set(duplicates.map(d => d.invoice))
        );

        return {
            duplicates,         // Registros exactos duplicados
            duplicateInvoices,  // Lista de invoice con productos repetidos
        };
    }

    async exportInvoicesToExcelWithExcelJS(dateRange?: DTODateRangeFilter): Promise<Buffer> {
        const where: any = {};
        if (dateRange?.startDate && dateRange?.endDate) {
            where.dispatchDate = {
                gte: dateRange.startDate,
                lte: dateRange.endDate,
            };
        }

        const invoices = await this.prismaService.invoice.findMany({
            where,
            include: {
                client: { include: { block: true } },
                invoiceItems: { include: { product: true } },
                InvoicePayment: {
                    include: {
                        payment: {
                            include: {
                                account: { include: { method: true } },
                                dolar: true
                            },
                        },
                    },
                },
            },
            orderBy: { dispatchDate: 'desc' },
        });

        const productsMap: Map<string, { total: number; price: number }> = new Map();
        invoices.forEach((inv) => {
            inv.invoiceItems.forEach(({ product, quantity, unitPrice }) => {
                const key = product.name;
                const current = productsMap.get(key);
                if (!current) {
                    productsMap.set(key, { total: quantity, price: Number(unitPrice) });
                } else {
                    current.total += quantity;
                    productsMap.set(key, current);
                }
            });
        });

        const productNames = Array.from(productsMap.keys());

        const workbook = new ExcelJS.Workbook();

        // Hoja 1 - Facturas
        const ws1 = workbook.addWorksheet('Facturas');

        const baseHeaders = [
            'N° Control', 'Cliente', 'Teléfono', 'Bloque', 'Dirección', 'Zona', 'Fecha', 'Vence', 'Total', 'Debe', 'Estado'
        ];

        const productHeaders = productNames.flatMap(name => [`${name}`, `Precio`]);
        const finalHeaders = [...baseHeaders, ...productHeaders, 'Total de bultos', 'Monto', 'Abono'];

        ws1.addRow(finalHeaders);
        ws1.getRow(1).font = { bold: true };

        invoices.forEach(inv => {
            const totalBultos = inv.invoiceItems.reduce((sum, i) => sum + i.quantity, 0);
            const abono = Number(inv.totalAmount) - Number(inv.remaining);

            const rowData: (string | number | Date)[] = [
                inv.controlNumber,
                inv.client.name,
                inv.client.phone,
                inv.client.block.name,
                inv.client.address,
                inv.client.zone,
                inv.dispatchDate,
                inv.dueDate,
                Number(inv.totalAmount),
                Number(inv.remaining),
                inv.status,
            ];

            // Agregar los productos por nombre (cantidad y precio)
            for (const productName of productNames) {
                const found = inv.invoiceItems.find(item => item.product.name === productName);
                rowData.push(found ? found.quantity : '');
                rowData.push(found ? Number(found.unitPrice) : 0);
            }

            rowData.push(totalBultos);
            rowData.push(''); // Monto vacío
            rowData.push(abono);

            const row = ws1.addRow(rowData);

            // Formato de fecha
            row.getCell(6).numFmt = 'dd/mm/yyyy';
            row.getCell(7).numFmt = 'dd/mm/yyyy';

            // Color por estado
            const colorMap = {
                Creada: 'dbeafe',
                Pendiente: 'ffedd4',
                Vencida: 'ffe2e2',
                Pagado: 'dbfce7',
                Cancelada: 'ffe2e2',
            };
            const fillColor = colorMap[inv.status as keyof typeof colorMap];
            if (fillColor) {
                row.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: fillColor },
                };
            }
        });

        // Hoja 2 - Pagos
        const ws2 = workbook.addWorksheet('Pagos');
        const pagosHeaders = [
            'Cuenta', 'Factura', 'Cantidad', 'Cantidad USD', 'Cantidad Bs', 'Tasa Dolar', 'Referencia',
            ...productNames.flatMap(name => [`${name}`, 'Precio']),
            'Total de bultos',
        ];

        ws2.addRow(pagosHeaders);
        ws2.getRow(1).font = { bold: true };

        invoices.forEach(inv => {
            inv.InvoicePayment.forEach(({ payment }) => {
                const currency = payment.account.method.currency;
                const usdAmount = currency === 'USD' ? Number(payment.amount) : Number(payment.amount) / Number(payment.dolar.dolar);
                const bsAmount = currency === 'BS' ? Number(payment.amount) : Number(payment.amount) * Number(payment.dolar.dolar);

                const rowData: (string | number)[] = [
                    payment.account.name,
                    inv.controlNumber,
                    `${Number(payment.amount).toFixed(2)} ${currency === 'USD' ? '$' : 'Bs'}`,
                    usdAmount,
                    bsAmount,
                    Number(payment.dolar.dolar),
                    payment.reference,
                ];

                for (const productName of productNames) {
                    const found = inv.invoiceItems.find(item => item.product.name === productName);
                    rowData.push(found ? found.quantity : '');
                    rowData.push(found ? Number(found.unitPrice) : 0);
                }

                const totalBultos = inv.invoiceItems.reduce((sum, i) => sum + i.quantity, 0);
                rowData.push(totalBultos);

                const row = ws2.addRow(rowData);
                if (currency === 'USD') {
                    row.eachCell(cell => {
                        cell.fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'dbeafe' },
                        };
                    });
                }
            });
        });

        const arrayBuffer = await workbook.xlsx.writeBuffer();
        const buffer = Buffer.from(arrayBuffer); // <-- Conversión correcta
        return buffer;
    }

}
