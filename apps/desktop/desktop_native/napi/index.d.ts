/* tslint:disable */
/* eslint-disable */

/* auto-generated by NAPI-RS */

export declare namespace passwords {
  /** Fetch the stored password from the keychain. */
  export function getPassword(service: string, account: string): Promise<string>
  /** Fetch the stored password from the keychain that was stored with Keytar. */
  export function getPasswordKeytar(service: string, account: string): Promise<string>
  /** Save the password to the keychain. Adds an entry if none exists otherwise updates the existing entry. */
  export function setPassword(service: string, account: string, password: string): Promise<void>
  /** Delete the stored password from the keychain. */
  export function deletePassword(service: string, account: string): Promise<void>
  export function isAvailable(): Promise<boolean>
}
export declare namespace biometrics {
  export function prompt(hwnd: Buffer, message: string): Promise<boolean>
  export function available(): Promise<boolean>
  export function setBiometricSecret(service: string, account: string, secret: string, keyMaterial: KeyMaterial | undefined | null, ivB64: string): Promise<string>
  export function getBiometricSecret(service: string, account: string, keyMaterial?: KeyMaterial | undefined | null): Promise<string>
  /**
   * Derives key material from biometric data. Returns a string encoded with a
   * base64 encoded key and the base64 encoded challenge used to create it
   * separated by a `|` character.
   *
   * If the iv is provided, it will be used as the challenge. Otherwise a random challenge will be generated.
   *
   * `format!("<key_base64>|<iv_base64>")`
   */
  export function deriveKeyMaterial(iv?: string | undefined | null): Promise<OsDerivedKey>
  export interface KeyMaterial {
    osKeyPartB64: string
    clientKeyPartB64?: string
  }
  export interface OsDerivedKey {
    keyB64: string
    ivB64: string
  }
}
export declare namespace clipboards {
  export function read(): Promise<string>
  export function write(text: string, password: boolean): Promise<void>
}
export declare namespace sshagent {
  export interface PrivateKey {
    privateKey: string
    name: string
    cipherId: string
  }
  export interface SshKey {
    privateKey: string
    publicKey: string
    keyFingerprint: string
  }
  export const enum SshKeyImportStatus {
    /** ssh key was parsed correctly and will be returned in the result */
    Success = 0,
    /** ssh key was parsed correctly but is encrypted and requires a password */
    PasswordRequired = 1,
    /** ssh key was parsed correctly, and a password was provided when calling the import, but it was incorrect */
    WrongPassword = 2,
    /** ssh key could not be parsed, either due to an incorrect / unsupported format (pkcs#8) or key type (ecdsa), or because the input is not an ssh key */
    ParsingError = 3,
    /** ssh key type is not supported (e.g. ecdsa) */
    UnsupportedKeyType = 4
  }
  export interface SshKeyImportResult {
    status: SshKeyImportStatus
    sshKey?: SshKey
  }
  export function serve(callback: (err: Error | null, arg0: string, arg1: boolean) => any): Promise<SshAgentState>
  export function stop(agentState: SshAgentState): void
  export function isRunning(agentState: SshAgentState): boolean
  export function setKeys(agentState: SshAgentState, newKeys: Array<PrivateKey>): void
  export function lock(agentState: SshAgentState): void
  export function importKey(encodedKey: string, password: string): SshKeyImportResult
  export function clearKeys(agentState: SshAgentState): void
  export function generateKeypair(keyAlgorithm: string): Promise<SshKey>
  export class SshAgentState {   }
}
export declare namespace processisolations {
  export function disableCoredumps(): Promise<void>
  export function isCoreDumpingDisabled(): Promise<boolean>
  export function disableMemoryAccess(): Promise<void>
}
export declare namespace powermonitors {
  export function onLock(callback: (err: Error | null, ) => any): Promise<void>
  export function isLockMonitorAvailable(): Promise<boolean>
}
export declare namespace windows_registry {
  export function createKey(key: string, subkey: string, value: string): Promise<void>
  export function deleteKey(key: string, subkey: string): Promise<void>
}
export declare namespace ipc {
  export interface IpcMessage {
    clientId: number
    kind: IpcMessageType
    message?: string
  }
  export const enum IpcMessageType {
    Connected = 0,
    Disconnected = 1,
    Message = 2
  }
  export class IpcServer {
    /**
     * Create and start the IPC server without blocking.
     *
     * @param name The endpoint name to listen on. This name uniquely identifies the IPC connection and must be the same for both the server and client.
     * @param callback This function will be called whenever a message is received from a client.
     */
    static listen(name: string, callback: (error: null | Error, message: IpcMessage) => void): Promise<IpcServer>
    /** Return the path to the IPC server. */
    getPath(): string
    /** Stop the IPC server. */
    stop(): void
    /**
     * Send a message over the IPC server to all the connected clients
     *
     * @return The number of clients that the message was sent to. Note that the number of messages
     * actually received may be less, as some clients could disconnect before receiving the message.
     */
    send(message: string): number
  }
}
export declare namespace epheremal_values {
  export class EpheremalValueStoreWrapper {
    constructor()
    set(key: string, value: string): void
    get(key: string): string | null
    remove(key: string): void
  }
}
