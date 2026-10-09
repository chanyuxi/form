export type AnyCoreFieldDefinition<TValues, TContext extends object> = {
  [TPath in FieldPath<TValues>]: CoreFieldDefinition<TValues, TPath, TContext>
}[FieldPath<TValues>]

export interface CoreFieldDefinition<
  TValues,
  TPath extends FieldPath<TValues>,
  TContext extends object,
> {
  readonly defaultValue: FieldValue<TValues, TPath>
  readonly name: TPath
  readonly validate?: (
    context: ValidationContext<TValues, TPath, TContext>,
  ) => readonly ValidationIssueInput[]
  readonly validateWhen?: (context: ValidationWhenContext<TValues, TContext>) => boolean
}

export type DeepPartial<TValue> = TValue extends ScalarValue
  ? TValue
  : TValue extends readonly unknown[]
    ? TValue
    : TValue extends object
      ? { [TKey in keyof TValue]?: DeepPartial<TValue[TKey]> }
      : TValue

export type DeepReadonly<TValue> = TValue extends ((...args: never[]) => unknown) | ScalarValue
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: DeepReadonly<TValue[TKey]> }
      : TValue

export type FieldPath<TValues> = TValues extends ScalarValue | UnsupportedLeaf
  ? never
  : TValues extends object
    ? {
        [TKey in Extract<keyof TValues, string>]: NonNullable<TValues[TKey]> extends ScalarValue
          ? TKey
          : NonNullable<TValues[TKey]> extends UnsupportedLeaf
            ? never
            : NonNullable<TValues[TKey]> extends object
              ? JoinPath<TKey, FieldPath<NonNullable<TValues[TKey]>>>
              : never
      }[Extract<keyof TValues, string>]
    : never

export type FieldValue<TValues, TPath extends string> = TPath extends keyof TValues
  ? TValues[TPath]
  : TPath extends `${infer THead}.${infer TTail}`
    ? THead extends keyof TValues
      ? FieldValue<NonNullable<TValues[THead]>, TTail>
      : never
    : never

export interface FormIssue {
  readonly code: string
  readonly id: string
  readonly message: string
  readonly path?: string
  readonly source: FormIssueSource
}

export type FormIssueSource = 'manual' | 'server' | 'submit' | 'validation'

export type ScalarValue
  = | bigint
    | boolean
    | null
    | number
    | string
    | symbol
    | undefined

export interface ValidationContext<TValues, TPath extends FieldPath<TValues>, TContext extends object> {
  readonly context: DeepReadonly<TContext>
  readonly signal: AbortSignal
  readonly value: DeepReadonly<FieldValue<TValues, TPath>>
  readonly values: DeepReadonly<TValues>
}

export interface ValidationIssueInput {
  readonly code: string
  readonly message: string
}

export type ValidationStatus = 'invalid' | 'unvalidated' | 'valid' | 'validating'

export interface ValidationWhenContext<TValues, TContext extends object> {
  readonly context: DeepReadonly<TContext>
  readonly values: DeepReadonly<TValues>
}

type JoinPath<TKey extends string, TChild extends string> = `${TKey}.${TChild}`

type UnsupportedLeaf = ((...args: never[]) => unknown) | Date | readonly unknown[] | RegExp

declare const schemaBrand: unique symbol

export type CompleteFieldDefinitions<
  TValues extends object,
  TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
  TContext extends object,
> = [MissingFieldPaths<TValues, TFields, TContext>] extends [never]
  ? TFields
  : { readonly __missingFieldPaths__: MissingFieldPaths<TValues, TFields, TContext> } & TFields

export interface CoreSchema<TValues extends object, TContext extends object> {
  readonly fields: readonly AnyCoreFieldDefinition<TValues, TContext>[]
  readonly [schemaBrand]: {
    readonly context: TContext
    readonly values: TValues
  }
}

export interface CoreSystem<TContext extends object> {
  create<TValues extends object>(
    schema: CoreSchema<TValues, TContext>,
    ...args: CreateArguments<TValues, TContext>
  ): FormInstance<TValues, TContext>
  defineSchema<TValues extends object>(): <
    const TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
  >(
    fields: CompleteFieldDefinitions<TValues, TFields, TContext>,
  ) => CoreSchema<TValues, TContext>
}

export interface CreateOptions<TValues extends object, TContext extends object> {
  readonly initialContext?: TContext
  readonly initialValues?: DeepPartial<TValues>
}

