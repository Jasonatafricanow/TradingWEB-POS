// 同步队列完整性密钥：HMAC 密钥存 expo-secure-store（iOS Keychain / Android Keystore），
// 不落 AsyncStorage，避免 rooted 设备上被读取后重算指纹。
import * as SecureStore from 'expo-secure-store';

const SYNC_HMAC_KEY = 'twpos.sync-hmac.v1';

/** 读取或生成 32 字节随机 HMAC 密钥（hex）；SecureStore 不可用时返回 null（退化为无密钥校验）。 */
export async function getSyncHmacKey(): Promise<string | null> {
  try {
    const existing = await SecureStore.getItemAsync(SYNC_HMAC_KEY);
    if (existing) return existing;
    const cryptoApi = (globalThis as { crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array } }).crypto;
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') return null;
    const bytes = new Uint8Array(32);
    cryptoApi.getRandomValues(bytes);
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    await SecureStore.setItemAsync(SYNC_HMAC_KEY, hex);
    return hex;
  } catch {
    return null;
  }
}
