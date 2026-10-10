import type { ScalarValue } from './types'

import { FormCoreError, formErrorCode } from './formError'

const dangerousSegments = new Set(['__proto__', 'constructor', 'prototype'])

export interface ParsedPath {
  readonly name: string
  readonly segments: readonly string[]
}

export function assertScalarValue(
  value: unknown,
  path: string,
): asserts value is ScalarValue {
  if (!isScalarValue(value)) {
    throw new FormCoreError(
      formErrorCode.invalidValue,
      `Field "${path}" only supports scalar values in P0.`,
    )
  }
}

export function cloneAndFreeze<TValue>(value: TValue, path = 'value'): TValue {
  if (isScalarValue(value)) {
    return value
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map((item, index) => cloneAndFreeze(item, `${path}[${index}]`)),
    ) as TValue
  }

  if (isPlainRecord(value)) {
    const clone: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (dangerousSegments.has(key)) {
        throw new FormCoreError(
          formErrorCode.invalidValue,
          `Unsafe object key at ${path}.${key}.`,
        )
      }
      clone[key] = cloneAndFreeze(child, `${path}.${key}`)
    }
    return Object.freeze(clone) as TValue
  }

  throw new FormCoreError(
    formErrorCode.invalidValue,
    `Unsupported non-plain value at ${path}.`,
  )
}

export function getAtPath(
  source: unknown,
  segments: readonly string[],
): unknown {
  let current = source
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

export function hasAtPath(
  source: unknown,
  segments: readonly string[],
): boolean {
  let current = source
  for (const segment of segments) {
    if (
      !isRecord(current)
      || !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      return false
    }
    current = current[segment]
  }
  return true
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isScalarValue(value: unknown): value is ScalarValue {
  return (
    value === null
    || value === undefined
    || typeof value === 'boolean'
    || typeof value === 'number'
    || typeof value === 'string'
  )
}

export function parseFieldPath(name: unknown): ParsedPath {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\\')) {
    throw new FormCoreError(
      formErrorCode.invalidFieldName,
      `Invalid field name: ${String(name)}`,
    )
  }

  const segments = name.split('.')
  for (const segment of segments) {
    if (
      segment.length === 0
      || /^\d+$/.test(segment)
      || dangerousSegments.has(segment)
    ) {
      throw new FormCoreError(
        formErrorCode.invalidFieldName,
        `Invalid field name: ${name}`,
      )
    }
  }

  return { name, segments }
}

export function replaceAtPath<TValue>(
  source: TValue,
  segments: readonly string[],
  value: unknown,
): TValue {
  const replace = (current: unknown, index: number): unknown => {
    const segment = segments[index]
    if (segment === undefined) {
      return value
    }
    if (!isPlainRecord(current)) {
      throw new FormCoreError(
        formErrorCode.invalidValue,
        `Cannot update non-plain value at ${segments.slice(0, index).join('.')}.`,
      )
    }

    const previous = current[segment]
    const next = replace(previous, index + 1)
    if (Object.is(previous, next)) {
      return current
    }
    return Object.freeze({ ...current, [segment]: next })
  }

  return replace(source, 0) as TValue
}

export function setAtPath(
  target: Record<string, unknown>,
  segments: readonly string[],
  value: unknown,
): void {
  let current = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment === undefined) {
      throw new FormCoreError(
        formErrorCode.invalidFieldName,
        'A field path cannot be empty.',
      )
    }
    const existing = current[segment]
    if (!isRecord(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  const leaf = segments.at(-1)
  if (leaf === undefined) {
    throw new FormCoreError(
      formErrorCode.invalidFieldName,
      'A field path cannot be empty.',
    )
  }
  current[leaf] = value
}
