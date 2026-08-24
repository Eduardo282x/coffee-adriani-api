import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  DTOInventory,
  DTOInventorySimple,
  DTOUpdateInventoryEntry,
  CreateInventoryEntryDTO,
  InventoryEntryFilterDTO,
  InventoryCutFilterDTO,
  ExecuteInventoryCutDTO,
} from './inventory.dto';
import { badResponse, baseResponse } from 'src/dto/base.dto';
import { ProductsService } from 'src/products/products.service';
import { InvoiceTypeProduct, Prisma } from 'src/generated/prisma/client';

@Injectable()
export class InventoryService {
  private readonly logger = new Logger(InventoryService.name);

  constructor(
    private readonly prismaService: PrismaService,
    private readonly productsService: ProductsService,
  ) {}

  private getStartOfDayUtc(date: string) {
    if (date.length > 10) {
      return new Date(date);
    }
    return new Date(`${date}T00:00:00.000Z`);
  }

  private getEndOfDayUtc(date: string) {
    if (date.length > 10) {
      return new Date(date);
    }
    return new Date(`${date}T23:59:59.999Z`);
  }

  private normalizeControlNumber(controlNumber?: string | null): string {
    return (controlNumber ?? '').trimEnd();
  }

  async getInventory() {
    const getDolar = await this.productsService.getDolar();

    try {
      return await this.prismaService.inventory
        .findMany({
          orderBy: { product: { priorityOrder: 'asc' } },
          include: {
            product: true,
          },
          where: {
            product: {
              deleted: false,
            },
          },
        })
        .then((inv) =>
          inv.map((iv) => {
            return {
              ...iv,
              quantity: Number(iv.quantity),
              product: {
                ...iv.product,
                price: iv.product.price.toFixed(2),
                priceUSD: iv.product.priceUSD.toFixed(2),
                priceBs: (
                  Number(iv.product.price) * Number(getDolar.dolar)
                ).toFixed(2),
              },
            };
          }),
        );
    } catch (err) {
      await this.prismaService.errorMessages.create({
        data: {
          message: err instanceof Error ? err.message : String(err),
          from: 'inventoryService',
        },
      });
      badResponse.message = err instanceof Error ? err.message : String(err);
      return [];
    }
  }

