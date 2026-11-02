import { describe, expect, it } from 'vitest';

import {
  PASSWORD_MIN_SCORE,
  assessPasswordStrength,
} from './password-strength.js';

describe('assessPasswordStrength', () => {
  it('rejects passwords that the old character-class regex accepted', () => {
    // These satisfied "upper + lower + digit" and were the reason the rule was
    // replaced: the regex measured shape, not guessability.
    for (const password of ['Password1', 'Abcd1234', 'Qwerty123']) {
      const result = assessPasswordStrength(password);
      expect(result.accepted, password).toBe(false);
      expect(result.score, password).toBeLessThan(PASSWORD_MIN_SCORE);
    }
  });

  it('rejects bare dictionary words and keyboard walks', () => {
    for (const password of ['password', 'abcdefgh', 'qwertyui']) {
      expect(assessPasswordStrength(password).accepted, password).toBe(false);
    }
  });

  it('accepts a long passphrase', () => {
    const result = assessPasswordStrength('correct horse battery staple');
    expect(result.accepted).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(PASSWORD_MIN_SCORE);
  });

  it('accepts a random-looking password', () => {
    expect(assessPasswordStrength('x9$Kp2!mQz7#Lw').accepted).toBe(true);
  });

  it('penalises a password containing the account email local part', () => {
    // Without user context this passes; folding the email in should sink it.
    const password = 'ZhangWei1990';
    const withContext = assessPasswordStrength(password, [
      'zhangwei',
      'ZhangWei1990',
    ]);
    const withoutContext = assessPasswordStrength(password);

    expect(withContext.score).toBeLessThanOrEqual(withoutContext.score);
    expect(withContext.accepted).toBe(false);
  });

  it('ignores blank user inputs', () => {
    const result = assessPasswordStrength('correct horse battery staple', [
      '',
      '   ',
    ]);
    expect(result.accepted).toBe(true);
  });

  it('reports feedback for rejected passwords', () => {
    const result = assessPasswordStrength('password');
    expect(result.accepted).toBe(false);
    expect(result.warning ?? result.suggestions.length).toBeTruthy();
  });

  it('exposes the configured score floor', () => {
    expect(PASSWORD_MIN_SCORE).toBe(3);
  });
});
