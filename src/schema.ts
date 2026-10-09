import type {
  AnyCoreFieldDefinition,
  CoreSchema,
  FieldPath,
  ScalarValue,
} from './types.js'

import { FormCoreError } from './errors.js'
import { assertScalarValue, parseFieldPath } from './path.js'

export interface CompiledField<TValues extends object, TContext extends object> {
  readonly defaultValue: ScalarValue
  readonly definition: AnyCoreFieldDefinition<TValues, TContext>
  readonly name: FieldPath<TValues>
  readonly segments: readonly string[]
}

export interface CompiledSchema<TValues extends object, TContext extends object> {
  readonly fieldMap: ReadonlyMap<string, CompiledField<TValues, TContext>>
  readonly fields: readonly CompiledField<TValues, TContext>[]
  readonly schema: CoreSchema<TValues, TContext>
}

export function compileSchema<TValues extends object, TContext extends object>(
  input: readonly AnyCoreFieldDefinition<TValues, TContext>[],
): CompiledSchema<TValues, TContext> {
  if (!Array.isArray(input)) {
    throw new FormCoreError('INVALID_VALUE', 'Schema fields must be an array.')
  }

  const fields: CompiledField<TValues, TContext>[] = []
  const fieldMap = new Map<string, CompiledField<TValues, TContext>>()

  for (const candidate of input) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new FormCoreError('INVALID_VALUE', 'Every schema field must be an object.')
    }

    const parsed = parseFieldPath(candidate.name)
    if (fieldMap.has(parsed.name)) {
      throw new FormCoreError('DUPLICATE_FIELD', `Field "${parsed.name}" is defined more than once.`)
    }

    for (const existing of fields) {
      if (parsed.name.startsWith(`${existing.name}.`) || existing.name.startsWith(`${parsed.name}.`)) {
        throw new FormCoreError(
          'PATH_CONFLICT',
          `Field paths "${existing.name}" and "${parsed.name}" conflict.`,
        )
      }
    }

    if (!Object.prototype.hasOwnProperty.call(candidate, 'defaultValue')) {
      throw new FormCoreError('INVALID_VALUE', `Field "${parsed.name}" must define defaultValue.`)
    }
    assertScalarValue(candidate.defaultValue, parsed.name)

    if (candidate.validate !== undefined && typeof candidate.validate !== 'function') {
      throw new FormCoreError('INVALID_VALUE', `Field "${parsed.name}" has an invalid validator.`)
    }
    if (candidate.validateWhen !== undefined && typeof candidate.validateWhen !== 'function') {
      throw new FormCoreError('INVALID_VALUE', `Field "${parsed.name}" has an invalid validateWhen rule.`)
    }

    const definition = Object.freeze({ ...candidate }) as AnyCoreFieldDefinition<TValues, TContext>
    const field = Object.freeze({
      defaultValue: candidate.defaultValue as ScalarValue,
      definition,
      name: parsed.name as FieldPath<TValues>,
      segments: parsed.segments,
    })
    fields.push(field)
    fieldMap.set(parsed.name, field)
  }

  const normalizedFields = Object.freeze(fields)
  const schema = Object.freeze({
    fields: Object.freeze(normalizedFields.map(field => field.definition)),
  }) as CoreSchema<TValues, TContext>

  return Object.freeze({ fieldMap, fields: normalizedFields, schema })
}
