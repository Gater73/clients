import { DialogConfig, DialogRef } from "@angular/cdk/dialog";
import { Component, OnInit } from "@angular/core";
import { FormBuilder, Validators } from "@angular/forms";
import { firstValueFrom, map, Observable } from "rxjs";

import { VerificationType } from "@bitwarden/common/auth/enums/verification-type";
import { ErrorResponse } from "@bitwarden/common/models/response/error.response";
import { I18nService } from "@bitwarden/common/platform/abstractions/i18n.service";
import { LogService } from "@bitwarden/common/platform/abstractions/log.service";
import { PlatformUtilsService } from "@bitwarden/common/platform/abstractions/platform-utils.service";
import { DialogService } from "@bitwarden/components";

import { WebauthnAdminService } from "../../../core";
import { CredentialCreateOptionsView } from "../../../core/views/credential-create-options.view";
import { PendingWebauthnCredentialView } from "../../../core/views/pending-webauthn-credential.view";
import { PendingWebauthnCryptoKeysView } from "../../../core/views/pending-webauthn-crypto-keys.view";
import { CreatePasskeyFailedIcon } from "../../../shared/icons/create-passkey-failed.icon";
import { CreatePasskeyIcon } from "../../../shared/icons/create-passkey.icon";

export enum CreateCredentialDialogResult {
  Success,
}

type Step =
  | "userVerification"
  | "credentialCreation"
  | "credentialCreationFailed"
  | "prfSetup"
  | "credentialNaming";

@Component({
  templateUrl: "create-credential-dialog.component.html",
})
export class CreateCredentialDialogComponent implements OnInit {
  protected readonly NameMaxCharacters = 50;
  protected readonly CreateCredentialDialogResult = CreateCredentialDialogResult;
  protected readonly Icons = { CreatePasskeyIcon, CreatePasskeyFailedIcon };

  protected currentStep: Step = "userVerification";
  protected formGroup = this.formBuilder.group({
    userVerification: this.formBuilder.group({
      masterPassword: ["", [Validators.required]],
    }),
    credentialNaming: this.formBuilder.group({
      name: ["", Validators.maxLength(50)],
    }),
  });
  protected credentialOptions?: CredentialCreateOptionsView;
  protected pendingCredential?: PendingWebauthnCredentialView;
  protected pendingCryptoKeys?: PendingWebauthnCryptoKeysView;
  protected hasPasskeys$?: Observable<boolean>;

  constructor(
    private formBuilder: FormBuilder,
    private dialogRef: DialogRef,
    private webauthnService: WebauthnAdminService,
    private platformUtilsService: PlatformUtilsService,
    private i18nService: I18nService,
    private logService: LogService
  ) {}

  ngOnInit(): void {
    this.hasPasskeys$ = this.webauthnService.credentials$.pipe(
      map((credentials) => credentials.length > 0)
    );
  }

  protected submit = async () => {
    this.dialogRef.disableClose = true;

    try {
      switch (this.currentStep) {
        case "userVerification":
          return await this.submitUserVerification();
        case "credentialCreationFailed":
          return await this.submitCredentialCreationFailed();
        case "credentialCreation":
          return await this.submitCredentialCreation();
        case "prfSetup":
          return await this.submitPrfSetup();
        case "credentialNaming":
          return await this.submitCredentialNaming();
      }
    } finally {
      this.dialogRef.disableClose = false;
    }
  };

  protected async submitUserVerification() {
    this.formGroup.controls.userVerification.markAllAsTouched();
    if (this.formGroup.controls.userVerification.invalid) {
      return;
    }

    try {
      this.credentialOptions = await this.webauthnService.getCredentialCreateOptions({
        type: VerificationType.MasterPassword,
        secret: this.formGroup.value.userVerification.masterPassword,
      });
    } catch (error) {
      if (error instanceof ErrorResponse && error.statusCode === 400) {
        this.platformUtilsService.showToast(
          "error",
          this.i18nService.t("error"),
          this.i18nService.t("invalidMasterPassword")
        );
      } else {
        this.logService?.error(error);
        this.platformUtilsService.showToast("error", null, this.i18nService.t("unexpectedError"));
      }
      return;
    }

    this.currentStep = "credentialCreation";
    await this.submitCredentialCreation();
  }

  protected async submitCredentialCreation() {
    this.pendingCredential = await this.webauthnService.createCredential(this.credentialOptions);
    if (this.pendingCredential === undefined) {
      this.currentStep = "credentialCreationFailed";
      return;
    }

    if (this.pendingCredential.supportsPrf) {
      this.currentStep = "prfSetup";
      await this.submitPrfSetup();
      return;
    }

    this.currentStep = "credentialNaming";
  }

  protected async submitCredentialCreationFailed() {
    this.currentStep = "credentialCreation";
    await this.submitCredentialCreation();
  }

  protected async submitPrfSetup() {
    this.pendingCryptoKeys = await this.webauthnService.createCryptoKeys(this.pendingCredential);
    this.currentStep = "credentialNaming";
  }

  protected async submitCredentialNaming() {
    this.formGroup.controls.credentialNaming.markAllAsTouched();
    if (this.formGroup.controls.credentialNaming.invalid) {
      return;
    }

    const name = this.formGroup.value.credentialNaming.name;
    try {
      await this.webauthnService.saveCredential(
        this.formGroup.value.credentialNaming.name,
        this.pendingCredential,
        this.pendingCryptoKeys
      );
    } catch (error) {
      this.logService?.error(error);
      this.platformUtilsService.showToast("error", null, this.i18nService.t("unexpectedError"));
      return;
    }

    if (firstValueFrom(this.hasPasskeys$)) {
      this.platformUtilsService.showToast(
        "success",
        null,
        this.i18nService.t("passkeySaved", name)
      );
    } else {
      this.platformUtilsService.showToast(
        "success",
        null,
        this.i18nService.t("loginWithPasskeyEnabled")
      );
    }

    this.dialogRef.close(CreateCredentialDialogResult.Success);
  }
}

/**
 * Strongly typed helper to open a CreateCredentialDialog
 * @param dialogService Instance of the dialog service that will be used to open the dialog
 * @param config Configuration for the dialog
 */
export const openCreateCredentialDialog = (
  dialogService: DialogService,
  config: DialogConfig<unknown>
) => {
  return dialogService.open<CreateCredentialDialogResult | undefined, unknown>(
    CreateCredentialDialogComponent,
    config
  );
};
