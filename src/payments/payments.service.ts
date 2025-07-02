import { Injectable } from '@nestjs/common';
import { badResponse, baseResponse, DTODateRangeFilter } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { AccountsDTO, PayInvoiceDTO, PaymentDTO } from './payment.dto';
import { ProductsService } from 'src/products/products.service';
import { BankData } from './payments.data';
import { PaymentParseExcel } from 'src/excel/excel.interfaces';
import { InvoiceStatus, PaymentStatus } from '@prisma/client';

@Injectable()
export class PaymentsService {

    constructor(
        private readonly prismaService: PrismaService,
        private readonly productService: ProductsService
    ) { }

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

            if (Number(totalInvoices) > Number(findPayment.amount)) {
                badResponse.message = 'La cantidad a pagar excede la cantidad del pago.'
                return badResponse;
            }

            pay.details.map(async (pay) => {
                let findInvoice = await this.prismaService.invoice.findFirst({
                    where: { id: pay.invoiceId },
                    include: { invoiceItems: true }
                });

                if (!findInvoice) {
                    throw new Error(`Factura con ID ${pay.invoiceId} no encontrada.`);
                }

                if (findInvoice.status === 'Pagado') {
                    throw new Error(`La factura #${findInvoice.controlNumber} ya está pagada.`);
                }

                // const totalAmountPay = findPayment.account.method.currency === 'BS'
                //     ? pay.amount / Number(findPayment.dolar.dolar)
                //     : pay.amount

                if (findPayment.account.method.currency == 'USD' && Number(findInvoice.remaining) == Number(findInvoice.totalAmount)) {
                    const newTotalUSD = findInvoice.invoiceItems.reduce((acc, item) => acc + (Number(item.unitPriceUSD) * item.quantity), 0)
                    findInvoice = await this.prismaService.invoice.update({
                        data: { totalAmount: Number(newTotalUSD).toFixed(2), remaining: Number(newTotalUSD).toFixed(2) },
                        include: { invoiceItems: true },
                        where: { id: findInvoice.id }
                    });

                    findInvoice.invoiceItems.map(async (item) => {
                        await this.prismaService.invoiceProduct.update({
                            data: {
                                unitPrice: item.unitPriceUSD,
                                subtotal: Number(item.unitPriceUSD) * item.quantity
                            },
                            where: { id: item.id }
                        })
                    })
                }

                await this.prismaService.invoicePayment.create({
                    data: {
                        invoiceId: findInvoice.id,
                        paymentId: findPayment.id,
                        amount: pay.amount
                    }
                });

                const calculateRemaining = findPayment.account.method.currency == 'BS'
                    ? ((Number(findPayment.amount) / Number(findPayment.dolar.dolar)) - pay.amount) * Number(findPayment.dolar.dolar)
                    : Number(findPayment.amount) - pay.amount;

                await this.prismaService.payment.update({
                    data: { remaining: Number(calculateRemaining) },
                    where: { id: findPayment.id }
                })

                await this.prismaService.invoice.update({
                    where: { id: findInvoice.id },
                    data: {
                        remaining: {
                            decrement: pay.amount,
                        },
                        status: Number(findInvoice.remaining) - pay.amount <= 2 ? 'Pagado' : 'Pendiente',
                    },
                });

                if (Number(findInvoice.remaining) - pay.amount <= 2) {
                    const findClientReminder = await this.prismaService.clientReminder.findFirst({
                        where: {
                            clientId: findInvoice.clientId,
                        }
                    })

                    if(findClientReminder){
                        await this.prismaService.clientReminder.delete({
                            where: {
                                id: findClientReminder.id,
                            }
                        })
                    }
                }
            });

            baseResponse.message = `Pago Asociado a factura exitosamente.`
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