import type { Plugin } from 'rollup'

import { execFile } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { nodeResolve } from '@rollup/plugin-node-resolve'
import * as typescriptModule from '@rollup/plugin-typescript'
import { rollup } from 'rollup'

import { rewriteDeclarationImports } from './rewriteDeclarationImports'

const typescript = typescriptModule.default as unknown as (
  options?: { tsconfig?: string },
) => Plugin

const execFileAsync = promisify(execFile)
const rootDirectory = fileURLToPath(new URL('../', import.meta.url))
const sourceDirectory = fileURLToPath(new URL('../src/', import.meta.url))
const distDirectory = fileURLToPath(new URL('../dist/', import.meta.url))
const typeScriptCli = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))

await rm(distDirectory, { force: true, recursive: true })

const bundle = await rollup({
  external: id => id.startsWith('@chanyuxi/utils'),
  input: fileURLToPath(new URL('../src/index', import.meta.url)),
  plugins: [
    nodeResolve({ extensions: ['.mjs', '.js', '.json', '.ts'] }),
    typescript({
      tsconfig: fileURLToPath(new URL('../tsconfig.rollup.json', import.meta.url)),
    }),
  ],
})

try {
  await bundle.write({
    dir: distDirectory,
    format: 'es',
    preserveModules: true,
    preserveModulesRoot: sourceDirectory,
    sourcemap: true,
  })
}
finally {
  await bundle.close()
}

await execFileAsync(
  process.execPath,
  [typeScriptCli, '-p', 'tsconfig.build.json'],
  { cwd: rootDirectory },
)

await rewriteDeclarationImports(distDirectory)
