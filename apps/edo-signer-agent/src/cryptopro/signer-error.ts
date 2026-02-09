export type SignerErrorCode =
  | 'NO_CERTIFICATE_SELECTED'
  | 'NO_CERT_FOUND_FOR_INN'
  | 'CERT_NOT_SELECTED'
  | 'CRYPTOPRO_NOT_FOUND'
  | 'SIGNING_TOOL_NOT_FOUND'
  | 'CADESCOM_NOT_AVAILABLE'
  | 'CRYPTOAPI_FAILED'
  | 'CERT_NOT_FOUND'
  | 'CERT_NO_PRIVATE_KEY'
  | 'SIGNING_FAILED'
  | 'TEMPLATE_INVALID'
  | 'SIGN_FAILED'
  | 'TIMEOUT'
  | 'IO_ERROR'
  | 'UNSUPPORTED_FORMAT'
  | 'CERT_LIST_FAILED'
  | 'USER_CANCELLED';

export type SignerErrorDetails = {
  availableCertsCount?: number;
  checkedStores?: string[];
  thumbprint?: string;
  hresult?: string;
  raw?: string;
  // Allow callers to attach additional structured context without widening all call sites.
  [k: string]: unknown;
};

export class SignerError extends Error {
  public readonly code: SignerErrorCode;
  public readonly details?: SignerErrorDetails;

  constructor(code: SignerErrorCode, message: string, details?: SignerErrorDetails) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

