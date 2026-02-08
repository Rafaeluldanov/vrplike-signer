export type SignerErrorCode =
  | 'NO_CERTIFICATE_SELECTED'
  | 'NO_CERT_FOUND_FOR_INN'
  | 'CRYPTOPRO_NOT_FOUND'
  | 'TEMPLATE_INVALID'
  | 'SIGN_FAILED'
  | 'TIMEOUT'
  | 'IO_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'CERT_LIST_FAILED'
  | 'USER_CANCELLED';

export class SignerError extends Error {
  public readonly code: SignerErrorCode;
  public readonly details?: unknown;

  constructor(code: SignerErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

