export type AnyCoreFieldDefinition<TValues, TContext extends object> = {
  [TPath in FieldPath<TValues>]: CoreFieldDefinition<TValues, TPath, TContext>
}[FieldPath<TValues>]

/** Describes a scalar leaf field in a form schema. */
export interface CoreFieldDefinition<
  TValues,
  TPath extends FieldPath<TValues>,
  TContext extends object,
> {
  /** The initial baseline used by dirty tracking and a parameterless reset. */
  readonly defaultValue: FieldValue<TValues, TPath>
  /** A type-safe field path, such as `profile.name`. */
  readonly name: TPath
  /**
   * Validates the current field.
   *
   * @remarks P0 validators must return an issue array synchronously. Returning
   * a Promise throws `ASYNC_VALIDATION_UNSUPPORTED`.
   */
  readonly validate?: (
    context: ValidationContext<TValues, TPath, TContext>,
  ) => readonly ValidationIssueInput[]
  /**
   * Decides whether this field participates in the current validation run.
   * Returning `false` skips the validator and marks its validation rule as valid.
   */
  readonly validateWhen?: (context: ValidationWhenContext<TValues, TContext>) => boolean
}

/** Recursively makes object properties optional while preserving arrays and scalars. */
export type DeepPartial<TValue> = TValue extends ScalarValue
  ? TValue
  : TValue extends readonly unknown[]
    ? TValue
    : TValue extends object
      ? { [TKey in keyof TValue]?: DeepPartial<TValue[TKey]> }
      : TValue

/** Represents the immutable value views exposed by the Core API. */
export type DeepReadonly<TValue> = TValue extends ((...args: never[]) => unknown) | ScalarValue
  ? TValue
  : TValue extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : TValue extends object
      ? { readonly [TKey in keyof TValue]: DeepReadonly<TValue[TKey]> }
      : TValue

/**
 * A union of scalar leaf paths derived from a values model.
 *
 * @remarks Paths are not generated through arrays, Date, RegExp, functions,
 * or nullable objects in P0.
 */
export type FieldPath<TValues> = TValues extends ScalarValue | UnsupportedLeaf
  ? never
  : TValues extends object
    ? {
        [TKey in Extract<keyof TValues, string>]: TValues[TKey] extends ScalarValue
          ? TKey
          : null extends TValues[TKey]
            ? never
            : undefined extends TValues[TKey]
              ? never
              : TValues[TKey] extends UnsupportedLeaf
                ? never
                : TValues[TKey] extends object
                  ? JoinPath<TKey, FieldPath<TValues[TKey]>>
                  : never
      }[Extract<keyof TValues, string>]
    : never

/** Resolves the value type at the dotted path `TPath` within `TValues`. */
export type FieldValue<TValues, TPath extends string> = TPath extends keyof TValues
  ? TValues[TPath]
  : TPath extends `${infer THead}.${infer TTail}`
    ? THead extends keyof TValues
      ? FieldValue<NonNullable<TValues[THead]>, TTail>
      : never
    : never

/** A normalized form-level or field-level issue. */
export interface FormIssue {
  /** A stable application-facing code suitable for programmatic checks. */
  readonly code: string
  /** The unique identifier assigned to the issue by the Core. */
  readonly id: string
  /** A user-facing error message. */
  readonly message: string
  /** The owning field path; omitted for a form-level issue. */
  readonly path?: string
  /** The source category of the issue. */
  readonly source: FormIssueSource
}

/**
 * Issue source categories.
 *
 * @remarks `manual` issues are created by `setError`; `validation` issues come from
 * field validators. `server` and `submit` are reserved protocol categories. P0 Core
 * currently emits only `manual` and `validation`.
 */
export type FormIssueSource = 'manual' | 'server' | 'submit' | 'validation'

/** Scalar values supported by P0 fields. */
export type ScalarValue
  = | boolean
    | null
    | number
    | string
    | undefined

