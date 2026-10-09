import type {
  AnyCoreFieldDefinition,
  CompleteFieldDefinitions,
  CoreSchema,
  CoreSystem,
  CreateOptions,
  FormInstance,
} from './types.js'

import { FormCoreError } from './errors.js'
import { FormRuntime } from './runtime.js'
import { compileSchema } from './schema.js'

export function createSystem<
  TContext extends object = Record<never, never>,
>(): CoreSystem<TContext> {
  const schemas = new WeakMap<object, ReturnType<typeof compileSchema<object, TContext>>>()

  const defineSchema = <TValues extends object>() => <
    const TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
  >(
    fields: CompleteFieldDefinitions<TValues, TFields, TContext>,
  ): CoreSchema<TValues, TContext> => {
    const compiled = compileSchema<TValues, TContext>(fields)
    schemas.set(
      compiled.schema,
      compiled as unknown as ReturnType<typeof compileSchema<object, TContext>>,
    )
    return compiled.schema
  }

  const create = <TValues extends object>(
    schema: CoreSchema<TValues, TContext>,
    options?: CreateOptions<TValues, TContext>,
  ): FormInstance<TValues, TContext> => {
    const compiled = schemas.get(schema)
    if (compiled === undefined) {
      throw new FormCoreError(
        'SCHEMA_SYSTEM_MISMATCH',
        'This schema was not created by the current Core System.',
      )
    }
    return new FormRuntime(
      compiled as unknown as ReturnType<typeof compileSchema<TValues, TContext>>,
      options,
    )
  }

  return Object.freeze({ create, defineSchema }) as CoreSystem<TContext>
}
