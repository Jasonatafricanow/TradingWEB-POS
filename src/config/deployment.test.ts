import { describe, expect, it } from 'vitest';
import { parseRuntimeConfig, describeConfig, getBuildConfig } from './deployment';

describe('parseRuntimeConfig', () => {
  it('解析 JSON 配置', () => {
    const cfg = parseRuntimeConfig(
      '{"serverUrl":"http://192.168.8.109:5000","storeId":"abc-123","currency":"MZN","taxRateBps":850,"storeName":"F&J Maputo"}',
    );
    expect(cfg).not.toBeNull();
    expect(cfg!.serverUrl).toBe('http://192.168.8.109:5000');
    expect(cfg!.storeId).toBe('abc-123');
    expect(cfg!.currency).toBe('MZN');
    expect(cfg!.taxRateBps).toBe(850);
    expect(cfg!.storeName).toBe('F&J Maputo');
  });

  it('解析键值行配置', () => {
    const cfg = parseRuntimeConfig([
      '# 门店部署配置',
      'serverUrl=http://192.168.8.109:5000',
      'store_id=abc-123',
      'currency=mzn',
      'tax_bps=850',
      '',
    ].join('\n'));
    expect(cfg).not.toBeNull();
    expect(cfg!.serverUrl).toBe('http://192.168.8.109:5000');
    expect(cfg!.storeId).toBe('abc-123');
    expect(cfg!.currency).toBe('MZN');
    expect(cfg!.taxRateBps).toBe(850);
  });

  it('空输入返回 null', () => {
    expect(parseRuntimeConfig('')).toBeNull();
    expect(parseRuntimeConfig('   \n  ')).toBeNull();
  });

  it('坏 JSON 返回 null（不以 { 开头则走键值解析，全无效也返回 null）', () => {
    expect(parseRuntimeConfig('{bad json')).toBeNull();
    expect(parseRuntimeConfig('hello world')).toBeNull();
  });

  it('忽略未知键与无效值', () => {
    const cfg = parseRuntimeConfig('serverUrl=http://x\nunknownKey=1\ncurrency=EUR\ntax_bps=abc');
    expect(cfg).not.toBeNull();
    expect(cfg!.serverUrl).toBe('http://x');
    expect(cfg!.currency).toBe('EUR');
    expect(cfg!.taxRateBps).toBeUndefined();
  });
  it('rejects a JSON config that declares an unsupported currency', () => {
    expect(parseRuntimeConfig('{"serverUrl":"https://example.test","currency":"BTC"}')).toBeNull();
  });

  it('rejects a key-value config that declares an unsupported currency', () => {
    expect(parseRuntimeConfig('serverUrl=https://example.test\ncurrency=BTC')).toBeNull();
  });

  it('normalizes supported currency values before returning them', () => {
    expect(parseRuntimeConfig('currency=mzn')).toMatchObject({ currency: 'MZN' });
  });

  it('rejects a serverUrl without an http(s) scheme', () => {
    expect(parseRuntimeConfig('serverUrl=192.168.8.109:5000')).toBeNull();
    expect(parseRuntimeConfig('{"serverUrl":"ftp://example.test"}')).toBeNull();
    expect(parseRuntimeConfig('{"serverUrl":"javascript:alert(1)"}')).toBeNull();
  });

  it('accepts http and https server URLs and omits empty ones', () => {
    expect(parseRuntimeConfig('serverUrl=http://192.168.8.109:5000')).toMatchObject({ serverUrl: 'http://192.168.8.109:5000' });
    expect(parseRuntimeConfig('serverUrl=https://example.test')).toMatchObject({ serverUrl: 'https://example.test' });
    expect(parseRuntimeConfig('{"serverUrl":""}')).not.toHaveProperty('serverUrl');
  });
});

describe('describeConfig', () => {
  it('输出可读摘要', () => {
    const text = describeConfig({
      dataSource: 'tradingweb',
      serverUrl: 'http://192.168.8.109:5000',
      storeId: 'abc',
      currency: 'MZN',
      taxRateBps: 850,
    });
    expect(text).toContain('serverUrl=http://192.168.8.109:5000');
    expect(text).toContain('currency=MZN');
  });

  it('round-trips empty serverUrl and storeId as comments', () => {
    const text = describeConfig({
      dataSource: 'tradingweb',
      serverUrl: '',
      storeId: null,
      currency: 'MZN',
      taxRateBps: 850,
    });
    expect(text).toContain('# serverUrl=(未配置)');
    expect(text).toContain('# storeId=(未选择)');
    const reparsed = parseRuntimeConfig(text);
    expect(reparsed).not.toBeNull();
    expect(reparsed).not.toHaveProperty('serverUrl');
    expect(reparsed).not.toHaveProperty('storeId');
  });
});

describe('getBuildConfig', () => {
  it('返回内置默认值', () => {
    const cfg = getBuildConfig();
    expect(cfg).toHaveProperty('dataSource');
    expect(cfg).toHaveProperty('serverUrl');
    expect(cfg).toHaveProperty('storeId');
    expect(cfg).toHaveProperty('currency');
    expect(cfg).toHaveProperty('taxRateBps');
  });
});
