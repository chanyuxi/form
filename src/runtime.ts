import type { CompiledField, CompiledSchema } from './schema.js'
import type {
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
  ScalarValue,
  TransactionContext,
  ValidationIssueInput,
  ValidationResult,
  ValidationStatus,
} from './types.js'

import { FormCoreError } from './errors.js'
import {
  assertScalarValue,
  cloneAndFreeze,
  getAtPath,
  hasAtPath,
  isRecord,
  setAtPath,
} from './path.js'

interface InternalState<TValues extends object, TContext extends object> {
  readonly context: TContext
  readonly defaultValues: TValues
  readonly formEpoch: number
  readonly inputsRevision: number
  readonly manualIssues: readonly FormIssue[]
  readonly revision: number
  readonly touched: Readonly<Record<string, boolean>>
  readonly validationIssues: readonly FormIssue[]
  readonly validationStatuses: Readonly<Record<string, ValidationStatus>>
  readonly values: TValues
}

interface ValidationTicket {
  readonly formEpoch: number
  readonly inputsRevision: number
}

export class FormRuntime<TValues extends object, TContext extends object>
implements FormInstance<TValues, TContext> {
  readonly schema: CoreSchema<TValues, TContext>

  get state(): FormState<TValues> {
    return this.snapshotValue
  }

  private readonly compiled: CompiledSchema<TValues, TContext>
  private disposed = false
  private readonly fieldInstances = new Map<string, FieldInstance<TValues, FieldPath<TValues>, TContext>>()
  private readonly fieldListeners = new Map<string, Set<() => void>>()
  private readonly fieldSnapshots = new Map<string, FieldState<TValues, FieldPath<TValues>>>()
  private readonly formListeners = new Set<() => void>()
  private notifying = false
  private readonly queuedWrites: (() => void)[] = []
  private snapshotValue: FormState<TValues>
  private stateValue: InternalState<TValues, TContext>
  private readonly subscriberErrors: unknown[] = []
  private transactionActive = false

  private readonly validationControllers = new Set<AbortController>()

  constructor(
    compiled: CompiledSchema<TValues, TContext>,
    options?: CreateOptions<TValues, TContext>,
  ) {
    this.compiled = compiled
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
      manualIssues: Object.freeze([]),
      revision: 0,
      touched,
      validationIssues: Object.freeze([]),
      validationStatuses,
      values,
    }
    this.snapshotValue = this.createFormSnapshot(this.stateValue)

    for (const field of compiled.fields) {
      const instance = this.createFieldInstance(field.name)
      this.fieldInstances.set(field.name, instance)
      this.fieldSnapshots.set(field.name, this.createFieldSnapshot(field.name, this.stateValue))
      this.fieldListeners.set(field.name, new Set())
    }
  }

  clearErrors(name?: FieldPath<TValues>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      if (name !== undefined) {
        this.requireField(name)
      }
      const shouldClear = (issue: FormIssue) => name === undefined || issue.path === name
      const validationIssues = this.stateValue.validationIssues.filter(issue => !shouldClear(issue))
      const manualIssues = this.stateValue.manualIssues.filter(issue => !shouldClear(issue))
      if (
        validationIssues.length === this.stateValue.validationIssues.length
        && manualIssues.length === this.stateValue.manualIssues.length
      ) {
        return
      }
      const validationStatuses = { ...this.stateValue.validationStatuses }
      for (const field of this.compiled.fields) {
        if (name === undefined || field.name === name) {
          validationStatuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
        }
      }
      this.publish({
        ...this.stateValue,
        manualIssues: Object.freeze(manualIssues),
        validationIssues: Object.freeze(validationIssues),
        validationStatuses: Object.freeze(validationStatuses),
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
      this.disposed = true
      this.abortValidations()
      this.formListeners.clear()
      for (const listeners of this.fieldListeners.values()) {
        listeners.clear()
      }
      this.queuedWrites.length = 0
    })
  }

  getContext(): DeepReadonly<TContext> {
    return this.stateValue.context as DeepReadonly<TContext>
  }

  getDefaultValues(): DeepReadonly<TValues> {
    return this.stateValue.defaultValues as DeepReadonly<TValues>
  }

  getField<TPath extends FieldPath<TValues>>(name: TPath): FieldInstance<TValues, TPath, TContext> {
    this.requireField(name)
    return this.fieldInstances.get(name) as FieldInstance<TValues, TPath, TContext>
  }

  getFields(): readonly FieldInstance<TValues, FieldPath<TValues>, TContext>[] {
    return Object.freeze(this.compiled.fields.map(field => this.fieldInstances.get(field.name)!))
  }

  getState(): FormState<TValues> {
    return this.snapshotValue
  }

  getValue<TPath extends FieldPath<TValues>>(name: TPath): DeepReadonly<FieldValue<TValues, TPath>> {
    const field = this.requireField(name)
    return getAtPath(this.stateValue.values, field.segments) as DeepReadonly<FieldValue<TValues, TPath>>
  }

  getValues(): DeepReadonly<TValues> {
    return this.stateValue.values as DeepReadonly<TValues>
  }

  hasError(name?: FieldPath<TValues>): boolean {
    const issues = allIssues(this.stateValue)
    return name === undefined ? issues.length > 0 : issues.some(issue => issue.path === name)
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
      })
    })
  }

  patchContext(patch: Partial<TContext>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      if (!isRecord(patch)) {
        throw new FormCoreError('INVALID_VALUE', 'Context patch must be a plain object.')
      }
      const merged = { ...this.stateValue.context, ...patch }
      if (shallowObjectEqual(this.stateValue.context, merged)) {
        return
      }
      const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
      this.publish({
        ...invalidated,
        context: cloneContext(merged as TContext),
        inputsRevision: this.stateValue.inputsRevision + 1,
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
      this.abortValidations()
      const values = options === undefined
        ? this.stateValue.defaultValues
        : materializeValues(this.compiled.fields, options.values)
      const defaultValues = options !== undefined && options.asDefaults !== false
        ? values
        : this.stateValue.defaultValues
      const inputsChanged = !valuesEqual(this.compiled.fields, values, this.stateValue.values)
      const next: InternalState<TValues, TContext> = {
        ...this.stateValue,
        defaultValues,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        manualIssues: Object.freeze([]),
        touched: makeBooleanRecord(this.compiled.fields, false),
        validationIssues: Object.freeze([]),
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
      this.abortValidations()
      const defaultValue = getAtPath(this.stateValue.defaultValues, field.segments)
      const values = replaceFieldValue(this.compiled, this.stateValue.values, name, defaultValue)
      const touched = { ...this.stateValue.touched, [field.name]: false }
      const validationStatuses = {
        ...this.stateValue.validationStatuses,
        [field.name]: hasValidator(field) ? 'unvalidated' : 'valid',
      } as Readonly<Record<string, ValidationStatus>>
      const validationIssues = this.stateValue.validationIssues.filter(issue => issue.path !== field.name)
      const manualIssues = this.stateValue.manualIssues.filter(issue => issue.path !== field.name)
      const inputsChanged = !valuesEqual(this.compiled.fields, values, this.stateValue.values)
      this.publish({
        ...this.stateValue,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        manualIssues: Object.freeze(manualIssues),
        touched: Object.freeze(touched),
        validationIssues: Object.freeze(validationIssues),
        validationStatuses: Object.freeze(validationStatuses),
        values,
      })
    })
  }

  setDefaultValues(patch: Partial<TValues>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextDefaults = patchTopLevelValues(this.compiled, this.stateValue.defaultValues, patch)
      if (valuesEqual(this.compiled.fields, nextDefaults, this.stateValue.defaultValues)) {
        return
      }
      this.publish({ ...this.stateValue, defaultValues: nextDefaults })
    })
  }

  setError<TPath extends FieldPath<TValues>>(name: TPath, input: ManualIssueInput): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const field = this.requireField(name)
      if (typeof input.code !== 'string' || input.code.length === 0 || typeof input.message !== 'string') {
        throw new FormCoreError('INVALID_VALUE', 'Manual errors require a non-empty code and a message.')
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
      this.publish({ ...this.stateValue, manualIssues: Object.freeze(manualIssues) })
    })
  }

  setValue<TPath extends FieldPath<TValues>>(name: TPath, value: FieldValue<TValues, TPath>): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextValues = replaceFieldValue(this.compiled, this.stateValue.values, name, value)
      this.applyValues(nextValues)
    })
  }

  setValues(values: TValues): void {
    this.ensureDirectWriteAllowed()
    this.executeWrite(() => {
      const nextValues = materializeValues(this.compiled.fields, values)
      this.applyValues(nextValues)
    })
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
      throw new FormCoreError('NESTED_TRANSACTION', 'Nested transactions are not supported.')
    }

    this.executeWrite(() => {
      this.transactionActive = true
      let open = true
      let draftValues = this.stateValue.values
      const ensureOpen = () => {
        if (!open) {
          throw new FormCoreError('ASYNC_TRANSACTION', 'A transaction cannot be used after its callback returns.')
        }
      }
      const transaction: TransactionContext<TValues> = {
        getValue: (name) => {
          ensureOpen()
          const field = this.requireField(name)
          return getAtPath(draftValues, field.segments) as never
        },
        getValues: () => {
          ensureOpen()
          return draftValues as DeepReadonly<TValues>
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
      }

      try {
        const result = callback(transaction)
        if (isThenable(result)) {
          throw new FormCoreError('ASYNC_TRANSACTION', 'Transactions must use a synchronous callback.')
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

  private abortValidations(): void {
    for (const controller of this.validationControllers) {
      controller.abort()
    }
    this.validationControllers.clear()
  }

  private applyValues(values: TValues): void {
    if (valuesEqual(this.compiled.fields, values, this.stateValue.values)) {
      return
    }
    const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
    this.publish({
      ...invalidated,
      inputsRevision: this.stateValue.inputsRevision + 1,
      values,
    })
  }

  private createFieldInstance<TPath extends FieldPath<TValues>>(
    name: TPath,
  ): FieldInstance<TValues, TPath, TContext> {
    const runtime = this
    return Object.freeze({
      clearErrors: () => runtime.clearErrors(name),
      get: () => runtime.getValue(name),
      getDefault: () => {
        const field = runtime.requireField(name)
        return getAtPath(runtime.stateValue.defaultValues, field.segments) as never
      },
      getState: () => runtime.getFieldSnapshot(name),
      hasError: () => runtime.hasError(name),
      isDirty: () => runtime.getFieldSnapshot(name).isDirty,
      markTouched: () => runtime.markTouched(name),
      name,
      reset: () => runtime.resetField(name),
      set: (value: FieldValue<TValues, TPath>) => runtime.setValue(name, value),
      setDefault: (value: FieldValue<TValues, TPath>) => runtime.setFieldDefault(name, value),
      get state() {
        return runtime.getFieldSnapshot(name)
      },
      subscribe: (listener: () => void) => runtime.subscribeField(name, listener),
      validate: () => runtime.validateField(name),
    })
  }

  private createFieldSnapshot<TPath extends FieldPath<TValues>>(
    name: TPath,
    state: InternalState<TValues, TContext>,
  ): FieldState<TValues, TPath> {
    const field = this.requireField(name)
    const errors = Object.freeze(allIssues(state).filter(issue => issue.path === name))
    const baseStatus = state.validationStatuses[name] ?? 'unvalidated'
    const validationStatus = errors.length > 0 ? 'invalid' : baseStatus
    const value = getAtPath(state.values, field.segments) as DeepReadonly<FieldValue<TValues, TPath>>
    const defaultValue = getAtPath(state.defaultValues, field.segments) as DeepReadonly<
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

  private createFormSnapshot(state: InternalState<TValues, TContext>): FormState<TValues> {
    const dirtyFields = makeDirtyRecord(this.compiled.fields, state.values, state.defaultValues)
    const errors = allIssues(state)
    const validationStatus = aggregateValidationStatus(
      this.compiled.fields,
      state.validationStatuses,
      errors,
    )
    return Object.freeze({
      defaultValues: state.defaultValues as DeepReadonly<TValues>,
      dirtyFields,
      errors,
      isDirty: Object.values(dirtyFields).some(Boolean),
      isValid: validationStatus === 'valid',
      isValidating: validationStatus === 'validating',
      revision: state.revision,
      touchedFields: state.touched as Readonly<Record<FieldPath<TValues>, boolean>>,
      validationStatus,
      values: state.values as DeepReadonly<TValues>,
    })
  }

  private ensureDirectWriteAllowed(): void {
    this.ensureWritable()
    if (this.transactionActive) {
      throw new FormCoreError(
        'TRANSACTION_ACTIVE',
        'Use the transaction context to write while a transaction is active.',
      )
    }
  }

  private ensureWritable(): void {
    if (this.disposed) {
      throw new FormCoreError('FORM_DISPOSED', 'This form instance has been disposed.')
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
      throw new AggregateError(errors, 'One or more form subscribers threw after a committed update.')
    }
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

  private publish(candidate: InternalState<TValues, TContext>): void {
    const observableChanged = hasObservableChange(this.compiled.fields, this.stateValue, candidate)
    if (!observableChanged) {
      this.stateValue = { ...candidate, revision: this.stateValue.revision }
      return
    }

    const previousFieldSnapshots = new Map(this.fieldSnapshots)
    this.stateValue = { ...candidate, revision: this.stateValue.revision + 1 }
    this.snapshotValue = this.createFormSnapshot(this.stateValue)

    const changedFields: string[] = []
    for (const field of this.compiled.fields) {
      const next = this.createFieldSnapshot(field.name, this.stateValue)
      const previous = previousFieldSnapshots.get(field.name)
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

  private requireField(name: string): CompiledField<TValues, TContext> {
    const field = this.compiled.fieldMap.get(name)
    if (field === undefined) {
      throw new FormCoreError('FIELD_NOT_FOUND', `Field "${name}" does not exist in this schema.`)
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
        for (const field of fields) {
          statuses[field.name] = hasValidator(field) ? 'validating' : 'valid'
        }
        this.publish({
          ...this.stateValue,
          validationIssues: Object.freeze(
            this.stateValue.validationIssues.filter(issue => !names.has(issue.path as FieldPath<TValues>)),
          ),
          validationStatuses: Object.freeze(statuses),
        })
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
          value: getAtPath(values, field.segments) as never,
          values: values as never,
        })
        if (isThenable(output)) {
          throw new FormCoreError(
            'ASYNC_VALIDATION_UNSUPPORTED',
            `Field "${field.name}" returned a Promise from its P0 validator.`,
          )
        }
        if (!Array.isArray(output)) {
          throw new FormCoreError('INVALID_VALUE', `Field "${field.name}" validator must return an issue array.`)
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
          validationIssues: Object.freeze([...untouched, ...nextIssues]),
          validationStatuses: Object.freeze(statuses),
        })
      })

      const issues = allIssues(this.stateValue).filter(issue =>
        fields.some(field => field.name === issue.path),
      )
      return issues.length === 0
        ? Object.freeze({ inputsRevision: ticket.inputsRevision, issues: Object.freeze([]), status: 'valid' })
        : Object.freeze({ inputsRevision: ticket.inputsRevision, issues: Object.freeze(issues), status: 'invalid' })
    }
    catch (error) {
      if (this.validationTicketStatus(ticket) === undefined) {
        this.executeWrite(() => {
          const statuses = { ...this.stateValue.validationStatuses }
          for (const field of fields) {
            statuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
          }
          this.publish({ ...this.stateValue, validationStatuses: Object.freeze(statuses) })
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
      if (valuesEqual(this.compiled.fields, nextDefaults, this.stateValue.defaultValues)) {
        return
      }
      this.publish({ ...this.stateValue, defaultValues: nextDefaults })
    })
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
      return Object.freeze({ status: 'aborted' })
    }
    if (this.stateValue.inputsRevision !== ticket.inputsRevision) {
      return Object.freeze({ status: 'stale' })
    }
    return undefined
  }
}

function aggregateValidationStatus<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  statuses: Readonly<Record<string, ValidationStatus>>,
  errors: readonly FormIssue[],
): ValidationStatus {
  if (fields.some(field => statuses[field.name] === 'validating')) {
    return 'validating'
  }
  if (errors.length > 0 || fields.some(field => statuses[field.name] === 'invalid')) {
    return 'invalid'
  }
  if (fields.some(field => statuses[field.name] === 'unvalidated')) {
    return 'unvalidated'
  }
  return 'valid'
}

function allIssues<TValues extends object, TContext extends object>(
  state: InternalState<TValues, TContext>,
): readonly FormIssue[] {
  return Object.freeze([...state.validationIssues, ...state.manualIssues])
}

function cloneContext<TContext extends object>(context: TContext): TContext {
  if (!isRecord(context)) {
    throw new FormCoreError('INVALID_VALUE', 'Initial context must be a plain object.')
  }
  return cloneAndFreeze(context)
}

function createValidationIssue(
  path: string,
  input: ValidationIssueInput,
  index: number,
): FormIssue {
  if (
    typeof input !== 'object'
    || input === null
    || typeof input.code !== 'string'
    || input.code.length === 0
    || typeof input.message !== 'string'
  ) {
    throw new FormCoreError('INVALID_VALUE', `Validator for "${path}" returned an invalid issue.`)
  }
  return freezeIssue({
    code: input.code,
    id: `validation:${path}:${input.code}:${index}`,
    message: input.message,
    path,
    source: 'validation',
  })
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

function freezeIssue(issue: FormIssue): FormIssue {
  return Object.freeze(issue)
}

function hasObservableChange<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  current: InternalState<TValues, TContext>,
  candidate: InternalState<TValues, TContext>,
): boolean {
  return !valuesEqual(fields, current.values, candidate.values)
    || !valuesEqual(fields, current.defaultValues, candidate.defaultValues)
    || current.context !== candidate.context
    || !recordsEqual(current.touched, candidate.touched)
    || !recordsEqual(current.validationStatuses, candidate.validationStatuses)
    || !issuesEqual(current.validationIssues, candidate.validationIssues)
    || !issuesEqual(current.manualIssues, candidate.manualIssues)
}

function hasValidator<TValues extends object, TContext extends object>(
  field: CompiledField<TValues, TContext>,
): boolean {
  return field.definition.validate !== undefined
}

function invalidateValidation<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  state: InternalState<TValues, TContext>,
): InternalState<TValues, TContext> {
  return {
    ...state,
    validationIssues: Object.freeze([]),
    validationStatuses: makeInitialValidationStatuses(fields),
  }
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

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function'
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
    !Object.is(getAtPath(values, field.segments), getAtPath(defaults, field.segments)),
  ]))) as Readonly<Record<FieldPath<TValues>, boolean>>
}

