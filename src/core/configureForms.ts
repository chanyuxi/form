import type {
  AnyCoreFieldDefinition,
  CompleteFieldDefinitions,
  ConfigureFormsOptions,
  CoreSchema,
  CreateOptions,
  FormInstance,
  FormSystem,
  SchemaOptions,
} from './types'

import { FormCoreError, formErrorCode } from './formError'
import { FormRuntime } from './formRuntime'
import { compileSchema } from './formSchema'

export function configureForms<
  TContext extends object = Record<never, never>,
>(config: ConfigureFormsOptions = {}): FormSystem<TContext> {
  const schemas = new WeakMap<object, ReturnType<typeof compileSchema<object, TContext, unknown>>>()
  const onSubscriberError = config.onSubscriberError ?? reportSubscriberError

  const defineSchema = <TValues extends object>() => <
    const TFields extends readonly AnyCoreFieldDefinition<TValues, TContext>[],
    TSubmitValues = TValues,
  >(
    fields: CompleteFieldDefinitions<TValues, TFields, TContext>,
    options?: SchemaOptions<TValues, TContext, TSubmitValues>,
  ): CoreSchema<TValues, TContext, TSubmitValues> => {
    const compiled = compileSchema<TValues, TContext, TSubmitValues>(fields, options)
    schemas.set(
      compiled.schema,
      compiled as unknown as ReturnType<typeof compileSchema<object, TContext, unknown>>,
    )
    return compiled.schema
  }

  const create = <TValues extends object, TSubmitValues = TValues>(
    schema: CoreSchema<TValues, TContext, TSubmitValues>,
    options?: CreateOptions<TValues, TContext>,
  ): FormInstance<TValues, TContext, TSubmitValues> => {
    const compiled = schemas.get(schema)
    if (compiled === undefined) {
      throw new FormCoreError(
        formErrorCode.schemaSystemMismatch,
        'This schema was not created by the current Core System.',
      )
    }
    return new FormRuntime(
      compiled as unknown as ReturnType<typeof compileSchema<TValues, TContext, TSubmitValues>>,
      onSubscriberError,
      options,
    )
  }

  return Object.freeze({ create, defineSchema }) as FormSystem<TContext>
}

function reportSubscriberError(error: AggregateError): void {
  queueMicrotask(() => {
    throw error
  })
}
