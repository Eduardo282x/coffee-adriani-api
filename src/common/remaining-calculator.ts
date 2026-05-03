type DecimalLike = number | string | { toString(): string } | null | undefined;

type Currency = 'USD' | 'BS';

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

export function calculateInvoicePaidUsd(invoicePayments: Array<{ amount: DecimalLike }>): number {
  return round2(
    invoicePayments.reduce((acc, item) => acc + toNumber(item.amount), 0)
  );
}

export function calculateInvoiceRemainingUsd(totalAmountUsd: DecimalLike, invoicePayments: Array<{ amount: DecimalLike }>): number {
  const total = toNumber(totalAmountUsd);
  const paid = calculateInvoicePaidUsd(invoicePayments);
  return round2(clampZero(total - paid));
}

export function calculatePaymentAllocatedUsd(invoicePayments: Array<{ amount: DecimalLike }>): number {
  return round2(
    invoicePayments.reduce((acc, item) => acc + toNumber(item.amount), 0)
  );
}

export function calculatePaymentRemaining(
  paymentAmount: DecimalLike,
  currency: Currency,
  dolarRate: DecimalLike,
  invoicePayments: Array<{ amount: DecimalLike }>
) {
  const totalAmount = toNumber(paymentAmount);
  const rate = toNumber(dolarRate);
  const allocatedUSD = calculatePaymentAllocatedUsd(invoicePayments);

  const allocatedInOriginalCurrency = currency === 'USD'
    ? allocatedUSD
    : allocatedUSD * rate;

  const remainingOriginal = round2(clampZero(totalAmount - allocatedInOriginalCurrency));
  const remainingUSD = currency === 'USD'
    ? remainingOriginal
    : round2(rate > 0 ? remainingOriginal / rate : 0);

  return {
    allocatedUSD,
    allocatedInOriginalCurrency: round2(allocatedInOriginalCurrency),
    remainingOriginal,
    remainingUSD,
  };
}
