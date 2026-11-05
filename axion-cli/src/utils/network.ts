import { lookup } from 'dns/promises';
import type { AgentOptions } from 'http';
import { isIP } from 'net';

export interface PublicHttpDestination {
  url: URL;
  addresses: Array<{ address: string; family: number }>;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113);
}

function isPrivateIPv6(address: string): boolean {
  const value = address.toLowerCase().split('%')[0];
  if (value === '::' || value === '::1') return true;
  if (value.startsWith('::ffff:')) {
    const mapped = value.slice('::ffff:'.length);
    if (mapped.includes('.')) return isPrivateIPv4(mapped);
    const hex = mapped.split(':').map((part) => parseInt(part || '0', 16));
    if (hex.length >= 2 && hex.every(Number.isFinite)) {
      const ipv4 = `${hex[0] >> 8}.${hex[0] & 255}.${hex[1] >> 8}.${hex[1] & 255}`;
      return isPrivateIPv4(ipv4);
    }
    return true;
  }

  const first = parseInt(value.split(':')[0] || '0', 16);
  if (!Number.isFinite(first) || first < 0x2000 || first > 0x3fff) return true;
  // Exclude well-known special-purpose, documentation, transition, and translation ranges.
  return value.startsWith('2001::') ||
    value.startsWith('2001:0:') ||
    value.startsWith('2001:2:') ||
    value.startsWith('2001:10:') ||
    value.startsWith('2001:db8:') ||
    value.startsWith('2002:') ||
    value.startsWith('64:ff9b:') ||
    value.startsWith('64:ff9b:1:');
}

export function isPrivateOrReservedIp(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isPrivateIPv4(address);
  if (version === 6) return isPrivateIPv6(address);
  return true;
}

function normalizedHostname(value: string): string {
  return value.toLowerCase().replace(/^\[|\]$/g, '');
}

/** Resolve and validate a public destination once, returning the exact addresses to pin for the request. */
export async function resolvePublicHttpUrl(value: string): Promise<PublicHttpDestination> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Invalid URL. Provide an absolute HTTP or HTTPS URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Only HTTP and HTTPS URLs are supported.');
  }
  if (url.username || url.password) {
    throw new Error('URLs containing embedded credentials are not allowed.');
  }

  const hostname = normalizedHostname(url.hostname);
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') || hostname.endsWith('.internal') || hostname.endsWith('.test') ||
      hostname.endsWith('.lan') || hostname.endsWith('.home.arpa')) {
    throw new Error('Local or reserved hostnames are not allowed.');
  }

  const version = isIP(hostname);
  if (version) {
    if (isPrivateOrReservedIp(hostname)) throw new Error('Private or reserved IP addresses are not allowed.');
    return { url, addresses: [{ address: hostname, family: version }] };
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new Error(`Could not resolve host: ${hostname}`);
  }
  if (!addresses.length || addresses.some((item) => isPrivateOrReservedIp(item.address))) {
    throw new Error('The URL resolves to a private or reserved IP address and was blocked.');
  }
  return { url, addresses };
}

/** Build a DNS lookup callback that pins the already-validated address set, preventing DNS-rebinding between check and connect. */
export function createPinnedLookup(
  hostname: string,
  addresses: Array<{ address: string; family: number }>,
): NonNullable<AgentOptions['lookup']> {
  const expectedHostname = normalizedHostname(hostname);
  return ((requestedHostname: string, options: unknown, callback: (...args: unknown[]) => void): void => {
    if (normalizedHostname(requestedHostname) !== expectedHostname) {
      const error = Object.assign(new Error('The request attempted to resolve an unvalidated hostname.'), { code: 'EAI_NONAME' });
      callback(error, '', 0);
      return;
    }

    const lookupOptions = typeof options === 'object' && options !== null
      ? options as { all?: boolean; family?: number }
      : {};
    if (lookupOptions.all) {
      callback(null, addresses.map((item) => ({ address: item.address, family: item.family })));
      return;
    }
    const selected = addresses.find((item) => !lookupOptions.family || item.family === lookupOptions.family) || addresses[0];
    callback(null, selected.address, selected.family);
  }) as NonNullable<AgentOptions['lookup']>;
}

/** Compatibility helper for validation-only callers. Network requests should use resolvePublicHttpUrl + createPinnedLookup. */
export async function assertPublicHttpUrl(value: string): Promise<URL> {
  return (await resolvePublicHttpUrl(value)).url;
}
