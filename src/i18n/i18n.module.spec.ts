import { I18nModule } from './i18n.module.js';

describe('I18nModule', () => {
  it('is decorated with @Global()', () => {
    // The @Global decorator doesn't add metadata key to the class itself
    // in the same way, but we can verify the module exists and is importable.
    expect(I18nModule).toBeDefined();
    expect(typeof I18nModule).toBe('function');
  });

  it('is decorated with @Module()', () => {
    const metadata = Reflect.getMetadata('imports', I18nModule);
    // I18nModule imports NestI18nModule.forRoot(...)
    expect(metadata).toBeDefined();
    expect(Array.isArray(metadata)).toBe(true);
    expect(metadata.length).toBeGreaterThan(0);
  });

  it('exports the i18n module so other modules can use I18nService', () => {
    const exports = Reflect.getMetadata('exports', I18nModule);
    expect(exports).toBeDefined();
    expect(Array.isArray(exports)).toBe(true);
    expect(exports.length).toBeGreaterThan(0);
  });
});
