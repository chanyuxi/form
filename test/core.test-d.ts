import type { FieldPath, FieldValue, FormState } from '../src/index'

import { configureForms } from '../src/index'

interface InvalidNestedValues {
  optionalProfile?: {
    name: string
  }
  profile: {
    name: string
  } | null
}

interface ProfileContext {
  minimumAge: number
}

type ProfilePath = FieldPath<ProfileValues>

interface ProfileValues {
  address: {
    city: string
    zip: number
  }
  age: null | number
  name: string
}
const validPath: ProfilePath = 'address.city'
void validPath

// @ts-expect-error unknown path
const invalidPath: ProfilePath = 'address.country'
void invalidPath

const validCity: FieldValue<ProfileValues, 'address.city'> = 'Shanghai'
void validCity

// @ts-expect-error field value must match its path
const invalidCity: FieldValue<ProfileValues, 'address.city'> = 200000
void invalidCity

// @ts-expect-error nullable containers cannot expose child field paths
const invalidNullablePath: FieldPath<InvalidNestedValues> = 'profile.name'
void invalidNullablePath

// @ts-expect-error optional containers cannot expose child field paths
const invalidOptionalPath: FieldPath<InvalidNestedValues> = 'optionalProfile.name'
void invalidOptionalPath

const forms = configureForms<ProfileContext>()
const schema = forms.defineSchema<ProfileValues>()([
  {
    defaultValue: '',
    name: 'name',
  },
  {
    defaultValue: null,
    name: 'age',
    validate: ({ context, value }) => {
      const age: null | number = value
      const minimumAge: number = context.minimumAge
      return age === null || age < minimumAge
        ? [{ code: 'minimum', message: 'Too young' }]
        : []
    },
  },
  {
    defaultValue: '',
    name: 'address.city',
  },
  {
    defaultValue: 0,
    name: 'address.zip',
  },
])

const form = forms.create(schema, {
  initialContext: { minimumAge: 18 },
  initialValues: { address: { city: 'Shanghai' } },
})

form.setValue('name', 'Jason')
form.setValue('age', 28)
form.getField('address.city').set('Hangzhou')
form.clearErrors('name', { source: 'manual' })
form.getField('name').clearErrors({ source: 'validation' })

const state: FormState<ProfileValues> = form.state
const minimumAge: number = form.context.minimumAge
const defaultName: string = form.defaultValues.name
const fieldValue: string = form.getField('name').value
const fieldDefaultValue: string = form.getField('name').defaultValue
const fieldDirty: boolean = form.getField('name').isDirty
const fieldHasError: boolean = form.getField('name').hasError
const fields = form.fields
void state
void minimumAge
void defaultName
void fieldValue
void fieldDefaultValue
void fieldDirty
void fieldHasError
void fields

// @ts-expect-error wrong value type
form.setValue('name', 123)

// @ts-expect-error unknown field
form.getValue('unknown')

// @ts-expect-error error sources are a closed protocol
form.clearErrors('name', { source: 'custom' })

// @ts-expect-error context is required for non-empty context models
forms.create(schema)

const baseForms = configureForms()

// @ts-expect-error schema must cover every scalar leaf path
baseForms.defineSchema<ProfileValues>()([
  { defaultValue: '', name: 'name' },
])

baseForms.defineSchema<ProfileValues>()([
  { defaultValue: '', name: 'name' },
  // @ts-expect-error default value must match the field path
  { defaultValue: 'wrong', name: 'age' },
  { defaultValue: '', name: 'address.city' },
  { defaultValue: 0, name: 'address.zip' },
])
