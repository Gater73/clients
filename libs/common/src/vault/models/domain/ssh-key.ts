// FIXME: Update this file to be type safe and remove this and next line
// @ts-strict-ignore
import { Jsonify } from "type-fest";

import { EncString } from "../../../../../key-management/src/cryptography/domain/enc-string";
import { SymmetricCryptoKey } from "../../../../../key-management/src/cryptography/domain/symmetric-crypto-key";
import Domain from "../../../platform/models/domain/domain-base";
import { SshKeyData } from "../data/ssh-key.data";
import { SshKeyView } from "../view/ssh-key.view";

export class SshKey extends Domain {
  privateKey: EncString;
  publicKey: EncString;
  keyFingerprint: EncString;

  constructor(obj?: SshKeyData) {
    super();
    if (obj == null) {
      return;
    }

    this.buildDomainModel(
      this,
      obj,
      {
        privateKey: null,
        publicKey: null,
        keyFingerprint: null,
      },
      [],
    );
  }

  decrypt(orgId: string, encKey?: SymmetricCryptoKey): Promise<SshKeyView> {
    return this.decryptObj(
      new SshKeyView(),
      {
        privateKey: null,
        publicKey: null,
        keyFingerprint: null,
      },
      orgId,
      encKey,
    );
  }

  toSshKeyData(): SshKeyData {
    const c = new SshKeyData();
    this.buildDataModel(this, c, {
      privateKey: null,
      publicKey: null,
      keyFingerprint: null,
    });
    return c;
  }

  static fromJSON(obj: Partial<Jsonify<SshKey>>): SshKey {
    if (obj == null) {
      return null;
    }

    const privateKey = EncString.fromJSON(obj.privateKey);
    const publicKey = EncString.fromJSON(obj.publicKey);
    const keyFingerprint = EncString.fromJSON(obj.keyFingerprint);
    return Object.assign(new SshKey(), obj, {
      privateKey,
      publicKey,
      keyFingerprint,
    });
  }
}
