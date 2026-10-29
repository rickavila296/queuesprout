import { describe, expect, it } from 'vitest';
import { decodeCaCert, pgConnection } from './client';

const PEM = '-----BEGIN CERTIFICATE-----\nMIIBfake\n-----END CERTIFICATE-----';

describe('pgConnection', () => {
  it('leaves the URL alone without a CA', () => {
    const url = 'postgres://u:p@db.example.com:5432/app?sslmode=require';
    expect(pgConnection(url)).toEqual({ connectionString: url });
  });

  it('verifies against the CA and drops sslmode, which would override it', () => {
    const conn = pgConnection('postgres://u:p@db.example.com:5432/app?sslmode=require&x=1', PEM);
    expect(conn.ssl).toEqual({ ca: PEM, rejectUnauthorized: true });
    expect(conn.connectionString).toBe('postgres://u:p@db.example.com:5432/app?x=1');
  });
});

describe('decodeCaCert', () => {
  it('takes PEM as is or base64-encoded', () => {
    expect(decodeCaCert(`  ${PEM}\n`)).toBe(PEM);
    expect(decodeCaCert(Buffer.from(PEM).toString('base64'))).toBe(PEM);
  });

  it('ignores quotes, a byte-order mark and literal \\n that pasting adds', () => {
    const base64 = Buffer.from(PEM).toString('base64');
    expect(decodeCaCert(`"${base64}"`)).toBe(PEM);
    expect(decodeCaCert(`'${PEM}'`)).toBe(PEM);
    expect(decodeCaCert(`\uFEFF${PEM}`)).toBe(PEM);
    expect(decodeCaCert(Buffer.from(`\uFEFF${PEM}`).toString('base64'))).toBe(PEM);
    expect(decodeCaCert(PEM.replaceAll('\n', '\\n'))).toBe(PEM);
  });

  it('refuses anything else', () => {
    expect(() => decodeCaCert('not a cert')).toThrow(/PEM certificate/);
  });
});
