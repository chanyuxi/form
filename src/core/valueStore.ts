import type { CompiledField, CompiledSchema } from './formSchema'
import type { FieldPath } from './types'

import { cloneAndFreeze } from '@chanyuxi/utils/immutable'
import { isPlainObject } from '@chanyuxi/utils/object'
import {
  getPath,
  hasPath,
  setPath,
  updatePath,
} from '@chanyuxi/utils/path'

import {
  assertScalarValue,
} from './fieldPath'
import { FormCoreError, formErrorCode } from './formError'

export { shallowEqual as shallowObjectEqual } from '@chanyuxi/utils/object'

export function cloneContext<TContext extends object>(context: TContext): TContext {
  if (!isPlainObject(context)) {
    throw new FormCoreError(formErrorCode.invalidValue, 'Initial context must be a plain object.')
  }
  return cloneCoreValue(context, 'context')
}

export function cloneCoreValue<TValue>(value: TValue, path: string): TValue {
  try {
    return cloneAndFreeze(value, path)
  }
  catch (error) {
    if (error instanceof TypeError) {
      throw new FormCoreError(formErrorCode.invalidValue, error.message, { cause: error })
    }
    throw error
  }
}

export function findChangedValuePaths<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  left: TValues,
  right: TValues,
): Set<string> {
  return new Set(
    fields.flatMap(field =>
      Object.is(getPath(left, field.segments), getPath(right, field.segments))
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
    if (source !== undefined && hasPath(source, field.segments)) {
      value = getPath(source, field.segments)
    }
    else if (fallback !== undefined) {
      value = getPath(fallback, field.segments)
    }
    else if (source === undefined) {
      value = field.defaultValue
    }
    else {
      throw new FormCoreError(formErrorCode.invalidValue, `Value for field "${field.name}" is missing.`)
    }
    assertScalarValue(value, field.name)
    setPath(target, field.segments, value)
  }
  return cloneCoreValue(target, 'values') as TValues
}

export function patchTopLevelValues<
  TValues extends object,
  TContext extends object,
  TSubmitValues,
>(
  compiled: CompiledSchema<TValues, TContext, TSubmitValues>,
  current: TValues,
  patch: Partial<TValues>,
): TValues {
  if (!isPlainObject(patch)) {
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
      if (!hasPath(patch, field.segments)) {
        throw new FormCoreError(
          formErrorCode.invalidValue,
          `Top-level patch for "${root}" must contain field "${field.name}".`,
        )
      }
      const value = getPath(patch, field.segments)
      assertScalarValue(value, field.name)
      setPath(target, field.segments, value)
    }
    else {
      setPath(target, field.segments, getPath(current, field.segments))
    }
  }
  return cloneCoreValue(target, 'values') as TValues
}

export function replaceFieldValue<
  TValues extends object,
  TContext extends object,
  TSubmitValues,
>(
  compiled: CompiledSchema<TValues, TContext, TSubmitValues>,
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
  if (Object.is(getPath(current, field.segments), value)) {
    return current
  }

  return updatePath(current, field.segments, value)
}

export function valuesEqual<TValues extends object, TContext extends object>(
  fields: readonly CompiledField<TValues, TContext>[],
  left: TValues,
  right: TValues,
): boolean {
  return fields.every(field =>
    Object.is(getPath(left, field.segments), getPath(right, field.segments)),
  )
}
