type DecimalLike = number | string | { toString(): string } | null | undefined;

type Currency = 'USD' | 'BS';

/**
 * Tolerancia en USD por debajo de la cual una factura se considera pagada.
 * Regla de negocio intencional (absorbe el redondeo de conversiones BS/USD).
 * Configurable con `PAYMENT_TOLERANCE_USD`; default 2.
 */
export function getPaymentTolerance(): number {
  const parsed = Number(process.env.PAYMENT_TOLERANCE_USD);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

export function toNumber(value: DecimalLike): number {
  if (value === null || value === undefined) {
    return 0;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : 0;
  }

  const parsed = Number(value.toString());
  return Number.isFinite(parsed) ? parsed : 0;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function clampZero(value: number): number {
  if (value < 0) {
    return 0;
  }
  return value;
}

export function calculateInvoicePaidUsd(
  invoicePayments: Array<{ amount: DecimalLike }>,
): number {
  return round2(
    invoicePayments.reduce((acc, item) => acc + toNumber(item.amount), 0),
  );
}

/**
 * `InvoicePayment.amount` esta definido SIEMPRE en USD (ver `payment.dto.ts`).
 * Mezclar pagos en BS con un saldo en USD sin convertir marca facturas como
 * pagadas con muy poco dinero realmente cobrado, asi que toda conversion se
 * hace en el borde de la API, nunca al sumar saldos.
 */
export function calculateInvoiceRemainingUsd(
  totalAmountUsd: DecimalLike,
  invoicePayments: Array<{ amount: DecimalLike }>,
  tolerance: number = getPaymentTolerance(),
): number {
  const total = toNumber(totalAmountUsd);
  const paid = calculateInvoicePaidUsd(invoicePayments);
  const remaining = round2(total - paid);
  return remaining <= tolerance ? 0 : remaining;
}

/** Un saldo esta saldado cuando no supera la tolerancia configurada. */
export function isInvoiceSettled(
  remainingUsd: number,
  tolerance: number = getPaymentTolerance(),
): boolean {
  return remainingUsd <= tolerance;
}

export function calculatePaymentAllocatedUsd(
  invoicePayments: Array<{ amount: DecimalLike }>,
): number {
  return round2(
    invoicePayments.reduce((acc, item) => acc + toNumber(item.amount), 0),
  );
}

export function calculatePaymentRemaining(
  paymentAmount: DecimalLike,
  currency: Currency,
  dolarRate: DecimalLike,
  invoicePayments: Array<{ amount: DecimalLike }>,
) {
  const totalAmount = toNumber(paymentAmount);
  const rate = toNumber(dolarRate);
  const allocatedUSD = calculatePaymentAllocatedUsd(invoicePayments);

  const allocatedInOriginalCurrency =
    currency === 'USD' ? allocatedUSD : allocatedUSD * rate;

  const remainingOriginal = round2(
    clampZero(totalAmount - allocatedInOriginalCurrency),
  );
  const remainingUSD =
    currency === 'USD'
      ? remainingOriginal
      : round2(rate > 0 ? remainingOriginal / rate : 0);

  return {
    allocatedUSD,
    allocatedInOriginalCurrency: round2(allocatedInOriginalCurrency),
    remainingOriginal,
    remainingUSD,
  };
}
