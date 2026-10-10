import type { CompiledField, CompiledSchema } from './formSchema'
import type { FieldPath } from './types'

import {
  assertScalarValue,
  cloneAndFreeze,
  getAtPath,
  hasAtPath,
  isPlainRecord,
  isRecord,
  replaceAtPath,
  setAtPath,
} from './fieldPath'
import { FormCoreError, formErrorCode } from './formError'

export function cloneContext<TContext extends object>(context: TContext): TContext {
  if (!isPlainRecord(context)) {
    throw new FormCoreError(formErrorCode.invalidValue, 'Initial context must be a plain object.')
  }
  return cloneAndFreeze(context, 'context')
}

export function findChangedValuePaths<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  left: TValues,
  right: TValues,
): Set<string> {
  return new Set(
    fields.flatMap(field =>
      Object.is(getAtPath(left, field.segments), getAtPath(right, field.segments))
        ? []
        : [field.name],
    ),
  )
}

export function materializeValues<TValues extends object, TContext extends object>(
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
      throw new FormCoreError(formErrorCode.invalidValue, `Value for field "${field.name}" is missing.`)
    }
    assertScalarValue(value, field.name)
    setAtPath(target, field.segments, value)
  }
  return cloneAndFreeze(target) as TValues
}

export function patchTopLevelValues<TValues extends object, TContext extends object>(
  compiled: CompiledSchema<TValues, TContext>,
  current: TValues,
  patch: Partial<TValues>,
): TValues {
  if (!isRecord(patch)) {
    throw new FormCoreError(formErrorCode.invalidValue, 'Value patch must be a plain object.')
  }
  const roots = new Set(Object.keys(patch))
  const knownRoots = new Set(compiled.fields.map(field => field.segments[0]))
  for (const root of roots) {
    if (!knownRoots.has(root)) {
      throw new FormCoreError(
        formErrorCode.fieldNotFound,
        `Top-level value "${root}" is not defined by the schema.`,
      )
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
          formErrorCode.invalidValue,
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

export function replaceFieldValue<TValues extends object, TContext extends object>(
  compiled: CompiledSchema<TValues, TContext>,
  current: TValues,
  name: FieldPath<TValues>,
  value: unknown,
): TValues {
  const field = compiled.fieldMap.get(name)
  if (field === undefined) {
    throw new FormCoreError(
      formErrorCode.fieldNotFound,
      `Field "${name}" does not exist in this schema.`,
    )
  }
  assertScalarValue(value, field.name)
  if (Object.is(getAtPath(current, field.segments), value)) {
    return current
  }

  return replaceAtPath(current, field.segments, value)
}

export function shallowObjectEqual(left: object, right: object): boolean {
  const leftRecord = left as Record<string, unknown>
  const rightRecord = right as Record<string, unknown>
  const leftKeys = Object.keys(leftRecord)
  const rightKeys = Object.keys(rightRecord)
  return leftKeys.length === rightKeys.length && leftKeys.every(key => Object.is(leftRecord[key], rightRecord[key]))
}

export function valuesEqual<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  left: TValues,
  right: TValues,
): boolean {
  return fields.every(field =>
    Object.is(getAtPath(left, field.segments), getAtPath(right, field.segments)),
  )
}
