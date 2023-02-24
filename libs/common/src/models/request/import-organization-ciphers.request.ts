import { CipherRequest } from "../../vault/models/request/cipher.request";

import { CollectionWithIdRequest } from "./collection-with-id.request";
import { KvpRequest } from "./kvp.request";

export class ImportOrganizationCiphersRequest {
  ciphers: CipherRequest[] = [];
  collections: CollectionWithIdRequest[] = [];
  collectionRelationships: KvpRequest<number, number>[] = [];
}
