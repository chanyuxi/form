import assert from 'node:assert/strict'

import { configureForms } from '@chanyuxi/form'
import { test } from 'vitest'

interface FirstSecondValues {
  first: string
  second: string
}

interface NameValues {
  name: string
}

interface NumericValues {
  nan: number
  zero: number
}

interface ProfileValues {
  profile: {
    name: string
  }
}

test('copies complete value replacements before exposing them', () => {
  const forms = configureForms()
  const schema = forms.defineSchema<ProfileValues>()([
    { defaultValue: '', name: 'profile.name' },
  ])
  const form = forms.create(schema)
  const values = { profile: { name: 'Ada' } }

  form.setValues(values)
  values.profile.name = 'Mutated outside'

  assert.equal(form.getValue('profile.name'), 'Ada')
  assert.ok(Object.isFrozen(form.values))
  assert.ok(Object.isFrozen(form.values.profile))
})

test('does not read inherited values through schema paths', () => {
  const forms = configureForms()
  const schema = forms.defineSchema<ProfileValues>()([
    { defaultValue: '', name: 'profile.name' },
  ])
  const initialValues = Object.create({
    profile: { name: 'Inherited' },
  }) as ProfileValues
  const form = forms.create(schema, { initialValues })

  assert.equal(form.getValue('profile.name'), '')
})

test('restores validation status when a validator throws', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()([
    {
      defaultValue: '',
      name: 'name',
      validate: () => {
        throw new Error('validator failed')
      },
    },
  ])
  const form = forms.create(schema)

  await assert.rejects(form.validate(), /validator failed/)
  assert.equal(form.state.validationStatus, 'unvalidated')
  assert.equal(form.getField('name').state.validationStatus, 'unvalidated')
})

test('resetField aborts a form validation without leaving sibling fields validating', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<FirstSecondValues>()([
    { defaultValue: '', name: 'first', validate: () => [] },
    { defaultValue: '', name: 'second', validate: () => [] },
  ])
  const form = forms.create(schema)

  const validation = form.validate()
  assert.equal(form.state.validationStatus, 'validating')
  form.resetField('first')

  assert.equal((await validation).status, 'aborted')
  assert.equal(form.state.validationStatus, 'unvalidated')
  assert.equal(form.getField('first').state.validationStatus, 'unvalidated')
  assert.equal(form.getField('second').state.validationStatus, 'unvalidated')
})

test('keeps concurrent synchronous validation attempts deterministic', async () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NameValues>()([
    { defaultValue: 'Ada', name: 'name', validate: () => [] },
  ])
  const form = forms.create(schema)

  const [first, second] = await Promise.all([form.validate(), form.validate()])

  assert.equal(first.status, 'valid')
  assert.equal(second.status, 'valid')
  assert.equal(form.state.validationStatus, 'valid')
})

test('uses Object.is semantics for scalar dirty checks', () => {
  const forms = configureForms()
  const schema = forms.defineSchema<NumericValues>()([
    { defaultValue: Number.NaN, name: 'nan' },
    { defaultValue: 0, name: 'zero' },
  ])
  const form = forms.create(schema)
  const initial = form.state

  form.setValue('nan', Number.NaN)
  assert.equal(form.state, initial)

  form.setValue('zero', -0)
  assert.equal(form.state.dirtyFields.zero, true)
  form.setValue('zero', 0)
  assert.equal(form.state.dirtyFields.zero, false)
})
