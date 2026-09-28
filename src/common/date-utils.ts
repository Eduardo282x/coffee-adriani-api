/**
 * Utilidades de fecha con zona horaria de negocio.
 *
 * Antes de este modulo el proyecto mezclaba tres semanticas distintas para el
 * mismo concepto (UTC en payments, hora local del servidor en expenses/
 * inventory, y un `toLocaleString()` roto en dashboard que produce
 * `Invalid Date` con ICU >= 72 por el U+202F previo a AM/PM).
 *
 * La regla ahora es una sola: los rangos de fechas se interpre siempre como
 * dias calendario de la zona de negocio y se devuelven como instantes UTC
 * listos para `gte` / `lt` de Prisma.
 */

const DEFAULT_BUSINESS_TZ = 'America/Caracas';

export function getBusinessTimeZone(): string {
  return process.env.BUSINESS_TZ?.trim() || DEFAULT_BUSINESS_TZ;
}

function parseDateInput(value: Date | string | number): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Fecha invalida: se recibio un Date no valido.');
    }
    return value;
  }

  if (typeof value === 'number') {
    const fromNumber = new Date(value);
    if (Number.isNaN(fromNumber.getTime())) {
      throw new TypeError(`Fecha invalida: ${value}`);
    }
    return fromNumber;
  }

  const raw = String(value).trim();
  if (!raw) {
    throw new TypeError('Fecha invalida: valor vacio.');
  }

  // `YYYY-MM-DD` se interpreta como dia calendario en la zona de negocio,
  // nunca como medianoche UTC.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return new Date(`${raw}T12:00:00.000Z`);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new TypeError(`Fecha invalida: ${raw}`);
  }
  return parsed;
}

/** Devuelve `YYYY-MM-DD` del instante dado, ya sea en la zona indicada. */
export function formatDateInTz(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function tzOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const part of parts) {
    map[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second),
  );

  return asUtc - date.getTime();
}

/** Instante UTC que corresponde a la medianoche local de `ymd` en `timeZone`. */
function zonedMidnightToUtc(ymd: string, timeZone: string): Date {
  const target = Date.parse(`${ymd}T00:00:00.000Z`);
  let guess = new Date(target);

  // Dos pasadas: la primera corrige el desfase aproximado, la segunda el
  // desfase real ya situado en la zona correcta (necesario con DST).
  for (let i = 0; i < 2; i += 1) {
    const offset = tzOffsetMs(guess, timeZone);
    const next = new Date(target - offset);
    if (next.getTime() === guess.getTime()) {
      break;
    }
    guess = next;
  }

  return guess;
}

function shiftYmd(ymd: string, days: number): string {
  const base = new Date(`${ymd}T00:00:00.000Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/**
 * `00:00:00.000` del dia calendario (en zona de negocio) del valor dado.
 */
export function startOfDayUtc(
  value: Date | string | number,
  timeZone: string = getBusinessTimeZone(),
): Date {
  const date = parseDateInput(value);
  return zonedMidnightToUtc(formatDateInTz(date, timeZone), timeZone);
}

/**
 * Ultimo milisegundo del dia calendario (en zona de negocio) del valor dado.
 * Preferí `lt: startOfNextDayUtc(...)` en rangos: usar `lte` sobre
 * `23:59:59.999` deja fuera los ultimos microsegundos del dia.
 */
export function endOfDayUtc(
  value: Date | string | number,
  timeZone: string = getBusinessTimeZone(),
): Date {
  return new Date(startOfNextDayUtc(value, timeZone).getTime() - 1);
}

/** `00:00:00.000` del dia siguiente. Usar como limite exclusivo (`lt`). */
export function startOfNextDayUtc(
  value: Date | string | number,
  timeZone: string = getBusinessTimeZone(),
): Date {
  const date = parseDateInput(value);
  const nextYmd = shiftYmd(formatDateInTz(date, timeZone), 1);
  return zonedMidnightToUtc(nextYmd, timeZone);
}

/**
 * Rango `[start, end)` en UTC para los dias calendario indicados.
 * Devuelve `undefined` cuando el filtro viene incompleto.
 */
export function buildDateRangeFilter(
  startDate?: Date | string | number | null,
  endDate?: Date | string | number | null,
  timeZone: string = getBusinessTimeZone(),
): { gte: Date; lt: Date } | undefined {
  const hasStart =
    startDate !== undefined && startDate !== null && startDate !== '';
  const hasEnd = endDate !== undefined && endDate !== null && endDate !== '';

  if (!hasStart && !hasEnd) {
    return undefined;
  }

  const gte = hasStart
    ? startOfDayUtc(startDate as Date | string | number, timeZone)
    : startOfDayUtc('1970-01-01', timeZone);

  const lt = hasEnd
    ? startOfNextDayUtc(endDate as Date | string | number, timeZone)
    : startOfNextDayUtc('2999-12-31', timeZone);

  return { gte, lt };
}

export function getPaymentToleranceUsd(): number {
  const raw = process.env.PAYMENT_TOLERANCE_USD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 2;
}

export function getLowStockThreshold(): number {
  const raw = process.env.LOW_STOCK_THRESHOLD;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 10;
}
