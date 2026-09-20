module.exports = {
  preset: 'jest-expo',
  roots: ['<rootDir>/src'],
  testMatch: ['**/src/**/*.native.test.ts?(x)'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.native.ts'],
};
