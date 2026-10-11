/** Stable error codes thrown by the form Core. */
export const formErrorCode = Object.freeze({
  asyncTransaction: 'ASYNC_TRANSACTION',
  asyncTransformUnsupported: 'ASYNC_TRANSFORM_UNSUPPORTED',
  asyncValidationUnsupported: 'ASYNC_VALIDATION_UNSUPPORTED',
  duplicateField: 'DUPLICATE_FIELD',
  fieldNotFound: 'FIELD_NOT_FOUND',
  formDisposed: 'FORM_DISPOSED',
  invalidFieldName: 'INVALID_FIELD_NAME',
  invalidValue: 'INVALID_VALUE',
  nestedTransaction: 'NESTED_TRANSACTION',
  pathConflict: 'PATH_CONFLICT',
  schemaSystemMismatch: 'SCHEMA_SYSTEM_MISMATCH',
  transactionActive: 'TRANSACTION_ACTIVE',
} as const)

/** A stable error code exposed by {@link FormCoreError}. */
export type FormCoreErrorCode = typeof formErrorCode[keyof typeof formErrorCode]

/** An expected Core contract or input error with a stable machine-readable code. */
export class FormCoreError extends Error {
  /** The stable code identifying the violated Core contract. */
  readonly code: FormCoreErrorCode

  /** Creates a Core error with a stable code and optional native error cause. */
  constructor(code: FormCoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FormCoreError'
    this.code = code
  }
}
