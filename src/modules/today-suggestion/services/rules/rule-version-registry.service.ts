import { Injectable, Logger } from '@nestjs/common';
import type { SuggestionRule } from '../../types/rule.types';

/**
 * Manages A/B rule version selection.
 *
 * Multiple versions of the same rule (same `ruleId`, different `ruleVersion`)
 * can be registered. The selector deterministically picks one version per user
 * using a hash of (userId + ruleId), so the same user always sees the same
 * version until the distribution is changed.
 *
 * Usage:
 * 1. Register all versions of a rule via `registerVersion()`.
 * 2. Call `selectVersion(ruleId, userId)` to get the active version for that user.
 * 3. The registry also supports a global "default version" override for rollout.
 */
@Injectable()
export class RuleVersionRegistry {
  private readonly logger = new Logger(RuleVersionRegistry.name);

  /** ruleId → map of version → rule instance */
  private readonly versions = new Map<string, Map<string, SuggestionRule>>();

  /** ruleId → version string that overrides hash-based selection (for forced rollout). */
  private readonly forcedVersions = new Map<string, string>();

  /** ruleId → distribution ratio for v2 (0–1). e.g., 0.1 means 10% get v2. */
  private readonly distribution = new Map<string, number>();

  /**
   * Registers a version of a rule. If a version with the same
   * ruleId+version already exists, it will be replaced.
   */
  registerVersion(rule: SuggestionRule): void {
    let versionMap = this.versions.get(rule.ruleId);
    if (versionMap == null) {
      versionMap = new Map();
      this.versions.set(rule.ruleId, versionMap);
    }
    versionMap.set(rule.ruleVersion, rule);
    this.logger.debug(
      `Registered rule version ${rule.ruleId}@${rule.ruleVersion}`,
    );
  }

  /**
   * Sets the distribution ratio for a rule's "new" version.
   * ratio=0 means all users get the first registered version (old).
   * ratio=1 means all users get the last registered version (new).
   * ratio=0.1 means 10% get the new version.
   */
  setDistribution(ruleId: string, ratio: number): void {
    const clamped = Math.max(0, Math.min(1, ratio));
    this.distribution.set(ruleId, clamped);
    this.logger.debug(
      `Set distribution for ${ruleId}: ${String(clamped * 100)}% new version`,
    );
  }

  /**
   * Forces a specific version for all users (overrides distribution).
   * Pass null to clear the forced version.
   */
  forceVersion(ruleId: string, version: string | null): void {
    if (version == null) {
      this.forcedVersions.delete(ruleId);
      this.logger.debug(`Cleared forced version for ${ruleId}`);
    } else {
      this.forcedVersions.set(ruleId, version);
      this.logger.debug(`Forced version ${version} for ${ruleId}`);
    }
  }

  /**
   * Selects the active rule version for a given user.
   *
   * Selection logic:
   * 1. If a forced version exists, use it.
   * 2. Otherwise, use deterministic hash-based selection based on
   *    the distribution ratio.
   */
  selectVersion(ruleId: string, userId: string): SuggestionRule | null {
    const versionMap = this.versions.get(ruleId);
    if (versionMap == null || versionMap.size === 0) {
      return null;
    }

    // Single version — no selection needed
    if (versionMap.size === 1) {
      return versionMap.values().next().value ?? null;
    }

    // Check forced version first
    const forced = this.forcedVersions.get(ruleId);
    if (forced != null) {
      const rule = versionMap.get(forced);
      if (rule != null) return rule;
      this.logger.warn(
        `Forced version ${forced} not found for rule ${ruleId}, falling back to distribution`,
      );
    }

    // Hash-based deterministic selection
    const versions = Array.from(versionMap.values());
    const ratio = this.distribution.get(ruleId) ?? 0;

    // If ratio is 0, always use the first version (old)
    // If ratio is 1, always use the last version (new)
    if (ratio === 0) {
      return versions[0] ?? null;
    }
    if (ratio === 1) {
      return versions[versions.length - 1] ?? null;
    }

    // Deterministic hash: user is in the "new" bucket if hash < ratio
    const hash = this.hashUserId(userId + ':' + ruleId);
    if (hash < ratio) {
      return versions[versions.length - 1] ?? null;
    }
    return versions[0] ?? null;
  }

  /**
   * Returns all registered rule IDs that have multiple versions.
   */
  getMultiVersionRuleIds(): string[] {
    const result: string[] = [];
    for (const [ruleId, versionMap] of this.versions.entries()) {
      if (versionMap.size > 1) {
        result.push(ruleId);
      }
    }
    return result;
  }

  /**
   * Returns all unique rules across all versions (one per ruleId, using
   * the first registered version as representative).
   */
  getAllRuleIds(): string[] {
    return Array.from(this.versions.keys());
  }

  /**
   * Deterministic hash from a string to a float in [0, 1).
   * Uses FNV-1a for simplicity and speed.
   */
  private hashUserId(input: string): number {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    // Convert to unsigned and normalize to [0, 1)
    return (hash >>> 0) / 0x100000000;
  }
}
