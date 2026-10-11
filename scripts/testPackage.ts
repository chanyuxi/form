import { spawnSync } from 'node:child_process'
import {
  access,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const forbiddenRuntimeDependencies = [
  '@hookform/resolvers',
  'react',
  'react-dom',
  'react-hook-form',
  'solid-js',
  'vue',
]
const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const typeScriptCli = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const packageManagerCli = process.env.npm_execpath

if (packageManagerCli === undefined) {
  throw new Error('Package smoke tests must run through pnpm.')
}

function assertAllowedDependency(specifier: string, location: string): void {
  const forbidden = forbiddenRuntimeDependencies.find(dependency =>
    specifier === dependency || specifier.startsWith(`${dependency}/`),
  )
  if (forbidden !== undefined) {
    throw new Error(`Forbidden Core dependency "${specifier}" found in ${location}.`)
  }
}

async function assertCoreImportGraph(packageDirectory: string): Promise<void> {
  const packageJson = JSON.parse(
    await readFile(join(packageDirectory, 'package.json'), 'utf8'),
  ) as {
    readonly dependencies?: Readonly<Record<string, string>>
    readonly optionalDependencies?: Readonly<Record<string, string>>
    readonly peerDependencies?: Readonly<Record<string, string>>
  }
  const productionDependencies = {
    ...packageJson.dependencies,
    ...packageJson.optionalDependencies,
    ...packageJson.peerDependencies,
  }
  for (const dependency of Object.keys(productionDependencies)) {
    assertAllowedDependency(dependency, 'package manifest')
  }

  const files = await collectFiles(join(packageDirectory, 'dist'))
  for (const file of files) {
    if (!file.endsWith('.js') && !file.endsWith('.d.ts')) {
      continue
    }
    const source = await readFile(file, 'utf8')
    for (const specifier of importSpecifiers(source)) {
      assertAllowedDependency(specifier, file)
    }
  }
}

async function assertMissing(path: string): Promise<void> {
  try {
    await access(path)
  }
  catch {
    return
  }
  throw new Error(`Unexpected package entry: ${path}`)
}

async function assertPackageContents(packageDirectory: string): Promise<void> {
  await Promise.all([
    access(join(packageDirectory, 'dist', 'index.d.ts')),
    access(join(packageDirectory, 'dist', 'index.js')),
    access(join(packageDirectory, 'package.json')),
  ])
  await Promise.all([
    assertMissing(join(packageDirectory, 'FORM_RFC.md')),
    assertMissing(join(packageDirectory, 'src')),
    assertMissing(join(packageDirectory, 'test')),
  ])
}

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? collectFiles(path) : [path]
  }))
  return files.flat()
}

function importSpecifiers(source: string): string[] {
  const pattern = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)['"]([^'"]+)['"]/g
  return [...source.matchAll(pattern)].flatMap(match => match[1] === undefined ? [] : [match[1]])
}

async function main(): Promise<void> {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'chanyuxi-form-package-'))

  try {
    const artifactsDirectory = join(temporaryDirectory, 'artifacts')
    const consumerDirectory = join(temporaryDirectory, 'consumer')
    await Promise.all([
      mkdir(artifactsDirectory),
      mkdir(consumerDirectory),
    ])

    runPackageManager(['pack', '--pack-destination', artifactsDirectory], rootDirectory)
    const archives = (await readdir(artifactsDirectory)).filter(name => name.endsWith('.tgz'))
    if (archives.length !== 1) {
      throw new Error(`Expected one package archive, received ${archives.length}.`)
    }

    const archiveName = archives[0]!
    await Promise.all([
      writeFile(
        join(consumerDirectory, 'package.json'),
        JSON.stringify({
          dependencies: {
            '@chanyuxi/form': `file:../artifacts/${archiveName}`,
          },
          name: 'form-package-smoke-test',
          packageManager: 'pnpm@12.10.1',
          private: true,
          type: 'module',
          version: '0.0.0',
        }, undefined, 2),
      ),
      writeFile(
        join(consumerDirectory, 'runtime-smoke.mjs'),
        runtimeSmokeSource,
      ),
      writeFile(
        join(consumerDirectory, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            module: 'NodeNext',
            moduleResolution: 'NodeNext',
            noEmit: true,
            strict: true,
            target: 'ES2022',
          },
          include: ['type-smoke.ts'],
        }, undefined, 2),
      ),
      writeFile(
        join(consumerDirectory, 'type-smoke.ts'),
        typeSmokeSource,
      ),
    ])

    runPackageManager(['install', '--ignore-scripts'], consumerDirectory)

    const installedPackageDirectory = join(
      consumerDirectory,
      'node_modules',
      '@chanyuxi',
      'form',
    )
    await assertPackageContents(installedPackageDirectory)
    await assertCoreImportGraph(installedPackageDirectory)

    run(process.execPath, [typeScriptCli, '-p', 'tsconfig.json'], consumerDirectory)
    run(process.execPath, ['runtime-smoke.mjs'], consumerDirectory)
  }
  finally {
    await rm(temporaryDirectory, { force: true, recursive: true })
  }
}

