import type {
  AnyCoreFieldDefinition,
  CoreSchema,
  FieldPath,
  ScalarValue,
  SchemaOptions,
  SchemaTransformContext,
} from './types'

import { assertScalarValue, parseFieldPath } from './fieldPath'
import { FormCoreError, formErrorCode } from './formError'

export interface CompiledField<
  TValues extends object,
  TContext extends object,
> {
  readonly defaultValue: ScalarValue
  readonly definition: AnyCoreFieldDefinition<TValues, TContext>
  readonly name: FieldPath<TValues>
  readonly segments: readonly string[]
}

export interface CompiledSchema<
  TValues extends object,
  TContext extends object,
  TSubmitValues = TValues,
> {
  readonly fieldMap: ReadonlyMap<string, CompiledField<TValues, TContext>>
  readonly fields: readonly CompiledField<TValues, TContext>[]
  readonly schema: CoreSchema<TValues, TContext, TSubmitValues>
  readonly transform: (
    context: SchemaTransformContext<TValues, TContext>,
  ) => TSubmitValues
}

export function compileSchema<
  TValues extends object,
  TContext extends object,
  TSubmitValues = TValues,
>(
  input: readonly AnyCoreFieldDefinition<TValues, TContext>[],
  options?: SchemaOptions<TValues, TContext, TSubmitValues>,
): CompiledSchema<TValues, TContext, TSubmitValues> {
  if (!Array.isArray(input)) {
    throw new FormCoreError(
      formErrorCode.invalidValue,
      'Schema fields must be an array.',
    )
  }

  const fields: CompiledField<TValues, TContext>[] = []
  const fieldMap = new Map<string, CompiledField<TValues, TContext>>()

  for (const candidate of input) {
    if (typeof candidate !== 'object' || candidate === null) {
      throw new FormCoreError(
        formErrorCode.invalidValue,
        'Every schema field must be an object.',
      )
    }

    const parsed = parseFieldPath(candidate.name)
    if (fieldMap.has(parsed.name)) {
      throw new FormCoreError(
        formErrorCode.duplicateField,
        `Field "${parsed.name}" is defined more than once.`,
      )
    }

    for (const existing of fields) {
      if (
        parsed.name.startsWith(`${existing.name}.`)
        || existing.name.startsWith(`${parsed.name}.`)
      ) {
        throw new FormCoreError(
          formErrorCode.pathConflict,
          `Field paths "${existing.name}" and "${parsed.name}" conflict.`,
        )
      }
    }

    if (!Object.prototype.hasOwnProperty.call(candidate, 'defaultValue')) {
      throw new FormCoreError(
        formErrorCode.invalidValue,
        `Field "${parsed.name}" must define defaultValue.`,
      )
    }
    assertScalarValue(candidate.defaultValue, parsed.name)

    if (
      candidate.validate !== undefined
      && typeof candidate.validate !== 'function'
    ) {
      throw new FormCoreError(
        formErrorCode.invalidValue,
        `Field "${parsed.name}" has an invalid validator.`,
      )
    }
    if (
      candidate.validateWhen !== undefined
      && typeof candidate.validateWhen !== 'function'
    ) {
      throw new FormCoreError(
        formErrorCode.invalidValue,
        `Field "${parsed.name}" has an invalid validateWhen rule.`,
      )
    }

    const definition = Object.freeze({
      ...candidate,
    }) as AnyCoreFieldDefinition<TValues, TContext>
    const field = {
      defaultValue: candidate.defaultValue as ScalarValue,
      definition,
      name: parsed.name as FieldPath<TValues>,
      segments: parsed.segments,
    }
    fields.push(field)
    fieldMap.set(parsed.name, field)
  }

  const normalizedFields = fields
  const schema = Object.freeze({
    fields: Object.freeze(normalizedFields.map(field => field.definition)),
  }) as CoreSchema<TValues, TContext, TSubmitValues>
  const transform = options?.transform
    ?? ((context: SchemaTransformContext<TValues, TContext>) => context.values as TSubmitValues)

  return { fieldMap, fields: normalizedFields, schema, transform }
}