function makeInitialValidationStatuses<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
): Readonly<Record<string, ValidationStatus>> {
  const entries = fields.map(field => [
    field.name,
    hasValidator(field) ? 'unvalidated' : 'valid',
  ] as const)
  return Object.freeze(Object.fromEntries(entries)) as Readonly<Record<string, ValidationStatus>>
}

function materializeValues<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  source?: unknown,
  fallback?: TValues,
): TValues {
  const target: Record<string, unknown> = {}
  for (const field of fields) {
    let value: unknown
    if (source !== undefined && hasAtPath(source, field.segments)) {
      value = getAtPath(source, field.segments)
    }
    else if (fallback !== undefined) {
      value = getAtPath(fallback, field.segments)
    }
    else if (source === undefined) {
      value = field.defaultValue
    }
    else {
      throw new FormCoreError('INVALID_VALUE', `Value for field "${field.name}" is missing.`)
    }
    assertScalarValue(value, field.name)
    setAtPath(target, field.segments, value)
  }
  return cloneAndFreeze(target) as TValues
}

function patchTopLevelValues<TValues extends object, TContext extends object>(
  compiled: CompiledSchema<TValues, TContext>,
  current: TValues,
  patch: Partial<TValues>,
): TValues {
  if (!isRecord(patch)) {
    throw new FormCoreError('INVALID_VALUE', 'Value patch must be a plain object.')
  }
  const roots = new Set(Object.keys(patch))
  const knownRoots = new Set(compiled.fields.map(field => field.segments[0]))
  for (const root of roots) {
    if (!knownRoots.has(root)) {
      throw new FormCoreError('FIELD_NOT_FOUND', `Top-level value "${root}" is not defined by the schema.`)
    }
  }
  if (roots.size === 0) {
    return current
  }

  const target: Record<string, unknown> = {}
  for (const field of compiled.fields) {
    const root = field.segments[0]
    if (root !== undefined && roots.has(root)) {
      if (!hasAtPath(patch, field.segments)) {
        throw new FormCoreError(
          'INVALID_VALUE',
          `Top-level patch for "${root}" must contain field "${field.name}".`,
        )
      }
      const value = getAtPath(patch, field.segments)
      assertScalarValue(value, field.name)
      setAtPath(target, field.segments, value)
    }
    else {
      setAtPath(target, field.segments, getAtPath(current, field.segments))
    }
  }
  return cloneAndFreeze(target) as TValues
}

