import { inject } from "@angular/core";
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  CanActivateFn,
} from "@angular/router";
import { firstValueFrom } from "rxjs";

import { AuthService } from "@bitwarden/common/auth/abstractions/auth.service";
import { DeviceTrustServiceAbstraction } from "@bitwarden/common/auth/abstractions/device-trust.service.abstraction";
import { AuthenticationStatus } from "@bitwarden/common/auth/enums/authentication-status";
import { FeatureFlag } from "@bitwarden/common/enums/feature-flag.enum";
import { ConfigService } from "@bitwarden/common/platform/abstractions/config/config.service";
import { CryptoService } from "@bitwarden/common/platform/abstractions/crypto.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";

/**
 * Only allow access to this route if the vault is locked and has never been decrypted.
 * Otherwise redirect to root.
 *
 * TODO: This should return Observable<boolean | UrlTree> once we can get rid of all the promises
 */
export function tdeDecryptionRequiredGuard(): CanActivateFn {
  return async (_: ActivatedRouteSnapshot, state: RouterStateSnapshot) => {
    const authService = inject(AuthService);
    const cryptoService = inject(CryptoService);
    const deviceTrustService = inject(DeviceTrustServiceAbstraction);
    const configService = inject(ConfigService);
    const logService = inject(LogService);
    const router = inject(Router);

    const authStatus = await authService.getAuthStatus();
    const tdeEnabled = await firstValueFrom(deviceTrustService.supportsDeviceTrust$);
    const everHadUserKey = await firstValueFrom(cryptoService.everHadUserKey$);

    // We need to determine if we should bypass the decryption options and send the user to the vault.
    // The ONLY time that we want to send a user to the decryption options is when:
    // 1. The user's auth status is Locked, AND
    // 2. TDE is enabled, AND
    // 3. The user has never had a user key in state since last logout.
    // The inverse of this is when we should send the user to the vault.
    if (authStatus !== AuthenticationStatus.Locked || !tdeEnabled || everHadUserKey) {
      return router.createUrlTree(["/"]);
    }

    if (await configService.getFeatureFlag(FeatureFlag.DeviceTrustLogging)) {
      logService.info(
        "Sending user to TDE decryption options. AuthStatus is %s. TDE support is %s. Ever had user key is %s.",
        authStatus,
        tdeEnabled,
        everHadUserKey,
      );
    }

    return true;
  };
}
