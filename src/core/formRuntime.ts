import type { CompiledField, CompiledSchema } from './formSchema'
import type {
  ClearErrorsOptions,
  CoreSchema,
  CreateOptions,
  DeepReadonly,
  FieldInstance,
  FieldPath,
  FieldState,
  FieldValue,
  FormInstance,
  FormIssue,
  FormState,
  ManualIssueInput,
  ResetOptions,
  SubmitHandler,
  SubmitResult,
  TransactionContext,
  ValidationResult,
  ValidationStatus,
} from './types'

import { isPromiseLike } from '@chanyuxi/utils/async'
import { isPlainObject } from '@chanyuxi/utils/object'
import { getPath } from '@chanyuxi/utils/path'

import { FormCoreError, formErrorCode } from './formError'
import {
  aggregateValidationStatus,
  collectIssuePaths,
  collectValidationInvalidationPaths,
  createValidationIssue,
  freezeIssue,
  hasValidator,
  indexIssues,
  invalidateValidation,
  makeInitialValidationStatuses,
} from './validation'
import {
  cloneContext,
  cloneCoreValue,
  findChangedValuePaths,
  materializeValues,
  patchTopLevelValues,
  replaceFieldValue,
  shallowObjectEqual,
  valuesEqual,
} from './valueStore'

interface InternalState<TValues extends object, TContext extends object> {
  readonly context: TContext
  readonly defaultValues: TValues
  readonly formEpoch: number
  readonly inputsRevision: number
  readonly isSubmitSuccessful: boolean
  readonly isSubmitted: boolean
  readonly isSubmitting: boolean
  readonly manualIssues: readonly FormIssue[]
  readonly revision: number
  readonly submitCount: number
  readonly touched: Readonly<Record<string, boolean>>
  readonly validatedFields: ReadonlySet<string>
  readonly validationIssues: readonly FormIssue[]
  readonly validationStatuses: Readonly<Record<string, ValidationStatus>>
  readonly values: TValues
}

interface PublishHint {
  readonly dirtyNames?: ReadonlySet<string>
  readonly fieldNames?: ReadonlySet<string>
  readonly observableChanged?: boolean
  readonly validationChanged?: boolean
}

interface ValidationTicket {
  readonly formEpoch: number
  readonly inputsRevision: number
}

const emptyIssues: readonly FormIssue[] = Object.freeze([])

export class FormRuntime<
  TValues extends object,
  TContext extends object,
  TSubmitValues = TValues,
