import type { ConfigureFormsOptions } from '@chanyuxi/form'

import assert from 'node:assert/strict'

import { configureForms, FormCoreError, formErrorCode } from '@chanyuxi/form'
import { test } from 'vitest'

interface NameValues {
  name: string
}

interface TestValues {
  address: {
    city: string
    zip: number
  }
  age: null | number
  name: string
}

interface ValidationValues {
  kind: string
  taxId: string
}

const hasErrorCode = (code: string) => (error: unknown): boolean =>
  error instanceof FormCoreError && error.code === code

function makeForms(options?: ConfigureFormsOptions) {
  const forms = configureForms(options)
  const schema = forms.defineSchema<TestValues>()([
    { defaultValue: '', name: 'name' },
    { defaultValue: null, name: 'age' },
    { defaultValue: '', name: 'address.city' },
    { defaultValue: 0, name: 'address.zip' },
  ])
  return { forms, schema }
}

test('creates isolated forms and applies partial initial values over defaults', () => {
  const { forms, schema } = makeForms()
  const first = forms.create(schema, { initialValues: { address: { city: 'London' }, name: 'Ada' } })
  const second = forms.create(schema)

  assert.deepEqual(first.values, {
    address: { city: 'London', zip: 0 },
    age: null,
    name: 'Ada',
  })
  assert.deepEqual(second.values, {
    address: { city: '', zip: 0 },
    age: null,
    name: '',
  })

  const addressBeforeNameChange = first.values.address
  first.setValue('name', 'Grace')
  assert.equal(first.values.address, addressBeforeNameChange)
  assert.equal(second.getValue('name'), '')
  assert.equal(first.fields, first.fields)
  assert.ok(Object.isFrozen(schema))
  assert.ok(Object.isFrozen(schema.fields))
  assert.ok(Object.isFrozen(first.state))
  assert.ok(Object.isFrozen(first.state.errors))
  assert.ok(Object.isFrozen(first.values))
  assert.ok(Object.isFrozen(first.values.address))
})

test('rejects schemas from another system', () => {
  const first = makeForms()
  const second = configureForms()
  assert.throws(
    () => second.create(first.schema),
    error => error instanceof FormCoreError && error.code === formErrorCode.schemaSystemMismatch,
  )
})

test('normalizes field paths and rejects invalid definitions', () => {
  const forms = configureForms()
  const defineInvalidSchema = (fields: readonly unknown[]) =>
    forms.defineSchema<Record<string, string>>()(fields as never)

  assert.throws(
    () => defineInvalidSchema([
      { defaultValue: '', name: 'name' },
      { defaultValue: '', name: 'name' },
    ]),
    hasErrorCode(formErrorCode.duplicateField),
  )
  assert.throws(
    () => defineInvalidSchema([
      { defaultValue: '', name: 'profile' },
      { defaultValue: '', name: 'profile.name' },
    ]),
    hasErrorCode(formErrorCode.pathConflict),
  )
  for (const name of ['items.0', 'a..b', '__proto__.x', 'a\\.b']) {
    assert.throws(
      () => defineInvalidSchema([{ defaultValue: '', name }]),
      hasErrorCode(formErrorCode.invalidFieldName),
    )
  }
  assert.throws(
    () => defineInvalidSchema([{ defaultValue: {}, name: 'object' }]),
    hasErrorCode(formErrorCode.invalidValue),
  )
  for (const defaultValue of [1n, Symbol('unsupported')]) {
    assert.throws(
      () => defineInvalidSchema([{ defaultValue, name: 'unsupported' }]),
      hasErrorCode(formErrorCode.invalidValue),
    )
  }
})

