import type { ScalarValue } from './types.js'

import { FormCoreError } from './errors.js'

const dangerousSegments = new Set(['__proto__', 'constructor', 'prototype'])

export interface ParsedPath {
  readonly name: string
  readonly segments: readonly string[]
}

export function assertScalarValue(value: unknown, path: string): asserts value is ScalarValue {
  if (!isScalarValue(value)) {
    throw new FormCoreError('INVALID_VALUE', `Field "${path}" only supports scalar values in P0.`)
  }
}

export function cloneAndFreeze<TValue>(value: TValue): TValue {
  if (Array.isArray(value)) {
    return Object.freeze(value.map(item => cloneAndFreeze(item))) as TValue
  }

  if (isPlainRecord(value)) {
    const clone: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      clone[key] = cloneAndFreeze(child)
    }
    return Object.freeze(clone) as TValue
  }

  return value
}

export function getAtPath(source: unknown, segments: readonly string[]): unknown {
  let current = source
  for (const segment of segments) {
    if (!isRecord(current)) {
      return undefined
    }
    current = current[segment]
  }
  return current
}

export function hasAtPath(source: unknown, segments: readonly string[]): boolean {
  let current = source
  for (const segment of segments) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return false
    }
    current = current[segment]
  }
  return true
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isScalarValue(value: unknown): value is ScalarValue {
  return value === null || (typeof value !== 'object' && typeof value !== 'function')
}

export function parseFieldPath(name: unknown): ParsedPath {
  if (typeof name !== 'string' || name.length === 0 || name.includes('\\')) {
    throw new FormCoreError('INVALID_FIELD_NAME', `Invalid field name: ${String(name)}`)
  }

  const segments = name.split('.')
  for (const segment of segments) {
    if (segment.length === 0 || /^\d+$/.test(segment) || dangerousSegments.has(segment)) {
      throw new FormCoreError('INVALID_FIELD_NAME', `Invalid field name: ${name}`)
    }
  }

  return Object.freeze({ name, segments: Object.freeze(segments) })
}

export function setAtPath(target: Record<string, unknown>, segments: readonly string[], value: unknown): void {
  let current = target
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index]
    if (segment === undefined) {
      throw new FormCoreError('INVALID_FIELD_NAME', 'A field path cannot be empty.')
    }
    const existing = current[segment]
    if (!isRecord(existing)) {
      current[segment] = {}
    }
    current = current[segment] as Record<string, unknown>
  }

  const leaf = segments.at(-1)
  if (leaf === undefined) {
    throw new FormCoreError('INVALID_FIELD_NAME', 'A field path cannot be empty.')
  }
  current[leaf] = value
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) {
    return false
  }
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