>
implements FormInstance<TValues, TContext, TSubmitValues> {
  readonly schema: CoreSchema<TValues, TContext, TSubmitValues>

  get context(): DeepReadonly<TContext> {
    return this.stateValue.context as DeepReadonly<TContext>
  }

  get defaultValues(): DeepReadonly<TValues> {
    return this.stateValue.defaultValues as DeepReadonly<TValues>
  }

  get fields(): readonly FieldInstance<TValues, FieldPath<TValues>, TContext>[] {
    return this.fieldList
  }

  get state(): FormState<TValues> {
    return this.snapshotValue
  }

  get values(): DeepReadonly<TValues> {
    return this.stateValue.values as DeepReadonly<TValues>
  }

  private readonly compiled: CompiledSchema<TValues, TContext, TSubmitValues>
  private dirtyCount = 0
  private disposed = false
  private readonly fieldInstances = new Map<string, FieldInstance<TValues, FieldPath<TValues>, TContext>>()
  private readonly fieldList: readonly FieldInstance<TValues, FieldPath<TValues>, TContext>[]
  private readonly fieldListeners = new Map<string, Set<() => void>>()
  private readonly fieldSnapshots = new Map<string, FieldState<TValues, FieldPath<TValues>>>()
  private readonly formListeners = new Set<() => void>()
  private notifying = false
  private readonly onSubscriberError: (error: AggregateError) => void
  private readonly queuedWrites: (() => void)[] = []
  private snapshotValue: FormState<TValues>
  private stateValue: InternalState<TValues, TContext>
  private submitController: AbortController | undefined
  private readonly subscriberErrors: unknown[] = []
  private transactionActive = false

  private readonly validationControllers = new Set<AbortController>()

  constructor(
    compiled: CompiledSchema<TValues, TContext, TSubmitValues>,
    onSubscriberError: (error: AggregateError) => void,
    options?: CreateOptions<TValues, TContext>,
  ) {
    this.compiled = compiled
    this.onSubscriberError = onSubscriberError
    this.schema = compiled.schema

    const defaultValues = materializeValues(compiled.fields)
    const values = options?.initialValues === undefined
      ? defaultValues
      : materializeValues(compiled.fields, options.initialValues, defaultValues)
    const context = cloneContext(options?.initialContext ?? ({} as TContext))
    const touched = makeBooleanRecord(compiled.fields, false)
    const validationStatuses = makeInitialValidationStatuses(compiled.fields)

    this.stateValue = {
      context,
      defaultValues,
      formEpoch: 0,
      inputsRevision: 0,
      isSubmitSuccessful: false,
      isSubmitted: false,
      isSubmitting: false,
      manualIssues: [],
      revision: 0,
      submitCount: 0,
      touched,
      validatedFields: new Set(),
      validationIssues: [],
      validationStatuses,
      values,
    }
    const initialIssues = Object.freeze(allIssues(this.stateValue))
    const initialIssuesByPath = indexIssues(initialIssues)
    this.snapshotValue = this.createFormSnapshot(this.stateValue, initialIssues)

    for (const field of compiled.fields) {
      const instance = this.createFieldInstance(field.name)
      this.fieldInstances.set(field.name, instance)
      this.fieldSnapshots.set(
        field.name,
        this.createFieldSnapshot(
          field.name,
          this.stateValue,
          initialIssuesByPath.get(field.name) ?? emptyIssues,
        ),
      )
      this.fieldListeners.set(field.name, new Set())
    }
    this.fieldList = Object.freeze(compiled.fields.map(field => this.fieldInstances.get(field.name)!))
  }

  clearErrors(name?: FieldPath<TValues>, options: ClearErrorsOptions = {}): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      if (name !== undefined) {
        this.requireField(name)
      }
      const shouldClear = (issue: FormIssue) => {
        const matchesPath = name === undefined || issue.path === name
        const matchesSource = options.source === undefined || issue.source === options.source
        return matchesPath && matchesSource
      }
      const validationIssues = this.stateValue.validationIssues.filter(issue => !shouldClear(issue))
      const manualIssues = this.stateValue.manualIssues.filter(issue => !shouldClear(issue))
      if (
        validationIssues.length === this.stateValue.validationIssues.length
        && manualIssues.length === this.stateValue.manualIssues.length
      ) {
        return
      }
      const clearedIssues = [
        ...this.stateValue.validationIssues.filter(shouldClear),
        ...this.stateValue.manualIssues.filter(shouldClear),
      ]
      const fieldNames = collectIssuePaths(clearedIssues)
      const validatedFields = new Set(this.stateValue.validatedFields)
      const validationStatuses = { ...this.stateValue.validationStatuses }
      if (options.source === undefined || options.source === 'validation') {
        for (const field of this.compiled.fields) {
          if (name === undefined || field.name === name) {
            validatedFields.delete(field.name)
            validationStatuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
            fieldNames.add(field.name)
          }
        }
      }
      this.publish({
        ...this.stateValue,
        manualIssues,
        validatedFields,
        validationIssues,
        validationStatuses,
      }, {
        dirtyNames: new Set(),
        fieldNames,
        observableChanged: true,
        validationChanged: true,
      })
    })
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.executeWrite(() => {
      if (this.disposed) {
        return
      }
      this.abortSubmit()
      if (this.stateValue.isSubmitting) {
        this.publish({
          ...this.stateValue,
          isSubmitSuccessful: false,
          isSubmitting: false,
        }, {
          dirtyNames: new Set(),
          fieldNames: new Set(),
          observableChanged: true,
          validationChanged: false,
        })
      }
      this.disposed = true
      this.abortValidations()
      this.formListeners.clear()
      for (const listeners of this.fieldListeners.values()) {
        listeners.clear()
      }
      this.queuedWrites.length = 0
    })
  }

  getField<TPath extends FieldPath<TValues>>(name: TPath): FieldInstance<TValues, TPath, TContext> {
    this.requireField(name)
    return this.fieldInstances.get(name) as FieldInstance<TValues, TPath, TContext>
  }

  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>> {
    const field = this.requireField(name)
    return getPath(this.stateValue.values, field.segments) as DeepReadonly<FieldValue<TValues, TPath>>
  }

  hasError(name?: FieldPath<TValues>): boolean {
    return name === undefined
      ? this.snapshotValue.errors.length > 0
      : this.getFieldSnapshot(name).errors.length > 0
  }

  markTouched<TPath extends FieldPath<TValues>>(name: TPath): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const field = this.requireField(name)
      if (this.stateValue.touched[field.name] === true) {
        return
      }
      this.publish({
        ...this.stateValue,
        touched: Object.freeze({ ...this.stateValue.touched, [field.name]: true }),
      }, {
        dirtyNames: new Set(),
        fieldNames: new Set([field.name]),
        observableChanged: true,
        validationChanged: false,
      })
    })
  }

  patchContext(patch: Partial<TContext>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      if (!isPlainObject(patch)) {
        throw new FormCoreError(formErrorCode.invalidValue, 'Context patch must be a plain object.')
      }
      const merged = { ...this.stateValue.context, ...patch }
      if (shallowObjectEqual(this.stateValue.context, merged)) {
        return
      }
      const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
      const fieldNames = collectValidationInvalidationPaths(this.stateValue)
      this.publish({
        ...invalidated,
        context: cloneContext(merged as TContext),
        inputsRevision: this.stateValue.inputsRevision + 1,
      }, {
        dirtyNames: new Set(),
        fieldNames,
        observableChanged: true,
        validationChanged: fieldNames.size > 0,
      })
    })
  }

  patchValues(patch: Partial<TValues>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextValues = patchTopLevelValues(this.compiled, this.stateValue.values, patch)
      this.applyValues(nextValues)
    })
  }

  reset(options?: ResetOptions<TValues>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      this.abortSubmit()
      this.abortValidations()
      const values = options === undefined
        ? this.stateValue.defaultValues
        : materializeValues(this.compiled.fields, options.values)
      const defaultValues = options !== undefined && options.asDefaults !== false
        ? values
        : this.stateValue.defaultValues
      const inputsChanged = values !== this.stateValue.values
      const next: InternalState<TValues, TContext> = {
        ...this.stateValue,
        defaultValues,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        isSubmitSuccessful: false,
        isSubmitted: false,
        isSubmitting: false,
        manualIssues: [],
        submitCount: 0,
        touched: makeBooleanRecord(this.compiled.fields, false),
        validatedFields: new Set(),
        validationIssues: [],
        validationStatuses: makeInitialValidationStatuses(this.compiled.fields),
        values,
      }
      this.publish(next)
    })
  }

  resetField<TPath extends FieldPath<TValues>>(name: TPath): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const field = this.requireField(name)
      this.abortSubmit()
      this.abortValidations()
      const defaultValue = getPath(this.stateValue.defaultValues, field.segments)
      const values = replaceFieldValue(this.compiled, this.stateValue.values, name, defaultValue)
      const touched = { ...this.stateValue.touched, [field.name]: false }
      const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
      const fieldNames = collectValidationInvalidationPaths(this.stateValue)
      fieldNames.add(field.name)
      const manualIssues = this.stateValue.manualIssues.filter(issue => issue.path !== field.name)
      const inputsChanged = !valuesEqual(this.compiled.fields, values, this.stateValue.values)
      this.publish({
        ...invalidated,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        manualIssues,
        touched: Object.freeze(touched),
        values,
      }, { dirtyNames: new Set([field.name]), fieldNames, validationChanged: true })
    })
  }

  setDefaultValues(patch: Partial<TValues>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextDefaults = patchTopLevelValues(this.compiled, this.stateValue.defaultValues, patch)
      if (valuesEqual(this.compiled.fields, nextDefaults, this.stateValue.defaultValues)) {
        return
      }
      const changedPaths = findChangedValuePaths(
        this.compiled.fields,
        this.stateValue.defaultValues,
        nextDefaults,
      )
      this.publish(
        { ...this.stateValue, defaultValues: nextDefaults },
        {
          dirtyNames: changedPaths,
          fieldNames: changedPaths,
          observableChanged: true,
          validationChanged: false,
        },
      )
    })
  }

  setError<TPath extends FieldPath<TValues>>(name: TPath, input: ManualIssueInput): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const field = this.requireField(name)
      if (typeof input.code !== 'string' || input.code.length === 0 || typeof input.message !== 'string') {
        throw new FormCoreError(
          formErrorCode.invalidValue,
          'Manual errors require a non-empty code and a message.',
        )
      }
      const id = `manual:${field.name}:${input.code}`
      const issue = freezeIssue({
        code: input.code,
        id,
        message: input.message,
        path: field.name,
        source: 'manual',
      })
      const existing = this.stateValue.manualIssues.find(candidate => candidate.id === id)
      if (existing !== undefined && existing.message === issue.message) {
        return
      }
      const manualIssues = [...this.stateValue.manualIssues.filter(candidate => candidate.id !== id), issue]
      this.publish(
        { ...this.stateValue, manualIssues },
        {
          dirtyNames: new Set(),
          fieldNames: new Set([field.name]),
          observableChanged: true,
          validationChanged: true,
        },
      )
    })
  }

  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextValues = replaceFieldValue(this.compiled, this.stateValue.values, name, value)
      this.applyValues(nextValues, new Set([name]))
    })
  }

  setValues(values: TValues): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextValues = materializeValues(this.compiled.fields, values)
      this.applyValues(nextValues)
    })
  }

  async submit<TResult>(
    handler: SubmitHandler<TSubmitValues, TResult>,
  ): Promise<SubmitResult<TResult>> {
    this.ensureWritable()
    if (this.stateValue.isSubmitting) {
      return { status: 'busy' }
    }

    const ticket: ValidationTicket = {
      formEpoch: this.stateValue.formEpoch,
      inputsRevision: this.stateValue.inputsRevision,
    }
    const values = this.stateValue.values
    const context = this.stateValue.context
    const controller = new AbortController()
    this.submitController = controller
    this.executeWrite(() => {
      this.publish({
        ...this.stateValue,
        isSubmitSuccessful: false,
        isSubmitting: true,
        submitCount: this.stateValue.submitCount + 1,
      }, {
        dirtyNames: new Set(),
        fieldNames: new Set(),
        observableChanged: true,
        validationChanged: false,
      })
    })

    try {
      const validation = await this.runValidation(this.compiled.fields)
      if (validation.status === 'invalid') {
        this.finishSubmit(true, false)
        return { issues: validation.issues, status: 'invalid' }
      }
      if (validation.status === 'stale') {
        this.finishSubmit(false, false)
        return { status: 'stale' }
      }
      if (validation.status === 'aborted') {
        this.finishSubmit(false, false)
        return { status: 'aborted' }
      }

      const beforeTransform = this.submitTicketStatus(ticket, controller)
      if (beforeTransform !== undefined) {
        this.finishSubmit(false, false)
        return { status: beforeTransform }
      }

      const transformed = this.compiled.transform({
        context: context as DeepReadonly<TContext>,
        values: values as DeepReadonly<TValues>,
      })
      if (isPromiseLike(transformed)) {
        throw new FormCoreError(
          formErrorCode.asyncTransformUnsupported,
          'Schema transforms must be synchronous.',
        )
      }
      const payload = cloneCoreValue(transformed, 'submitValues') as DeepReadonly<TSubmitValues>

      const beforeHandler = this.submitTicketStatus(ticket, controller)
      if (beforeHandler !== undefined) {
        this.finishSubmit(false, false)
        return { status: beforeHandler }
      }

      const result = await handler(payload, {
        inputsRevision: ticket.inputsRevision,
        signal: controller.signal,
      })
      if (
        controller.signal.aborted
        || this.disposed
        || this.stateValue.formEpoch !== ticket.formEpoch
      ) {
        this.finishSubmit(false, false)
        return { status: 'aborted' }
      }

      this.finishSubmit(true, true)
      return {
        inputsRevision: ticket.inputsRevision,
        result,
        status: 'success',
      }
    }
    catch (error) {
      if (
        controller.signal.aborted
        || this.disposed
        || this.stateValue.formEpoch !== ticket.formEpoch
      ) {
        this.finishSubmit(false, false)
        return { status: 'aborted' }
      }
      this.finishSubmit(true, false)
      return { error, status: 'error' }
    }
    finally {
      if (this.submitController === controller) {
        this.submitController = undefined
      }
    }
  }

  subscribe(listener: () => void): () => void {
    this.ensureWritable()
    this.formListeners.add(listener)
    let subscribed = true
    return () => {
      if (subscribed) {
        subscribed = false
        this.formListeners.delete(listener)
      }
    }
  }

  transaction(callback: (transaction: TransactionContext<TValues>) => void): void {
    this.ensureWritable()
    if (this.transactionActive) {
      throw new FormCoreError(formErrorCode.nestedTransaction, 'Nested transactions are not supported.')
    }

    this.executeWrite(() => {
      this.transactionActive = true
      let open = true
      let draftValues = this.stateValue.values
      const ensureOpen = () => {
        if (!open) {
          throw new FormCoreError(
            formErrorCode.asyncTransaction,
            'A transaction cannot be used after its callback returns.',
          )
        }
      }
      const transaction: TransactionContext<TValues> = {
        getValue: (name) => {
          ensureOpen()
          const field = this.requireField(name)
          return getPath(draftValues, field.segments) as never
        },
        patchValues: (patch) => {
          ensureOpen()
          draftValues = patchTopLevelValues(this.compiled, draftValues, patch)
        },
        setValue: (name, value) => {
          ensureOpen()
          draftValues = replaceFieldValue(this.compiled, draftValues, name, value)
        },
        setValues: (values) => {
          ensureOpen()
          draftValues = materializeValues(this.compiled.fields, values)
        },
        get values() {
          ensureOpen()
          return draftValues as DeepReadonly<TValues>
        },
      }

      try {
        const result = callback(transaction)
        if (isPromiseLike(result)) {
          throw new FormCoreError(
            formErrorCode.asyncTransaction,
            'Transactions must use a synchronous callback.',
          )
        }
        open = false
        this.transactionActive = false
        this.applyValues(draftValues)
      }
      finally {
        open = false
        this.transactionActive = false
      }
    })
  }

  validate(): Promise<ValidationResult> {
    return this.runValidation(this.compiled.fields)
  }

  validateField<TPath extends FieldPath<TValues>>(name: TPath): Promise<ValidationResult> {
    return this.runValidation([this.requireField(name)])
  }

  private abortSubmit(): void {
    this.submitController?.abort()
    this.submitController = undefined
  }

  private abortValidations(): void {
    for (const controller of this.validationControllers) {
      controller.abort()
    }
    this.validationControllers.clear()
  }

  private applyValues(values: TValues, changedValuePaths?: ReadonlySet<string>): void {
    if (
      values === this.stateValue.values
      || (changedValuePaths === undefined
        && valuesEqual(this.compiled.fields, values, this.stateValue.values))
    ) {
      return
    }
    const valuePaths = changedValuePaths
      ?? findChangedValuePaths(this.compiled.fields, this.stateValue.values, values)
    const fieldNames = collectValidationInvalidationPaths(this.stateValue)
    const validationChanged = fieldNames.size > 0
    for (const path of valuePaths) {
      fieldNames.add(path)
    }
    const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
    this.publish({
      ...invalidated,
      inputsRevision: this.stateValue.inputsRevision + 1,
      values,
    }, {
      dirtyNames: valuePaths,
      fieldNames,
      observableChanged: true,
      validationChanged,
    })
  }

  private createDirtyFields(
    state: InternalState<TValues, TContext>,
    previous?: FormState<TValues>,
    dirtyNames?: ReadonlySet<string>,
  ): Readonly<Record<FieldPath<TValues>, boolean>> {
    if (previous === undefined || dirtyNames === undefined) {
      const dirtyFields = makeDirtyRecord(this.compiled.fields, state.values, state.defaultValues)
      this.dirtyCount = Object.values(dirtyFields).filter(Boolean).length
      return dirtyFields
    }
    if (dirtyNames.size === 0) {
      return previous.dirtyFields
    }

    const dirtyFields = { ...previous.dirtyFields } as Record<string, boolean>
    for (const name of dirtyNames) {
      const field = this.requireField(name)
      const wasDirty = dirtyFields[field.name] === true
      const isDirty = !Object.is(
        getPath(state.values, field.segments),
        getPath(state.defaultValues, field.segments),
      )
      dirtyFields[field.name] = isDirty
      if (wasDirty !== isDirty) {
        this.dirtyCount += isDirty ? 1 : -1
      }
    }
    return Object.freeze(dirtyFields) as Readonly<Record<FieldPath<TValues>, boolean>>
  }

  private createFieldInstance<TPath extends FieldPath<TValues>>(
    name: TPath,
  ): FieldInstance<TValues, TPath, TContext> {
    const readDefaultValue = () => {
      const field = this.requireField(name)
      return getPath(this.stateValue.defaultValues, field.segments) as DeepReadonly<
        FieldValue<TValues, TPath>
      >
    }
    const readState = () => this.getFieldSnapshot(name)
    const readValue = () => this.getValue(name)
    return Object.freeze({
      clearErrors: (options?: ClearErrorsOptions) => this.clearErrors(name, options),
      get defaultValue() {
        return readDefaultValue()
      },
      get hasError() {
        return readState().errors.length > 0
      },
      get isDirty() {
        return readState().isDirty
      },
      markTouched: () => this.markTouched(name),
      name,
      reset: () => this.resetField(name),
      set: (value: FieldValue<TValues, TPath>) => this.setValue(name, value),
      setDefault: (value: FieldValue<TValues, TPath>) => this.setFieldDefault(name, value),
      get state() {
        return readState()
      },
      subscribe: (listener: () => void) => this.subscribeField(name, listener),
      validate: () => this.validateField(name),
      get value() {
        return readValue()
      },
    })
  }

  private createFieldSnapshot<TPath extends FieldPath<TValues>>(
    name: TPath,
    state: InternalState<TValues, TContext>,
    errors: readonly FormIssue[],
  ): FieldState<TValues, TPath> {
    const field = this.requireField(name)
    const baseStatus = state.validationStatuses[name] ?? 'unvalidated'
    const validationStatus = errors.length > 0 ? 'invalid' : baseStatus
    const value = getPath(state.values, field.segments) as DeepReadonly<FieldValue<TValues, TPath>>
    const defaultValue = getPath(state.defaultValues, field.segments) as DeepReadonly<
      FieldValue<TValues, TPath>
    >
    return Object.freeze({
      defaultValue,
      errors,
      isDirty: !Object.is(value, defaultValue),
      isTouched: state.touched[name] === true,
      isValid: validationStatus === 'valid',
      isValidating: validationStatus === 'validating',
      name,
      validationStatus,
      value,
    })
  }

  private createFormSnapshot(
    state: InternalState<TValues, TContext>,
    errors: readonly FormIssue[],
    previous?: FormState<TValues>,
    dirtyNames?: ReadonlySet<string>,
    validationChanged = true,
  ): FormState<TValues> {
    const dirtyFields = this.createDirtyFields(state, previous, dirtyNames)
    const validationStatus = previous !== undefined && !validationChanged
      ? previous.validationStatus
      : aggregateValidationStatus(
          this.compiled.fields,
          state.validationStatuses,
          errors,
        )
    return Object.freeze({
      defaultValues: state.defaultValues as DeepReadonly<TValues>,
      dirtyFields,
      errors,
      isDirty: this.dirtyCount > 0,
      isSubmitSuccessful: state.isSubmitSuccessful,
      isSubmitted: state.isSubmitted,
      isSubmitting: state.isSubmitting,
      isValid: validationStatus === 'valid',
      isValidating: validationStatus === 'validating',
      revision: state.revision,
      submitCount: state.submitCount,
      touchedFields: state.touched as Readonly<Record<FieldPath<TValues>, boolean>>,
      validationStatus,
      values: state.values as DeepReadonly<TValues>,
    })
  }

  private ensureDirectWriteAllowed(): void {
    this.ensureWritable()
    if (this.transactionActive) {
      throw new FormCoreError(
        formErrorCode.transactionActive,
        'Use the transaction context to write while a transaction is active.',
      )
    }
  }

  private ensureWritable(): void {
    if (this.disposed) {
      throw new FormCoreError(formErrorCode.formDisposed, 'This form instance has been disposed.')
    }
  }

  private executeWrite(operation: () => void): void {
    if (this.notifying) {
      this.queuedWrites.push(operation)
      return
    }

    operation()
    while (this.queuedWrites.length > 0 && !this.disposed) {
      const queued = this.queuedWrites.shift()
      queued?.()
    }

    if (this.subscriberErrors.length > 0) {
      const errors = this.subscriberErrors.splice(0)
      this.reportSubscriberError(
        new AggregateError(errors, 'One or more form subscribers threw after a committed update.'),
      )
    }
  }

  private finishSubmit(submitted: boolean, successful: boolean): void {
    if (this.disposed || !this.stateValue.isSubmitting) {
      return
    }
    this.executeWrite(() => {
      this.publish({
        ...this.stateValue,
        isSubmitSuccessful: successful,
        isSubmitted: submitted || this.stateValue.isSubmitted,
        isSubmitting: false,
      }, {
        dirtyNames: new Set(),
        fieldNames: new Set(),
        observableChanged: true,
        validationChanged: false,
      })
    })
  }

  private getFieldSnapshot<TPath extends FieldPath<TValues>>(name: TPath): FieldState<TValues, TPath> {
    this.requireField(name)
    return this.fieldSnapshots.get(name) as FieldState<TValues, TPath>
  }

  private notify(listeners: Set<() => void>): void {
    this.notifying = true
    try {
      for (const listener of [...listeners]) {
        try {
          listener()
        }
        catch (error) {
          this.subscriberErrors.push(error)
        }
      }
    }
    finally {
      this.notifying = false
    }
  }

  private publish(
    candidate: InternalState<TValues, TContext>,
    hint: PublishHint = {},
  ): void {
    const observableChanged = hint.observableChanged
      ?? hasObservableChange(this.compiled.fields, this.stateValue, candidate)
    if (!observableChanged) {
      this.stateValue = { ...candidate, revision: this.stateValue.revision }
      return
    }

    this.stateValue = { ...candidate, revision: this.stateValue.revision + 1 }
    const issues = hint.validationChanged === false
      ? this.snapshotValue.errors
      : Object.freeze(allIssues(this.stateValue))
    const issuesByPath = indexIssues(issues)
    this.snapshotValue = this.createFormSnapshot(
      this.stateValue,
      issues,
      this.snapshotValue,
      hint.dirtyNames,
      hint.validationChanged,
    )

    const changedFields: string[] = []
    const fields = hint.fieldNames === undefined
      ? this.compiled.fields
      : [...hint.fieldNames].map(name => this.requireField(name))
    for (const field of fields) {
      const next = this.createFieldSnapshot(
        field.name,
        this.stateValue,
        issuesByPath.get(field.name) ?? emptyIssues,
      )
      const previous = this.fieldSnapshots.get(field.name)
      if (previous !== undefined && fieldSnapshotsEqual(previous, next)) {
        this.fieldSnapshots.set(field.name, previous)
      }
      else {
        this.fieldSnapshots.set(field.name, next)
        changedFields.push(field.name)
      }
    }

    this.notify(this.formListeners)
    for (const name of changedFields) {
      this.notify(this.fieldListeners.get(name)!)
    }
  }

  private reportSubscriberError(error: AggregateError): void {
    try {
      this.onSubscriberError(error)
    }
    catch (reportingError) {
      queueMicrotask(() => {
        throw reportingError
      })
    }
  }

  private requireField(name: string): CompiledField<TValues, TContext> {
    const field = this.compiled.fieldMap.get(name)
    if (field === undefined) {
      throw new FormCoreError(
        formErrorCode.fieldNotFound,
        `Field "${name}" does not exist in this schema.`,
      )
    }
    return field
  }

  private async runValidation(
    fields: readonly CompiledField<TValues, TContext>[],
  ): Promise<ValidationResult> {
    this.ensureWritable()
    const ticket: ValidationTicket = {
      formEpoch: this.stateValue.formEpoch,
      inputsRevision: this.stateValue.inputsRevision,
    }
    const controller = new AbortController()
    this.validationControllers.add(controller)

    try {
      this.executeWrite(() => {
        const statuses = { ...this.stateValue.validationStatuses }
        const names = new Set(fields.map(field => field.name))
        const validatedFields = new Set(this.stateValue.validatedFields)
        for (const field of fields) {
          statuses[field.name] = hasValidator(field) ? 'validating' : 'valid'
          if (hasValidator(field)) {
            validatedFields.add(field.name)
          }
        }
        this.publish({
          ...this.stateValue,
          validatedFields,
          validationIssues: this.stateValue.validationIssues.filter(
            issue => !names.has(issue.path as FieldPath<TValues>),
          ),
          validationStatuses: statuses,
        }, { dirtyNames: new Set(), fieldNames: names, validationChanged: true })
      })

      await Promise.resolve()
      const invalid = this.validationTicketStatus(ticket)
      if (invalid !== undefined) {
        return invalid
      }

      const values = this.stateValue.values
      const context = this.stateValue.context
      const nextIssues: FormIssue[] = []
      const statuses = { ...this.stateValue.validationStatuses }

      for (const field of fields) {
        const definition = field.definition
        const shouldValidate = definition.validateWhen?.({
          context: context as never,
          values: values as never,
        }) ?? true

        if (!shouldValidate || definition.validate === undefined) {
          statuses[field.name] = 'valid'
          continue
        }

        const output = definition.validate({
          context: context as never,
          signal: controller.signal,
          value: getPath(values, field.segments) as never,
          values: values as never,
        })
        if (isPromiseLike(output)) {
          throw new FormCoreError(
            formErrorCode.asyncValidationUnsupported,
            `Field "${field.name}" returned a Promise from its P0 validator.`,
          )
        }
        if (!Array.isArray(output)) {
          throw new FormCoreError(
            formErrorCode.invalidValue,
            `Field "${field.name}" validator must return an issue array.`,
          )
        }

        const fieldIssues = output.map((issue, index) => createValidationIssue(field.name, issue, index))
        nextIssues.push(...fieldIssues)
        statuses[field.name] = fieldIssues.length === 0 ? 'valid' : 'invalid'
      }

      const afterRules = this.validationTicketStatus(ticket)
      if (afterRules !== undefined) {
        return afterRules
      }

      this.executeWrite(() => {
        const targetNames = new Set(fields.map(field => field.name))
        const untouched = this.stateValue.validationIssues.filter(
          issue => !targetNames.has(issue.path as FieldPath<TValues>),
        )
        this.publish({
          ...this.stateValue,
          validationIssues: [...untouched, ...nextIssues],
          validationStatuses: statuses,
        }, { dirtyNames: new Set(), fieldNames: targetNames, validationChanged: true })
      })

      const issues = allIssues(this.stateValue).filter(issue =>
        fields.some(field => field.name === issue.path),
      )
      return issues.length === 0
        ? { inputsRevision: ticket.inputsRevision, issues: [], status: 'valid' }
        : { inputsRevision: ticket.inputsRevision, issues, status: 'invalid' }
    }
    catch (error) {
      if (this.validationTicketStatus(ticket) === undefined) {
        this.executeWrite(() => {
          const statuses = { ...this.stateValue.validationStatuses }
          const validatedFields = new Set(this.stateValue.validatedFields)
          for (const field of fields) {
            validatedFields.delete(field.name)
            statuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
          }
          this.publish(
            { ...this.stateValue, validatedFields, validationStatuses: statuses },
            {
              dirtyNames: new Set(),
              fieldNames: new Set(fields.map(field => field.name)),
              validationChanged: true,
            },
          )
        })
      }
      throw error
    }
    finally {
      this.validationControllers.delete(controller)
    }
  }

  private setFieldDefault<TPath extends FieldPath<TValues>>(
    name: TPath,
    value: FieldValue<TValues, TPath>,
  ): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextDefaults = replaceFieldValue(this.compiled, this.stateValue.defaultValues, name, value)
      if (nextDefaults === this.stateValue.defaultValues) {
        return
      }
      this.publish(
        { ...this.stateValue, defaultValues: nextDefaults },
        {
          dirtyNames: new Set([name]),
          fieldNames: new Set([name]),
          observableChanged: true,
          validationChanged: false,
        },
      )
    })
  }

  private submitTicketStatus(
    ticket: ValidationTicket,
    controller: AbortController,
  ): 'aborted' | 'stale' | undefined {
    if (
      controller.signal.aborted
      || this.disposed
      || this.stateValue.formEpoch !== ticket.formEpoch
    ) {
      return 'aborted'
    }
    if (this.stateValue.inputsRevision !== ticket.inputsRevision) {
      return 'stale'
    }
    return undefined
  }

  private subscribeField<TPath extends FieldPath<TValues>>(name: TPath, listener: () => void): () => void {
    this.ensureWritable()
    const field = this.requireField(name)
    const listeners = this.fieldListeners.get(field.name)!
    listeners.add(listener)
    let subscribed = true
    return () => {
      if (subscribed) {
        subscribed = false
        listeners.delete(listener)
      }
    }
  }

  private validationTicketStatus(ticket: ValidationTicket): undefined | ValidationResult {
    if (this.disposed || this.stateValue.formEpoch !== ticket.formEpoch) {
      return { status: 'aborted' }
    }
    if (this.stateValue.inputsRevision !== ticket.inputsRevision) {
      return { status: 'stale' }
    }
    return undefined
  }
}

