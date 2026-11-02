import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as common from '@zxcvbn-ts/language-common';
import * as en from '@zxcvbn-ts/language-en';

/**
 * Password strength scoring, backed by zxcvbn.
 *
 * Why zxcvbn rather than a character-class regex: a complexity regex
 * (`must contain upper + lower + digit`) accepts `Password1` and rejects
 * `correct horse battery staple`. The rule produces exactly the passwords it
 * was meant to prevent, because it only measures the *shape* of a password,
 * never whether it is guessable. zxcvbn estimates guess counts against
 * dictionaries, keyboard walks, dates, repeats and l33t substitutions, which
 * is what "strength" actually means.
 *
 * Nothing here is asynchronous — the dictionaries are bundled, so scoring
 * costs a few milliseconds and touches no network.
 */

/**
 * Minimum accepted zxcvbn score. The scale is 0–4, roughly:
 *
 * - 0 — trivially guessable (`password`, `qwertyui`, `abcdefgh`)
 * - 1 — very guessable (`abc123xyz` class)
 * - 2 — somewhat guessable (`ValidPass123`); rejected here
 * - 3 — safely unguessable, the usual recommendation for signup
 * - 4 — strongly unguessable
 *
 * 3 is the floor used by the frameworks this project is modelled on. It
 * rejects dictionary-plus-suffix patterns while accepting passphrases and
 * random strings, so a user is never forced to invent a symbol soup.
 */
export const PASSWORD_MIN_SCORE = 3;

const zxcvbn = new ZxcvbnFactory({
  dictionary: { ...common.dictionary, ...en.dictionary },
  graphs: common.adjacencyGraphs,
  translations: en.translations,
});

export interface PasswordStrengthAssessment {
  /** zxcvbn score, 0–4. */
  score: number;
  /** True when `score` meets `PASSWORD_MIN_SCORE`. */
  accepted: boolean;
  /** zxcvbn's own English explanation, when it has one. */
  warning: string | null;
  /** Concrete suggestions from zxcvbn (e.g. "Avoid dates and years"). */
  suggestions: string[];
}

/**
 * Scores a password with zxcvbn.
 *
 * `userInputs` (the account's email, name, nickname) are folded into the
 * scoring so that a password containing the user's own email or nickname is
 * penalised — an attacker targeting one account tries those first.
 *
 * @param password candidate password
 * @param userInputs context values that should not appear in the password
 */
export function assessPasswordStrength(
  password: string,
  userInputs: readonly string[] = [],
): PasswordStrengthAssessment {
  const result = zxcvbn.check(
    password,
    userInputs.filter((input) => input.trim().length > 0),
  );

  return {
    score: result.score,
    accepted: result.score >= PASSWORD_MIN_SCORE,
    warning: result.feedback.warning ?? null,
    suggestions: result.feedback.suggestions,
  };
}
