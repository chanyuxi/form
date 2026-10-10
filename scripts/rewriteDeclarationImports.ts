import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export async function rewriteDeclarationImports(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true })

  await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)

    if (entry.isDirectory()) {
      await rewriteDeclarationImports(path)
      return
    }

    if (!entry.name.endsWith('.d.ts') && !entry.name.endsWith('.js')) {
      return
    }

    const source = await readFile(path, 'utf8')
    const output = source.replace(
      /(['"])(\.{1,2}\/[^'"]+)\1/g,
      (_match, quote: string, specifier: string) => {
        const normalized = specifier.replace(/\.ts$/, '')
        const hasExtension = /\.(?:cjs|js|json|mjs)$/.test(normalized)
        return `${quote}${hasExtension ? normalized : `${normalized}.js`}${quote}`
      },
    )

    if (output !== source) {
      await writeFile(path, output)
    }
  }))
}
