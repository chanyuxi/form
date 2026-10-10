import assert from 'node:assert/strict'

import { configureForms, FormCoreError, formErrorCode } from '@chanyuxi/form'
import { test } from 'vitest'

interface NameValues {
  name: string
}

function createNameForm(validate?: (value: string) => readonly { code: string, message: string }[]) {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()([
    {
      defaultValue: '',
      name: 'name',
      ...(validate === undefined
        ? {}
        : { validate: ({ value }) => validate(value) }),
    },
  ])
  return forms.create(schema)
}

test('submits a validated snapshot and records successful state', async () => {
  const form = createNameForm()
  form.setValue('name', 'Ada')

  const submission = form.submit(async (values, context) => {
    assert.equal(values.name, 'Ada')
    assert.ok(Object.isFrozen(values))
    assert.equal(context.inputsRevision, 1)
    return { id: 1 }
  })

  assert.equal(form.state.isSubmitting, true)
  assert.equal(form.state.isSubmitSuccessful, false)
  assert.equal(form.state.submitCount, 1)

  const result = await submission
  assert.deepEqual(result, {
    inputsRevision: 1,
    result: { id: 1 },
    status: 'success',
  })
  assert.equal(form.state.isSubmitted, true)
  assert.equal(form.state.isSubmitting, false)
  assert.equal(form.state.isSubmitSuccessful, true)
})

test('rejects concurrent submits as busy without incrementing submitCount', async () => {
  const form = createNameForm()
  let release!: () => void
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const first = form.submit(async () => {
    calls += 1
    await blocked
    return 'saved'
  })

  const second = await form.submit(() => {
    calls += 1
    return 'duplicate'
  })
  assert.deepEqual(second, { status: 'busy' })
  assert.equal(form.state.submitCount, 1)
  assert.equal(calls, 0)

  release()
  assert.equal((await first).status, 'success')
  assert.equal(calls, 1)
})

test('returns invalid without invoking the submit handler', async () => {
  const form = createNameForm(value => value === ''
    ? [{ code: 'required', message: 'Name is required' }]
    : [])
  let called = false

  const result = await form.submit(() => {
    called = true
  })

  assert.equal(result.status, 'invalid')
  assert.equal(called, false)
  assert.equal(form.state.isSubmitted, true)
  assert.equal(form.state.isSubmitting, false)
  assert.equal(form.state.isSubmitSuccessful, false)
})

test('returns stale when values change during submit validation', async () => {
  const form = createNameForm(() => [])
  let called = false
  const submission = form.submit(() => {
    called = true
  })

  form.setValue('name', 'changed')
  assert.deepEqual(await submission, { status: 'stale' })
  assert.equal(called, false)
  assert.equal(form.state.isSubmitted, false)
  assert.equal(form.state.isSubmitting, false)
  assert.equal(form.state.submitCount, 1)
})

test('returns error when transform or handler throws', async () => {
  const handlerForm = createNameForm()
  const handlerResult = await handlerForm.submit(() => {
    throw new Error('request failed')
  })
  assert.equal(handlerResult.status, 'error')
  if (handlerResult.status === 'error') {
    assert.match(String(handlerResult.error), /request failed/)
  }
  assert.equal(handlerForm.state.isSubmitted, true)

  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()(
    [{ defaultValue: '', name: 'name' }],
    {
      transform: () => Promise.resolve({ name: 'async' }) as never,
    },
  )
  const transformResult = await forms.create(schema).submit(() => undefined)
  assert.equal(transformResult.status, 'error')
  if (transformResult.status === 'error') {
    assert.ok(transformResult.error instanceof FormCoreError)
    assert.equal(transformResult.error.code, formErrorCode.asyncTransformUnsupported)
  }
})

test('reset aborts an active handler and clears submission state', async () => {
  const form = createNameForm()
  const submission = form.submit((_values, { signal }) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))

  await Promise.resolve()
  form.reset()

  assert.deepEqual(await submission, { status: 'aborted' })
  assert.equal(form.state.isSubmitted, false)
  assert.equal(form.state.isSubmitting, false)
  assert.equal(form.state.isSubmitSuccessful, false)
  assert.equal(form.state.submitCount, 0)
})

test('dispose aborts an active handler and retains a non-submitting debug snapshot', async () => {
  const form = createNameForm()
  const submission = form.submit((_values, { signal }) => new Promise<void>((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
  }))

  await Promise.resolve()
  form.dispose()

  assert.deepEqual(await submission, { status: 'aborted' })
  assert.equal(form.state.isSubmitting, false)
  assert.equal(form.state.isSubmitSuccessful, false)
})

test('edits during the handler do not mutate the submitted payload', async () => {
  const form = createNameForm()
  form.setValue('name', 'submitted')
  let release!: () => void
  let started!: () => void
  const handlerStarted = new Promise<void>((resolve) => {
    started = resolve
  })
  const blocked = new Promise<void>((resolve) => {
    release = resolve
  })
  let payloadName = ''

  const submission = form.submit(async (values) => {
    payloadName = values.name
    started()
    await blocked
    return 'saved'
  })
  await handlerStarted

  form.setValue('name', 'edited later')
  release()

  const result = await submission
  assert.equal(result.status, 'success')
  assert.equal(payloadName, 'submitted')
  assert.equal(form.values.name, 'edited later')
})

test('transforms input values into a distinct submit payload', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()(
    [{ defaultValue: '', name: 'name' }],
    {
      transform: ({ values }) => ({ displayName: values.name.trim() }),
    },
  )
  const form = forms.create(schema)
  form.setValue('name', '  Ada  ')

  const result = await form.submit((payload) => {
    const displayName: string = payload.displayName
    return displayName
  })

  assert.deepEqual(result, {
    inputsRevision: 1,
    result: 'Ada',
    status: 'success',
  })
  assert.equal(form.values.name, '  Ada  ')
})