/** Read-only input passed to a field validator. */
export interface ValidationContext<TValues, TPath extends FieldPath<TValues>, TContext extends object> {
  /** The current read-only form context. */
  readonly context: DeepReadonly<TContext>
  /** Aborted when reset, resetField, or dispose cancels the validation task. */
  readonly signal: AbortSignal
  /** The current value of the field being validated. */
  readonly value: DeepReadonly<FieldValue<TValues, TPath>>
  /** The complete values snapshot read by this validation run. */
  readonly values: DeepReadonly<TValues>
}

/** An issue descriptor returned by a field validator. */
export interface ValidationIssueInput {
  /** An application-facing code suitable for programmatic checks. */
  readonly code: string
  /** A user-facing error message. */
  readonly message: string
}

/** Controls which form interactions automatically trigger field validation. */
export type ValidationMode = 'all' | 'onBlur' | 'onChange' | 'onSubmit' | 'onTouched'

/**
 * The validation status of a field or the aggregate form.
 *
 * @remarks `unvalidated` means no current result exists; `validating` means a task is
 * active; `invalid` means at least one issue or invalid field exists; and `valid`
 * means the current validation run completed without issues.
 */
export type ValidationStatus = 'invalid' | 'unvalidated' | 'valid' | 'validating'

/** Read-only input passed to `validateWhen`. */
export interface ValidationWhenContext<TValues, TContext extends object> {
  /** The current form context. */
  readonly context: DeepReadonly<TContext>
  /** The current complete form values. */
  readonly values: DeepReadonly<TValues>
}

type JoinPath<TKey extends string, TChild extends string> = `${TKey}.${TChild}`

type UnsupportedLeaf = ((...args: never[]) => unknown) | Date | readonly unknown[] | RegExp

declare const schemaBrand: unique symbol
declare const fieldContextBrand: unique symbol

/** Filters which issues are removed by `clearErrors`. */
export interface ClearErrorsOptions {
  /** Clears only issues from this source. Omit to clear matching issues from every source. */
  readonly source?: FormIssueSource
}

export type CompleteFieldDefinitions<
  TValues extends object,
  TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
  TContext extends object,
> = [MissingFieldPaths<TValues, TFields, TContext>] extends [never]
  ? TFields
  : { readonly __missingFieldPaths__: MissingFieldPaths<TValues, TFields, TContext> } & TFields

/** Options applied to every form instance created by a form system. */
export interface ConfigureFormsOptions {
  /**
   * Handles errors thrown by subscribers after all listeners have had a chance to run.
   *
   * @remarks The state remains committed. The default handler rethrows the aggregate
   * error in a microtask.
   */
  readonly onSubscriberError?: (error: AggregateError) => void
}

/** An immutable schema owned by the {@link FormSystem} that defined it. */
export interface CoreSchema<
  TValues extends object,
  TContext extends object,
  TSubmitValues = TValues,
> {
  /** The complete ordered field definitions in this schema. */
  readonly fields: readonly AnyCoreFieldDefinition<TValues, TContext>[]
  readonly [schemaBrand]: {
    readonly context: TContext
    readonly submitValues: TSubmitValues
    readonly values: TValues
  }
}

/** Values, context, and validation behavior used when creating a form instance. */
export interface CreateOptions<TValues extends object, TContext extends object> {
  /**
   * Initial default-value baseline used by dirty tracking and parameterless resets.
   * Missing scalar leaves fall back to defaults declared by the schema.
   */
  readonly defaultValues?: DeepPartial<TValues>
  /**
   * Initial immutable context.
   *
   * @remarks Required when `TContext` has required keys. Later updates must use
   * `patchContext`.
   */
  readonly initialContext?: TContext
  /**
   * Initial current field values. Missing scalar leaves fall back to `defaultValues`,
   * then to defaults declared by the schema.
   *
   * @remarks These values never replace the default-value baseline. A difference
   * from `defaultValues` therefore makes the corresponding field dirty immediately.
   */
  readonly initialValues?: DeepPartial<TValues>
  /**
   * Interaction that automatically triggers validation.
   *
   * @defaultValue `'onSubmit'`
   * @remarks `markTouched` represents a blur interaction in the framework-agnostic
   * Core API. `onTouched` validates on the first touch and on subsequent value changes
   * for touched fields. Explicit validation methods always run regardless of this mode.
   */
  readonly mode?: ValidationMode
}