test('keeps snapshots stable for no-op writes and tracks dirty, touched, and baselines', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  let notifications = 0
  form.subscribe(() => {
    notifications += 1
  })

  const initial = form.state
  form.setValue('name', '')
  assert.equal(form.state, initial)
  assert.equal(notifications, 0)

  form.setValue('name', 'Ada')
  assert.equal(form.state.isDirty, true)
  assert.equal(form.state.dirtyFields.name, true)
  assert.equal(form.state.touchedFields.name, false)
  assert.equal(notifications, 1)

  form.markTouched('name')
  assert.equal(form.state.touchedFields.name, true)
  form.setDefaultValues({ name: 'Ada' })
  assert.equal(form.getValue('name'), 'Ada')
  assert.equal(form.state.isDirty, false)

  form.setValue('name', 'Grace')
  form.resetField('name')
  assert.equal(form.getValue('name'), 'Ada')
  assert.equal(form.getField('name').state.isTouched, false)
})

test('implements reset baseline modes', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  form.setValue('name', 'Ada')
  form.setError('name', { code: 'server', message: 'Taken' })
  form.markTouched('name')

  form.reset({
    values: { address: { city: '', zip: 0 }, age: null, name: 'Grace' },
  })
  assert.equal(form.getValue('name'), 'Grace')
  assert.equal(form.defaultValues.name, 'Grace')
  assert.equal(form.state.isDirty, false)
  assert.equal(form.state.errors.length, 0)
  assert.equal(form.state.touchedFields.name, false)

  form.reset({
    asDefaults: false,
    values: { address: { city: '', zip: 0 }, age: null, name: 'Lin' },
  })
  assert.equal(form.defaultValues.name, 'Grace')
  assert.equal(form.state.isDirty, true)

  form.reset()
  assert.equal(form.getValue('name'), 'Grace')
  assert.equal(form.state.isDirty, false)
})

test('commits transactions atomically and rejects failed, nested, and async transactions', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  const snapshots: unknown[] = []
  form.subscribe(() => snapshots.push(form.values))

  form.transaction((tx) => {
    assert.equal(tx.values.name, '')
    tx.setValue('name', 'Ada')
    tx.setValue('age', 36)
  })
  assert.equal(snapshots.length, 1)
  assert.deepEqual(snapshots[0], {
    address: { city: '', zip: 0 },
    age: 36,
    name: 'Ada',
  })

  assert.throws(() => form.transaction((tx) => {
    tx.setValue('name', 'Discarded')
    throw new Error('rollback')
  }), /rollback/)
  assert.equal(form.getValue('name'), 'Ada')

  assert.throws(
    () => form.transaction(() => form.transaction(() => {})),
    hasErrorCode(formErrorCode.nestedTransaction),
  )
  assert.throws(
    () => form.transaction(async (tx) => { tx.setValue('name', 'Async') }),
    hasErrorCode(formErrorCode.asyncTransaction),
  )
  assert.equal(form.getValue('name'), 'Ada')
})

test('queues writes made during notification and isolates field subscriptions', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  const name = form.getField('name')
  const age = form.getField('age')
  let nameNotifications = 0
  let ageNotifications = 0
  name.subscribe(() => {
    nameNotifications += 1
  })
  age.subscribe(() => {
    ageNotifications += 1
  })

  let rewrote = false
  form.subscribe(() => {
    if (!rewrote && form.getValue('name') === 'Ada') {
      rewrote = true
      form.setValue('name', 'Grace')
    }
  })
  form.setValue('name', 'Ada')

  assert.equal(form.getValue('name'), 'Grace')
  assert.equal(nameNotifications, 2)
  assert.equal(ageNotifications, 0)
  assert.equal(form.getField('name'), name)
})

test('queues notification writes after an atomic transaction commit', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  const observed: Array<[string, null | number]> = []
  let rewrote = false
  form.subscribe(() => {
    observed.push([form.getValue('name'), form.getValue('age')])
    if (!rewrote) {
      rewrote = true
      form.setValue('name', 'Grace')
    }
  })

  form.transaction((tx) => {
    tx.setValue('name', 'Ada')
    tx.setValue('age', 36)
  })

  assert.deepEqual(observed, [
    ['Ada', 36],
    ['Grace', 36],
  ])
})

