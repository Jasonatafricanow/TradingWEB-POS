const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  ...expoConfig,
  {
    ignores: ['android/**', 'ios/**', '.expo/**', '.expo-audit/**'],
  },
  {
    files: [
      'app/settings/hardware.tsx',
      'src/api/adapters/tradingweb.ts',
      'src/api/index.ts',
      'src/hardware/printer/drivers/SystemPrinter.ts',
      'src/hardware/printer/encoders/gbk.ts',
      'src/hardware/printer/transports/index.ts',
      'src/hardware/scanner/BleScanner.ts',
      'src/test/setup.native.ts',
    ],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
]);
