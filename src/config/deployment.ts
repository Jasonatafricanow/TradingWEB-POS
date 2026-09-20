import { CURRENCY_SYMBOL, type Currency } from '@/utils/money';

/**
 * 通用部署配置模块（2026-08-12 新增）
 *
 * 解决的问题：每次装新 APK 都要在设置页手动填服务器地址、选门店、配货币税率——很麻烦。
 * 目标：打包时预置好部署参数，安装即用；同时保留运行时手动配置能力。
 *
 * 用法：
 * 1. 打包预置：设置构建环境变量 POS_DEFAULT_SERVER_URL 等（见 scripts/build/README）
 *    或直接改本文件 DEFAULT_BUILD_CONFIG 后重新打包。
 * 2. 运行时覆盖：设置页手动改（优先级最高，持久化到 AsyncStorage）。
 * 3. 快速导入：设置页提供"粘贴配置 JSON"入口（applyRuntimeConfig），
 *    支持从服务器下发或从分享文本粘贴，一步完成 bootstrap 所需参数。
 *
 * 配置优先级：持久化配置(AsyncStorage) > 运行时导入 > 构建预置 > 内置默认
 */

// ---------- 构建时预置（打包前改这里或注入环境变量） ----------
// ⚠️ 部署给真实门店时，把这里改成门店实际参数后重新打包
//    或构建时注入：POS_DEFAULT_SERVER_URL=... POS_DEFAULT_STORE_ID=...
export const DEFAULT_BUILD_CONFIG: BuildConfig = {
  dataSource: 'tradingweb', // 'mock' | 'tradingweb'
  serverUrl: 'https://fjglobal.online', // 伦敦服务器 tradingWEB 生产环境（nginx → 127.0.0.1:3000）
  storeId: null,      // TradingWEB 门店 UUID（bootstrap 后自动填充，也可预置）
  currency: 'MZN',    // 'USD' | 'CNY' | 'EUR' | 'MZN'
  taxRateBps: 0,      // 基点：850 = 8.5%
  storeName: 'TradingWEB 门店',
  storeAddress: '',
  storeFooter: '谢谢惠顾，欢迎再次光临',
};

export interface BuildConfig {
  dataSource: 'mock' | 'tradingweb';
  serverUrl: string;
  storeId: string | null;
  currency: Currency;
  taxRateBps: number;
  storeName: string;
  storeAddress: string;
  storeFooter: string;
}

export function isSupportedCurrency(value: unknown): value is Currency {
  return typeof value === 'string'
    && Object.prototype.hasOwnProperty.call(CURRENCY_SYMBOL, value.toUpperCase());
}

function normalizeCurrency(value: unknown): Currency | null {
  if (!isSupportedCurrency(value)) return null;
  return value.toUpperCase() as Currency;
}

/** 服务器地址必须是 http(s):// 开头的完整 URL；不合法返回 null（空串视为未提供） */
function normalizeServerUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  if (!t) return null;
  if (!/^https?:\/\/[^\s]+$/i.test(t)) return null;
  return t;
}

/** 是否为明文 HTTP 地址（用于运行时警告） */
export function isInsecureServerUrl(value: string): boolean {
  return /^http:\/\//i.test(value.trim());
}

/** 从构建环境变量读取（支持 React Native 的 process.env.EXPO_PUBLIC_* 注入） */
function envConfig(): Partial<BuildConfig> {
  const e = process.env as Record<string, string | undefined>;
  const c: Partial<BuildConfig> = {};
  const serverUrl = normalizeServerUrl(e.POS_DEFAULT_SERVER_URL);
  if (serverUrl) c.serverUrl = serverUrl;
  if (e.POS_DEFAULT_STORE_ID) c.storeId = e.POS_DEFAULT_STORE_ID;
  const currency = normalizeCurrency(e.POS_DEFAULT_CURRENCY);
  if (currency) c.currency = currency;
  if (e.POS_DEFAULT_TAX_BPS) c.taxRateBps = Number(e.POS_DEFAULT_TAX_BPS) || 0;
  if (e.POS_DEFAULT_SOURCE === 'tradingweb' || e.POS_DEFAULT_SOURCE === 'mock') c.dataSource = e.POS_DEFAULT_SOURCE;
  return c;
}

export const getBuildConfig = (): BuildConfig => ({
  ...DEFAULT_BUILD_CONFIG,
  ...envConfig(),
});

// ---------- 运行时导入（设置页"粘贴配置"入口用） ----------
export interface RuntimeConfig {
  serverUrl?: string;
  storeId?: string;
  currency?: Currency;
  taxRateBps?: number;
  storeName?: string;
  storeAddress?: string;
  storeFooter?: string;
  dataSource?: 'mock' | 'tradingweb';
}