test('continues notifying after subscriber errors and leaves state committed', () => {
  const reported: AggregateError[] = []
  const { forms, schema } = makeForms({
    onSubscriberError: error => reported.push(error),
  })
  const form = forms.create(schema)
  let observed = false
  form.subscribe(() => {
    throw new Error('listener failed')
  })
  form.subscribe(() => {
    observed = true
  })

  form.setValue('name', 'Ada')
  assert.equal(observed, true)
  assert.equal(form.getValue('name'), 'Ada')
  assert.equal(reported.length, 1)
  assert.ok(reported[0] instanceof AggregateError)
})

test('copies plain context data and rejects unsupported mutable instances', () => {
  const forms = configureForms<{
    createdAt?: Date
    limits?: { minimum: number }
    options?: string[]
  }>()
  const schema = forms.defineSchema<NameValues>()([
    { defaultValue: '', name: 'name' },
  ])
  const initialContext = {
    limits: { minimum: 18 },
    options: ['A', 'B'],
  }
  const form = forms.create(schema, { initialContext })

  initialContext.limits.minimum = 21
  initialContext.options.push('C')
  assert.deepEqual(form.context, {
    limits: { minimum: 18 },
    options: ['A', 'B'],
  })
  assert.ok(Object.isFrozen(form.context))
  assert.ok(Object.isFrozen(form.context.limits))
  assert.ok(Object.isFrozen(form.context.options))

  assert.throws(
    () => forms.create(schema, { initialContext: { createdAt: new Date() } }),
    hasErrorCode(formErrorCode.invalidValue),
  )
})

test('runs explicit validation, respects validateWhen, and preserves manual errors on input', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<ValidationValues>()([
    {
      defaultValue: 'person',
      name: 'kind',
    },
    {
      defaultValue: '',
      name: 'taxId',
      validate: ({ value }) => value === ''
        ? [{ code: 'required', message: 'Tax ID is required' }]
        : [],
      validateWhen: ({ values }) => values.kind === 'company',
    },
  ])
  const form = forms.create(schema)

  assert.equal(form.state.validationStatus, 'unvalidated')
  assert.equal((await form.validate()).status, 'valid')
  assert.equal(form.state.validationStatus, 'valid')

  form.setValue('kind', 'company')
  assert.equal(form.state.validationStatus, 'unvalidated')
  const invalid = await form.validate()
  assert.equal(invalid.status, 'invalid')
  assert.equal(form.getField('taxId').state.errors[0]?.source, 'validation')

  form.setError('taxId', { code: 'manual', message: 'Manual issue' })
  form.setValue('taxId', '123')
  assert.equal(form.getField('taxId').state.errors.length, 1)
  assert.equal(form.getField('taxId').state.errors[0]?.source, 'manual')
  await form.validateField('taxId')
  form.clearErrors('taxId', { source: 'manual' })
  assert.equal(form.hasError('taxId'), false)
  assert.equal(form.getField('taxId').state.validationStatus, 'valid')
})

test('returns stale or aborted for invalidated validation tickets', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()([
    { defaultValue: '', name: 'name', validate: () => [] },
  ])

  const staleForm = forms.create(schema)
  const staleValidation = staleForm.validate()
  staleForm.setValue('name', 'Ada')
  assert.equal((await staleValidation).status, 'stale')

  const abortedForm = forms.create(schema)
  const abortedValidation = abortedForm.validate()
  abortedForm.reset()
  assert.equal((await abortedValidation).status, 'aborted')
})

test('rejects async P0 validators and restores unvalidated status', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()([
    { defaultValue: '', name: 'name', validate: (() => Promise.resolve([])) as never },
  ])
  const form = forms.create(schema)
  await assert.rejects(
    form.validate(),
    hasErrorCode(formErrorCode.asyncValidationUnsupported),
  )
  assert.equal(form.state.validationStatus, 'unvalidated')
})

test('dispose is idempotent, preserves reads, and rejects commands', () => {
  const { forms, schema } = makeForms()
  const form = forms.create(schema)
  form.setValue('name', 'Ada')
  const snapshot = form.state
  form.dispose()
  form.dispose()

  assert.equal(form.state, snapshot)
  assert.equal(form.getValue('name'), 'Ada')
  assert.throws(
    () => form.setValue('name', 'Grace'),
    hasErrorCode(formErrorCode.formDisposed),
  )
})
