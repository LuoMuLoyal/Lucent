import { RuleVersionRegistry } from './rule-version-registry.service';
import { MissedDoseRuleService } from './medication/missed-dose.service';

describe('RuleVersionRegistry', () => {
  let registry: RuleVersionRegistry;

  beforeEach(() => {
    registry = new RuleVersionRegistry();
  });

  it('should return the single registered version', () => {
    const rule = new MissedDoseRuleService();
    registry.registerVersion(rule);

    const selected = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(selected).toBe(rule);
  });

  it('should return null for unregistered rule', () => {
    expect(registry.selectVersion('nonexistent', 'user-1')).toBeNull();
  });

  it('should always select the same version for the same user+rule', () => {
    const rule1 = new MissedDoseRuleService();
    // Create a second version with same ruleId but different version
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);
    registry.setDistribution('missed_dose_pending', 0.5);

    const first = registry.selectVersion('missed_dose_pending', 'user-1');
    const second = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(first).toBe(second);
  });

  it('should return old version when distribution is 0', () => {
    const rule1 = new MissedDoseRuleService();
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);
    registry.setDistribution('missed_dose_pending', 0);

    const selected = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(selected).toBe(rule1);
  });

  it('should return new version when distribution is 1', () => {
    const rule1 = new MissedDoseRuleService();
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);
    registry.setDistribution('missed_dose_pending', 1);

    const selected = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(selected).toBe(rule2);
  });

  it('should respect forced version over distribution', () => {
    const rule1 = new MissedDoseRuleService();
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);
    registry.setDistribution('missed_dose_pending', 0);
    registry.forceVersion('missed_dose_pending', '2.0.0');

    const selected = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(selected).toBe(rule2);
  });

  it('should clear forced version when null is passed', () => {
    const rule1 = new MissedDoseRuleService();
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);
    registry.forceVersion('missed_dose_pending', '2.0.0');
    registry.forceVersion('missed_dose_pending', null);
    registry.setDistribution('missed_dose_pending', 0);

    const selected = registry.selectVersion('missed_dose_pending', 'user-1');
    expect(selected).toBe(rule1);
  });

  it('should report multi-version rule IDs', () => {
    const rule1 = new MissedDoseRuleService();
    const rule2 = Object.assign(
      Object.create(MissedDoseRuleService.prototype),
      rule1,
      { ruleVersion: '2.0.0' },
    );
    registry.registerVersion(rule1);
    registry.registerVersion(rule2);

    expect(registry.getMultiVersionRuleIds()).toEqual(['missed_dose_pending']);
  });
});
