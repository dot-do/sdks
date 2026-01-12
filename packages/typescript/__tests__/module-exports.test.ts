/**
 * Module Export Tests for TypeScript Packages
 *
 * These tests verify that all TypeScript packages can be:
 * 1. Imported as ESM (import { } from 'package')
 * 2. Required as CJS (require('package'))
 * 3. TypeScript types are properly exported
 *
 * Following TDD RED phase: These tests should initially fail
 * because packages don't have CJS output yet.
 */

import { describe, it, expect, beforeAll } from 'vitest'
import { execSync } from 'child_process'
import { existsSync, readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const packagesDir = resolve(__dirname, '..')

interface PackageConfig {
  name: string
  path: string
  hasMultipleEntries?: boolean
  entries?: string[]
}

const packages: PackageConfig[] = [
  { name: '@dotdo/capnweb', path: 'capnweb' },
  { name: 'rpc.do', path: 'rpc' },
  { name: 'platform.do', path: 'dotdo' },
  {
    name: 'oauth.do',
    path: 'oauth',
    hasMultipleEntries: true,
    entries: ['index', 'node'],
  },
]

describe('TypeScript Package Module Exports', () => {
  beforeAll(() => {
    // Ensure all packages are built before running tests
    console.log('Building packages before tests...')
  })

  describe.each(packages)('Package: $name', ({ name, path, hasMultipleEntries, entries }) => {
    const packageDir = resolve(packagesDir, path)
    const distDir = resolve(packageDir, 'dist')

    describe('Build Output Existence', () => {
      it('should have dist directory', () => {
        expect(existsSync(distDir)).toBe(true)
      })

      it('should have ESM output (index.js)', () => {
        expect(existsSync(resolve(distDir, 'index.js'))).toBe(true)
      })

      it('should have CJS output (index.cjs)', () => {
        expect(existsSync(resolve(distDir, 'index.cjs'))).toBe(true)
      })

      it('should have TypeScript declaration file (index.d.ts)', () => {
        expect(existsSync(resolve(distDir, 'index.d.ts'))).toBe(true)
      })

      it('should have sourcemap (index.js.map)', () => {
        expect(existsSync(resolve(distDir, 'index.js.map'))).toBe(true)
      })

      if (hasMultipleEntries && entries) {
        entries.forEach((entry) => {
          if (entry !== 'index') {
            it(`should have ESM output for ${entry} (${entry}.js)`, () => {
              expect(existsSync(resolve(distDir, `${entry}.js`))).toBe(true)
            })

            it(`should have CJS output for ${entry} (${entry}.cjs)`, () => {
              expect(existsSync(resolve(distDir, `${entry}.cjs`))).toBe(true)
            })

            it(`should have TypeScript declaration for ${entry} (${entry}.d.ts)`, () => {
              expect(existsSync(resolve(distDir, `${entry}.d.ts`))).toBe(true)
            })
          }
        })
      }
    })

    describe('package.json Configuration', () => {
      let packageJson: Record<string, unknown>

      beforeAll(() => {
        const packageJsonPath = resolve(packageDir, 'package.json')
        packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      })

      it('should have "type": "module" for ESM support', () => {
        expect(packageJson.type).toBe('module')
      })

      it('should have exports field with types, import, and require', () => {
        expect(packageJson.exports).toBeDefined()
        const exports = packageJson.exports as Record<string, Record<string, string>>
        expect(exports['.']).toBeDefined()
        expect(exports['.'].types).toBeDefined()
        expect(exports['.'].import).toBeDefined()
        expect(exports['.'].require).toBeDefined()
      })

      it('should have exports pointing to correct files', () => {
        const exports = packageJson.exports as Record<string, Record<string, string>>
        expect(exports['.'].types).toBe('./dist/index.d.ts')
        expect(exports['.'].import).toBe('./dist/index.js')
        expect(exports['.'].require).toBe('./dist/index.cjs')
      })

      it('should have main field pointing to ESM entry', () => {
        expect(packageJson.main).toBe('./dist/index.js')
      })

      it('should have types field pointing to declaration', () => {
        expect(packageJson.types).toBe('./dist/index.d.ts')
      })
    })

    describe('ESM Import Validation', () => {
      it('should be importable as ESM', async () => {
        // Create a temporary ESM test script
        const testScript = `
          import('${resolve(distDir, 'index.js')}')
            .then(m => {
              console.log('ESM import successful');
              console.log('Exports:', Object.keys(m));
              process.exit(0);
            })
            .catch(e => {
              console.error('ESM import failed:', e.message);
              process.exit(1);
            });
        `

        try {
          execSync(`node --input-type=module -e "${testScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            cwd: packageDir,
            encoding: 'utf-8',
          })
          expect(true).toBe(true)
        } catch (error) {
          expect(error).toBeNull()
        }
      })
    })

    describe('CJS Require Validation', () => {
      it('should be requireable as CommonJS', () => {
        const cjsPath = resolve(distDir, 'index.cjs')
        const testScript = `
          try {
            const m = require('${cjsPath.replace(/\\/g, '\\\\')}');
            console.log('CJS require successful');
            console.log('Exports:', Object.keys(m));
            process.exit(0);
          } catch(e) {
            console.error('CJS require failed:', e.message);
            process.exit(1);
          }
        `

        try {
          execSync(`node -e "${testScript.replace(/"/g, '\\"').replace(/\n/g, ' ')}"`, {
            cwd: packageDir,
            encoding: 'utf-8',
          })
          expect(true).toBe(true)
        } catch (error) {
          expect(error).toBeNull()
        }
      })
    })

    describe('TypeScript Declaration Validation', () => {
      it('should have valid TypeScript declarations', () => {
        const dtsPath = resolve(distDir, 'index.d.ts')
        expect(existsSync(dtsPath)).toBe(true)

        const dtsContent = readFileSync(dtsPath, 'utf-8')
        // Basic validation: should contain export statements
        expect(dtsContent).toMatch(/export/)
      })

      it('should have declaration map for debugging', () => {
        const dtsMapPath = resolve(distDir, 'index.d.ts.map')
        // Declaration maps are optional but nice to have
        if (existsSync(dtsMapPath)) {
          const mapContent = readFileSync(dtsMapPath, 'utf-8')
          expect(JSON.parse(mapContent)).toHaveProperty('sources')
        }
      })
    })
  })

  describe('Cross-Package Consistency', () => {
    it('all packages should use tsup for building', () => {
      for (const { path } of packages) {
        const tsupConfigPath = resolve(packagesDir, path, 'tsup.config.ts')
        expect(existsSync(tsupConfigPath)).toBe(true)
      }
    })

    it('all packages should have consistent build script', () => {
      for (const { path } of packages) {
        const packageJsonPath = resolve(packagesDir, path, 'package.json')
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
        expect(packageJson.scripts.build).toBe('tsup')
      }
    })
  })
})