/** A stable imperative handle for one schema field. */
export interface FieldInstance<
  TValues extends object,
  TPath extends FieldPath<TValues>,
  TContext extends object,
> {
  /**
   * Clears issues attached to this field.
   *
   * @remarks Clearing validation issues also invalidates the field's validation status.
   * @param options - Optional source filter.
   */
  clearErrors(options?: ClearErrorsOptions): void
  /** The field's current default-value baseline. */
  readonly defaultValue: DeepReadonly<FieldValue<TValues, TPath>>
  readonly [fieldContextBrand]?: TContext
  /** Whether this field currently has at least one issue. */
  readonly hasError: boolean
  /** Whether the current value differs from {@link FieldInstance.defaultValue}. */
  readonly isDirty: boolean
  /**
   * Marks this field as touched and represents a blur interaction for validation modes.
   * Repeating it does not change touched state, but may trigger validation.
   */
  markTouched(): void
  /** The schema field path represented by this handle. */
  readonly name: TPath
  /**
   * Restores the current default value and clears field interaction state.
   *
   * @remarks Resetting a field aborts active submit and validation tasks and
   * invalidates previous validation results.
   */
  reset(): void
  /**
   * Replaces the current field value without changing its default baseline.
   * Current validation results are invalidated; manual issues are preserved.
   */
  set(value: FieldValue<TValues, TPath>): void
  /**
   * Replaces this field's default baseline without changing its current value.
   * Dirty state is recalculated against the new baseline.
   */
  setDefault(value: FieldValue<TValues, TPath>): void
  /** The current immutable field snapshot. */
  readonly state: FieldState<TValues, TPath>
  /**
   * Subscribes to committed changes of this field snapshot.
   *
   * @returns An idempotent function that removes the listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Validates this field and updates its validation state.
   *
   * @returns A result that may be `stale` or `aborted` if the task is invalidated.
   */
  validate(): Promise<ValidationResult>
  /** The current immutable field value. */
  readonly value: DeepReadonly<FieldValue<TValues, TPath>>
}

/** An immutable, referentially stable snapshot of one field. */
export interface FieldState<TValues extends object, TPath extends FieldPath<TValues>> {
  /** The baseline used to calculate {@link FieldState.isDirty}. */
  readonly defaultValue: DeepReadonly<FieldValue<TValues, TPath>>
  /** Issues currently attached to this field. */
  readonly errors: readonly FormIssue[]
  /** Whether the current value differs from `defaultValue`. */
  readonly isDirty: boolean
  /** Whether the field has been explicitly marked as touched. */
  readonly isTouched: boolean
  /** Whether `validationStatus` is `valid`. */
  readonly isValid: boolean
  /** Whether `validationStatus` is `validating`. */
  readonly isValidating: boolean
  /** The field's schema path. */
  readonly name: TPath
  /** The current validation lifecycle state. */
  readonly validationStatus: ValidationStatus
  /** The current immutable field value. */
  readonly value: DeepReadonly<FieldValue<TValues, TPath>>
}

/**
 * A framework-agnostic form runtime created from a {@link CoreSchema}.
 *
 * @remarks Values and state are exposed as immutable snapshots. After `dispose`,
 * reads remain available for diagnostics, but commands and new subscriptions throw
 * `FORM_DISPOSED`.
 */
export interface FormInstance<
  TValues extends object,
  TContext extends object,
  TSubmitValues = TValues,
