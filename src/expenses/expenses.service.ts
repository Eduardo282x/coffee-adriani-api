import { Injectable } from '@nestjs/common';
import { badResponse } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ExpensesDTO } from './expenses.dto';

@Injectable()
export class ExpensesService {

    constructor(private readonly prismaService: PrismaService) {

    }

    private getNormalizedDateRange(expenseFilter: ExpensesDTO) {
        const startDate = new Date(expenseFilter.startDate);
        startDate.setHours(0, 0, 0, 0);

        const endDate = new Date(expenseFilter.endDate);
        endDate.setHours(23, 59, 59, 999);

        return { startDate, endDate };
    }

    private normalizeText(value?: string | null) {
        return (value || '').trim().toLowerCase();
    }

    private isDivisaPayment(payment: any) {
        const methodName = this.normalizeText(payment?.account?.method?.name);
        const accountName = this.normalizeText(payment?.account?.name);
        const bankName = this.normalizeText(payment?.account?.bank);

        const isCashUsd = methodName.includes('efectivo $') || methodName.includes('efectivo usd');
        const isGastoDivisa = accountName.includes('gasto divisa') || bankName.includes('gasto divisa');

        return isCashUsd || isGastoDivisa;
    }

    async getExpensesFilter(expenseFilter: ExpensesDTO) {
        try {
            const invoices = await this.getInvoicesRemaining(expenseFilter);
            const invoicesEarns = await this.getInvoicesEarnV2(expenseFilter);
            const payments = await this.getPayments(expenseFilter);
            const paymentsNoAssociated = await this.getPaymentsNoAssociated(expenseFilter) as any[];

            const calculateTotal = paymentsNoAssociated
                .map(pay => Number(pay.amountUSD || 0))
                .reduce((acc, item) => acc + item, 0)

            return {
                invoicesEarns,
                invoices: invoices,
                payments: payments,
                paymentsNoAssociated: {
                    payments: paymentsNoAssociated,
                    total: calculateTotal
                }
            };
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getInvoicesEarn(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    dispatchDate: {
                        gte: startDate,
                        lte: endDate,
                    },
                    invoiceItems: {
                        none: {
                            type: 'GIFT'
                        }
                    }
                },
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
                                    account: {
                                        include: {
                                            method: true,
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
            });

            const historyProducts = await this.prismaService.historyProduct.findMany({});

            let totalMonthGain = 0;
            const dailyTotals: Record<number, number> = {};
            const productSales: Record<string, number> = {};

            for (const invoice of invoices) {
                let invoiceGain = 0;

                for (const item of invoice.invoiceItems) {
                    const history = historyProducts.find(h => h.name === item.product.name && h.presentation === item.product.presentation);
                    if (!history) continue;

                    const totalQty = Number(item.quantity);
                    let gainPerItem = 0;

                    const isUSD = invoice.InvoicePayment.some(ip => ip.payment.account.method.currency === 'USD');
                    if (isUSD) {
                        gainPerItem = (Number(item.unitPriceUSD) - Number(history.purchasePriceUSD)) * totalQty;
                    } else {
                        gainPerItem = (Number(item.unitPrice) - Number(history.purchasePrice)) * totalQty;
                    }

                    invoiceGain += gainPerItem;

                    const key = `${item.product.name} - ${item.product.presentation}`;
                    productSales[key] = (productSales[key] || 0) + totalQty;
                }

                totalMonthGain += invoiceGain;

                const day = new Date(invoice.dispatchDate).getDate();
                dailyTotals[day] = (dailyTotals[day] || 0) + invoiceGain;
            }

            const date = new Date(expenseFilter.startDate);
            const year = date.getFullYear();
            const month = date.getMonth();
            const daysInMonth = new Date(year, month + 1, 0).getDate();

            const dailyData = Array.from({ length: daysInMonth }, (_, i) => {
                const dia = i + 1;
                return {
                    dia,
                    ganancias: Number((dailyTotals[dia] || 0).toFixed(2)),
                    meta: 0,
                };
            });

            const ganancias = dailyData.map(da => Number(da.ganancias))
            const minEarns = Math.min(...ganancias);
            const maxEarns = Math.max(...ganancias);
            const average = (maxEarns + minEarns) / 2

            const parseDailyDataMeta = dailyData.map(gains => {
                return {
                    ...gains,
                    meta: average
                }
            })


            const totalProducts = Object.entries(productSales).reduce((acc, [, value]) => acc + value, 0);
            const productPercentage = Object.entries(productSales).map(([name, qty]) => ({
                name,
                percentage: Number(((qty / totalProducts) * 100).toFixed(2)),
            })).sort((a, b) => b.percentage - a.percentage);

            return {
                resumen: {
                    totalMonthGain: Number(totalMonthGain.toFixed(2)),
                    productPercentage,
                },
                dailyData: parseDailyDataMeta,
            };
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getInvoicesEarnV2(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            // 1. Obtener todos los pagos de facturas (InvoicePayment) con su factura, productos y pagos
            const invoicePayments = await this.prismaService.invoicePayment.findMany({
                include: {
                    invoice: {
                        include: {
                            invoiceItems: {
                                include: { product: true }
                            },
                            client: true,
                        }
                    },
                    payment: {
                        include: {
                            account: {
                                include: {
                                    method: true
                                }
                            }
                        }
                    },
                },
                where: {
                    createdAt: {
                        gte: startDate,
                        lte: endDate,
                    }
                }
            });

            // 2. Agrupar por factura para evitar recalcular cuando hay pagos parciales
            const groupedByInvoice = new Map<number, typeof invoicePayments>();
            for (const ip of invoicePayments) {
                const current = groupedByInvoice.get(ip.invoiceId) || [];
                current.push(ip);
                groupedByInvoice.set(ip.invoiceId, current);
            }

            // 3. Agrupar ventas de productos sin duplicar por multiples pagos
            const productSales: Record<number, { name: string, quantity: number }> = {};
            let totalQuantity = 0;

            for (const [, groupedPayments] of groupedByInvoice) {
                const firstPayment = groupedPayments[0];
                for (const item of firstPayment.invoice.invoiceItems) {
                    if (!productSales[item.productId]) {
                        productSales[item.productId] = { name: item.product.name || 'Desconocido', quantity: 0 };
                    }
                    productSales[item.productId].quantity += item.quantity;
                    totalQuantity += item.quantity;
                }
            }

            // Calcular porcentaje de ventas por producto
            const productPercentages = Object.entries(productSales).map(([id, data]) => ({
                productId: Number(id),
                name: data.name,
                quantity: data.quantity,
                percentage: totalQuantity > 0 ? (data.quantity / totalQuantity * 100).toFixed(2) : '0.00'
            })).sort((a, b) => b.quantity - a.quantity);

            // 4. Calcular ganancias individuales y totales
            let totalEarnDay = 0;
            let totalEarnMonth = 0;
            let totalEarnRange = 0;
            const invoiceEarns: any[] = [];

            // Referencias del día y mes usando el rango filtrado
            const referenceDate = new Date(endDate);
            const startOfDay = new Date(referenceDate);
            startOfDay.setHours(0, 0, 0, 0);

            const endOfDay = new Date(referenceDate);
            endOfDay.setHours(23, 59, 59, 999);

            const startOfMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), 1, 0, 0, 0, 0);

            const productCache = new Map<number, any>();

            const getProductById = async (productId: number) => {
                if (productCache.has(productId)) {
                    return productCache.get(productId);
                }

                const found = await this.prismaService.product.findUnique({ where: { id: productId } });
                productCache.set(productId, found);
                return found;
            };

            const historyCache = new Map<string, any>();

            const getHistoryAtDate = async (name: string, presentation: string, atDate: Date) => {
                const cacheKey = `${name}|${presentation}|${atDate.toISOString()}`;
                if (historyCache.has(cacheKey)) {
                    return historyCache.get(cacheKey);
                }

                let foundHistory = await this.prismaService.historyProduct.findFirst({
                    where: {
                        name,
                        presentation,
                        createdAt: { lte: atDate }
                    },
                    orderBy: { createdAt: 'desc' }
                });

                // Si no existe histórico previo, tomar el más cercano posterior para evitar usar el producto actual.
                if (!foundHistory) {
                    foundHistory = await this.prismaService.historyProduct.findFirst({
                        where: {
                            name,
                            presentation,
                            createdAt: { gte: atDate }
                        },
                        orderBy: { createdAt: 'asc' }
                    });
                }

                historyCache.set(cacheKey, foundHistory);
                return foundHistory;
            };

            for (const [, groupedPayments] of groupedByInvoice) {
                const firstPayment = groupedPayments.reduce((prev, current) =>
                    prev.createdAt <= current.createdAt ? prev : current
                );

                const invoiceRef = firstPayment.invoice;
                const paymentRefDate = firstPayment.createdAt;
                const invoiceCurrency = firstPayment.payment.account.method.currency;
                const saleRefDate = invoiceRef.dispatchDate || invoiceRef.createdAt;

                let earn = 0;
                for (const item of invoiceRef.invoiceItems) {
                    // Buscar el precio histórico del producto en el momento de la venta
                    const history = await getHistoryAtDate(item.product.name, item.product.presentation, saleRefDate);

                    // Si no hay histórico, usar el producto actual
                    const product = history || await getProductById(item.productId);

                    const purchasePrice = Number(product?.purchasePrice || 0);
                    const purchasePriceUSD = Number(product?.purchasePriceUSD || 0);

                    // Determinar si fue pagado en USD o BS
                    if (invoiceCurrency === 'USD') {
                        earn += (Number(item.unitPriceUSD) - purchasePriceUSD) * item.quantity;
                    } else {
                        earn += (Number(item.unitPrice) - purchasePrice) * item.quantity;
                    }
                }


                invoiceEarns.push({
                    invoiceId: firstPayment.invoiceId,
                    controlNumber: invoiceRef.controlNumber,
                    client: invoiceRef.client.name,
                    earn: Number(earn.toFixed(2)),
                    createdAt: paymentRefDate
                });

                totalEarnRange += earn;

                // Sumar a los totales del día y mes en base al rango seleccionado
                if (paymentRefDate >= startOfDay && paymentRefDate <= endOfDay) totalEarnDay += earn;
                if (paymentRefDate >= startOfMonth && paymentRefDate <= endDate) totalEarnMonth += earn;
            }

            return {
                productPercentages,
                invoiceEarns,
                totalEarnDay: Number(totalEarnDay.toFixed(2)),
                totalEarnMonth: Number(totalEarnMonth.toFixed(2)),
                totalEarnRange: Number(totalEarnRange.toFixed(2))
            };
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getInvoicesRemaining(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const invoices = await this.prismaService.invoice.findMany({
                where: {
                    status: 'Pagado',
                    OR: [
                        { remaining: { not: 0 } },
                        {
                            invoiceItems: {
                                some: { type: 'GIFT' }
                            }
                        }
                    ],
                    InvoicePayment: {
                        some: {
                            createdAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        }
                    }
                },
                include: { client: true, invoiceItems: { include: { product: true } } }
            })

            return invoices;
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getPayments(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { contains: 'Gastos' }
                    },
                    InvoicePayment: {
                        some: {
                            createdAt: {
                                gte: startDate,
                                lte: endDate
                            }
                        }
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    },
                    dolar: true
                }
            })

            const parsePayments = payments.map(payment => {
                const currency = payment.account?.method?.currency;
                const dolarRate = Number(payment?.dolar?.dolar || 0);
                const isDivisaPayment = this.isDivisaPayment(payment);

                let amountUSD = Number(payment.amount);
                if (currency === 'BS' && !isDivisaPayment) {
                    amountUSD = dolarRate > 0 ? Number(payment.amount) / dolarRate : 0;
                }

                return {
                    ...payment,
                    amountUSD: Number(amountUSD.toFixed(2))
                };
            })

            return parsePayments;
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }

    async getPaymentsNoAssociated(expenseFilter: ExpensesDTO) {
        try {
            const { startDate, endDate } = this.getNormalizedDateRange(expenseFilter);

            const payments = await this.prismaService.payment.findMany({
                where: {
                    account: {
                        name: { not: 'Gastos' }
                    },
                    paymentDate: {
                        gte: startDate,
                        lte: endDate
                    },
                    InvoicePayment: {
                        none: {}
                    }
                },
                include: {
                    account: {
                        include: {
                            method: true
                        }
                    },
                    dolar: true
                }
            })

            const parsePayments = payments.map(payment => {
                const currency = payment.account?.method?.currency;
                const dolarRate = Number(payment?.dolar?.dolar || 0);
                const isDivisaPayment = this.isDivisaPayment(payment);

                let amountUSD = Number(payment.amount);
                if (currency === 'BS' && !isDivisaPayment) {
                    amountUSD = dolarRate > 0 ? Number(payment.amount) / dolarRate : 0;
                }

                return {
                    ...payment,
                    amountUSD: Number(amountUSD.toFixed(2))
                };
            });

            return parsePayments;
        } catch (err) {
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
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
            badResponse.message = err instanceof Error ? err.message : 'Unknown error';
            return badResponse;
        }
    }
}
