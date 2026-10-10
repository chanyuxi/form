import type { CompiledField } from './formSchema'
import type {
  FormIssue,
  ValidationIssueInput,
  ValidationStatus,
} from './types'

import { FormCoreError, formErrorCode } from './formError'

interface ValidationState {
  readonly validatedFields: ReadonlySet<string>
  readonly validationIssues: readonly FormIssue[]
  readonly validationStatuses: Readonly<Record<string, ValidationStatus>>
}

export function aggregateValidationStatus<TValues extends object, TContext extends object>(
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

export function collectIssuePaths(issues: readonly FormIssue[]): Set<string> {
  return new Set(
    issues.flatMap(issue => issue.path === undefined ? [] : [issue.path]),
  )
}

export function collectValidationInvalidationPaths(state: ValidationState): Set<string> {
  const paths = collectIssuePaths(state.validationIssues)
  for (const fieldName of state.validatedFields) {
    paths.add(fieldName)
  }
  return paths
}

export function createValidationIssue(
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
    throw new FormCoreError(
      formErrorCode.invalidValue,
      `Validator for "${path}" returned an invalid issue.`,
    )
  }
  return freezeIssue({
    code: input.code,
    id: `validation:${path}:${input.code}:${index}`,
    message: input.message,
    path,
    source: 'validation',
  })
}

export function freezeIssue(issue: FormIssue): FormIssue {
  return Object.freeze(issue)
}

export function hasValidator<TValues extends object, TContext extends object>(
  field: CompiledField<TValues, TContext>,
): boolean {
  return field.definition.validate !== undefined
}

export function indexIssues(issues: readonly FormIssue[]): ReadonlyMap<string, readonly FormIssue[]> {
  const mutable = new Map<string, FormIssue[]>()
  for (const issue of issues) {
    if (issue.path === undefined) {
      continue
    }
    const fieldIssues = mutable.get(issue.path) ?? []
    fieldIssues.push(issue)
    mutable.set(issue.path, fieldIssues)
  }

  return new Map(
    [...mutable].map(([path, fieldIssues]) => [path, Object.freeze(fieldIssues)] as const),
  )
}

export function invalidateValidation<
  TValues extends object,
  TContext extends object,
  TState extends ValidationState,
>(
  fields: readonly CompiledField<TValues, TContext>[],
  state: TState,
): TState {
  if (state.validatedFields.size === 0 && state.validationIssues.length === 0) {
    return state
  }
  return {
    ...state,
    validatedFields: new Set(),
    validationIssues: [],
    validationStatuses: makeInitialValidationStatuses(fields),
  }
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && typeof (value as { then?: unknown }).then === 'function'
}

export function makeInitialValidationStatuses<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
): Readonly<Record<string, ValidationStatus>> {
  const entries = fields.map(field => [
    field.name,
    hasValidator(field) ? 'unvalidated' : 'valid',
  ] as const)
  return Object.fromEntries(entries) as Readonly<Record<string, ValidationStatus>>
}
