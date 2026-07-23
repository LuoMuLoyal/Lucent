import { RegistryService } from './registry.service';
import { MissedDoseRuleService } from './missed-dose.service';

describe('RegistryService', () => {
  it('should register and retrieve rules', () => {
    const registry = new RegistryService();
    const rule = new MissedDoseRuleService();

    registry.register(rule);

    expect(registry.getAll()).toHaveLength(1);
    expect(registry.getById('missed_dose_pending')).toBe(rule);
  });

  it('should throw on duplicate registration', () => {
    const registry = new RegistryService();
    const rule = new MissedDoseRuleService();

    registry.register(rule);
    expect(() => {
      registry.register(rule);
    }).toThrow('Duplicate');
  });
});
