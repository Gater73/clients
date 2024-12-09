export enum LegacyKeyMigrationAction {
  PREVENT_LOGIN_AND_SHOW_REQUIRE_MIGRATION_WARNING,
  NAVIGATE_TO_MIGRATION_COMPONENT,
}

/**
 * Manages all cross client functionality so we can have a single two factor auth component
 * implementation for all clients.
 */
export abstract class TwoFactorAuthComponentService {
  /**
   * We used to use the user's master key to encrypt their data. We deprecated that approach
   * and now use a user key. This method should be called if we detect that the user
   * is still using the old master key encryption scheme (server sends down a flag to
   * indicate this). This method then determines what action to take based on the client.
   *
   * We have two possible actions:
   * 1. Prevent the user from logging in and show a warning that they need to migrate their key on the web client today.
   * 2. Navigate the user to the key migration component on the web client.
   */
  abstract determineLegacyKeyMigrationAction(): LegacyKeyMigrationAction;
}