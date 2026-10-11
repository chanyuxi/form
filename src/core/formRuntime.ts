import type { CommitStateOptions, FormRuntimeState } from './formRuntimeState'
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
  ValidationMode,
  ValidationResult,
} from './types'

import { isPromiseLike } from '@chanyuxi/utils/async'
import { isPlainObject } from '@chanyuxi/utils/object'
import { getPath } from '@chanyuxi/utils/path'

import { FormCoreError, formErrorCode } from './formError'
import {
  addIssuePaths,
  allIssues,
  createFieldSnapshot,
  deriveFormSnapshot,
  fieldSnapshotsEqual,
  hasObservableChange,
  hasValidationChange,
  makeBooleanRecord,
} from './formRuntimeState'
import {
  collectIssuePaths,
  collectValidationInvalidationPaths,
  evaluateValidationFields,
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

interface ValidationTicket {
  readonly formEpoch: number
  readonly inputsRevision: number
}

const emptyIssues: readonly FormIssue[] = Object.freeze([])
const emptyFieldSelection: ReadonlySet<string> = new Set()
const validationModes: readonly ValidationMode[] = [
  'all',
  'onBlur',
  'onChange',
  'onSubmit',
  'onTouched',
]

export class FormRuntime<TValues extends object, TContext extends object, TSubmitValues = TValues>
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

  private automaticValidationScheduled = false
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
  private readonly pendingAutomaticValidationFields = new Set<string>()
  private readonly queuedWrites: (() => void)[] = []
  private snapshotValue: FormState<TValues>
  private stateValue: FormRuntimeState<TValues, TContext>
  private submitController: AbortController | undefined
  private readonly subscriberErrors: unknown[] = []
  private transactionActive = false
  private readonly validationControllers = new Set<AbortController>()
  private readonly validationMode: ValidationMode

  constructor(
    compiled: CompiledSchema<TValues, TContext, TSubmitValues>,
    onSubscriberError: (error: AggregateError) => void,
    options?: CreateOptions<TValues, TContext>,
  ) {
    this.compiled = compiled
    this.onSubscriberError = onSubscriberError
    this.schema = compiled.schema
    this.validationMode = resolveValidationMode(options?.mode)

    const schemaDefaultValues = materializeValues(compiled.fields)
    const defaultValues = options?.defaultValues === undefined
      ? schemaDefaultValues
      : materializeValues(compiled.fields, options.defaultValues, schemaDefaultValues)
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
    const initialSnapshot = deriveFormSnapshot({
      dirtyFieldsToRecompute: 'all',
      errors: initialIssues,
      fieldMap: this.compiled.fieldMap,
      fields: this.compiled.fields,
      previous: undefined,
      previousDirtyCount: 0,
      state: this.stateValue,
      validationChanged: true,
    })
    this.dirtyCount = initialSnapshot.dirtyCount
    this.snapshotValue = initialSnapshot.snapshot

    for (const field of compiled.fields) {
      const instance = this.createFieldInstance(field.name)
      this.fieldInstances.set(field.name, instance)
      this.fieldSnapshots.set(
        field.name,
        createFieldSnapshot(
          field,
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
      const clearedIssues: FormIssue[] = []
      const keepIssue = (issue: FormIssue) => {
        if (!shouldClear(issue)) {
          return true
        }
        clearedIssues.push(issue)
        return false
      }
      const validationIssues = this.stateValue.validationIssues.filter(keepIssue)
      const manualIssues = this.stateValue.manualIssues.filter(keepIssue)
      if (clearedIssues.length === 0) {
        return
      }
      const affectedFields = collectIssuePaths(clearedIssues)
      const validatedFields = new Set(this.stateValue.validatedFields)
      const validationStatuses = { ...this.stateValue.validationStatuses }
      if (options.source === undefined || options.source === 'validation') {
        for (const field of this.compiled.fields) {
          if (name === undefined || field.name === name) {
            validatedFields.delete(field.name)
            validationStatuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
            affectedFields.add(field.name)
          }
        }
      }
      const statePatch = {
        manualIssues,
        validatedFields,
        validationIssues,
        validationStatuses,
      }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: affectedFields,
        statePatch,
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
      this.abortValidations()

      const affectedFields = new Set<string>()
      const validatedFields = new Set(this.stateValue.validatedFields)
      const validationStatuses = { ...this.stateValue.validationStatuses }
      for (const field of this.compiled.fields) {
        if (validationStatuses[field.name] === 'validating') {
          affectedFields.add(field.name)
          validatedFields.delete(field.name)
          validationStatuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
        }
      }

      const statePatch = {
        isSubmitSuccessful: this.stateValue.isSubmitting
          ? false
          : this.stateValue.isSubmitSuccessful,
        isSubmitting: false,
        validatedFields,
        validationStatuses,
      }
      this.commitState({
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: affectedFields,
        statePatch,
      })
      this.disposed = true
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
      if (this.stateValue.touched[field.name] !== true) {
        const statePatch = {
          touched: Object.freeze({ ...this.stateValue.touched, [field.name]: true }),
        }
        this.commitState({
          assumeChanged: true,
          dirtyFieldsToRecompute: emptyFieldSelection,
          fieldSnapshotsToRefresh: new Set([field.name]),
          statePatch,
        })
      }
      this.requestAutomaticValidationAfterTouch(field.name)
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
      const affectedFields = collectValidationInvalidationPaths(this.stateValue)
      const statePatch = {
        ...invalidated,
        context: cloneContext(merged as TContext),
        inputsRevision: this.stateValue.inputsRevision + 1,
      }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: affectedFields,
        statePatch,
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
      const statePatch = {
        defaultValues,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        isSubmitSuccessful: false,
        isSubmitted: false,
        isSubmitting: false,
        manualIssues: [],
        submitCount: 0,
        touched: makeBooleanRecord(this.compiled.fields, false),
        validatedFields: new Set<string>(),
        validationIssues: [],
        validationStatuses: makeInitialValidationStatuses(this.compiled.fields),
        values,
      }
      this.commitState({
        dirtyFieldsToRecompute: 'all',
        fieldSnapshotsToRefresh: 'all',
        statePatch,
      })
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
      const affectedFields = collectValidationInvalidationPaths(this.stateValue)
      affectedFields.add(field.name)
      const manualIssues = this.stateValue.manualIssues.filter(issue => issue.path !== field.name)
      const inputsChanged = values !== this.stateValue.values
      const statePatch = {
        ...invalidated,
        formEpoch: this.stateValue.formEpoch + 1,
        inputsRevision: this.stateValue.inputsRevision + (inputsChanged ? 1 : 0),
        manualIssues,
        touched: Object.freeze(touched),
        values,
      }
      this.commitState({
        dirtyFieldsToRecompute: new Set([field.name]),
        fieldSnapshotsToRefresh: affectedFields,
        statePatch,
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
      const changedPaths = findChangedValuePaths(
        this.compiled.fields,
        this.stateValue.defaultValues,
        nextDefaults,
      )
      const statePatch = { defaultValues: nextDefaults }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: changedPaths,
        fieldSnapshotsToRefresh: changedPaths,
        statePatch,
      })
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
      const statePatch = { manualIssues }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: new Set([field.name]),
        statePatch,
      })
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
    this.pendingAutomaticValidationFields.clear()

    const ticket: ValidationTicket = {
      formEpoch: this.stateValue.formEpoch,
      inputsRevision: this.stateValue.inputsRevision,
    }
    const values = this.stateValue.values
    const context = this.stateValue.context
    const controller = new AbortController()
    this.submitController = controller
    this.executeWrite(() => {
      const statePatch = {
        isSubmitSuccessful: false,
        isSubmitting: true,
        submitCount: this.stateValue.submitCount + 1,
      }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: emptyFieldSelection,
        statePatch,
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

      const beforeTransform = this.ticketStatus(ticket, controller.signal)
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

      const beforeHandler = this.ticketStatus(ticket, controller.signal)
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
    this.pendingAutomaticValidationFields.clear()
    return this.runValidation(this.compiled.fields)
  }

  validateField<TPath extends FieldPath<TValues>>(name: TPath): Promise<ValidationResult> {
    const field = this.requireField(name)
    this.pendingAutomaticValidationFields.delete(field.name)
    return this.runValidation([field])
  }

  private abortSubmit(): void {
    this.submitController?.abort()
    this.submitController = undefined
  }

  private abortValidations(): void {
    this.pendingAutomaticValidationFields.clear()
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
    const affectedFields = collectValidationInvalidationPaths(this.stateValue)
    for (const path of valuePaths) {
      affectedFields.add(path)
    }
    const invalidated = invalidateValidation(this.compiled.fields, this.stateValue)
    const statePatch = {
      ...invalidated,
      inputsRevision: this.stateValue.inputsRevision + 1,
      values,
    }
    this.commitState({
      assumeChanged: true,
      dirtyFieldsToRecompute: valuePaths,
      fieldSnapshotsToRefresh: affectedFields,
      statePatch,
    })
    this.requestAutomaticValidationAfterChange(valuePaths)
  }

  private commitState(
    options: CommitStateOptions<TValues, TContext>,
  ): void {
    const current = this.stateValue
    const candidate = { ...current, ...options.statePatch }
    const observableChanged = options.assumeChanged === true
      || hasObservableChange(this.compiled.fields, current, candidate)
    if (!observableChanged) {
      this.stateValue = { ...candidate, revision: current.revision }
      return
    }

    const nextState = { ...candidate, revision: current.revision + 1 }
    const validationChanged = hasValidationChange(current, candidate)
    const issues = validationChanged
      ? Object.freeze(allIssues(nextState))
      : this.snapshotValue.errors
    let fieldSnapshotsToRefresh = options.fieldSnapshotsToRefresh
    if (fieldSnapshotsToRefresh !== 'all' && validationChanged) {
      const affectedFields = new Set(fieldSnapshotsToRefresh)
      for (const field of this.compiled.fields) {
        if (current.validationStatuses[field.name] !== candidate.validationStatuses[field.name]) {
          affectedFields.add(field.name)
        }
      }
      addIssuePaths(affectedFields, current.validationIssues)
      addIssuePaths(affectedFields, current.manualIssues)
      addIssuePaths(affectedFields, candidate.validationIssues)
      addIssuePaths(affectedFields, candidate.manualIssues)
      fieldSnapshotsToRefresh = affectedFields
    }
    const fields = fieldSnapshotsToRefresh === 'all'
      ? this.compiled.fields
      : [...fieldSnapshotsToRefresh].map(name => this.requireField(name))
    const issuesByPath = validationChanged && fields.length > 0
      ? indexIssues(issues)
      : undefined
    const formSnapshot = deriveFormSnapshot({
      dirtyFieldsToRecompute: options.dirtyFieldsToRecompute,
      errors: issues,
      fieldMap: this.compiled.fieldMap,
      fields: this.compiled.fields,
      previous: this.snapshotValue,
      previousDirtyCount: this.dirtyCount,
      state: nextState,
      validationChanged,
    })

    const changedFields: string[] = []
    const nextFieldSnapshots = new Map<string, FieldState<TValues, FieldPath<TValues>>>()
    for (const field of fields) {
      const previous = this.fieldSnapshots.get(field.name)
      const fieldIssues = validationChanged
        ? issuesByPath?.get(field.name) ?? emptyIssues
        : previous?.errors ?? emptyIssues
      const next = createFieldSnapshot(
        field,
        nextState,
        fieldIssues,
      )
      if (previous !== undefined && fieldSnapshotsEqual(previous, next)) {
        nextFieldSnapshots.set(field.name, previous)
      }
      else {
        nextFieldSnapshots.set(field.name, next)
        changedFields.push(field.name)
      }
    }

    this.stateValue = nextState
    this.dirtyCount = formSnapshot.dirtyCount
    this.snapshotValue = formSnapshot.snapshot
    for (const [name, snapshot] of nextFieldSnapshots) {
      this.fieldSnapshots.set(name, snapshot)
    }

    this.notify(this.formListeners)
    for (const name of changedFields) {
      this.notify(this.fieldListeners.get(name)!)
    }
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
      const statePatch = {
        isSubmitSuccessful: successful,
        isSubmitted: submitted || this.stateValue.isSubmitted,
        isSubmitting: false,
      }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: emptyFieldSelection,
        fieldSnapshotsToRefresh: emptyFieldSelection,
        statePatch,
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

  private queueAutomaticValidation(fieldNames: Iterable<string>): void {
    for (const name of fieldNames) {
      this.pendingAutomaticValidationFields.add(name)
    }
    if (
      this.automaticValidationScheduled
      || this.pendingAutomaticValidationFields.size === 0
    ) {
      return
    }

    this.automaticValidationScheduled = true
    queueMicrotask(() => {
      this.automaticValidationScheduled = false
      if (this.disposed || this.pendingAutomaticValidationFields.size === 0) {
        this.pendingAutomaticValidationFields.clear()
        return
      }

      const fields = [...this.pendingAutomaticValidationFields].map(name => this.requireField(name))
      this.pendingAutomaticValidationFields.clear()
      void this.runValidation(fields).catch((error: unknown) => {
        queueMicrotask(() => {
          throw error
        })
      })
    })
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

  private requestAutomaticValidationAfterChange(fieldNames: ReadonlySet<string>): void {
    if (this.validationMode === 'all' || this.validationMode === 'onChange') {
      this.queueAutomaticValidation(fieldNames)
      return
    }
    if (this.validationMode === 'onTouched') {
      this.queueAutomaticValidation(
        [...fieldNames].filter(name => this.stateValue.touched[name] === true),
      )
    }
  }

  private requestAutomaticValidationAfterTouch(fieldName: string): void {
    if (
      this.validationMode === 'all'
      || this.validationMode === 'onBlur'
      || this.validationMode === 'onTouched'
    ) {
      this.queueAutomaticValidation([fieldName])
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
    const names = new Set(fields.map(field => field.name))
    const ticket: ValidationTicket = {
      formEpoch: this.stateValue.formEpoch,
      inputsRevision: this.stateValue.inputsRevision,
    }
    const controller = new AbortController()
    this.validationControllers.add(controller)

    try {
      this.executeWrite(() => {
        const statuses = { ...this.stateValue.validationStatuses }
        const validatedFields = new Set(this.stateValue.validatedFields)
        for (const field of fields) {
          const fieldHasValidator = hasValidator(field)
          statuses[field.name] = fieldHasValidator ? 'validating' : 'valid'
          if (fieldHasValidator) {
            validatedFields.add(field.name)
          }
        }
        const statePatch = {
          validatedFields,
          validationIssues: this.stateValue.validationIssues.filter(
            issue => !names.has(issue.path as FieldPath<TValues>),
          ),
          validationStatuses: statuses,
        }
        this.commitState({
          dirtyFieldsToRecompute: emptyFieldSelection,
          fieldSnapshotsToRefresh: names,
          statePatch,
        })
      })

      await Promise.resolve()
      const invalid = this.ticketStatus(ticket)
      if (invalid !== undefined) {
        return { status: invalid }
      }

      const evaluated = evaluateValidationFields({
        context: this.stateValue.context,
        fields,
        signal: controller.signal,
        statuses: this.stateValue.validationStatuses,
        values: this.stateValue.values,
      })

      const afterRules = this.ticketStatus(ticket)
      if (afterRules !== undefined) {
        return { status: afterRules }
      }

      this.executeWrite(() => {
        const untouched = this.stateValue.validationIssues.filter(
          issue => !names.has(issue.path as FieldPath<TValues>),
        )
        const statePatch = {
          validationIssues: [...untouched, ...evaluated.issues],
          validationStatuses: evaluated.statuses,
        }
        this.commitState({
          dirtyFieldsToRecompute: emptyFieldSelection,
          fieldSnapshotsToRefresh: names,
          statePatch,
        })
      })

      const issues = allIssues(this.stateValue).filter(issue =>
        issue.path !== undefined && names.has(issue.path as FieldPath<TValues>),
      )
      return issues.length === 0
        ? { inputsRevision: ticket.inputsRevision, issues: [], status: 'valid' }
        : { inputsRevision: ticket.inputsRevision, issues, status: 'invalid' }
    }
    catch (error) {
      if (this.ticketStatus(ticket) === undefined) {
        this.executeWrite(() => {
          const statuses = { ...this.stateValue.validationStatuses }
          const validatedFields = new Set(this.stateValue.validatedFields)
          for (const field of fields) {
            validatedFields.delete(field.name)
            statuses[field.name] = hasValidator(field) ? 'unvalidated' : 'valid'
          }
          const statePatch = { validatedFields, validationStatuses: statuses }
          this.commitState({
            dirtyFieldsToRecompute: emptyFieldSelection,
            fieldSnapshotsToRefresh: names,
            statePatch,
          })
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
      const statePatch = { defaultValues: nextDefaults }
      this.commitState({
        assumeChanged: true,
        dirtyFieldsToRecompute: new Set([name]),
        fieldSnapshotsToRefresh: new Set([name]),
        statePatch,
      })
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

  private ticketStatus(
    ticket: ValidationTicket,
    signal?: AbortSignal,
  ): 'aborted' | 'stale' | undefined {
    if (
      signal?.aborted === true
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
}

function resolveValidationMode(value: unknown): ValidationMode {
  if (value === undefined) {
    return 'onSubmit'
  }
  if (!validationModes.includes(value as ValidationMode)) {
    throw new FormCoreError(
      formErrorCode.invalidValue,
      `Validation mode must be one of: ${validationModes.join(', ')}.`,
    )
  }
  return value as ValidationMode
}
