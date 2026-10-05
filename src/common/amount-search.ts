/**
 * Busqueda de pagos por monto.
 *
 * `Payment.amount` guarda el monto en la moneda de la cuenta (`BS` o `USD`),
 * asi que el mismo numero no significa lo mismo en cada pago: 200 puede ser
 * 200 Bs (poco) o 200 USD (mucho). Para que "200" encuentre el pago que el
 * usuario tiene en mente, el monto se compara contra las TRES
 * representaciones de cada pago (original, en Bs y en USD) dentro de un rango
 * con tolerancia porcentual: 200 -> 150..250.
 *
 * El rango se evalua pago por pago en la aplicacion, no en SQL: convertir exige
 * `amount * dolar.dolar`, producto de dos columnas, que Prisma no puede
 * expresar en un `where`.
 */

import { round2, toNumber } from './remaining-calculator';

type DecimalLike = number | string | { toString(): string } | null | undefined;

type Currency = 'USD' | 'BS';

export interface AmountSearchRange {
  min: number;
  max: number;
}

export interface AmountSearchTarget {
  amount: DecimalLike;
  currency: Currency;
  dolarRate: DecimalLike;
}

/** Tolerancia por defecto: 25% a cada lado (200 -> 150..250). */
const DEFAULT_AMOUNT_SEARCH_TOLERANCE = 0.25;

/** Solo miles: `1.500`, `25.617.556`, `1,500`. */
const THOUSANDS = /^(\d{1,3})(?:[.,]\d{3})+$/;

/** Miles con decimales: `25.617.556,14`, `1.500,50`. */
const THOUSANDS_WITH_DECIMALS = /^(\d{1,3}(?:[.,]\d{3})+)([.,]\d{1,2})$/;

/** Decimal simple: `200.50`, `200,50`, `0.5`. */
const DECIMAL = /^\d+([.,]\d{1,2})?$/;

export function getAmountSearchTolerance(): number {
  const parsed = Number(process.env.PAYMENT_AMOUNT_SEARCH_TOLERANCE);
  return Number.isFinite(parsed) && parsed >= 0
    ? parsed
    : DEFAULT_AMOUNT_SEARCH_TOLERANCE;
}

/**
 * Interpreta el termino de busqueda como monto, o `undefined` si es texto.
 *
 * `Payment.amount` es `Decimal(10,2)`, asi que el separador siempre precedido
 * por 3 digitos se toma como millar y el precedido por 1 o 2 como decimal:
 * `1.500` -> 1500, `1,50` -> 1.5. Se aceptan ambos separadores porque el
 * usuario escribe como le muestran el monto y no siempre con el mismo.
 *
 * Antes se usaba `parseFloat`, que aceptaba cualquier prefijo numerico
 * (`"200abc"` -> 200) y hacia que una referencia guardada como `"200-15"`
 * tambien se comparara como monto.
 */
export function parseAmountSearch(raw: string): number | undefined {
  if (typeof raw !== 'string') return undefined;

  const term = raw.trim().replace(/\s+/g, '');
  if (!term) return undefined;

  const withDecimals = term.match(THOUSANDS_WITH_DECIMALS);
  if (withDecimals) {
    const integerPart = withDecimals[1].replace(/[.,]/g, '');
    return parseDecimal(`${integerPart}${withDecimals[2].replace(',', '.')}`);
  }

  if (THOUSANDS.test(term)) {
    return parseDecimal(term.replace(/[.,]/g, ''));
  }

  if (DECIMAL.test(term)) {
    return parseDecimal(term.replace(',', '.'));
  }

  return undefined;
}

function parseDecimal(term: string): number | undefined {
  const value = Number(term);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * Rango de busqueda a partir del monto tipeado. El minimo se acota en 0 para
 * que un valor 0 no produzca un rango con limite negativo.
 */
export function getAmountSearchRange(
  value: number,
  tolerance: number = getAmountSearchTolerance(),
): AmountSearchRange {
  const pct =
    Number.isFinite(tolerance) && tolerance >= 0
      ? tolerance
      : DEFAULT_AMOUNT_SEARCH_TOLERANCE;

  return {
    min: round2(Math.max(0, value * (1 - pct))),
    max: round2(value * (1 + pct)),
  };
}

function isWithinRange(value: number, range: AmountSearchRange): boolean {
  return value >= range.min && value <= range.max;
}

/**
 * El pago coincide si el monto buscado cae en el rango de cualquiera de sus
 * representaciones. Comparar solo `amount` devolvia 56 resultados en prod para
 * "200" (pagos BS de 200 Bs, que valen ~0,23 USD) y perdiaba los pagos en Bs
 * que valen 200 USD, que son la gran mayoria del negocio.
 */
export function isAmountInSearchRange(
  target: AmountSearchTarget,
  range: AmountSearchRange,
): boolean {
  const amount = toNumber(target.amount);

  if (isWithinRange(amount, range)) return true;

  // Sin tasa no hay conversion posible: `HistoryDolar` tiene filas con
  // `dolar = 0` y dividir por ellas daria Infinity o NaN.
  const rate = toNumber(target.dolarRate);
  if (rate <= 0) return false;

  const amountUsd = target.currency === 'USD' ? amount : amount / rate;
  const amountBs = target.currency === 'BS' ? amount : amount * rate;

  return isWithinRange(amountUsd, range) || isWithinRange(amountBs, range);
}