function recordsEqual<TValue>(
  left: Readonly<Record<string, TValue>>,
  right: Readonly<Record<string, TValue>>,
): boolean {
  const leftKeys = Object.keys(left)
  const rightKeys = Object.keys(right)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.is(left[key], right[key]))
}

function replaceFieldValue<TValues extends object, TContext extends object>(
  compiled: CompiledSchema<TValues, TContext>,
  current: TValues,
  name: FieldPath<TValues>,
  value: unknown,
): TValues {
  const field = compiled.fieldMap.get(name)
  if (field === undefined) {
    throw new FormCoreError('FIELD_NOT_FOUND', `Field "${name}" does not exist in this schema.`)
  }
  assertScalarValue(value, field.name)
  if (Object.is(getAtPath(current, field.segments), value)) {
    return current
  }

  const target: Record<string, unknown> = {}
  for (const candidate of compiled.fields) {
    setAtPath(
      target,
      candidate.segments,
      candidate.name === name ? value : getAtPath(current, candidate.segments),
    )
  }
  return cloneAndFreeze(target) as TValues
}

function shallowObjectEqual(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.is(leftRecord[key], rightRecord[key]))
}

function valuesEqual<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  left: TValues,
  right: TValues,
): boolean {
  return fields.every(field =>
    Object.is(getAtPath(left, field.segments), getAtPath(right, field.segments)),
  )
}