  async getInventoryMovements(filter: {
    page: number;
    limit: number;
    startDate?: string;
    endDate?: string;
    typeMovement?: string;
    typeProduct?: string;
    controlNumber?: string;
  }) {
    const {
      page,
      limit,
      startDate,
      endDate,
      typeMovement,
      typeProduct,
      controlNumber,
    } = filter;
    const where: any = {};
    const getDolar = await this.productsService.getDolar();
    const safePage = page > 0 ? page : 1;
    const safeLimit = limit > 0 ? Math.min(limit, 100) : 20;
    const skip = (safePage - 1) * safeLimit;

    if (startDate && endDate) {
      where.date = {
        gte: this.getStartOfDayUtc(startDate),
        lte: this.getEndOfDayUtc(endDate),
      };
    }

    if (typeMovement) {
      where.movementType = typeMovement;
    }

    const normalizedControlNumber = this.normalizeControlNumber(controlNumber);
    if (normalizedControlNumber) {
      where.controlNumber = {
        equals: normalizedControlNumber,
        mode: 'insensitive',
      };
    }

    if (typeProduct) {
      where.details = {
        some: {
          product: {
            type: {
              equals: typeProduct,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    const [total, entries] = await Promise.all([
      this.prismaService.inventoryEntry.count({ where }),
      this.prismaService.inventoryEntry.findMany({
        skip,
        take: safeLimit,
        orderBy: [{ date: 'desc' }, { id: 'desc' }],
        where,
        include: {
          details: {
            include: {
              product: true,
            },
          },
        },
      }),
    ]);

    const history = entries.map((entry) => ({
      controlNumber: entry.controlNumber,
      description: entry.description,
      movementType: entry.movementType,
      movementDate: entry.date.toISOString().slice(0, 10),
      details: entry.details.map((detail) => ({
        productId: detail.productId,
        name: detail.product.name,
        presentation: detail.product.presentation,
        quantity: Number(detail.quantity),
        priceBs: (
          Number(detail.product.price) * Number(getDolar.dolar)
        ).toFixed(2),
        priceUSD: detail.product.priceUSD.toFixed(2),
        date: entry.date.toISOString(),
      })),
    }));

    const totalPages = Math.ceil(total / safeLimit);

    return {
      history,
      pagination: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  }

  async saveInventory(inventory: DTOInventory) {
    try {
      const normalizedControlNumber = this.normalizeControlNumber(
        inventory.controlNumber,
      );

      const existingEntry = await this.prismaService.inventoryEntry.findUnique({
        where: { controlNumber: normalizedControlNumber },
      });

      if (existingEntry) {
        badResponse.message =
          'Ya existe una entrada de inventario con este número de control';
        return badResponse;
      }

      const productIds = inventory.details.map((detail) => detail.productId);
      const products = await this.prismaService.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      const totalAmount = inventory.details.reduce((sum, detail) => {
        const price = Number(productMap.get(detail.productId)?.price || 0);
        return sum + price * detail.quantity;
      }, 0);

      const entry = await this.prismaService.inventoryEntry.create({
        data: {
          controlNumber: normalizedControlNumber,
          movementType: 'IN',
          totalAmount,
          status: 'CREADA',
          title: inventory.description || 'Entrada de inventario',
          description: `Entrada de mercancía ${inventory.description ? `- ${inventory.description}` : ''}`,
          date: inventory.date,
          supplierId: null,
        },
      });

      for (const detail of inventory.details) {
        const product = productMap.get(detail.productId);
        const unitPrice = Number(product?.price || 0);
        const unitPriceUSD = Number(product?.priceUSD || 0);
        const subtotal = unitPrice * detail.quantity;

        await this.prismaService.inventoryEntryDetail.create({
          data: {
            inventoryEntryId: entry.id,
            productId: detail.productId,
            quantity: detail.quantity,
            unitPrice,
            unitPriceUSD,
            subtotal,
          },
        });

        const findProductInInventory =
          await this.prismaService.inventory.findFirst({
            where: { productId: detail.productId },
          });

        if (findProductInInventory) {
          await this.prismaService.inventory.update({
            data: {
              quantity:
                Number(findProductInInventory.quantity) +
                Number(detail.quantity),
            },
            where: {
              id: findProductInInventory.id,
            },
          });
        } else {
          await this.prismaService.inventory.create({
            data: {
              productId: detail.productId,
              quantity: detail.quantity,
            },
          });
        }
      }

      baseResponse.message = 'Productos guardados en inventario.';
      return baseResponse;
    } catch (err) {
      await this.prismaService.errorMessages.create({
        data: {
          message: err instanceof Error ? err.message : String(err),
          from: 'inventoryService',
        },
      });
      badResponse.message = err instanceof Error ? err.message : String(err);
      return badResponse;
    }
  }

  async updateAmountInventory(inventory: DTOInventorySimple, id: number) {
    try {
      const findProductInInventory =
        await this.prismaService.inventory.findFirst({
          where: { id },
        });

      if (!findProductInInventory) {
        badResponse.message = 'No se encontró el producto en el inventario.';
        return badResponse;
      }

      const findDetail =
        await this.prismaService.inventoryEntryDetail.findFirst({
          where: {
            productId: findProductInInventory.productId,
            inventoryEntry: { movementType: 'IN' },
          },
          orderBy: { inventoryEntry: { date: 'desc' } },
        });

      const oldAmount = findDetail
        ? Number(findProductInInventory.quantity) - Number(findDetail.quantity)
        : Number(findProductInInventory.quantity);
      const updateAmountHistory = inventory.quantity - oldAmount;

      await this.prismaService.inventory.update({
        data: {
          quantity: inventory.quantity,
        },
        where: { id },
      });

      if (findDetail) {
        await this.prismaService.inventoryEntryDetail.update({
          where: { id: findDetail.id },
          data: {
            quantity: updateAmountHistory,
          },
        });
      }

      baseResponse.message = 'Inventario modificado.';
      return baseResponse;
    } catch (err) {
      await this.prismaService.errorMessages.create({
        data: {
          message: err instanceof Error ? err.message : String(err),
          from: 'inventoryService',
        },
      });
      badResponse.message = err instanceof Error ? err.message : String(err);
      return badResponse;
    }
  }

  async updateInventoryEntryControlNumber(inventory: DTOUpdateInventoryEntry) {
    try {
      const normalizedControlNumber = this.normalizeControlNumber(
        inventory.controlNumber,
      );

      const findHistory = await this.prismaService.inventoryEntry.findMany({
        where: { controlNumber: inventory.controlNumberOld },
        orderBy: { date: 'desc' },
      });
      if (!findHistory || findHistory.length === 0) {
        badResponse.message = 'Numero de control no encontrado.';
        return badResponse;
      }

      await this.prismaService.inventoryEntry.updateMany({
        where: { controlNumber: inventory.controlNumberOld },
        data: {
          controlNumber: normalizedControlNumber,
          date: inventory.date,
        },
      });

      baseResponse.message = 'Historial de inventario actualizado.';
      return baseResponse;
    } catch (err) {
      await this.prismaService.errorMessages.create({
        data: {
          message: err instanceof Error ? err.message : String(err),
          from: 'inventoryService',
        },
      });
      badResponse.message = err instanceof Error ? err.message : String(err);
      return badResponse;
    }
  }

  async updateInventoryInvoice(
    inventory: DTOInventory,
    tx?: Prisma.TransactionClient,
  ) {
    try {
      const prisma = tx ?? this.prismaService;
      const normalizedControlNumber = this.normalizeControlNumber(
        inventory.controlNumber,
      );

      const existingEntry = await prisma.inventoryEntry.findUnique({
        where: { controlNumber: normalizedControlNumber },
      });

      if (existingEntry) {
        badResponse.message =
          'Ya existe una entrada de inventario con este número de control';
        return badResponse;
      }

      const productIds = inventory.details.map((detail) => detail.productId);
      const products = await prisma.product.findMany({
        where: { id: { in: productIds } },
      });
      const productMap = new Map(
        products.map((product) => [product.id, product]),
      );

      const totalAmount = inventory.details.reduce((sum, detail) => {
        const price = Number(productMap.get(detail.productId)?.price || 0);
        return sum + price * detail.quantity;
      }, 0);

      const entry = await prisma.inventoryEntry.create({
        data: {
          controlNumber: normalizedControlNumber,
          movementType: 'OUT',
          totalAmount,
          status: 'CREADA',
          title: inventory.description || 'Salida de inventario',
          description: inventory.description || '',
          date: inventory.date,
          supplierId: null,
        },
      });

      for (const detail of inventory.details) {
        const product = productMap.get(detail.productId);
        const unitPrice = Number(product?.price || 0);
        const unitPriceUSD = Number(product?.priceUSD || 0);
        const subtotal = unitPrice * detail.quantity;
        const type = detail.type || 'SALE';

        await prisma.inventoryEntryDetail.create({
          data: {
            inventoryEntryId: entry.id,
            productId: detail.productId,
            quantity: detail.quantity,
            unitPrice,
            unitPriceUSD,
            subtotal,
            type: type as InvoiceTypeProduct,
          },
        });

        const findProductInventory = await prisma.inventory.findFirst({
          where: { productId: detail.productId },
        });

        if (!findProductInventory) {
          badResponse.message = `El producto con ID ${detail.productId} no se encontró en el inventario.`;
          return badResponse;
        }

        await prisma.inventory.update({
          where: { id: findProductInventory.id },
          data: {
            quantity: {
              decrement: detail.quantity,
            },
          },
        });
      }

      baseResponse.message = 'Productos actualizados en inventario.';
      return baseResponse;
    } catch (err) {
      await this.prismaService.errorMessages.create({
        data: {
          message: err instanceof Error ? err.message : String(err),
          from: 'inventoryService',
        },
      });
      badResponse.message = err instanceof Error ? err.message : String(err);
      return badResponse;
    }
  }

  async getInventoryEntries(filter: InventoryEntryFilterDTO) {
    try {
      const {
        page = 1,
        limit = 50,
        startDate,
        endDate,
        typeMovement,
        typeProduct,
        controlNumber,
        supplierId,
      } = filter;
      const skip = (page - 1) * limit;

      const where: any = {};

      if (startDate && endDate) {
        where.date = {
          gte: this.getStartOfDayUtc(startDate as string),
          lte: this.getEndOfDayUtc(endDate as string),
        };
      }

      if (typeMovement) {
        where.movementType = typeMovement;
      }

      if (controlNumber) {
        where.controlNumber = {
          contains: controlNumber,
          mode: 'insensitive',
        };
      }

      if (supplierId) {
        where.supplierId = supplierId;
      }

      if (typeProduct) {
        where.details = {
          some: {
            product: {
              type: {
                equals: typeProduct,
                mode: 'insensitive',
              },
            },
          },
        };
      }

      const [entries, totalCount] = await Promise.all([
        this.prismaService.inventoryEntry.findMany({
          where,
          include: {
            details: {
              include: {
                product: true,
              },
            },
            supplier: true,
            payments: {
              include: {
                payment: {
                  include: {
                    account: {
                      include: { method: true },
                    },
                    dolar: true,
                  },
                },
              },
            },
          },
          orderBy: { date: 'desc' },
          skip,
          take: limit,
        }),
        this.prismaService.inventoryEntry.count({ where }),
      ]);

      const processedEntries = entries.map((entry) => {
        const totalBultos = entry.details.reduce(
          (sum, d) => sum + Number(d.quantity),
          0,
        );
        const totalPaid = entry.payments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );
        const remaining = Number(entry.totalAmount) - totalPaid;

        return {
          ...entry,
          totalBultos,
          totalPaid: totalPaid.toFixed(2),
          remaining: remaining.toFixed(2),
          totalAmount: Number(entry.totalAmount).toFixed(2),
        };
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      return {
        entries: processedEntries,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNext,
          hasPrev,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener entradas: ${errMsg}`);
    }
  }

  async getInventoryEntriesStatistics(filter: InventoryEntryFilterDTO) {
    try {
      const {
        startDate,
        endDate,
        typeMovement,
        typeProduct,
        controlNumber,
        supplierId,
      } = filter;

      const where: any = {};

      if (startDate && endDate) {
        where.date = {
          gte: this.getStartOfDayUtc(startDate as string),
          lte: this.getEndOfDayUtc(endDate as string),
        };
      }

      if (controlNumber) {
        where.controlNumber = {
          contains: controlNumber,
          mode: 'insensitive',
        };
      }

      if (supplierId) {
        where.supplierId = supplierId;
      }

      if (typeProduct) {
        where.details = {
          some: {
            product: {
              type: {
                equals: typeProduct,
                mode: 'insensitive',
              },
            },
          },
        };
      }

      if (typeMovement) {
        where.movementType = typeMovement;
      }

      const entries = await this.prismaService.inventoryEntry.findMany({
        where,
        select: {
          totalAmount: true,
          details: {
            select: { quantity: true },
          },
          payments: {
            select: { amount: true },
          },
        },
      });

      const totalInvoices = entries.length;
      const totalBultos = entries.reduce(
        (sum, entry) =>
          sum +
          entry.details.reduce((s, detail) => s + Number(detail.quantity), 0),
        0,
      );
      const totalPaid = entries.reduce(
        (sum, entry) =>
          sum +
          entry.payments.reduce((s, payment) => s + Number(payment.amount), 0),
        0,
      );
      const totalAmount = entries.reduce(
        (sum, entry) => sum + Number(entry.totalAmount),
        0,
      );
      const totalPending = totalAmount - totalPaid;

      return {
        totals: {
          totalInvoices,
          totalBultos,
          totalPaid: totalPaid.toFixed(2),
          totalPending: totalPending.toFixed(2),
          totalAmount: totalAmount.toFixed(2),
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener estadísticas de entradas: ${errMsg}`);
    }
  }

  async getInventoryEntryById(id: number) {
    try {
      const entry = await this.prismaService.inventoryEntry.findUnique({
        where: { id },
        include: {
          details: {
            include: {
              product: true,
            },
          },
          supplier: true,
          payments: {
            include: {
              payment: {
                include: {
                  account: {
                    include: { method: true },
                  },
                  dolar: true,
                },
              },
            },
          },
        },
      });

      if (!entry) {
        throw new Error('Entrada no encontrada');
      }

      const totalBultos = entry.details.reduce(
        (sum, d) => sum + Number(d.quantity),
        0,
      );
      const totalPaid = entry.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const remaining = Number(entry.totalAmount) - totalPaid;

      return {
        ...entry,
        totalBultos,
        totalPaid: totalPaid.toFixed(2),
        remaining: remaining.toFixed(2),
        totalAmount: Number(entry.totalAmount).toFixed(2),
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener entrada: ${errMsg}`);
    }
  }

  async createInventoryEntry(data: CreateInventoryEntryDTO) {
    try {
      const existingEntry = await this.prismaService.inventoryEntry.findUnique({
        where: { controlNumber: data.controlNumber },
      });

      if (existingEntry) {
        badResponse.message =
          'Ya existe una entrada con este número de control';
        return badResponse;
      }

      const totalAmount = data.details.reduce((sum, detail) => {
        return sum + detail.unitPrice * detail.quantity;
      }, 0);

      const entry = await this.prismaService.inventoryEntry.create({
        data: {
          controlNumber: data.controlNumber,
          movementType: 'IN',
          totalAmount,
          status: 'CREADA',
          title: data.title || '',
          description: data.description || '',
          date: data.date,
          supplierId: data.supplierId || null,
        },
      });

      for (const detail of data.details) {
        const subtotal = detail.unitPrice * detail.quantity;

        await this.prismaService.inventoryEntryDetail.create({
          data: {
            inventoryEntryId: entry.id,
            productId: detail.productId,
            quantity: detail.quantity,
            unitPrice: detail.unitPrice,
            unitPriceUSD: detail.unitPriceUSD || detail.unitPrice,
            subtotal,
          },
        });

        const existingInventory = await this.prismaService.inventory.findFirst({
          where: { productId: detail.productId },
        });

        if (existingInventory) {
          await this.prismaService.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity:
                Number(existingInventory.quantity) + Number(detail.quantity),
            },
          });
        } else {
          await this.prismaService.inventory.create({
            data: {
              productId: detail.productId,
              quantity: detail.quantity,
            },
          });
        }
      }

      baseResponse.message = 'Entrada de inventario creada exitosamente';
      baseResponse.data = { id: entry.id, controlNumber: entry.controlNumber };
      return baseResponse;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async updateInventoryEntry(id: number, data: CreateInventoryEntryDTO) {
    try {
      const existingEntry = await this.prismaService.inventoryEntry.findUnique({
        where: { id },
        include: { details: true },
      });

      if (!existingEntry) {
        badResponse.message = 'Entrada no encontrada';
        return badResponse;
      }

      const duplicateEntry = await this.prismaService.inventoryEntry.findFirst({
        where: {
          controlNumber: data.controlNumber,
          id: { not: id },
        },
      });

      if (duplicateEntry) {
        badResponse.message =
          'Ya existe otra entrada con este número de control';
        return badResponse;
      }

      for (const oldDetail of existingEntry.details) {
        const existingInventory = await this.prismaService.inventory.findFirst({
          where: { productId: oldDetail.productId },
        });

        if (existingInventory) {
          await this.prismaService.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity: Math.max(
                0,
                Number(existingInventory.quantity) - Number(oldDetail.quantity),
              ),
            },
          });
        }
      }

      await this.prismaService.inventoryEntryDetail.deleteMany({
        where: { inventoryEntryId: id },
      });

      const totalAmount = data.details.reduce((sum, detail) => {
        return sum + detail.unitPrice * detail.quantity;
      }, 0);

      await this.prismaService.inventoryEntry.update({
        where: { id },
        data: {
          controlNumber: data.controlNumber,
          totalAmount,
          title: data.title || '',
          description: data.description || '',
          date: data.date,
          supplierId: data.supplierId || null,
        },
      });

      for (const detail of data.details) {
        const subtotal = detail.unitPrice * detail.quantity;

        await this.prismaService.inventoryEntryDetail.create({
          data: {
            inventoryEntryId: id,
            productId: detail.productId,
            quantity: detail.quantity,
            unitPrice: detail.unitPrice,
            unitPriceUSD: detail.unitPriceUSD || detail.unitPrice,
            subtotal,
          },
        });

        const existingInventory = await this.prismaService.inventory.findFirst({
          where: { productId: detail.productId },
        });

        if (existingInventory) {
          await this.prismaService.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity:
                Number(existingInventory.quantity) + Number(detail.quantity),
            },
          });
        } else {
          await this.prismaService.inventory.create({
            data: {
              productId: detail.productId,
              quantity: detail.quantity,
            },
          });
        }
      }

      baseResponse.message = 'Entrada de inventario actualizada exitosamente';
      return baseResponse;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async deleteInventoryEntry(id: number) {
    try {
      const existingEntry = await this.prismaService.inventoryEntry.findUnique({
        where: { id },
        include: { details: true, payments: true },
      });

      if (!existingEntry) {
        badResponse.message = 'Entrada no encontrada';
        return badResponse;
      }

      if (existingEntry.payments.length > 0) {
        badResponse.message =
          'No se puede eliminar una entrada con pagos asociados';
        return badResponse;
      }

      for (const detail of existingEntry.details) {
        const existingInventory = await this.prismaService.inventory.findFirst({
          where: { productId: detail.productId },
        });

        if (existingInventory) {
          await this.prismaService.inventory.update({
            where: { id: existingInventory.id },
            data: {
              quantity: Math.max(
                0,
                Number(existingInventory.quantity) - Number(detail.quantity),
              ),
            },
          });
        }
      }

      await this.prismaService.inventoryEntryDetail.deleteMany({
        where: { inventoryEntryId: id },
      });

      await this.prismaService.inventoryEntry.delete({
        where: { id },
      });

      baseResponse.message = 'Entrada de inventario eliminada exitosamente';
      return baseResponse;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      badResponse.message = errMsg;
      return badResponse;
    }
  }

  async getEnterpriseEntries(filter: InventoryEntryFilterDTO) {
    try {
      const {
        page = 1,
        limit = 50,
        startDate,
        endDate,
        controlNumber,
        supplierId,
        typeProduct,
      } = filter;
      const skip = (page - 1) * limit;

      const where: any = {
        movementType: 'IN',
      };

      if (startDate && endDate) {
        where.date = {
          gte: this.getStartOfDayUtc(startDate as string),
          lte: this.getEndOfDayUtc(endDate as string),
        };
      }

      if (controlNumber) {
        where.controlNumber = {
          contains: controlNumber,
          mode: 'insensitive',
        };
      }

      if (supplierId) {
        where.supplierId = supplierId;
      }

      if (typeProduct) {
        where.details = {
          some: {
            product: {
              type: {
                equals: typeProduct,
                mode: 'insensitive',
              },
            },
          },
        };
      }

      const [entries, totalCount] = await Promise.all([
        this.prismaService.inventoryEntry.findMany({
          where,
          include: {
            details: {
              include: {
                product: true,
              },
            },
            supplier: true,
            payments: {
              include: {
                payment: {
                  include: {
                    account: {
                      include: { method: true },
                    },
                    dolar: true,
                  },
                },
              },
            },
          },
          orderBy: { date: 'desc' },
          skip,
          take: limit,
        }),
        this.prismaService.inventoryEntry.count({ where }),
      ]);

      const processedEntries = entries.map((entry) => {
        const totalBultos = entry.details.reduce(
          (sum, d) => sum + Number(d.quantity),
          0,
        );
        const totalPaid = entry.payments.reduce(
          (sum, p) => sum + Number(p.amount),
          0,
        );
        const remaining = Number(entry.totalAmount) - totalPaid;

        return {
          id: entry.id,
          controlNumber: entry.controlNumber,
          title: entry.title,
          description: entry.description,
          date: entry.date,
          status: entry.status,
          totalAmount: Number(entry.totalAmount).toFixed(2),
          totalBultos,
          totalPaid: totalPaid.toFixed(2),
          remaining: remaining.toFixed(2),
          supplier: entry.supplier,
          details: entry.details,
          payments: entry.payments,
        };
      });

      const totalPages = Math.ceil(totalCount / limit);
      const hasNext = page < totalPages;
      const hasPrev = page > 1;

      return {
        entries: processedEntries,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages,
          hasNext,
          hasPrev,
        },
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener entradas de empresa: ${errMsg}`);
    }
  }

  async getEnterpriseEntryById(id: number) {
    try {
      const entry = await this.prismaService.inventoryEntry.findFirst({
        where: {
          id,
          movementType: 'IN',
        },
        include: {
          details: {
            include: {
              product: true,
            },
          },
          supplier: true,
          payments: {
            include: {
              payment: {
                include: {
                  account: {
                    include: { method: true },
                  },
                  dolar: true,
                },
              },
            },
          },
        },
      });

      if (!entry) {
        throw new Error('Entrada de empresa no encontrada');
      }

      const totalBultos = entry.details.reduce(
        (sum, d) => sum + Number(d.quantity),
        0,
      );
      const totalPaid = entry.payments.reduce(
        (sum, p) => sum + Number(p.amount),
        0,
      );
      const remaining = Number(entry.totalAmount) - totalPaid;

      const payments = entry.payments.map((ep) => {
        const currency = ep.payment.account?.method?.currency;
        const dolarRate = Number(ep.payment.dolar?.dolar || 0);

        let amountUSD = Number(ep.amount);
        let amountBS = 0;

        if (currency === 'BS') {
          amountUSD = dolarRate > 0 ? Number(ep.amount) / dolarRate : 0;
          amountBS = Number(ep.amount);
        } else {
          amountUSD = Number(ep.amount);
          amountBS = Number(ep.amount) * dolarRate;
        }

        return {
          id: ep.id,
          amount: Number(ep.amount).toFixed(2),
          amountUSD: amountUSD.toFixed(2),
          amountBS: amountBS.toFixed(2),
          payment: ep.payment,
          createdAt: ep.createdAt,
        };
      });

      return {
        id: entry.id,
        controlNumber: entry.controlNumber,
        title: entry.title,
        description: entry.description,
        date: entry.date,
        status: entry.status,
        totalAmount: Number(entry.totalAmount).toFixed(2),
        totalBultos,
        totalPaid: totalPaid.toFixed(2),
        remaining: remaining.toFixed(2),
        supplier: entry.supplier,
        details: entry.details,
        payments,
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new Error(`Error al obtener entrada de empresa: ${errMsg}`);
    }
  }

  // ============ Cortes de inventario (semanal y mensual) ============

  private formatDateMMDDYYYY(date: Date): string {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${month}/${day}/${date.getFullYear()}`;
  }

  private parseCutDate(dateStr: string): Date {
    const [month, day, year] = dateStr.split('/').map(Number);
    return new Date(year, month - 1, day);
  }

  private toComparable(dateStr: string): number {
    const [month, day, year] = dateStr.split('/').map(Number);
    return year * 10000 + month * 100 + day;
  }

  private toComparableFromFilter(dateStr: string): number {
    const normalized = dateStr.includes('-')
      ? dateStr.split('-').reverse().join('/')
      : dateStr;
    return this.toComparable(normalized);
  }

  private getMondayOfWeek(date: Date): Date {
    const d = new Date(date);
    const day = d.getDay();
    const diff = day === 0 ? 6 : day - 1;
    d.setDate(d.getDate() - diff);
    d.setHours(0, 0, 0, 0);
    return d;
  }

  private getSaturdayOfWeek(monday: Date): Date {
    const d = new Date(monday);
    d.setDate(d.getDate() + 5);
    return d;
  }

  private getLastDayOfMonth(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth() + 1, 0);
  }

  private async getInventorySnapshot() {
    return await this.prismaService.inventory.findMany({
      include: { product: true },
      where: { product: { deleted: false } },
    });
  }

  private async createCut(opts: {
    startDate: Date;
    endDate: Date;
    type: string;
    period: 'WEEK' | 'MONTH';
    status: 'OPEN' | 'CLOSE';
    snapshot: { productId: number; quantity: Prisma.Decimal }[];
  }) {
    const startDateStr = this.formatDateMMDDYYYY(opts.startDate);
    const endDateStr = this.formatDateMMDDYYYY(opts.endDate);

    const existing = await this.prismaService.inventoryCut.findFirst({
      where: {
        type: opts.type,
        period: opts.period,
        startDate: startDateStr,
        status: opts.status,
      },
    });

    if (existing) return existing;

    return await this.prismaService.inventoryCut.create({
      data: {
        startDate: startDateStr,
        endDate: endDateStr,
        type: opts.type,
        period: opts.period,
        status: opts.status,
        details: {
          create: opts.snapshot.map((item) => ({
            productId: item.productId,
            amount: item.quantity,
          })),
        },
      },
      include: { details: true },
    });
  }

  private async createCutsByType(opts: {
    startDate: Date;
    endDate: Date;
    period: 'WEEK' | 'MONTH';
    status: 'OPEN' | 'CLOSE';
  }) {
    const snapshot = await this.getInventorySnapshot();
    const types = [...new Set(snapshot.map((item) => item.product.type))];

    const cuts = [];
    for (const type of types) {
      const items = snapshot
        .filter((item) => item.product.type === type)
        .map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
        }));
      const cut = await this.createCut({
        ...opts,
        type,
        snapshot: items,
      });
      cuts.push(cut);
    }
    return cuts;
  }

  private handleCutError(err: unknown) {
    this.prismaService.errorMessages.create({
      data: {
        message: err instanceof Error ? err.message : String(err),
        from: 'inventoryService',
      },
    });
    badResponse.message = err instanceof Error ? err.message : String(err);
    return badResponse;
  }

  private buildCutResponse(open?: any, close?: any) {
    const openDetails = open?.details ?? [];
    const closeDetails = close?.details ?? [];
    const mapDetail = (detail: any) => ({
      productId: detail.productId,
      name: detail.product.name,
      presentation: detail.product.presentation,
      type: detail.product.type,
      amount: Number(detail.amount),
    });
    return {
      id: close?.id ?? open?.id,
      type: open?.type ?? close?.type,
      period: open?.period ?? close?.period,
      status: close ? 'CLOSE' : 'OPEN',
      startDate: open?.startDate ?? close?.startDate,
      endDate: open?.endDate ?? close?.endDate,
      initialAmount: openDetails.reduce(
        (sum, detail) =>
          sum +
          (detail.product.type == 'Cafe' &&
          detail.product.presentation.includes('1kilo')
            ? Number(detail.amount * 0.2)
            : Number(detail.amount)),
        0,
      ),
      closeAmount: closeDetails.reduce(
        (sum, detail) => sum + Number(detail.amount),
        0,
      ),
      initialDetail: openDetails.map(mapDetail),
      closeDetail: closeDetails.map(mapDetail),
    };
  }

  async runWeeklyOpenCut() {
    try {
      const now = new Date();
      const monday = this.getMondayOfWeek(now);
      const saturday = this.getSaturdayOfWeek(monday);
      const cuts = await this.createCutsByType({
        startDate: monday,
        endDate: saturday,
        period: 'WEEK',
        status: 'OPEN',
      });
      baseResponse.message = 'Corte semanal de apertura ejecutado.';
      baseResponse.data = { open: cuts.map((cut) => cut.id) };
      return baseResponse;
    } catch (err) {
      return this.handleCutError(err);
    }
  }

  async runWeeklyCloseCut() {
    try {
      const previousOpen = await this.prismaService.inventoryCut.findFirst({
        where: { status: 'OPEN', period: 'WEEK' },
        orderBy: { startDate: 'desc' },
      });

      if (!previousOpen) {
        badResponse.message =
          'No hay un corte de apertura semanal previo para cerrar.';
        return badResponse;
      }

      const cuts = await this.createCutsByType({
        startDate: this.parseCutDate(previousOpen.startDate),
        endDate: this.parseCutDate(previousOpen.endDate),
        period: 'WEEK',
        status: 'CLOSE',
      });
      baseResponse.message = 'Corte semanal de cierre ejecutado.';
      baseResponse.data = { close: cuts.map((cut) => cut.id) };
      return baseResponse;
    } catch (err) {
      return this.handleCutError(err);
    }
  }

  async executeWeeklyCut() {
    const openResult = await this.runWeeklyOpenCut();
    if (!openResult.success) return openResult;
    const closeResult = await this.runWeeklyCloseCut();
    if (!closeResult.success) return closeResult;
    baseResponse.message = 'Corte semanal de inventario ejecutado.';
    baseResponse.data = {
      open: openResult.data?.open ?? [],
      close: closeResult.data?.close ?? [],
    };
    return baseResponse;
  }

  @Cron('0 7 * * 1', { timeZone: 'America/Caracas' })
  async executeWeeklyOpenCron() {
    this.logger.debug('📅 Ejecutando corte semanal de apertura...');
    const result = await this.runWeeklyOpenCut();
    this.logger.debug('✅ Corte semanal de apertura completado');
    return result;
  }

  @Cron('0 14 * * 6', { timeZone: 'America/Caracas' })
  async executeWeeklyCloseCron() {
    this.logger.debug('📅 Ejecutando corte semanal de cierre...');
    const result = await this.runWeeklyCloseCut();
    this.logger.debug('✅ Corte semanal de cierre completado');
    return result;
  }

  async runMonthlyOpenCut() {
    try {
      const now = new Date();
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastDay = this.getLastDayOfMonth(now);
      const cuts = await this.createCutsByType({
        startDate: firstDay,
        endDate: lastDay,
        period: 'MONTH',
        status: 'OPEN',
      });
      baseResponse.message = 'Corte mensual de apertura ejecutado.';
      baseResponse.data = { open: cuts.map((cut) => cut.id) };
      return baseResponse;
    } catch (err) {
      return this.handleCutError(err);
    }
  }

  async runMonthlyCloseCut() {
    try {
      const previousOpen = await this.prismaService.inventoryCut.findFirst({
        where: { status: 'OPEN', period: 'MONTH' },
        orderBy: { startDate: 'desc' },
      });

      if (!previousOpen) {
        badResponse.message =
          'No hay un corte de apertura mensual previo para cerrar.';
        return badResponse;
      }

      const cuts = await this.createCutsByType({
        startDate: this.parseCutDate(previousOpen.startDate),
        endDate: this.parseCutDate(previousOpen.endDate),
        period: 'MONTH',
        status: 'CLOSE',
      });
      baseResponse.message = 'Corte mensual de cierre ejecutado.';
      baseResponse.data = { close: cuts.map((cut) => cut.id) };
      return baseResponse;
    } catch (err) {
      return this.handleCutError(err);
    }
  }

  @Cron('0 7 1 * *', { timeZone: 'America/Caracas' })
  async executeMonthlyOpenCron() {
    this.logger.debug('📅 Ejecutando corte mensual de apertura...');
    const result = await this.runMonthlyOpenCut();
    this.logger.debug('✅ Corte mensual de apertura completado');
    return result;
  }

  @Cron('0 7 28-31 * *', { timeZone: 'America/Caracas' })
  async executeMonthlyCloseCron() {
    this.logger.debug('📅 Ejecutando corte mensual de cierre...');
    const result = await this.runMonthlyCloseCut();
    this.logger.debug('✅ Corte mensual de cierre completado');
    return result;
  }

  async executeCut(data: ExecuteInventoryCutDTO) {
    if (data.period === 'week') {
      if (data.action === 'open') return await this.runWeeklyOpenCut();
      if (data.action === 'close') return await this.runWeeklyCloseCut();
      return await this.executeWeeklyCut();
    }
    if (data.action === 'open') return await this.runMonthlyOpenCut();
    if (data.action === 'close') return await this.runMonthlyCloseCut();
    const openResult = await this.runMonthlyOpenCut();
    if (!openResult.success) return openResult;
    const closeResult = await this.runMonthlyCloseCut();
    if (!closeResult.success) return closeResult;
    baseResponse.message = 'Corte mensual de inventario ejecutado.';
    baseResponse.data = {
      open: openResult.data?.open ?? [],
      close: closeResult.data?.close ?? [],
    };
    return baseResponse;
  }

  async getInventoryCuts(filter: InventoryCutFilterDTO) {
    const { type, period, startDate, endDate, page = 1, limit = 50 } = filter;
    const safePage = page > 0 ? page : 1;
    const safeLimit = limit > 0 ? Math.min(limit, 100) : 50;

    const cuts = await this.prismaService.inventoryCut.findMany({
      include: {
        details: { include: { product: true } },
      },
    });

    const groups = new Map<string, { open?: any; close?: any }>();
    for (const cut of cuts) {
      const key = `${cut.startDate}|${cut.endDate}|${cut.type}|${cut.period}`;
      const group: { open?: any; close?: any } = groups.get(key) ?? {};
      if (cut.status === 'CLOSE') group.close = cut;
      else group.open = cut;
      groups.set(key, group);
    }

    let results = [...groups.entries()].map(([key, group]) => ({
      key,
      ...this.buildCutResponse(group.open, group.close),
    }));

    if (type) {
      results = results.filter((result) => result.type === type);
    }
    if (period) {
      results = results.filter((result) => result.period === period);
    }
    if (startDate) {
      const comparableStart = this.toComparableFromFilter(startDate);
      results = results.filter(
        (result) => this.toComparable(result.endDate) >= comparableStart,
      );
    }
    if (endDate) {
      const comparableEnd = this.toComparableFromFilter(endDate);
      results = results.filter(
        (result) => this.toComparable(result.startDate) <= comparableEnd,
      );
    }

    results.sort(
      (a, b) => this.toComparable(b.startDate) - this.toComparable(a.startDate),
    );

    const totalCount = results.length;
    const skip = (safePage - 1) * safeLimit;
    const totalPages = Math.ceil(totalCount / safeLimit);

    return {
      cuts: results
        .slice(skip, skip + safeLimit)
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        .map(({ key, ...rest }) => rest),
      pagination: {
        page: safePage,
        limit: safeLimit,
        totalCount,
        totalPages,
        hasNextPage: safePage < totalPages,
        hasPreviousPage: safePage > 1,
      },
    };
  }
}