export interface FieldInstance<
  TValues extends object,
  TPath extends FieldPath<TValues>,
  TContext extends object,
> {
  clearErrors(): void
  get(): DeepReadonly<FieldValue<TValues, TPath>>
  getDefault(): DeepReadonly<FieldValue<TValues, TPath>>
  getState(): FieldState<TValues, TPath>
  hasError(): boolean
  isDirty(): boolean
  markTouched(): void
  readonly name: TPath
  reset(): void
  set(value: FieldValue<TValues, TPath>): void
  setDefault(value: FieldValue<TValues, TPath>): void
  readonly state: FieldState<TValues, TPath>
  subscribe(listener: () => void): () => void
  validate(): Promise<ValidationResult>
}

export interface FieldState<TValues extends object, TPath extends FieldPath<TValues>> {
  readonly defaultValue: DeepReadonly<FieldValue<TValues, TPath>>
  readonly errors: readonly FormIssue[]
  readonly isDirty: boolean
  readonly isTouched: boolean
  readonly isValid: boolean
  readonly isValidating: boolean
  readonly name: TPath
  readonly validationStatus: ValidationStatus
  readonly value: DeepReadonly<FieldValue<TValues, TPath>>
}

export interface FormInstance<TValues extends object, TContext extends object> {
  clearErrors(name?: FieldPath<TValues>): void
  dispose(): void
  getContext(): DeepReadonly<TContext>
  getDefaultValues(): DeepReadonly<TValues>
  getField<TPath extends FieldPath<TValues>>(name: TPath): FieldInstance<TValues, TPath, TContext>
  getFields(): readonly FieldInstance<TValues, FieldPath<TValues>, TContext>[]
  getState(): FormState<TValues>
  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>>
  getValues(): DeepReadonly<TValues>
  hasError(name?: FieldPath<TValues>): boolean
  markTouched<TPath extends FieldPath<TValues>>(name: TPath): void
  patchContext(patch: Partial<TContext>): void
  patchValues(patch: Partial<TValues>): void
  reset(options?: ResetOptions<TValues>): void
  resetField<TPath extends FieldPath<TValues>>(name: TPath): void
  readonly schema: CoreSchema<TValues, TContext>
  setDefaultValues(patch: Partial<TValues>): void
  setError<TPath extends FieldPath<TValues>>(name: TPath, issue: ManualIssueInput): void
  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void
  setValues(values: TValues): void
  readonly state: FormState<TValues>
  subscribe(listener: () => void): () => void
  transaction(callback: (transaction: TransactionContext<TValues>) => void): void
  validate(): Promise<ValidationResult>
  validateField<TPath extends FieldPath<TValues>>(name: TPath): Promise<ValidationResult>
}

export interface FormState<TValues extends object> {
  readonly defaultValues: DeepReadonly<TValues>
  readonly dirtyFields: Readonly<Record<FieldPath<TValues>, boolean>>
  readonly errors: readonly FormIssue[]
  readonly isDirty: boolean
  readonly isValid: boolean
  readonly isValidating: boolean
  readonly revision: number
  readonly touchedFields: Readonly<Record<FieldPath<TValues>, boolean>>
  readonly validationStatus: ValidationStatus
  readonly values: DeepReadonly<TValues>
}

export interface ManualIssueInput {
  readonly code: string
  readonly message: string
}

export interface ResetOptions<TValues extends object> {
  readonly asDefaults?: boolean
  readonly values: TValues
}

export interface TransactionContext<TValues extends object> {
  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>>
  getValues(): DeepReadonly<TValues>
  patchValues(patch: Partial<TValues>): void
  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void
  setValues(values: TValues): void
}

export type ValidationResult
  = | { readonly inputsRevision: number, readonly issues: readonly FormIssue[], readonly status: 'invalid' }
    | { readonly inputsRevision: number, readonly issues: readonly FormIssue[], readonly status: 'valid' }
    | { readonly status: 'aborted' }
    | { readonly status: 'stale' }

type CreateArguments<TValues extends object, TContext extends object> = keyof TContext extends never
  ? [options?: CreateOptions<TValues, TContext>]
  : [options: { readonly initialContext: TContext } & CreateOptions<TValues, TContext>]

type MissingFieldPaths<
  TValues extends object,
  TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
  TContext extends object,
> = Exclude<FieldPath<TValues>, TFields[number]['name']>
