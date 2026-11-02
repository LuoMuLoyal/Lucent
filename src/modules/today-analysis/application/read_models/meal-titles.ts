/**
 * Placeholder titles the ACL gives to meal records it could not analyse.
 *
 * Owned by the application layer because both sides need them: the ACL writes
 * them onto the context, and the prompt builder renders them for the model.
 * Leaving them in `adapters/acl/` made `infrastructure/` import an adapter
 * (`ddd-infrastructure-no-adapters`) for two string constants.
 */
export const MEAL_ANALYSIS_TITLE = '饮食分析';

export const MEAL_ANALYSIS_MISSING_TITLE = '饮食分析缺失';
