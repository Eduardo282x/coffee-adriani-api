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
import {
  endOfDayUtc,
  formatDateInTz,
  getBusinessTimeZone,
  getLowStockThreshold,
  startOfDayUtc,
  startOfNextDayUtc,
} from 'src/common/date-utils';

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

  /**
   * Reimplementado en `src/common/date-utils.ts`.
   *
   * La version local hacia `new Date(date.toLocaleString())` y luego
   * `new Date("28/09/2026, 12:00:00 AM")`. Eso depende del locale del
   * runtime y del separador invisible U+202F que ICU >= 72 inserta antes de
   * AM/PM, por lo que devolvia `Invalid Date` y los rangos del dashboard se
   * convertian en `gte: Invalid Date` (comparacion siempre falsa => cero
   * resultados). Ahora los rangos son dias de calendario en
   * `BUSINESS_TZ` con limite exclusivo.
   */
  private getStartOfDayUtc(date: Date | string) {
    return startOfDayUtc(date);
  }

  private getEndOfDayUtc(date: Date | string) {
    return endOfDayUtc(date);
  }

  private getStartOfNextDayUtc(date: Date | string) {
    return startOfNextDayUtc(date);
  }

  async getDashboardData(filter: DashboardExcel) {
    try {
      // Formatear fechas como YYYY-MM-DD en la zona de negocio. `format` de
      // date-fns usa la TZ del runtime y puede desplazar el dia si el servidor
      // no corre en `BUSINESS_TZ`.
      const formatDateStr = (date: Date | string): string =>
        formatDateInTz(startOfDayUtc(date), getBusinessTimeZone());
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
            deleted: false,
            status: {
              in: ['Pagado', 'Pendiente', 'Vencida'],
            },
            dispatchDate: {
              gte: this.getStartOfDayUtc(filter.startDate),
              lt: this.getStartOfNextDayUtc(filter.endDate),
            },
            /**
             * `every` exigia que TODOS los items de la factura fueran del tipo
             * filtrado, asi que un cafe con queso no aparecia nunca en la
             * lista de pendientes aunque tuviera saldo. La intencion es
             * "facturas que contengan el tipo".
             */
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

      /**
       * Stock bajo por cantidad ABSOLUTA (`LOW_STOCK_THRESHOLD`, 10 por
       * defecto). Antes se filtraba por `percent < 30`, que es participacion
       * en el inventario total: en un deposito con 3000 kg de cafe, un producto
       * con 2 kg quedaba en 0.07% y si entraba, pero un producto con 90 kg
       * (3%) tambien entraba aunque fuera Plenty. La alerta de reposicion
       * tiene que depender de las unidades, no del porcentaje.
       */
      const lowStockThreshold = getLowStockThreshold();
      const lowStock = productsPercent.filter(
        (p) => p.amount < lowStockThreshold,
      );

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
    // Normalizar una sola vez: los servicios reciben dias de calendario
    // (`YYYY-MM-DD`) y el Excel usa el mismo rango en UTC.
    const startYmd = formatDateInTz(
      filter.startDate instanceof Date
        ? filter.startDate
        : new Date(filter.startDate),
      getBusinessTimeZone(),
    );
    const endYmd = formatDateInTz(
      filter.endDate instanceof Date
        ? filter.endDate
        : new Date(filter.endDate),
      getBusinessTimeZone(),
    );

    const startOfRange = this.getStartOfDayUtc(startYmd);
    const endOfRange = this.getEndOfDayUtc(endYmd);

    const timings: Array<{ step: string; ms: number }> = [];
    const timed = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
      const startedAt = performance.now();
      try {
        return await fn();
      } finally {
        timings.push({
          step,
          ms: Math.round(performance.now() - startedAt),
        });
      }
    };

    // 1. Ejecutar todas las consultas en paralelo. Facturas y pagos se
    // obtienen de sus servicios; el dashboard solo conserva las consultas de
    // productos/inventario, que no pertenecen a esos dominios.
    const [
      productos,
      facturas,
      facturasCentros,
      paymentsReport,
      totalPagosSinAsociar,
      paymentStatisticsWeek,
      paymentItemsAnalysis,
      stockRealPorProducto,
      inventarioEntradasEnRango,
      invoiceStatisticsWeek,
      invoiceStatistics,
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

      // Facturas del rango. Antes se traia todo el historico y se filtraba en
      // memoria; ahora la base acota por fecha.
      timed('facturas-rango', () =>
        this.invoicesService.getInvoicesForReport({
          type: filter.type,
          startDate: startYmd,
          endDate: endYmd,
        }),
      ),

      // Solo las facturas de centros, que son las unicas que necesitan el
      // acumulado historico para "Bultos del centro - Pendientes".
      timed('facturas-centros', () =>
        this.invoicesService.getInvoicesForReport({
          type: filter.type,
          endDate: endYmd,
          blockNameContains: 'centro',
        }),
      ),

      // Filas de pagos del rango para la hoja "Analisis de Pagos"
      timed('pagos-report', () =>
        this.paymentsService.getPaymentsForReport({
          type: filter.type,
          startDate: startYmd,
          endDate: endYmd,
        }),
      ),

      // "Sin asociar" histórico: consulta ligera de solo pagos sin factura.
      timed('sin-asociar-historico', () =>
        this.paymentsService.getHistoricalUnassociatedAmount({
          endDate: endYmd,
        }),
      ),

      // Estadísticas de pagos del rango: gastos y totales semanales.
      timed('pagos-stats-semana', () =>
        this.paymentsService.getPaymentsStatistics({
          startDate: startYmd,
          endDate: endYmd,
          type: filter.type,
        }),
      ),

      // Bultos pagados y facturas consideradas, reutilizando el mismo cálculo
      // de la pagina de Items (/payments/analysis).
      timed('pagos-items-analysis', () =>
        this.paymentsService.getPaymentItemsAnalysis({
          type: filter.type,
          startDate: startYmd,
          endDate: endYmd,
        }),
      ),

      // Stock real por producto. Es la unica fuente de verdad del inventario:
      // `Product.amount` mas la suma de movimientos NO cuadra con la realidad
      // (ver `inventarioInicial` mas abajo), asi que el reporte se ancla en esta
      // tabla y se camina hacia atras para obtener el saldo inicial del rango.
      this.prismaService.inventory.findMany({
        select: { productId: true, quantity: true },
      }),

      // Entradas IN del rango, para el recorrido diario y para el anclaje
      this.prismaService.inventoryEntryDetail.findMany({
        where: {
          inventoryEntry: {
            date: { gte: startOfRange, lte: endOfRange },
            movementType: 'IN',
          },
        },
        select: {
          productId: true,
          quantity: true,
          inventoryEntry: { select: { date: true } },
        },
      }),

      // Estadísticas de la semana (rango del filtro)
      timed('facturas-stats-semana', () =>
        this.invoicesService
          .getInvoiceStatistics({
            type: filter.type,
            startDate: startYmd,
            endDate: endYmd,
          })
          .then((stats) => stats as InvoiceStatistics),
      ),

      // Estadísticas acumuladas (desde 2020 hasta endDate) para bultosPorCobrar.
      // Solo se necesitan los totales, no los desgloses por producto.
      timed('facturas-stats-acumulado', () =>
        this.invoicesService
          .getInvoiceStatistics(
            {
              type: filter.type,
              startDate: '2020-01-01',
              endDate: endYmd,
            },
            { includeDetails: false },
          )
          .then((stats) => stats as InvoiceStatistics),
      ),
    ]);

    if (process.env.REPORT_TIMING === 'true') {
      this.logger.debug(
        `[report] ${timings
          .map((timing) => `${timing.step}=${timing.ms}ms`)
          .join(', ')}`,
      );
    }

    const pagosEnRango = paymentsReport.payments;

    // 2. Preparar estructuras de datos optimizadas
    const dias = eachDayOfInterval({
      start: startOfRange,
      end: endOfRange,
    });
    // const exchangeRateUsed = currentDolar?.dolar || 1;

    // Entradas del rango agrupadas por dia y producto. Se reconstruyen con las
    // mismas claves `yyyy-MM-dd` que usan `dias` y que usa el calculo de
    // despachos, para que ambas series caigan en el mismo dia.
    const entradasPorDiaYProducto = {};
    dias.forEach((dia) => {
      const fechaKey = format(dia, 'yyyy-MM-dd');
      entradasPorDiaYProducto[fechaKey] = {};
      productos.forEach((producto) => {
        entradasPorDiaYProducto[fechaKey][producto.id] = 0;
      });
    });

    const entradasTotalesPorProducto = new Map<number, number>();
    inventarioEntradasEnRango.forEach((det) => {
      const fechaKey = format(det.inventoryEntry.date, 'yyyy-MM-dd');
      const dia = entradasPorDiaYProducto[fechaKey];
      if (dia && dia[det.productId] !== undefined) {
        dia[det.productId] += Number(det.quantity);
      }
      entradasTotalesPorProducto.set(
        det.productId,
        (entradasTotalesPorProducto.get(det.productId) || 0) +
          Number(det.quantity),
      );
    });

    const stockRealPorProductoId = new Map<number, number>(
      stockRealPorProducto.map((row) => [row.productId, Number(row.quantity)]),
    );

    // 3. Métricas de pagos: se reutilizan los totales de `getPaymentsStatistics`,
    // que es la misma fuente de la seccion de pagos. Antes "Divisas" y
    // "Transferencia" se recalculaban aqui con heurísticas por nombre de
    // método y no coincidian con la pagina.
    const pagosDivisas = paymentStatisticsWeek.totals.totalUSD;
    const pagosTransferencias = paymentStatisticsWeek.totals.totalBsInUSD;

    // 4. Estadísticas de facturas
    // "Bultos pagados" se toma del mismo analisis de pagos que la pagina de
    // Items, para que el reporte y la pagina muestren el mismo numero.
    const bultosPagados = paymentItemsAnalysis.generalItems.totalItems;
    const bultosPorCobrar = invoiceStatistics.packagePending;

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

    /**
     * Inventario inicial anclado en el stock real.
     *
     * Antes se calculaba como `Product.amount + suma de movimientos previos al
     * rango`, asumiendo que el historico de entradas y salidas reconstruye el
     * stock. En produccion esa asuncion es falsa: las salidas superan a las
     * entradas en ~24x mientras el stock real es positivo, porque el stock se
     * ajusto directamente en `Inventory` a lo largo de los anos sin registrar
     * las entradas correspondientes. Ese metodo producia saldos iniciales
     * negativo y finales que no cuadraban con el deposito.
     *
     * Ahora se parte del stock real (fuente de verdad) y se camina hacia
     * atras: el saldo al final del rango tiene que ser el stock real, asi que
     * el inicial es `stock - entradas + despachos`.
     *
     * Solo es valido para rangos que terminan en el presente: para un rango
     * historico el stock al final de ese rango no se puede recuperar, porque
     * `Inventory.quantity` solo guarda el valor actual.
     */
    const inventarioInicial = {};
    productos.forEach((p) => {
      const stockReal = stockRealPorProductoId.get(p.id) || 0;
      const entradas = entradasTotalesPorProducto.get(p.id) || 0;
      let despachos = 0;
      dias.forEach((dia) => {
        despachos +=
          despachosPorDiaYProducto[format(dia, 'yyyy-MM-dd')][p.id] || 0;
      });
      inventarioInicial[p.id] = stockReal - entradas + despachos;
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

      const pendiente = facturaCentro.remaining;
      if (centroFactura.totalFactura > 0) {
        const porcentajePendiente = Math.min(
          Math.max(pendiente / centroFactura.totalFactura, 0),
          1,
        );
        bultosPendientesCentroTotal +=
          centroFactura.totalBultos * porcentajePendiente;
      }
    });

    // 8. Deuda por cobrar: reutiliza el totalPending de getInvoiceStatistics
    const deudaPorCobrar = invoiceStatistics.payments.totalPending;

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
    const cellB7 = wsReporte.getCell('B7');
    cellB7.value = pagosDivisas;
    cellB7.numFmt = '#,##0.00';
    wsReporte.getCell('C6').value = 'Transferencia:';
    wsReporte.getCell('C6').font = { bold: true };
    const cellC7 = wsReporte.getCell('C7');
    cellC7.value = pagosTransferencias;
    cellC7.numFmt = '#,##0.00';
    wsReporte.getCell('D6').value = 'Sin asociar:';
    wsReporte.getCell('D6').font = { bold: true };
    const cellD7 = wsReporte.getCell('D7');
    cellD7.value = totalPagosSinAsociar;
    cellD7.numFmt = '#,##0.00';

    // Bultos pagados
    wsReporte.getCell('B8').value = 'Bultos Pagados:';
    wsReporte.getCell('B8').font = { bold: true };
    const cellB9 = wsReporte.getCell('B9');
    cellB9.value = bultosPagados;
    cellB9.numFmt = '#,##0.00';
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
    wsReporte.getCell('B18').value = 'Bultos por cobrar (hasta fecha):';
    wsReporte.getCell('B18').font = { bold: true };
    const cellB19 = wsReporte.getCell('B19');
    cellB19.value = bultosPorCobrar;
    cellB19.numFmt = '#,##0.0000';
    wsReporte.getCell('D18').value = 'Deuda por cobrar:';
    wsReporte.getCell('D18').font = { bold: true };
    const cellD19 = wsReporte.getCell('D19');
    cellD19.value = deudaPorCobrar;
    cellD19.numFmt = '#,##0.00';

    // Bultos del centro
    wsReporte.getCell('B20').value = 'Bultos del centro';
    wsReporte.getCell('B20').font = { bold: true };
    wsReporte.getCell('D20').value = 'Facturas perdidas:';
    wsReporte.getCell('D20').font = { bold: true };
    const cellE20 = wsReporte.getCell('E20');
    cellE20.value = invoiceStatisticsWeek.packageLostTotal;
    cellE20.numFmt = '#,##0.0000';
    wsReporte.getCell('B21').value = 'Despachados:';
    wsReporte.getCell('B21').font = { bold: true };
    const cellC21 = wsReporte.getCell('C21');
    cellC21.value = bultosDespachadosCentro;
    cellC21.numFmt = '#,##0.00';
    wsReporte.getCell('B22').value = 'Pagos:';
    wsReporte.getCell('B22').font = { bold: true };
    const cellC22 = wsReporte.getCell('C22');
    cellC22.value = bultosPagadosCentroTotal;
    cellC22.numFmt = '#,##0.00';
    wsReporte.getCell('B23').value = 'Pendientes:';
    wsReporte.getCell('B23').font = { bold: true };
    const cellC23 = wsReporte.getCell('C23');
    cellC23.value = bultosPendientesCentroTotal;
    cellC23.numFmt = '#,##0.00';
    wsReporte.getCell('B24').value = 'Gastos:';
    wsReporte.getCell('B24').font = { bold: true };
    const cellC24 = wsReporte.getCell('C24');
    cellC24.value = paymentStatisticsWeek.expensesGroup.total;
    cellC24.numFmt = '#,##0.00';

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
    header.push('Total Entradas', 'Total Despachado', 'Inventario Actual');
    wsInv.addRow(header);

    productos.forEach((p) => {
      const fila = [`${p.name} ${p.presentation}`, inventarioInicial[p.id]];
      let inventarioActual = inventarioInicial[p.id];
      let totalDespachado = 0;
      let totalEntradas = 0;

      // El recorrido aplica entradas y despachos. Antes solo restaba
      // despachos, asi que las compras del rango desaparecian del calculo y el
      // cierre no llegaba al stock real pese a que el inicial ya venía
      // anclado a él.
      dias.forEach((dia) => {
        const fechaKey = format(dia, 'yyyy-MM-dd');
        const cantidadDespachada: number =
          despachosPorDiaYProducto[fechaKey][p.id] || 0;
        const cantidadEntrada: number =
          entradasPorDiaYProducto[fechaKey][p.id] || 0;
        fila.push(cantidadDespachada);
        inventarioActual += cantidadEntrada - cantidadDespachada;
        totalDespachado += cantidadDespachada;
        totalEntradas += cantidadEntrada;
      });

      fila.push(totalEntradas, totalDespachado, inventarioActual);
      wsInv.addRow(fila);
    });

    // HOJA FACTURAS
    // Se consolidan las filas por factura: `getPaymentItemsAnalysis` devuelve
    // una fila por factura y dia cuando una factura recibio pagos en fechas
    // distintas. Aqui se suman los bultos pagados y se concatenan las fechas
    // de pago (`date`), no el nombre del dia.
    type ConsolidatedInvoice = {
      controlNumber: string;
      client: string;
      block: string;
      zone: string;
      blockId: number;
      status: string;
      dispatchDate: Date;
      dueDate: Date;
      paymentDates: Set<string>;
      totalBultos: number;
      totalBultosPagados: number;
      totalAmount: number;
      remaining: number;
    };

    const facturasPagadas = new Map<string, ConsolidatedInvoice>();
    paymentItemsAnalysis.invoices.forEach((invoice) => {
      const existing = facturasPagadas.get(invoice.controlNumber);
      if (existing) {
        existing.totalBultosPagados += invoice.totalBultosPagados;
        existing.paymentDates.add(invoice.date);
        return;
      }

      facturasPagadas.set(invoice.controlNumber, {
        controlNumber: invoice.controlNumber,
        client: invoice.client,
        block: invoice.block,
        zone: invoice.zone,
        blockId: invoice.blockId,
        status: invoice.status,
        dispatchDate: invoice.dispatchDate,
        dueDate: invoice.dueDate,
        paymentDates: new Set([invoice.date]),
        totalBultos: invoice.totalBultos,
        totalBultosPagados: invoice.totalBultosPagados,
        totalAmount: invoice.totalAmount,
        remaining: invoice.remaining,
      });
    });

    const facturasPagadasRows = Array.from(facturasPagadas.values()).sort(
      (a, b) =>
        a.blockId - b.blockId || a.controlNumber.localeCompare(b.controlNumber),
    );

    const wsFact = workbook.addWorksheet('Facturas');
    wsFact.addRow([
      'Nro Control',
      'Cliente',
      'Bloque',
      'Zona',
      'Fecha de despacho',
      'Fecha de vencimiento',
      'Total',
      'Debe',
      'Bultos',
      'Bultos Pagados',
      'Día del pago',
    ]);

    facturasPagadasRows.forEach((invoice) => {
      // Fechas de pago unicas en orden cronologico.
      const paymentDates = Array.from(invoice.paymentDates)
        .sort((dateA, dateB) => dateA.localeCompare(dateB))
        .join(', ');

      const row = wsFact.addRow([
        invoice.controlNumber,
        invoice.client,
        invoice.block,
        invoice.zone,
        format(invoice.dispatchDate, 'dd/MM/yyyy'),
        format(invoice.dueDate, 'dd/MM/yyyy'),
        invoice.totalAmount,
        invoice.remaining,
        invoice.totalBultos,
        invoice.totalBultosPagados,
        paymentDates,
      ]);
      row.getCell(7).numFmt = '#,##0.00';
      row.getCell(8).numFmt = '#,##0.00';
      row.getCell(9).numFmt = '#,##0.0000';
      row.getCell(10).numFmt = '#,##0.0000';
    });

    const totalFacturasPagadasRow = wsFact.addRow([
      'Total',
      `${facturasPagadasRows.length} facturas`,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      paymentItemsAnalysis.generalItems.totalItems,
      '',
    ]);
    totalFacturasPagadasRow.getCell(10).numFmt = '#,##0.0000';

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
        const row = wsPagos.addRow([
          format(pago.paymentDate, 'dd/MM/yyyy'),
          pago.reference,
          pago.account.name,
          pago.account.method.name,
          montoPagoUSD,
          Number(pago.dolar.dolar),
          montoPagoBS,
          pago.description,
          'Sin factura asociada',
          '-',
          '-',
          '-',
          '-',
          '-',
        ]);
        row.getCell(5).numFmt = '#,##0.00';
        row.getCell(6).numFmt = '#,##0.00';
        row.getCell(7).numFmt = '#,##0.00';
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

          const row = wsPagos.addRow([
            format(pago.paymentDate, 'dd/MM/yyyy'),
            pago.reference,
            pago.account.name,
            pago.account.method.name,
            montoPagoUSD,
            Number(pago.dolar.dolar),
            montoPagoBS,
            pago.description,
            `#${factura.controlNumber}`,
            totalFactura,
            cantidadTotalItems,
            montoAsignado,
            equivalenteItems,
            porcentajePagado,
          ]);
          row.getCell(5).numFmt = '#,##0.00';
          row.getCell(6).numFmt = '#,##0.00';
          row.getCell(7).numFmt = '#,##0.00';
          row.getCell(10).numFmt = '#,##0.00';
          row.getCell(11).numFmt = '#,##0.0000';
          row.getCell(12).numFmt = '#,##0.00';
          row.getCell(13).numFmt = '#,##0.0000';
          row.getCell(14).numFmt = '0.0%';
        });
      }
    });

    wsPagos.addRow([]);
    wsPagos.addRow(['=== RESUMEN GENERAL ===']);
    const rowTotalPagado = wsPagos.addRow(['Total Pagado ($):', totalPagado]);
    rowTotalPagado.getCell(2).numFmt = '#,##0.00';
    const rowTotalItems = wsPagos.addRow([
      'Total Items Equivalentes:',
      totalItemsPagados,
    ]);
    rowTotalItems.getCell(2).numFmt = '#,##0.00';
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
      const row = wsResumenProductos.addRow([
        nombreProducto,
        datos.cantidadPagada,
        datos.precioPromedio,
        datos.montoTotalPagado,
      ]);
      row.getCell(2).numFmt = '#,##0.0000';
      row.getCell(3).numFmt = '#,##0.00';
      row.getCell(4).numFmt = '#,##0.00';
      totalGeneralProductos += datos.montoTotalPagado;
    });

    wsResumenProductos.addRow([]);
    const rowTotal = wsResumenProductos.addRow([
      'TOTAL GENERAL',
      '',
      '',
      totalGeneralProductos,
    ]);
    rowTotal.getCell(4).numFmt = '#,##0.00';

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
    const excelStartedAt = performance.now();
    const arrayBuffer = await workbook.xlsx.writeBuffer();
    if (process.env.REPORT_TIMING === 'true') {
      this.logger.debug(
        `[report] excel=${Math.round(performance.now() - excelStartedAt)}ms`,
      );
    }
    return Buffer.from(arrayBuffer);
  }

  async getClientsDemandReport(filter: DashboardExcel) {
    const { type, startDate, endDate } = filter;
    // Obtener facturas en el rango con items y cliente
    const invoices = await this.prismaService.invoice.findMany({
      where: {
        deleted: false,
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
