/**
 * Aritmetica del rebasing de inventario.
 *
 * Una correccion manual de stock no crea una entrada nueva: se rebasa el
 * ULTIMO detalle de entrada tipo IN para que la suma del reporte cuadre con el
 * stock real. Estas funciones son puras (sin Prisma ni fechas) para poder
 * testearlas sin base de datos, igual que `remaining-calculator`.
 */

export type InventoryMovementType = 'ADJUSTMENT' | 'IN' | 'OUT' | 'EDIT';

export type RebaseResult =
  | { ok: true; oldAmount: number; rebasedQuantity: number }
  | { ok: false; oldAmount: number; reason: 'negative-rebase' };

/** `Inventory.quantity` es Decimal(10,3), asi que se redondea a 3 decimales. */
export function round3(value: number): number {
  return Number(value.toFixed(3));
}

/**
 * `detailQuantity` es la cantidad del ultimo detalle de entrada `IN`. Lo que se
 * movio desde esa entrada hasta hoy es `currentQuantity - detailQuantity`, asi
 * que el detalle tiene que absorber la diferencia para que la suma del reporte
 * desde esa entrada en adelante de el total nuevo:
 *
 *   rebased = requested - (current - detail)
 *
 * Si el resultado es negativo, la reduccion pide mas de lo que esa entrada
 * tiene registrado. No se escribe una cantidad negativa: se rechaza y la
 * reduccion debe registrarse como merma.
 */
export function computeRebasedDetailQuantity(
  currentQuantity: number,
  detailQuantity: number,
  requestedQuantity: number,
): RebaseResult {
  const oldAmount = round3(currentQuantity - detailQuantity);
  const rebasedQuantity = round3(requestedQuantity - oldAmount);

  if (rebasedQuantity < 0) {
    return { ok: false, oldAmount, reason: 'negative-rebase' };
  }

  return { ok: true, oldAmount, rebasedQuantity };
}

/**
 * El `totalAmount` de la cabecera tiene que seguir cuadrando con la suma de los
 * subtotales de sus detalles, y es Decimal(10,2).
 */
export function computeEntryTotalFromSubtotals(
  subtotals: (number | string | { toString(): string })[],
): number {
  return Number(
    subtotals.reduce<number>((sum, value) => sum + Number(value), 0).toFixed(2),
  );
}

/**
 * Solo `OUT` reduce stock. `IN` lo suma, y `ADJUSTMENT` tambien lo suma porque
 * es la devolucion por cancelacion de factura (invoices.service). Al editar o
 * borrar una entrada hay que devolver el stock en el sentido inverso al que lo
 * aplico.
 */
export function stockSignFor(movementType: InventoryMovementType): 1 | -1 {
  return movementType === 'OUT' ? -1 : 1;
}

export interface QuantifiedItem {
  productId: number;
  quantity: number | string | { toString(): string };
}

/**
 * Delta neto de stock por producto entre los detalles que se quitan y los que
 * se ponen.
 *
 * Los que se quitan entran con el signo contrario, porque hay que deshacer el
 * efecto que aplicaron: en una entrada `IN` quitar un detalle de 5 resta 5, no
 * suma 5. Sin esa inversion, editar una entrada `IN` duplicaba el stock.
 *
 * Se acumula por producto y no detalle por detalle para que un mismo producto
 * no se reporte como faltante cuando la operacion global lo compensa.
 */
export function computeNetStockDeltas(
  movementType: InventoryMovementType,
  removed: QuantifiedItem[],
  added: QuantifiedItem[],
): Map<number, number> {
  const deltas = new Map<number, number>();

  const accumulate = (items: QuantifiedItem[], factor: number) => {
    for (const item of items) {
      const delta =
        stockSignFor(movementType) * factor * Math.abs(Number(item.quantity));
      deltas.set(item.productId, (deltas.get(item.productId) ?? 0) + delta);
    }
  };

  accumulate(removed, -1);
  accumulate(added, 1);

  return deltas;
}