function allIssues<TValues extends object, TContext extends object>(
  state: InternalState<TValues, TContext>,
): readonly FormIssue[] {
  return [...state.validationIssues, ...state.manualIssues]
}

function fieldSnapshotsEqual<TValues extends object, TPath extends FieldPath<TValues>>(
  left: FieldState<TValues, TPath>,
  right: FieldState<TValues, TPath>,
): boolean {
  return Object.is(left.value, right.value)
    && Object.is(left.defaultValue, right.defaultValue)
    && left.isDirty === right.isDirty
    && left.isTouched === right.isTouched
    && left.validationStatus === right.validationStatus
    && issuesEqual(left.errors, right.errors)
}

function hasObservableChange<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  current: InternalState<TValues, TContext>,
  candidate: InternalState<TValues, TContext>,
): boolean {
  return !valuesEqual(fields, current.values, candidate.values)
    || !valuesEqual(fields, current.defaultValues, candidate.defaultValues)
    || current.context !== candidate.context
    || current.isSubmitted !== candidate.isSubmitted
    || current.isSubmitting !== candidate.isSubmitting
    || current.isSubmitSuccessful !== candidate.isSubmitSuccessful
    || current.submitCount !== candidate.submitCount
    || !recordsEqual(current.touched, candidate.touched)
    || !recordsEqual(current.validationStatuses, candidate.validationStatuses)
    || !issuesEqual(current.validationIssues, candidate.validationIssues)
    || !issuesEqual(current.manualIssues, candidate.manualIssues)
}

function issuesEqual(left: readonly FormIssue[], right: readonly FormIssue[]): boolean {
  return left.length === right.length && left.every((issue, index) => {
    const candidate = right[index]
    return candidate !== undefined
      && issue.id === candidate.id
      && issue.path === candidate.path
      && issue.code === candidate.code
      && issue.message === candidate.message
      && issue.source === candidate.source
  })
}

function makeBooleanRecord<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  value: boolean,
): Readonly<Record<string, boolean>> {
  return Object.freeze(Object.fromEntries(fields.map(field => [field.name, value])))
}

function makeDirtyRecord<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  values: TValues,
  defaults: TValues,
): Readonly<Record<FieldPath<TValues>, boolean>> {
  return Object.freeze(Object.fromEntries(fields.map(field => [
    field.name,
    !Object.is(getPath(values, field.segments), getPath(defaults, field.segments)),
  ]))) as Readonly<Record<FieldPath<TValues>, boolean>>
}

function recordsEqual<TValue>(
  left: Readonly<Record<string, TValue>>,
  right: Readonly<Record<string, TValue>>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.is(left[key], right[key]))
}