> {
  /**
   * Clears issues for one field or for the entire form when `name` is omitted.
   *
   * @remarks Clearing validation issues also invalidates the matching validation status.
   * @param name - Optional field path to limit the operation.
   * @param options - Optional issue-source filter.
   */
  clearErrors(name?: FieldPath<TValues>, options?: ClearErrorsOptions): void
  /** The current immutable context snapshot. */
  readonly context: DeepReadonly<TContext>
  /** The current immutable default-value baseline. */
  readonly defaultValues: DeepReadonly<TValues>
  /**
   * Permanently releases this form instance and aborts active tasks.
   *
   * @remarks This operation is idempotent. The last read snapshots remain available,
   * while subsequent commands throw `FORM_DISPOSED`.
   */
  dispose(): void
  /** Stable field handles in schema declaration order. */
  readonly fields: readonly FieldInstance<TValues, FieldPath<TValues>, TContext>[]
  /**
   * Returns the stable handle for a schema field.
   *
   * @throws {@link FormCoreError} with `FIELD_NOT_FOUND` for an unknown runtime path.
   */
  getField<TPath extends FieldPath<TValues>>(name: TPath): FieldInstance<TValues, TPath, TContext>
  /** Returns the current immutable value at a field path. */
  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>>
  /** Returns whether one field, or the whole form when omitted, currently has an issue. */
  hasError(name?: FieldPath<TValues>): boolean
  /**
   * Marks one field as touched and represents a blur interaction for validation modes.
   * Repeating it does not change touched state, but may trigger validation.
   */
  markTouched<TPath extends FieldPath<TValues>>(name: TPath): void
  /**
   * Shallowly merges a context patch and invalidates prior validation results.
   *
   * @remarks The patch must be a plain object. Context updates may make active
   * validation or submit preparation stale.
   */
  patchContext(patch: Partial<TContext>): void
  /**
   * Replaces selected top-level value roots without changing default values.
   *
   * @remarks When an object root is present in the patch, every schema leaf under
   * that root must be supplied. Use `setValue` for an individual nested field.
   */
  patchValues(patch: Partial<TValues>): void
  /**
   * Resets interaction, validation, issue, and submission state.
   *
   * @remarks With no options, values return to the current default baseline.
   * `reset({ values })` also adopts those values as the new baseline unless
   * `asDefaults` is `false`. Active validation and submit tasks are aborted.
   */
  reset(options?: ResetOptions<TValues>): void
  /**
   * Restores one field from its current default baseline and clears its touched state.
   * Active validation and submit tasks are aborted.
   */
  resetField<TPath extends FieldPath<TValues>>(name: TPath): void
  /** The immutable schema used to create this instance. */
  readonly schema: CoreSchema<TValues, TContext, TSubmitValues>
  /**
   * Replaces selected top-level default-value roots without changing current values.
   * Dirty state is recalculated against the new baseline.
   *
   * @remarks When an object root is present in the patch, every schema leaf under
   * that root must be supplied.
   */
  setDefaultValues(patch: Partial<TValues>): void
  /**
   * Adds or replaces a manual issue on one field.
   *
   * @remarks A later call with the same field and code replaces the previous message.
   * Successful validation does not clear manual issues.
   */
  setError<TPath extends FieldPath<TValues>>(name: TPath, issue: ManualIssueInput): void
  /**
   * Replaces one scalar field value without changing its default baseline.
   * Current validation results are invalidated; manual issues are preserved. Depending
   * on the configured validation mode, the changed field may be validated automatically.
   */
  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void
  /**
   * Replaces the complete values model without changing the default baseline.
   * Input is cloned and frozen before being exposed. Current validation results
   * are invalidated; manual issues are preserved.
   */
  setValues(values: TValues): void
  /** The current immutable form snapshot. */
  readonly state: FormState<TValues>
  /**
   * Validates a snapshot, transforms it, and invokes the submit handler.
   *
   * @remarks Concurrent calls return `busy`. The schema transform must be synchronous,
   * while the handler may be asynchronous. The handler receives an immutable payload;
   * edits made while it is running do not mutate that payload. A successful submit does
   * not reset values or change the default baseline.
   *
   * @returns A discriminated result covering success, invalid, busy, stale, aborted,
   * and caught handler or transform errors.
   */
  submit<TResult>(
    handler: SubmitHandler<TSubmitValues, TResult>,
  ): Promise<SubmitResult<TResult>>
  /**
   * Subscribes to committed form snapshot changes.
   *
   * @remarks No-op writes do not notify. Writes started by a listener are queued until
   * the current notification completes.
   * @returns An idempotent function that removes the listener.
   */
  subscribe(listener: () => void): () => void
  /**
   * Applies multiple value operations as one atomic commit.
   *
   * @remarks The callback must be synchronous. Throwing rolls back every draft change.
   * Nested transactions, async callbacks, and regular form write methods used from
   * inside the callback are rejected.
   */
  transaction(callback: (transaction: TransactionContext<TValues>) => void): void
  /**
   * Runs all field validators and updates validation snapshots.
   *
   * @remarks Validators themselves must be synchronous even though this method returns
   * a Promise for task lifecycle semantics.
   */
  validate(): Promise<ValidationResult>
  /**
   * Runs the validator for one field and updates its validation snapshot.
   *
   * @returns A result that may be `stale` or `aborted` if the task is invalidated.
   */
  validateField<TPath extends FieldPath<TValues>>(name: TPath): Promise<ValidationResult>
  /** The current complete immutable values snapshot. */
  readonly values: DeepReadonly<TValues>
}

