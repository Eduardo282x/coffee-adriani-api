import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { DashboardExcel } from 'src/dto/base.dto';
import { PrismaService } from 'src/prisma/prisma.service';

import {
  format,
  eachDayOfInterval,
  addDays,
  startOfDay,
  endOfDay,
  subDays,
} from 'date-fns';
import { es } from 'date-fns/locale';
import { InvoicesService } from 'src/invoices/invoices.service';
import { InvoiceStatistics } from 'src/invoices/invoice.dto';
import { PaymentsService } from 'src/payments/payments.service';
import { calculateInvoiceRemainingUsd } from 'src/common/remaining-calculator';

const SNAPSHOT_PRODUCT_TYPES = ['Cafe', 'Queso', 'Huevo', 'Guayaba'];

@Injectable()
export class DashboardService {
  private readonly logger = new Logger(DashboardService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly invoicesService: InvoicesService,
    private readonly paymentsService: PaymentsService,
  ) {}

  private getPreviousWeekRange(): { startDate: Date; endDate: Date } {
    const now = new Date();
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const currentWeekMonday = startOfDay(subDays(now, daysSinceMonday));
    const startDate = subDays(currentWeekMonday, 7);
    const endDate = endOfDay(addDays(startDate, 6));
    return { startDate, endDate };
  }

