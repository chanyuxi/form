import type { FieldPath, FieldValue } from '../src/index'

interface DeepValues {
  account: {
    contact: {
      address: {
        location: {
          city: string
          postcode: number
        }
      }
    }
  }
}

interface WideValues {
  field01: string
  field02: string
  field03: string
  field04: string
  field05: string
  field06: string
  field07: string
  field08: string
  field09: string
  field10: string
  field11: string
  field12: string
  field13: string
  field14: string
  field15: string
  field16: string
  field17: string
  field18: string
  field19: string
  field20: string
}

const deepPath: FieldPath<DeepValues> = 'account.contact.address.location.city'
const deepValue: FieldValue<DeepValues, typeof deepPath> = 'Shanghai'
const widePath: FieldPath<WideValues> = 'field20'

void deepPath
void deepValue
void widePath

// @ts-expect-error deep paths remain exact
const invalidDeepPath: FieldPath<DeepValues> = 'account.contact.city'
void invalidDeepPath

// @ts-expect-error wide field values retain their scalar contract
const invalidWideValue: FieldValue<WideValues, 'field10'> = 10
void invalidWideValue