/** An immutable snapshot of observable form state. */
export interface FormState<TValues extends object> {
  /** The current default-value baseline. */
  readonly defaultValues: DeepReadonly<TValues>
  /** Dirty state indexed by every schema field path. */
  readonly dirtyFields: Readonly<Record<FieldPath<TValues>, boolean>>
  /** All current form and field issues. */
  readonly errors: readonly FormIssue[]
  /** Whether at least one field differs from its default baseline. */
  readonly isDirty: boolean
  /** Whether the most recently completed submit attempt succeeded. */
  readonly isSubmitSuccessful: boolean
  /** Whether at least one submit attempt reached a terminal submitted result. */
  readonly isSubmitted: boolean
  /** Whether a submit attempt is currently active. */
  readonly isSubmitting: boolean
  /** Whether the aggregate `validationStatus` is `valid`. */
  readonly isValid: boolean
  /** Whether the aggregate `validationStatus` is `validating`. */
  readonly isValidating: boolean
  /** Monotonically increasing number for observable committed changes. */
  readonly revision: number
  /** Number of submit attempts started since the last reset. */
  readonly submitCount: number
  /** Touched state indexed by every schema field path. */
  readonly touchedFields: Readonly<Record<FieldPath<TValues>, boolean>>
  /** Aggregate validation state across every field and current issue. */
  readonly validationStatus: ValidationStatus
  /** The current complete values snapshot. */
  readonly values: DeepReadonly<TValues>
}

/** Defines schemas and creates independent form instances for one context model. */
export interface FormSystem<TContext extends object> {
  /**
   * Creates an independent runtime from a schema owned by this system.
   *
   * @remarks Values, validation, issues, subscriptions, and task state are never shared
   * between instances created from the same schema.
   * @throws {@link FormCoreError} with `SCHEMA_SYSTEM_MISMATCH` when the schema belongs
   * to another form system.
   */
  create<TValues extends object, TSubmitValues = TValues>(
    schema: CoreSchema<TValues, TContext, TSubmitValues>,
    ...args: CreateArguments<TValues, TContext>
  ): FormInstance<TValues, TContext, TSubmitValues>
  /**
   * Starts a type-safe schema definition for a values model.
   *
   * @remarks The returned builder requires one definition for every scalar leaf path.
   * Field paths must not be duplicated or overlap as parent and child paths. An optional
   * synchronous transform can define the submit payload type.
   */
  defineSchema<TValues extends object>(): <
    const TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
    TSubmitValues = TValues,
  >(
    fields: CompleteFieldDefinitions<TValues, TFields, TContext>,
    options?: SchemaOptions<TValues, TContext, TSubmitValues>,
  ) => CoreSchema<TValues, TContext, TSubmitValues>
}

