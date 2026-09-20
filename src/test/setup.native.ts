import AsyncStorage from '@react-native-async-storage/async-storage';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

globalThis.fetch = jest.fn();

afterEach(async () => {
  await AsyncStorage.clear();
  jest.mocked(globalThis.fetch).mockReset();
  jest.clearAllMocks();
});