  @Cron('0 5 * * 1', { timeZone: 'America/Caracas' })
  async generateWeeklySnapshots() {
    this.logger.debug('📊 Iniciando generación de reportes semanales...');
    try {
      const { startDate, endDate } = this.getPreviousWeekRange();
      const dateSuffix = format(startDate, 'yyyy-MM-dd');

      for (const type of SNAPSHOT_PRODUCT_TYPES) {
        try {
          const buffer = await this.generateInventoryAndInvoicesExcelV2({
            type,
            startDate,
            endDate,
          });
          const fileData = new Uint8Array(buffer);
          const fileName = `reporte-semanal-${type}-${dateSuffix}.xlsx`;

          await this.prismaService.weeklyReportSnapshot.upsert({
            where: {
              type_weekStart: { type, weekStart: startDate },
            },
            update: {
              weekEnd: endDate,
              fileName,
              file: fileData,
            },
            create: {
              type,
              weekStart: startDate,
              weekEnd: endDate,
              fileName,
              file: fileData,
            },
          });
          this.logger.debug(`✅ Reporte semanal ${type} generado exitosamente`);
        } catch (error) {
          await this.prismaService.errorMessages.create({
            data: {
              message: error instanceof Error ? error.message : String(error),
              from: 'DashboardService - WeeklySnapshot',
            },
          });
          this.logger.debug(
            `❌ Error al generar reporte semanal ${type}`,
            error instanceof Error ? error.message : String(error),
          );
        }
      }
      this.logger.debug('📊 Generación de reportes semanales completada');
    } catch (error) {
      this.logger.debug(
        '❌ Error general en generación de reportes semanales',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  async getSnapshots(type?: string, startDate?: string, endDate?: string) {
    return this.prismaService.weeklyReportSnapshot.findMany({
      where: {
        ...(type ? { type } : {}),
        ...(startDate && endDate
          ? {
              weekStart: {
                gte: this.getStartOfDayUtc(startDate),
                lte: this.getEndOfDayUtc(endDate),
              },
            }
          : {}),
      },
      orderBy: { weekStart: 'desc' },
      select: {
        id: true,
        type: true,
        weekStart: true,
        weekEnd: true,
        fileName: true,
        createdAt: true,
      },
    });
  }

  async getSnapshotById(id: number) {
    return this.prismaService.weeklyReportSnapshot.findUnique({
      where: { id },
      select: {
        id: true,
        type: true,
        weekStart: true,
        weekEnd: true,
        fileName: true,
        file: true,
      },
    });
  }

  private getStartOfDayUtc(date: Date | string) {
    const parseString = date.toString();
    if (parseString.length > 10) {
      return new Date(parseString);
    }
    return new Date(`${parseString}T00:00:00.000Z`);
  }

  private getEndOfDayUtc(date: Date | string) {
    const parseDate = date.toLocaleString();
    if (parseDate.length > 10) {
      return new Date(parseDate);
    }
    return new Date(`${parseDate}T23:59:59.999Z`);
  }

  async getDashboardData(filter: DashboardExcel) {
    try {
      // Formatear fechas como YYYY-MM-DD para compatibilidad con los servicios
      const formatDateStr = (date: Date | string): string => {
        const d = date instanceof Date ? date : new Date(date);
        return format(d, 'yyyy-MM-dd');
      };
      const startDateStr = formatDateStr(filter.startDate);
      const endDateStr = formatDateStr(filter.endDate);

      // 1. Ejecutar todas las consultas en paralelo usando los servicios estandarizados
      const [
        invoiceStatistics,
        paymentStatistics,
        inventory,
        lastPending,
        totalClients,
      ] = await Promise.all([
        // Usar InvoicesService.getInvoiceStatistics() para estadísticas de facturas
        this.invoicesService.getInvoiceStatistics({
          type: filter.type,
          startDate: startDateStr,
          endDate: endDateStr,
        }) as Promise<InvoiceStatistics>,

        // Usar PaymentsService.getPaymentsStatistics() para estadísticas de pagos
        this.paymentsService.getPaymentsStatistics({
          startDate: startDateStr,
          endDate: endDateStr,
          type: filter.type,
        }),

        // Obtener solo los campos necesarios de productos (inventario es específico del dashboard)
        this.prismaService.inventory.findMany({
          select: {
            id: true,
            quantity: true,
            product: {
              select: {
                name: true,
                presentation: true,
              },
            },
          },
          where: {
            product: {
              type: {
                contains: filter.type,
                mode: 'insensitive',
              },
            },
          },
        }),

        // Últimas 100 facturas pendientes - usando dispatchDate para consistencia
        this.prismaService.invoice.findMany({
          orderBy: { dispatchDate: 'desc' },
          take: 100,
          select: {
            id: true,
            controlNumber: true,
            dispatchDate: true,
            dueDate: true,
            totalAmount: true,
            status: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
          },
          where: {
            status: {
              in: ['Pagado', 'Pendiente', 'Vencida'],
            },
            dispatchDate: { gte: filter.startDate, lte: filter.endDate },
            invoiceItems: {
              every: {
                product: {
                  type: {
                    contains: filter.type,
                    mode: 'insensitive',
                  },
                },
              },
            },
          },
        }),

        this.prismaService.client.count(),
      ]);

      // 2. Calcular estadísticas de facturas por estado usando los datos del servicio
      const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
      const totalInvoices = invoiceStatistics.summary.invoiceCount;
      const payed = r2(invoiceStatistics.packagePaid);
      const expired = r2(invoiceStatistics.packagePending);
      const pending = r2(invoiceStatistics.packagePending);

      const percent = (amount: number) =>
        totalInvoices === 0
          ? 0
          : Number(((amount / totalInvoices) * 100).toFixed(2));

      // 3. Procesar productos e inventario
      const totalStock = inventory.reduce(
        (acc, p) => acc + Number(p.quantity),
        0,
      );

      const productsPercent = inventory.map((p) => {
        const productPercent =
          totalStock === 0
            ? 0
            : Number(((Number(p.quantity) / totalStock) * 100).toFixed(2));
        return {
          id: p.id,
          name: `${p.product.name} ${p.product.presentation}`,
          amount: r2(Number(p.quantity)),
          percent: productPercent,
        };
      });

      // 4. Filtrar productos con bajo stock (evitar iteración adicional)
      const lowStock = productsPercent.filter((p) => p.percent < 30);

      return {
        invoices: {
          total: totalInvoices,
          totalClients: totalClients,
          totalPackages: r2(invoiceStatistics.package),
          packagePaid: r2(invoiceStatistics.packagePaid),
          packagePending: r2(invoiceStatistics.packagePending),
          packagePaidUSD: r2(invoiceStatistics.packagePaidUSD),
          packagePaidBS: r2(invoiceStatistics.packagePaidBS),
          packagePendingUSD: r2(invoiceStatistics.packagePendingUSD),
          packagePendingBS: r2(invoiceStatistics.packagePendingBS),
          payed: { amount: payed, percent: percent(payed) },
          expired: { amount: expired, percent: percent(expired) },
          pending: { amount: pending, percent: percent(pending) },
          payments: {
            total: r2(invoiceStatistics.payments.total),
            totalPaid: r2(invoiceStatistics.payments.totalPaid),
            totalPending: r2(invoiceStatistics.payments.totalPending),
            debt: r2(invoiceStatistics.payments.debt),
            remaining: r2(invoiceStatistics.payments.remaining),
          },
          summary: {
            invoiceCount: invoiceStatistics.summary.invoiceCount,
            averageInvoiceValue: r2(
              invoiceStatistics.summary.averageInvoiceValue,
            ),
            paymentPercentage: r2(invoiceStatistics.summary.paymentPercentage),
          },
        },
        payments: {
          totalUSD: r2(paymentStatistics.totals.totalUSD),
          totalBs: r2(paymentStatistics.totals.totalBs),
          total: r2(paymentStatistics.totals.total),
          remaining: r2(paymentStatistics.totals.remaining),
          totalRemainingBs: r2(paymentStatistics.totals.totalRemainingBs),
          totalRemainingUSD: r2(paymentStatistics.totals.totalRemainingUSD),
          counts: paymentStatistics.counts,
          // byMethod: paymentStatistics.byMethod,
          expenses: {
            totalUSD: r2(paymentStatistics.expenses.totalUSD),
            totalBs: r2(paymentStatistics.expenses.totalBs),
            total: r2(paymentStatistics.expenses.total),
            count: paymentStatistics.expenses.count,
          },
        },
        inventory: {
          products: productsPercent,
          lowStock,
        },
        lastPending,
      };
    } catch (error) {
      console.log(error);
      // Manejar el error adecuadamente
      throw new Error(`Error al generar el dashboard: ${error}`);
    }
  }

  async generateInventoryAndInvoicesExcelV2(
    filter: DashboardExcel,
  ): Promise<Buffer> {
    const endDatePlusOne = addDays(new Date(filter.endDate), 1);

    // 1. Ejecutar todas las consultas en paralelo con selects optimizados
    const [
      productos,
      facturas,
      facturasCentros,
      facturasHastaCierre,
      pagosEnRango,
      paymentStatistics,
      // currentDolar,
      inventarioMovsAntes,
    ] = await Promise.all([
      // Productos con solo campos necesarios
      this.prismaService.product.findMany({
        select: {
          id: true,
          name: true,
          presentation: true,
          amount: true,
        },
        where: {
          type: {
            contains: filter.type,
            mode: 'insensitive',
          },
        },
      }),

      // Facturas en el rango
      this.prismaService.invoice.findMany({
        where: {
          dispatchDate: {
            gte: this.getStartOfDayUtc(filter.startDate),
            lte: this.getEndOfDayUtc(filter.endDate),
          },
          invoiceItems: {
            every: {
              product: {
                type: {
                  contains: filter.type,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
        select: {
          id: true,
          controlNumber: true,
          dispatchDate: true,
          dueDate: true,
          totalAmount: true,
          status: true,
          client: {
            select: {
              name: true,
              zone: true,
              block: {
                select: { name: true },
              },
            },
          },
          invoiceItems: {
            select: {
              quantity: true,
              unitPrice: true,
              unitPriceUSD: true,
              productId: true,
              product: {
                select: {
                  id: true,
                  name: true,
                  presentation: true,
                },
              },
            },
          },
          InvoicePayment: {
            select: {
              amount: true,
              payment: {
                select: {
                  account: {
                    select: {
                      method: {
                        select: { currency: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { dispatchDate: 'asc' },
      }),

      // Facturas de centros
      this.prismaService.invoice.findMany({
        where: {
          dispatchDate: { lte: this.getEndOfDayUtc(filter.endDate) },
          client: {
            block: {
              name: { contains: 'centro', mode: 'insensitive' },
            },
          },
          invoiceItems: {
            every: {
              product: {
                type: {
                  contains: filter.type,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
        select: {
          id: true,
          totalAmount: true,
          InvoicePayment: {
            select: {
              amount: true,
            },
          },
          invoiceItems: {
            select: { quantity: true },
          },
          client: {
            select: {
              block: {
                select: { name: true },
              },
            },
          },
        },
        orderBy: { dispatchDate: 'asc' },
      }),

      // Facturas hasta cierre
      this.prismaService.invoice.findMany({
        where: {
          dispatchDate: { lte: this.getEndOfDayUtc(endDatePlusOne) },
          invoiceItems: {
            some: {
              product: {
                type: {
                  contains: filter.type,
                  mode: 'insensitive',
                },
              },
            },
          },
        },
        select: {
          id: true,
          totalAmount: true,
          invoiceItems: {
            select: { quantity: true },
          },
          InvoicePayment: {
            select: {
              amount: true,
              payment: {
                select: {
                  account: {
                    select: {
                      method: {
                        select: { currency: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),

      // Pagos en rango
      this.prismaService.payment.findMany({
        where: {
          paymentDate: {
            gte: this.getStartOfDayUtc(filter.startDate),
            lte: this.getEndOfDayUtc(endDatePlusOne),
          },
          type: 'INCOME',
        },
        select: {
          paymentDate: true,
          reference: true,
          amount: true,
          description: true,
          account: {
            select: {
              name: true,
              method: {
                select: {
                  name: true,
                  currency: true,
                },
              },
            },
          },
          dolar: {
            select: { dolar: true },
          },
          InvoicePayment: {
            select: {
              amount: true,
              invoice: {
                select: {
                  id: true,
                  controlNumber: true,
                  totalAmount: true,
                  invoiceItems: {
                    select: {
                      quantity: true,
                      unitPrice: true,
                      product: {
                        select: {
                          name: true,
                          presentation: true,
                        },
                      },
                    },
                  },
                  client: {
                    select: {
                      block: {
                        select: { name: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        orderBy: { paymentDate: 'asc' },
      }),

      // Estadísticas de pagos (incluye unassociatedAmount)
      this.paymentsService.getPaymentsStatistics({
        startDate: format(new Date(2000, 1, 1), 'yyyy-MM-dd'),
        endDate: format(new Date(filter.endDate), 'yyyy-MM-dd'),
        type: filter.type,
      }),

      // Movimientos de inventario antes del rango (agrupados)
      this.prismaService.inventoryEntryDetail.findMany({
        where: {
          inventoryEntry: { date: { lt: filter.startDate } },
        },
        select: {
          productId: true,
          quantity: true,
          inventoryEntry: { select: { movementType: true } },
        },
      }),
    ]);

    // 2. Preparar estructuras de datos optimizadas
    const dias = eachDayOfInterval({
      start: this.getStartOfDayUtc(filter.startDate),
      end: this.getEndOfDayUtc(filter.endDate),
    });
    // const exchangeRateUsed = currentDolar?.dolar || 1;

    // Mapear movimientos de inventario por producto
    const inventarioInicialMap = new Map();
    inventarioMovsAntes.forEach((mov) => {
      const sign = mov.inventoryEntry.movementType === 'OUT' ? -1 : 1;
      const current = inventarioInicialMap.get(mov.productId) || 0;
      inventarioInicialMap.set(
        mov.productId,
        current + Number(mov.quantity) * sign,
      );
    });

    // Calcular inventario inicial
    const inventarioInicial = {};
    productos.forEach((p) => {
      inventarioInicial[p.id] =
        (p.amount || 0) + (inventarioInicialMap.get(p.id) || 0);
    });

    // 3. Calcular métricas de pagos de forma eficiente
    const pagosDivisas = pagosEnRango
      .filter(
        (p) =>
          p.account.method.name.toLowerCase().includes('efectivo') &&
          p.account.method.currency.toLowerCase().includes('usd'),
      )
      .reduce((sum, p) => sum + Number(p.amount), 0);

    const pagosTransferencias = pagosEnRango
      .filter(
        (p) =>
          p.account.method.name.toLowerCase().includes('transferencia') ||
          p.account.method.name.toLowerCase().includes('pago movil') ||
          p.account.method.name.toLowerCase().includes('bs'),
      )
      .reduce((sum, p) => sum + Number(p.amount) / Number(p.dolar.dolar), 0);

    const totalPagosSinAsociar = paymentStatistics.totals.unassociatedAmount;

    // 4. Estadísticas de facturas usando el servicio para consistencia
    const baseStartDate = new Date(2020, 1, 1);
    const [invoiceStatisticsWeek, invoiceStatistics] = await Promise.all([
      // Estadísticas de la semana (rango del filtro)
      this.invoicesService.getInvoiceStatistics({
        type: filter.type,
        startDate:
          filter.startDate instanceof Date
            ? filter.startDate.toISOString()
            : new Date(filter.startDate).toISOString(),
        endDate:
          filter.endDate instanceof Date
            ? filter.endDate.toISOString()
            : new Date(filter.endDate).toISOString(),
      }) as Promise<InvoiceStatistics>,
      // Estadísticas acumuladas (desde 2020 hasta endDate) para bultosPorCobrar
      this.invoicesService.getInvoiceStatistics({
        type: filter.type,
        startDate: baseStartDate.toISOString(),
        endDate: new Date(filter.endDate).toISOString(),
      }) as Promise<InvoiceStatistics>,
    ]);

    const bultosPagados = invoiceStatisticsWeek.packagePaid;
    const bultosPorCobrar = invoiceStatistics.packagePending;

    // Cache para totales de facturas (mantenido para métricas de centro)
    const facturaTotalesCache = new Map();
    facturas.forEach((f) => {
      const totalBultos = f.invoiceItems.reduce(
        (sum, item) => sum + Number(item.quantity),
        0,
      );
      facturaTotalesCache.set(f.id, {
        totalBultos,
        totalAmount: Number(f.totalAmount),
        remaining: calculateInvoiceRemainingUsd(
          f.totalAmount,
          f.InvoicePayment,
        ),
      });
    });

    // 5. Calcular despachados agrupados usando detPackage del servicio (aplica factor de conversión)
    // detPackage[].product tiene formato "Cafe Gourmet Gourmet 100 y 200" (nombre + presentación)
    const categoryProducto: Record<string, string> = {
      'Cafe Gourmet': 'Gourmet 100 y 200',
      'Cafe Premium': 'Premium 100 y 200',
      'Cafe Especial': 'Especial 250',
      'Cafe en Grano': 'Grano Kg',
    };

    const despachados: Record<string, number> = {};
    invoiceStatisticsWeek.detPackage.forEach((det) => {
      // Buscar cuál categoría del mapa coincide con el nombre del producto
      for (const [productKey, category] of Object.entries(categoryProducto)) {
        if (det.product.startsWith(productKey)) {
          despachados[category] =
            (despachados[category] || 0) + det.totalQuantity;
          break;
        }
      }
    });

    // 6. Calcular despachos por día y producto con factor de conversión
    const despachosPorDiaYProducto = {};
    dias.forEach((dia) => {
      const fechaKey = format(dia, 'yyyy-MM-dd');
      despachosPorDiaYProducto[fechaKey] = {};
      productos.forEach((producto) => {
        despachosPorDiaYProducto[fechaKey][producto.id] = 0;
      });
    });

    facturas.forEach((factura) => {
      const fechaDespacho = format(factura.dispatchDate, 'yyyy-MM-dd');
      if (despachosPorDiaYProducto[fechaDespacho]) {
        factura.invoiceItems.forEach((item) => {
          if (
            despachosPorDiaYProducto[fechaDespacho][item.productId] !==
            undefined
          ) {
            const conversionFactor =
              item.product.presentation === '1kilo' ? 0.2 : 1;
            despachosPorDiaYProducto[fechaDespacho][item.productId] +=
              Number(item.quantity) * conversionFactor;
          }
        });
      }
    });

    // 7. Calcular métricas de centro
    let bultosDespachadosCentro = 0;
    let bultosPagadosCentroTotal = 0;
    let bultosPendientesCentroTotal = 0;

    const centroInvoicesById = new Map(
      facturasCentros.map((facturaCentro) => {
        const totalBultos = facturaCentro.invoiceItems.reduce(
          (sum, item) => sum + Number(item.quantity),
          0,
        );
        return [
          facturaCentro.id,
          {
            totalBultos,
            totalFactura: Number(facturaCentro.totalAmount),
          },
        ] as const;
      }),
    );

    facturas.forEach((factura) => {
      if (factura.client.block.name.toLowerCase().includes('centro')) {
        bultosDespachadosCentro += factura.invoiceItems.reduce(
          (sum, item) => sum + Number(item.quantity),
          0,
        );
      }
    });

    pagosEnRango.forEach((pago) => {
      pago.InvoicePayment.forEach((invoicePayment) => {
        const factura = invoicePayment.invoice;
        if (factura.client.block.name.toLowerCase().includes('centro')) {
          const centroFactura = centroInvoicesById.get(factura.id);
          if (!centroFactura) {
            return;
          }

          const montoAsignado = Number(invoicePayment.amount);
          const porcentajePagado =
            centroFactura.totalFactura > 0
              ? Math.min(
                  Math.max(montoAsignado / centroFactura.totalFactura, 0),
                  1,
                )
              : 0;
          bultosPagadosCentroTotal +=
            centroFactura.totalBultos * porcentajePagado;
        }
      });
    });

    facturasCentros.forEach((facturaCentro) => {
      const centroFactura = centroInvoicesById.get(facturaCentro.id);
      if (!centroFactura) {
        return;
      }

      const pendiente = calculateInvoiceRemainingUsd(
        facturaCentro.totalAmount,
        facturaCentro.InvoicePayment,
      );
      if (centroFactura.totalFactura > 0) {
        const porcentajePendiente = Math.min(
          Math.max(pendiente / centroFactura.totalFactura, 0),
          1,
        );
        bultosPendientesCentroTotal +=
          centroFactura.totalBultos * porcentajePendiente;
      }
    });

    // 8. Calcular deuda por cobrar
    const deudaPorCobrar = facturasHastaCierre.reduce(
      (sum, f) =>
        sum + calculateInvoiceRemainingUsd(f.totalAmount, f.InvoicePayment),
      0,
    );

    // bultosPorCobrar ya se obtuvo en el paso 4 (invoiceStatistics.packagePending)

    // ============== GENERACIÓN DEL EXCEL ==============
    const ExcelJS: any = (await import('exceljs')).default;
    const workbook = new ExcelJS.Workbook();

    // HOJA 1: REPORTE SEMANAL
    const wsReporte = workbook.addWorksheet('Reporte Semanal');
    wsReporte.columns = [
      { width: 25 },
      { width: 20 },
      { width: 15 },
      { width: 15 },
      { width: 15 },
    ];

    // Título y fecha
    wsReporte.getCell('C3').value = 'Reporte semanal';
    wsReporte.getCell('C3').font = { bold: true, size: 14 };
    wsReporte.getCell('D2').value = 'Fecha';
    wsReporte.getCell('D2').font = { bold: true };
    wsReporte.getCell('D3').value =
      `${format(filter.startDate, 'dd/MM/yyyy')} - ${format(filter.endDate, 'dd/MM/yyyy')}`;
    wsReporte.getCell('D3').alignment = { horizontal: 'center' };

    // Ingresos
    wsReporte.getCell('C5').value = 'Ingresos de la semana';
    wsReporte.getCell('B6').value = 'Divisas:';
    wsReporte.getCell('B6').font = { bold: true };
    wsReporte.getCell('B7').value = pagosDivisas.toFixed(2);
    wsReporte.getCell('C6').value = 'Transferencia:';
    wsReporte.getCell('C6').font = { bold: true };
    wsReporte.getCell('C7').value = pagosTransferencias.toFixed(2);
    wsReporte.getCell('D6').value = 'Sin asociar:';
    wsReporte.getCell('D6').font = { bold: true };
    wsReporte.getCell('D7').value = totalPagosSinAsociar.toFixed(2);

    // Bultos pagados
    wsReporte.getCell('B8').value = 'Bultos Pagados:';
    wsReporte.getCell('B8').font = { bold: true };
    wsReporte.getCell('B9').value = bultosPagados.toFixed(2);
    wsReporte.getCell('D8').value = 'Ganancias:';
    wsReporte.getCell('D8').font = { bold: true };

    // Inventario y despachados
    wsReporte.getCell('B11').value = 'Inventario:';
    wsReporte.getCell('B11').font = { bold: true };
    wsReporte.getCell('D11').value = 'Despachados de la semana:';
    wsReporte.getCell('D11').font = { bold: true };

    const productosEspeciales = [
      'Gourmet 100 y 200',
      'Especial 250',
      'Premium 100 y 200',
      'Grano Kg',
    ];
    let rowIndex = 12;

    productosEspeciales.forEach((nombreProd) => {
      wsReporte.getCell(`B${rowIndex}`).value = `${nombreProd}:`;
      wsReporte.getCell(`D${rowIndex}`).value = despachados[nombreProd] || 0;
      rowIndex++;
    });

    // Total despachado
    const totalDespachado = Object.values(despachados).reduce(
      (sum: number, val: any) => sum + val,
      0,
    );
    wsReporte.getCell('B16').value = 'Total:';
    wsReporte.getCell('B16').font = { bold: true };
    wsReporte.getCell(`D${rowIndex}`).value = totalDespachado as number;

    // Bultos y deuda por cobrar
    wsReporte.getCell('B18').value = 'Bultos por cobrar:';
    wsReporte.getCell('B18').font = { bold: true };
    wsReporte.getCell('B19').value = bultosPorCobrar.toFixed(4);
    wsReporte.getCell('D18').value = 'Deuda por cobrar:';
    wsReporte.getCell('D18').font = { bold: true };
    wsReporte.getCell('D19').value = deudaPorCobrar.toFixed(2);

    // Bultos del centro
    wsReporte.getCell('B20').value = 'Bultos del centro';
    wsReporte.getCell('B20').font = { bold: true };
    wsReporte.getCell('D20').value = 'Facturas perdidas:';
    wsReporte.getCell('D20').font = { bold: true };
    wsReporte.getCell('E20').value =
      invoiceStatisticsWeek.packageLostTotal.toFixed(4);
    wsReporte.getCell('B21').value = 'Despachados:';
    wsReporte.getCell('B21').font = { bold: true };
    wsReporte.getCell('C21').value = bultosDespachadosCentro.toFixed(2);
    wsReporte.getCell('B22').value = 'Pagos:';
    wsReporte.getCell('B22').font = { bold: true };
    wsReporte.getCell('C22').value = bultosPagadosCentroTotal.toFixed(2);
    wsReporte.getCell('B23').value = 'Pendientes:';
    wsReporte.getCell('B23').font = { bold: true };
    wsReporte.getCell('C23').value = bultosPendientesCentroTotal.toFixed(2);
    wsReporte.getCell('B24').value = 'Gastos:';
    wsReporte.getCell('B24').font = { bold: true };
    wsReporte.getCell('C24').value =
      paymentStatistics.expensesGroup.total.toFixed(2);

    // Detalle por producto (datos de getInvoiceStatistics)
    let detailRow = 25;
    wsReporte.getCell(`B${detailRow}`).value = 'Detalle por producto:';
    wsReporte.getCell(`B${detailRow}`).font = { bold: true, size: 11 };
    detailRow++;

    wsReporte.getCell(`B${detailRow}`).value = 'Producto';
    wsReporte.getCell(`C${detailRow}`).value = 'Total';
    wsReporte.getCell(`D${detailRow}`).value = 'Pagado';
    wsReporte.getCell(`E${detailRow}`).value = 'Pendiente';
    wsReporte.getCell(`B${detailRow}`).font = { bold: true };
    wsReporte.getCell(`C${detailRow}`).font = { bold: true };
    wsReporte.getCell(`D${detailRow}`).font = { bold: true };
    wsReporte.getCell(`E${detailRow}`).font = { bold: true };
    detailRow++;

    invoiceStatisticsWeek.detPackage.forEach((det) => {
      wsReporte.getCell(`B${detailRow}`).value = det.product;
      wsReporte.getCell(`C${detailRow}`).value = Number(
        det.totalQuantity.toFixed(4),
      );
      wsReporte.getCell(`D${detailRow}`).value = Number(
        det.paidQuantity.toFixed(4),
      );
      wsReporte.getCell(`E${detailRow}`).value = Number(
        det.pendingQuantity.toFixed(4),
      );
      detailRow++;
    });

    // Aplicar bordes
    for (let row = 2; row <= detailRow; row++) {
      for (let col = 2; col <= 5; col++) {
        const cell = wsReporte.getCell(row, col);
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      }
    }

    // HOJA INVENTARIO
    const wsInv = workbook.addWorksheet('Inventario');
    const header = ['Producto', 'Inventario Inicial'];
    dias.forEach((d) =>
      header.push(format(d, 'EEEE dd/MM/yyyy', { locale: es })),
    );
    header.push('Total Despachado', 'Inventario Actual');
    wsInv.addRow(header);

    productos.forEach((p) => {
      const fila = [`${p.name} ${p.presentation}`, inventarioInicial[p.id]];
      let inventarioActual = inventarioInicial[p.id];
      let totalDespachado = 0;

      dias.forEach((dia) => {
        const fechaKey = format(dia, 'yyyy-MM-dd');
        const cantidadDespachada: number =
          despachosPorDiaYProducto[fechaKey][p.id] || 0;
        fila.push(cantidadDespachada);
        inventarioActual -= Number(cantidadDespachada);
        totalDespachado += Number(cantidadDespachada);
      });

      fila.push(totalDespachado, inventarioActual);
      wsInv.addRow(fila);
    });

    // HOJA FACTURAS
    const wsFact = workbook.addWorksheet('Facturas');
    const prodHeaders = productos.map((p) => p.name);
    wsFact.addRow([
      'Nro de control',
      'Cliente',
      'Bloque',
      'Dirección zona',
      'Fecha despacho',
      'Fecha vencimiento',
      'Total',
      'Debe',
      'Estado',
      ...prodHeaders,
    ]);

    facturas.forEach((f) => {
      const invoiceRemaining = calculateInvoiceRemainingUsd(
        f.totalAmount,
        f.InvoicePayment,
      );
      const prodMap = {};
      f.invoiceItems.forEach((item) => {
        prodMap[item.product.name] = item.unitPriceUSD
          ? Number(item.unitPriceUSD)
          : Number(item.unitPrice);
      });
      wsFact.addRow([
        f.controlNumber,
        f.client.name,
        f.client.block.name,
        f.client.zone,
        format(f.dispatchDate, 'dd/MM/yyyy'),
        format(f.dueDate, 'dd/MM/yyyy'),
        Number(f.totalAmount),
        invoiceRemaining,
        f.status,
        ...productos.map((p) => prodMap[p.name] ?? ''),
      ]);
    });

    // HOJA PAGOS
    const wsPagos = workbook.addWorksheet('Análisis de Pagos');
    const headerPagos = [
      'Fecha Pago',
      'Referencia',
      'Cuenta',
      'Método',
      'Monto ($)',
      'Tasa Dólar',
      'Monto (Bs)',
      'Descripción',
      'Factura Asociada',
      'Total Factura ($)',
      'Cantidad Total Items',
      'Monto Asignado ($)',
      'Equivalente en Items',
      'Porcentaje Pagado',
    ];
    wsPagos.addRow(headerPagos);

    let totalPagado = 0;
    let totalItemsPagados = 0;
    const totalFacturasAfectadas = new Set();

    pagosEnRango.forEach((pago) => {
      const montoPagoUSD =
        pago.account.method.currency === 'USD'
          ? Number(pago.amount)
          : Number(pago.amount) / Number(pago.dolar.dolar);
      const montoPagoBS =
        pago.account.method.currency === 'BS'
          ? Number(pago.amount)
          : Number(pago.amount) * Number(pago.dolar.dolar);

      totalPagado += montoPagoUSD;

      if (pago.InvoicePayment.length === 0) {
        wsPagos.addRow([
          format(pago.paymentDate, 'dd/MM/yyyy'),
          pago.reference,
          pago.account.name,
          pago.account.method.name,
          montoPagoUSD.toFixed(2),
          Number(pago.dolar.dolar).toFixed(2),
          montoPagoBS.toFixed(2),
          pago.description,
          'Sin factura asociada',
          '-',
          '-',
          '-',
          '-',
          '-',
        ]);
      } else {
        pago.InvoicePayment.forEach((invoicePayment) => {
          const factura = invoicePayment.invoice;
          const montoAsignado = Number(invoicePayment.amount);
          const totalFactura = Number(factura.totalAmount);
          const cantidadTotalItems = factura.invoiceItems.reduce(
            (sum, item) => sum + Number(item.quantity),
            0,
          );
          const porcentajePagado = montoAsignado / totalFactura;
          const equivalenteItems = cantidadTotalItems * porcentajePagado;

          totalItemsPagados += equivalenteItems;
          totalFacturasAfectadas.add(factura.id);

          wsPagos.addRow([
            format(pago.paymentDate, 'dd/MM/yyyy'),
            pago.reference,
            pago.account.name,
            pago.account.method.name,
            montoPagoUSD.toFixed(2),
            Number(pago.dolar.dolar).toFixed(2),
            montoPagoBS.toFixed(2),
            pago.description,
            `#${factura.controlNumber}`,
            totalFactura.toFixed(2),
            cantidadTotalItems,
            montoAsignado.toFixed(2),
            equivalenteItems.toFixed(2),
            `${(porcentajePagado * 100).toFixed(1)}%`,
          ]);
        });
      }
    });

    wsPagos.addRow([]);
    wsPagos.addRow(['=== RESUMEN GENERAL ===']);
    wsPagos.addRow(['Total Pagado ($):', totalPagado.toFixed(2)]);
    wsPagos.addRow(['Total Items Equivalentes:', totalItemsPagados.toFixed(2)]);
    wsPagos.addRow(['Facturas Afectadas:', totalFacturasAfectadas.size]);

    // HOJA RESUMEN POR PRODUCTO
    const wsResumenProductos = workbook.addWorksheet('Productos Pagados');
    const headerProductos = [
      'Producto',
      'Cantidad Pagada',
      'Precio Promedio ($)',
      'Monto Total Pagado ($)',
    ];
    wsResumenProductos.addRow(headerProductos);

    type ProductoResumen = {
      cantidadPagada: number;
      montoTotalPagado: number;
      precioPromedio: number;
    };
    const productosResumen: Record<string, ProductoResumen> = {};

    pagosEnRango.forEach((pago) => {
      pago.InvoicePayment.forEach((invoicePayment) => {
        const factura = invoicePayment.invoice;
        const montoAsignado = Number(invoicePayment.amount);
        const totalFactura = Number(factura.totalAmount);
        const porcentajePagado = montoAsignado / totalFactura;

        factura.invoiceItems.forEach((item) => {
          const productoKey = `${item.product.name} ${item.product.presentation}`;
          const cantidadPagada = Number(item.quantity) * porcentajePagado;
          const montoPagadoProducto = Number(item.unitPrice) * cantidadPagada;

          if (!productosResumen[productoKey]) {
            productosResumen[productoKey] = {
              cantidadPagada: 0,
              montoTotalPagado: 0,
              precioPromedio: Number(item.unitPrice),
            };
          }

          productosResumen[productoKey].cantidadPagada += cantidadPagada;
          productosResumen[productoKey].montoTotalPagado += montoPagadoProducto;
          productosResumen[productoKey].precioPromedio =
            productosResumen[productoKey].montoTotalPagado /
            productosResumen[productoKey].cantidadPagada;
        });
      });
    });

    let totalGeneralProductos = 0;
    Object.entries(productosResumen).forEach(([nombreProducto, datos]) => {
      wsResumenProductos.addRow([
        nombreProducto,
        datos.cantidadPagada.toFixed(2),
        datos.precioPromedio.toFixed(2),
        datos.montoTotalPagado.toFixed(2),
      ]);
      totalGeneralProductos += datos.montoTotalPagado;
    });

    wsResumenProductos.addRow([]);
    wsResumenProductos.addRow([
      'TOTAL GENERAL',
      '',
      '',
      totalGeneralProductos.toFixed(2),
    ]);

    // Aplicar estilos
    [wsPagos, wsResumenProductos].forEach((ws) => {
      const headerRow = ws.getRow(1);
      headerRow.font = { bold: true, color: { argb: 'FFFFFF' } };
      headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: '4472C4' },
      };
      headerRow.alignment = { horizontal: 'center' };

      ws.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 10;
          if (columnLength > maxLength) maxLength = columnLength;
        });
        column.width = Math.min(Math.max(maxLength + 2, 10), 50);
      });
    });

    // Exportar
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    return Buffer.from(arrayBuffer);
  }

  async getClientsDemandReport(filter: DashboardExcel) {
    const { type, startDate, endDate } = filter;
    // Obtener facturas en el rango con items y cliente
    const invoices = await this.prismaService.invoice.findMany({
      where: {
        dispatchDate: {
          gte: this.getStartOfDayUtc(startDate),
          lte: this.getEndOfDayUtc(endDate),
        },
        invoiceItems: {
          every: {
            product: {
              type: {
                contains: type,
                mode: 'insensitive',
              },
            },
          },
        },
      },
      include: {
        client: {
          include: {
            block: true,
          },
        },
        invoiceItems: {
          include: {
            product: true,
          },
        },
      },
    });

    // Definir los rangos de categorías
    const ranges = [
      { label: '1-10', min: 1, max: 10 },
      { label: '11-20', min: 11, max: 20 },
      { label: '21-30', min: 21, max: 30 },
      { label: '31-40', min: 31, max: 40 },
      { label: '41-50', min: 41, max: 50 },
      { label: '51-60', min: 51, max: 60 },
      { label: '61-70', min: 61, max: 70 },
      { label: '71-80', min: 71, max: 80 },
      { label: '81-90', min: 81, max: 90 },
      { label: '91-100', min: 91, max: 100 },
      { label: '101+', min: 101, max: Infinity },
    ];

    // Inicializar buckets agrupados por cliente
    const buckets: Record<
      string,
      Array<{
        clientName: string;
        clientBlock: string;
        invoicesCount: number;
        invoices: Array<{
          controlNumber: string;
          dispatchDate: Date;
          status: string;
          totalElements: number;
        }>;
      }>
    > = {};
    ranges.forEach((r) => {
      buckets[r.label] = [];
    });

    // Map para agrupar por cliente dentro de cada bucket
    const bucketClientMap: Record<
      string,
      Map<
        string,
        {
          clientName: string;
          clientBlock: string;
          invoicesCount: number;
          invoices: Array<{
            controlNumber: string;
            dispatchDate: Date;
            status: string;
            totalElements: number;
          }>;
        }
      >
    > = {};
    ranges.forEach((r) => {
      bucketClientMap[r.label] = new Map();
    });

    for (const inv of invoices) {
      const totalElements = inv.invoiceItems
        .filter((sale) => sale.type == 'SALE')
        .reduce(
          (sum, it) =>
            sum +
            (it.product.presentation === '1kilo'
              ? Number(it.quantity) * 0.2
              : Number(it.quantity)),
          0,
        );
      const range = ranges.find(
        (r) => totalElements >= r.min && totalElements <= r.max,
      );
      if (!range) continue;
      const clientName = inv.client?.name || 'Sin nombre';
      const clientBlock = inv.client?.block?.name || 'Sin bloque';
      const clientKey = inv.clientId.toString();
      const invoiceDetail = {
        controlNumber: inv.controlNumber,
        dispatchDate: inv.dispatchDate,
        status: inv.status,
        totalElements,
      };
      const map = bucketClientMap[range.label];
      if (!map.has(clientKey)) {
        map.set(clientKey, {
          clientName,
          clientBlock,
          invoicesCount: 1,
          invoices: [invoiceDetail],
        });
      } else {
        const entry = map.get(clientKey)!;
        entry.invoicesCount += 1;
        entry.invoices.push(invoiceDetail);
      }
    }

    // Convertir los maps a arrays para cada bucket
    ranges.forEach((r) => {
      buckets[r.label] = Array.from(bucketClientMap[r.label].values());
    });

    // Resumen: cantidad de facturas por bucket
    const summary = ranges.map((r) => ({
      range: r.label,
      count: buckets[r.label].reduce((acc, c) => acc + c.invoicesCount, 0),
    }));

    const topClients = Object.values(buckets)
      .flat()
      .sort((a, b) => b.invoicesCount - a.invoicesCount);

    return {
      topClients,
      summary,
      buckets,
      totalInvoices: invoices.length,
    };
  }
}