/** Input used to create or replace a manual field issue. */
export interface ManualIssueInput {
  /** A non-empty application-facing code. */
  readonly code: string
  /** A user-facing error message. */
  readonly message: string
}

/** Controls the values and default baseline used by `reset`. */
export interface ResetOptions<TValues extends object> {
  /**
   * Whether `values` also become the new default baseline.
   * @defaultValue `true`
   */
  readonly asDefaults?: boolean
  /** Complete values to install during reset. */
  readonly values: TValues
}

/** Optional schema-level behavior. */
export interface SchemaOptions<
  TValues extends object,
  TContext extends object,
  TSubmitValues,
> {
  /**
   * Converts validated form values into the submit payload.
   *
   * @remarks The transform must be synchronous. Returning a Promise produces an
   * `ASYNC_TRANSFORM_UNSUPPORTED` submit error.
   */
  readonly transform: (
    context: SchemaTransformContext<TValues, TContext>,
  ) => TSubmitValues extends PromiseLike<unknown> ? never : TSubmitValues
}

/** Read-only input passed to a schema submit transform. */
export interface SchemaTransformContext<TValues extends object, TContext extends object> {
  /** The context captured when submit started. */
  readonly context: DeepReadonly<TContext>
  /** The values snapshot captured when submit started. */
  readonly values: DeepReadonly<TValues>
}

/** Handles a validated, transformed, immutable submit payload. */
export type SubmitHandler<TSubmitValues, TResult> = (
  values: DeepReadonly<TSubmitValues>,
  context: SubmitHandlerContext,
) => Promise<TResult> | TResult

/** Lifecycle information passed to a submit handler. */
export interface SubmitHandlerContext {
  /** The input revision captured by this submit attempt. */
  readonly inputsRevision: number
  /** Aborted when reset, resetField, or dispose cancels the submit attempt. */
  readonly signal: AbortSignal
}

/**
 * The terminal outcome of a submit attempt.
 *
 * @remarks `invalid` means the handler was not called; `busy` means another submit
 * was active; `stale` means inputs changed before the handler began; `aborted` means
 * the lifecycle invalidated the attempt; and `error` contains a caught transform,
 * validation, or handler error.
 */
export type SubmitResult<TResult = unknown>
  = | { readonly error: unknown, readonly status: 'error' }
    | { readonly inputsRevision: number, readonly result: TResult, readonly status: 'success' }
    | { readonly issues: readonly FormIssue[], readonly status: 'invalid' }
    | { readonly status: 'aborted' }
    | { readonly status: 'busy' }
    | { readonly status: 'stale' }

/** A synchronous draft used inside {@link FormInstance.transaction}. */
export interface TransactionContext<TValues extends object> {
  /** Reads a field from the current transaction draft. */
  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>>
  /** Replaces selected top-level roots in the transaction draft. */
  patchValues(patch: Partial<TValues>): void
  /** Replaces one scalar field in the transaction draft. */
  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void
  /** Replaces the complete transaction draft. */
  setValues(values: TValues): void
  /** The current immutable view of the transaction draft. */
  readonly values: DeepReadonly<TValues>
}

/**
 * The terminal outcome of a validation task.
 *
 * @remarks `stale` means inputs changed while validation was pending. `aborted`
 * means reset, dispose, or another lifecycle boundary invalidated the task. Stale
 * and aborted tasks never write their old result back into current state.
 */
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
