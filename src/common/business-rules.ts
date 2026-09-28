/**
 * Reglas de negocio configurables por entorno.
 *
 * Antes estas reglas vivian incrustadas como comparaciones de texto sobre
 * nombres (`method.name !== 'Zelle'`, `account.name.includes('gastos')`,
 * `product.type !== 'queso'`). Renombrar una cuenta, un metodo o un tipo de
 * producto cambiaba en silencio la clasificacion de pagos y la validacion de
 * mermas.
 */

function csvEnv(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined) return fallback;

  const parsed = raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);

  return parsed.length > 0 ? parsed : fallback;
}

/**
 * Metodos de pago cuyos ingresos quedan PENDING hasta confirmacion manual.
 * Default historico: Zelle.
 */
export function getPendingConfirmationMethods(): string[] {
  return csvEnv('PENDING_CONFIRMATION_METHODS', ['Zelle']).map((value) =>
    value.toLowerCase(),
  );
}

export function isPendingConfirmationMethod(methodName: string): boolean {
  return getPendingConfirmationMethods().includes(
    String(methodName ?? '')
      .trim()
      .toLowerCase(),
  );
}

/** Tipos de producto para los que se permite registrar merma. */
export function getLossAllowedProductTypes(): string[] {
  return csvEnv('LOSS_ALLOWED_PRODUCT_TYPES', ['queso']).map((value) =>
    value.trim().toLowerCase(),
  );
}

export function isLossAllowedProductType(productType: string): boolean {
  return getLossAllowedProductTypes().includes(
    String(productType ?? '')
      .trim()
      .toLowerCase(),
  );
}

/**
 * Nombres de cuenta historicamente tratados como gasto. Se conserva solo como
 * red de seguridad: la clasificacion correcta usa `Payment.type` explicito o
 * el flag `AccountsPayments.isExpense`.
 */
export function getLegacyExpenseAccountNames(): string[] {
  return csvEnv('LEGACY_EXPENSE_ACCOUNT_NAMES', ['gastos']).map((value) =>
    value.trim().toLowerCase(),
  );
}

export function looksLikeLegacyExpenseAccount(accountName: string): boolean {
  const name = String(accountName ?? '')
    .trim()
    .toLowerCase();
  return getLegacyExpenseAccountNames().some((needle) => name.includes(needle));
}
