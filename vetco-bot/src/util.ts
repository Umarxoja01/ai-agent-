/** Escapes text for Telegram HTML parse mode and for HTML pages (text and attribute values). */
export function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 1250000 -> "1 250 000" (non-breaking spaces). */
export function groupDigits(n: number): string {
  return String(Math.trunc(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Trims and collapses whitespace; returns '' for non-strings. */
export function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/**
 * Normalizes a phone number to +<digits>. Nine digits are treated as an Uzbek
 * number without the country code. Returns null when it does not look like a phone.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  if (!/^[+\d\s()\-.]{7,25}$/.test(raw)) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length === 9) return `+998${digits}`;
  if (digits.length === 12 && digits.startsWith('998')) return `+${digits}`;
  if (raw.startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  return null;
}

/** Constant-time string comparison for secrets. */
export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export function bearerOk(request: Request, token: string | undefined): boolean {
  if (!token) return false;
  const header = request.headers.get('Authorization') ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return !!match && safeEqual(match[1]!.trim(), token);
}

export function parseIdList(value: string | undefined): Set<number> {
  const ids = new Set<number>();
  for (const part of (value ?? '').split(',')) {
    const n = Number(part.trim());
    if (part.trim() && Number.isSafeInteger(n)) ids.add(n);
  }
  return ids;
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

/** Product and category ids: they go into callback_data (64 bytes) and URLs. */
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;
