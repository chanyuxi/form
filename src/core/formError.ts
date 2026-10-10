export const formErrorCode = Object.freeze({
  asyncTransaction: 'ASYNC_TRANSACTION',
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

export type FormCoreErrorCode = typeof formErrorCode[keyof typeof formErrorCode]

export class FormCoreError extends Error {
  readonly code: FormCoreErrorCode

  constructor(code: FormCoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FormCoreError'
    this.code = code
  }
}