/**
 * 解析用户粘贴/分享的配置文本。
 * 支持格式：
 *   - JSON：{"serverUrl":"http://...","storeId":"...","currency":"MZN","taxRateBps":850}
 *   - 键值行：serverUrl=http://...\nstoreId=...（= 分隔，忽略 # 注释与空行）
 * 返回 null 表示格式无法识别。
 */
export function parseRuntimeConfig(text: string): RuntimeConfig | null {
  const t = (text ?? '').trim();
  if (!t) return null;
  // JSON 优先
  if (t.startsWith('{')) {
    try {
      const obj = JSON.parse(t) as Record<string, unknown>;
      const out: RuntimeConfig = {};
      if (obj.serverUrl !== undefined) {
        if (typeof obj.serverUrl !== 'string') return null;
        const trimmed = obj.serverUrl.trim();
        if (trimmed && !/^https?:\/\/[^\s]+$/i.test(trimmed)) return null;
        if (trimmed) out.serverUrl = trimmed;
      }
      if (typeof obj.storeId === 'string' && obj.storeId.trim()) out.storeId = obj.storeId.trim();
      if (obj.currency !== undefined) {
        const currency = normalizeCurrency(obj.currency);
        if (!currency) return null;
        out.currency = currency;
      }
      if (typeof obj.taxRateBps === 'number') out.taxRateBps = obj.taxRateBps;
      if (typeof obj.storeName === 'string') out.storeName = obj.storeName.trim();
      if (typeof obj.storeAddress === 'string') out.storeAddress = obj.storeAddress.trim();
      if (typeof obj.storeFooter === 'string') out.storeFooter = obj.storeFooter.trim();
      if (obj.dataSource === 'mock' || obj.dataSource === 'tradingweb') out.dataSource = obj.dataSource;
      return out;
    } catch {
      return null;
    }
  }
  // 键值行
  const out: RuntimeConfig = {};
  for (const rawLine of t.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!value) continue;
    switch (key) {
      case 'serverUrl': case 'server_url': {
        const url = normalizeServerUrl(value);
        if (url === null) return null;
        out.serverUrl = url;
        break;
      }
      case 'storeId': case 'store_id': out.storeId = value; break;
      case 'currency': {
        const currency = normalizeCurrency(value);
        if (!currency) return null;
        out.currency = currency;
        break;
      }
      case 'taxRateBps': case 'tax_bps': {
        const n = Number(value);
        if (Number.isFinite(n)) out.taxRateBps = n;
        break;
      }
      case 'storeName': case 'store_name': out.storeName = value; break;
      case 'storeAddress': case 'store_address': out.storeAddress = value; break;
      case 'storeFooter': case 'store_footer': out.storeFooter = value; break;
      case 'dataSource': case 'source':
        if (value === 'mock' || value === 'tradingweb') out.dataSource = value;
        break;
      default: break;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** 把运行时配置应用到 settings store（调用方确保参数合法） */
export function applyRuntimeConfig(settings: {
  set: (p: Record<string, unknown>) => void;
  dataSource: 'mock' | 'tradingweb';
  serverUrl: string;
  storeId: string | null;
  currency: string;
  taxRateBps: number;
  store: { name: string; address: string; footer: string };
}, cfg: RuntimeConfig): void {
  const patch: Record<string, unknown> = {};
  if (cfg.dataSource) patch.dataSource = cfg.dataSource;
  if (cfg.serverUrl !== undefined) patch.serverUrl = cfg.serverUrl;
  if (cfg.storeId !== undefined) patch.storeId = cfg.storeId;
  if (cfg.currency !== undefined) patch.currency = cfg.currency;
  if (cfg.taxRateBps !== undefined) patch.taxRateBps = cfg.taxRateBps;
  if (cfg.storeName !== undefined || cfg.storeAddress !== undefined || cfg.storeFooter !== undefined) {
    patch.store = {
      name: cfg.storeName ?? settings.store.name,
      address: cfg.storeAddress ?? settings.store.address,
      footer: cfg.storeFooter ?? settings.store.footer,
    };
  }
  settings.set(patch);
}

/** 当前配置的摘要（设置页展示/分享用） */
export function describeConfig(cfg: {
  dataSource: 'mock' | 'tradingweb';
  serverUrl: string;
  storeId: string | null;
  currency: string;
  taxRateBps: number;
}): string {
  const lines = [
    `dataSource=${cfg.dataSource}`,
    cfg.serverUrl ? `serverUrl=${cfg.serverUrl}` : '# serverUrl=(未配置)',
    cfg.storeId ? `storeId=${cfg.storeId}` : '# storeId=(未选择)',
    `currency=${cfg.currency}`,
    `taxRateBps=${cfg.taxRateBps}`,
  ];
  return lines.join('\n');
}
