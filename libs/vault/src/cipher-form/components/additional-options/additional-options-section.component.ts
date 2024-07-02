import { Component, OnInit } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { FormBuilder, ReactiveFormsModule } from "@angular/forms";

import { JslibModule } from "@bitwarden/angular/jslib.module";
import { CipherRepromptType } from "@bitwarden/common/vault/enums";
import {
  CardComponent,
  CheckboxModule,
  FormFieldModule,
  SectionComponent,
  SectionHeaderComponent,
  TypographyModule,
} from "@bitwarden/components";

import { CipherFormContainer } from "../../cipher-form-container";

@Component({
  selector: "vault-additional-options-section",
  templateUrl: "./additional-options-section.component.html",
  standalone: true,
  imports: [
    SectionComponent,
    SectionHeaderComponent,
    TypographyModule,
    JslibModule,
    CardComponent,
    FormFieldModule,
    ReactiveFormsModule,
    CheckboxModule,
  ],
})
export class AdditionalOptionsSectionComponent implements OnInit {
  additionalOptionsForm = this.formBuilder.group({
    notes: [null as string],
    reprompt: [false],
  });

  constructor(
    private cipherFormContainer: CipherFormContainer,
    private formBuilder: FormBuilder,
  ) {
    this.cipherFormContainer.registerChildForm("additionalOptions", this.additionalOptionsForm);

    this.additionalOptionsForm.valueChanges.pipe(takeUntilDestroyed()).subscribe((value) => {
      this.cipherFormContainer.patchCipher({
        notes: value.notes,
        reprompt: value.reprompt ? CipherRepromptType.Password : CipherRepromptType.None,
      });
    });
  }

  ngOnInit() {
    if (this.cipherFormContainer.originalCipherView) {
      this.additionalOptionsForm.patchValue({
        notes: this.cipherFormContainer.originalCipherView.notes,
        reprompt:
          this.cipherFormContainer.originalCipherView.reprompt === CipherRepromptType.Password,
      });
    }

    if (this.cipherFormContainer.config.mode === "partial-edit") {
      this.additionalOptionsForm.disable();
    }
  }
}