function run(command: string, arguments_: readonly string[], cwd: string): void {
  const result = spawnSync(command, arguments_, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
  })
  if (result.error !== undefined) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error([
      `Command failed: ${command} ${arguments_.join(' ')}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'))
  }
}

function runPackageManager(arguments_: readonly string[], cwd: string): void {
  if (/\.[cm]?js$/u.test(packageManagerCli!)) {
    run(process.execPath, [packageManagerCli!, ...arguments_], cwd)
    return
  }
  run(packageManagerCli!, arguments_, cwd)
}

const runtimeSmokeSource = `
import { configureForms, formErrorCode } from '@chanyuxi/form'

const forms = configureForms()
const schema = forms.defineSchema()([
  {
    defaultValue: '',
    name: 'name',
    validate: ({ value }) => value === ''
      ? [{ code: 'required', message: 'Name is required' }]
      : [],
  },
])
const form = forms.create(schema)
const initialSnapshot = form.state

form.setValue('name', '')
if (form.state !== initialSnapshot) {
  throw new Error('A no-op write replaced the cached snapshot.')
}

form.setValue('name', 'Ada')
if (form.getValue('name') !== 'Ada' || !form.state.isDirty) {
  throw new Error('The installed package failed to update field state.')
}

const validation = await form.validate()
if (validation.status !== 'valid') {
  throw new Error('The installed package failed validation.')
}

const submission = await form.submit(payload => ({ saved: payload.name }))
if (submission.status !== 'success' || submission.result.saved !== 'Ada') {
  throw new Error('The installed package failed submission.')
}

form.dispose()
try {
  form.setValue('name', 'Grace')
  throw new Error('A disposed form accepted a write.')
}
catch (error) {
  if (error?.code !== formErrorCode.formDisposed) {
    throw error
  }
}
`

const typeSmokeSource = `
import { configureForms } from '@chanyuxi/form'

interface Values {
  age: number | null
  profile: {
    name: string
  }
}

const forms = configureForms<{ minimumAge: number }>()
const schema = forms.defineSchema<Values>()(
  [
    {
      defaultValue: null,
      name: 'age',
      validate: ({ context, value }) => value === null || value < context.minimumAge
        ? [{ code: 'minimum', message: 'Too young' }]
        : [],
    },
    { defaultValue: '', name: 'profile.name' },
  ],
  {
    transform: ({ values }) => ({ displayName: values.profile.name }),
  },
)
const form = forms.create(schema, {
  defaultValues: { profile: { name: 'Anonymous' } },
  initialContext: { minimumAge: 18 },
  initialValues: { profile: { name: 'Ada' } },
  mode: 'onTouched',
})

form.setValue('profile.name', 'Ada')
form.setValue('age', 36)

// @ts-expect-error field values remain path-specific in the published declarations
form.setValue('profile.name', 36)

// @ts-expect-error unknown fields are rejected by the published declarations
form.getValue('unknown')

void form.submit((payload) => {
  const displayName: string = payload.displayName
  return displayName
})
`

await main()
