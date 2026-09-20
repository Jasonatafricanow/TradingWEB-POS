import { useAuth } from '@/stores/auth';
import { useSettings } from '@/stores/settings';
import { HttpClient } from './client';
import type { MockDataSource as MockDataSourceType } from './adapters/mock';
import type { TradingWebDataSource as TradingWebDataSourceType } from './adapters/tradingweb';
import type { PosDataSource, PosSourceScope } from './types';
import {
  getOperatorDeviceId,
  getOperatorSessionToken,
  getUsableOperatorSessionStaffId,
} from '@/services/operatorSession';
import { normalizePosSourceScope } from '@/services/sourceIdentity';

let http: HttpClient | null = null;
let mock: MockDataSourceType | null = null;
let tradingweb: TradingWebDataSourceType | null = null;

function getHttp(): HttpClient {
  if (!http) {
    http = new HttpClient(() => ({
      baseUrl: useSettings.getState().serverUrl,
      token: useAuth.getState().token,
      operatorSessionToken: getOperatorSessionToken(),
      deviceId: getOperatorDeviceId(),
    }));
  }
  return http;
}

function getMock(): MockDataSourceType {
  if (!mock) {
    const { MockDataSource } = require('./adapters/mock') as typeof import('./adapters/mock');
    mock = new MockDataSource();
  }
  return mock;
}
export function getCurrentPosSourceScope(): PosSourceScope | null {
  const settings = useSettings.getState();
  if (settings.dataSource !== 'tradingweb') return null;
  return normalizePosSourceScope({
    serverUrl: settings.serverUrl,
    storeId: settings.storeId,
    operatorId: getUsableOperatorSessionStaffId(),
    deviceId: getOperatorDeviceId(),
  });
}

function getTradingWeb(): TradingWebDataSourceType {
  if (!tradingweb) {
    const { TradingWebDataSource } = require('./adapters/tradingweb') as typeof import('./adapters/tradingweb');
    tradingweb = new TradingWebDataSource(
      getHttp(),
      () => ({
        storeId: useSettings.getState().storeId ?? '',
        pricingVersion: useSettings.getState().pricingVersion ?? '',
      }),
      getCurrentPosSourceScope,
    );
  }
  return tradingweb;
}

/** 页面统一入口：按设置切换 演示模式 / TradingWEB */
export function getDataSource(): PosDataSource {
  return useSettings.getState().dataSource === 'tradingweb' ? getTradingWeb() : getMock();
}

export function getDataSourceByKind(kind: 'mock' | 'tradingweb'): PosDataSource {
  return kind === 'tradingweb' ? getTradingWeb() : getMock();
}

export * from './types';
export {
  ApiError,
  ApiValidationError,
  errorMessage,
  isMissingEndpoint,
  isRetryableApiError,
  localizedErrorMessage,
} from './client';
