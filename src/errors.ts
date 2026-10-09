export type FormCoreErrorCode
  = | 'ASYNC_TRANSACTION'
    | 'ASYNC_VALIDATION_UNSUPPORTED'
    | 'DUPLICATE_FIELD'
    | 'FIELD_NOT_FOUND'
    | 'FORM_DISPOSED'
    | 'INVALID_FIELD_NAME'
    | 'INVALID_VALUE'
    | 'NESTED_TRANSACTION'
    | 'PATH_CONFLICT'
    | 'SCHEMA_SYSTEM_MISMATCH'
    | 'TRANSACTION_ACTIVE'

export class FormCoreError extends Error {
  readonly code: FormCoreErrorCode

  constructor(code: FormCoreErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'FormCoreError'
    this.code = code
  }
}
