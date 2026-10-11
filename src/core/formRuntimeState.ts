import type { CompiledField } from './formSchema'
import type {
  FieldPath,
  FieldState,
  FormIssue,
  FormState,
  ValidationStatus,
} from './types'

import { getPath } from '@chanyuxi/utils/path'

import { FormCoreError, formErrorCode } from './formError'
import { aggregateValidationStatus } from './validation'
import { valuesEqual } from './valueStore'

export interface CommitStateOptions<
  TValues extends object,
  TContext extends object,
> {
  readonly assumeChanged?: true
  readonly dirtyFieldsToRecompute: FieldSelection
  readonly fieldSnapshotsToRefresh: FieldSelection
  readonly statePatch: Partial<Omit<FormRuntimeState<TValues, TContext>, 'revision'>>
}

export type FieldSelection = 'all' | ReadonlySet<string>

export interface FormRuntimeState<TValues extends object, TContext extends object> {
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

interface DeriveFormSnapshotOptions<
  TValues extends object,
  TContext extends object,
> {
  readonly dirtyFieldsToRecompute: FieldSelection
  readonly errors: readonly FormIssue[]
  readonly fieldMap: ReadonlyMap<string, CompiledField<TValues, TContext>>
  readonly fields: readonly CompiledField<TValues, TContext>[]
  readonly previous: FormState<TValues> | undefined
  readonly previousDirtyCount: number
  readonly state: FormRuntimeState<TValues, TContext>
  readonly validationChanged: boolean
}

export function addIssuePaths(target: Set<string>, issues: readonly FormIssue[]): void {
  for (const issue of issues) {
    if (issue.path !== undefined) {
      target.add(issue.path)
    }
  }
}

export function allIssues<TValues extends object, TContext extends object>(
  state: FormRuntimeState<TValues, TContext>,
): readonly FormIssue[] {
  return [...state.validationIssues, ...state.manualIssues]
}

export function createFieldSnapshot<
  TValues extends object,
  TContext extends object,
>(
  field: CompiledField<TValues, TContext>,
  state: FormRuntimeState<TValues, TContext>,
  errors: readonly FormIssue[],
): FieldState<TValues, FieldPath<TValues>> {
  const baseStatus = state.validationStatuses[field.name] ?? 'unvalidated'
  const validationStatus = baseStatus === 'validating'
    ? 'validating'
    : errors.length > 0 ? 'invalid' : baseStatus
  const value = getPath(state.values, field.segments)
  const defaultValue = getPath(state.defaultValues, field.segments)
  return Object.freeze({
    defaultValue,
    errors,
    isDirty: !Object.is(value, defaultValue),
    isTouched: state.touched[field.name] === true,
    isValid: validationStatus === 'valid',
    isValidating: validationStatus === 'validating',
    name: field.name,
    validationStatus,
    value,
  }) as FieldState<TValues, FieldPath<TValues>>
}

export function deriveFormSnapshot<
  TValues extends object,
  TContext extends object,
>(
  options: DeriveFormSnapshotOptions<TValues, TContext>,
): { readonly dirtyCount: number, readonly snapshot: FormState<TValues> } {
  const dirty = deriveDirtyFields(options)
  const validationStatus = options.previous !== undefined && !options.validationChanged
    ? options.previous.validationStatus
    : aggregateValidationStatus(
        options.fields,
        options.state.validationStatuses,
        options.errors,
      )
  return {
    dirtyCount: dirty.dirtyCount,
    snapshot: Object.freeze({
      defaultValues: options.state.defaultValues,
      dirtyFields: dirty.dirtyFields,
      errors: options.errors,
      isDirty: dirty.dirtyCount > 0,
      isSubmitSuccessful: options.state.isSubmitSuccessful,
      isSubmitted: options.state.isSubmitted,
      isSubmitting: options.state.isSubmitting,
      isValid: validationStatus === 'valid',
      isValidating: validationStatus === 'validating',
      revision: options.state.revision,
      submitCount: options.state.submitCount,
      touchedFields: options.state.touched,
      validationStatus,
      values: options.state.values,
    }) as FormState<TValues>,
  }
}

export function fieldSnapshotsEqual<
  TValues extends object,
  TPath extends FieldPath<TValues>,
>(
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

export function hasObservableChange<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  current: FormRuntimeState<TValues, TContext>,
  candidate: FormRuntimeState<TValues, TContext>,
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

export function hasValidationChange<TValues extends object, TContext extends object>(
  current: FormRuntimeState<TValues, TContext>,
  candidate: FormRuntimeState<TValues, TContext>,
): boolean {
  return (
    current.validationStatuses !== candidate.validationStatuses
    && !recordsEqual(current.validationStatuses, candidate.validationStatuses)
  ) || (
    current.validationIssues !== candidate.validationIssues
    && !issuesEqual(current.validationIssues, candidate.validationIssues)
  ) || (
    current.manualIssues !== candidate.manualIssues
    && !issuesEqual(current.manualIssues, candidate.manualIssues)
  )
}

export function makeBooleanRecord<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  value: boolean,
): Readonly<Record<string, boolean>> {
  return Object.freeze(Object.fromEntries(fields.map(field => [field.name, value])))
}

function deriveDirtyFields<TValues extends object, TContext extends object>(
  options: DeriveFormSnapshotOptions<TValues, TContext>,
): {
  readonly dirtyCount: number
  readonly dirtyFields: Readonly<Record<FieldPath<TValues>, boolean>>
} {
  if (options.previous === undefined || options.dirtyFieldsToRecompute === 'all') {
    const dirtyFields = makeDirtyRecord(
      options.fields,
      options.state.values,
      options.state.defaultValues,
    )
    return {
      dirtyCount: Object.values(dirtyFields).filter(Boolean).length,
      dirtyFields,
    }
  }
  if (options.dirtyFieldsToRecompute.size === 0) {
    return {
      dirtyCount: options.previousDirtyCount,
      dirtyFields: options.previous.dirtyFields,
    }
  }

  const dirtyFields = { ...options.previous.dirtyFields } as Record<string, boolean>
  let dirtyCount = options.previousDirtyCount
  for (const name of options.dirtyFieldsToRecompute) {
    const field = options.fieldMap.get(name)
    if (field === undefined) {
      throw new FormCoreError(
        formErrorCode.fieldNotFound,
        `Field "${name}" does not exist in this schema.`,
      )
    }
    const wasDirty = dirtyFields[field.name] === true
    const isDirty = !Object.is(
      getPath(options.state.values, field.segments),
      getPath(options.state.defaultValues, field.segments),
    )
    dirtyFields[field.name] = isDirty
    if (wasDirty !== isDirty) {
      dirtyCount += isDirty ? 1 : -1
    }
  }
  return {
    dirtyCount,
    dirtyFields: Object.freeze(dirtyFields) as Readonly<Record<FieldPath<TValues>, boolean>>,
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
