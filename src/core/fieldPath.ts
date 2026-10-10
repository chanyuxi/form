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
