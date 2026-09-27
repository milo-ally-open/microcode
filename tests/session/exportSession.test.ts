import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { exportSessionJsonl } from '../../src/session/exportSession.ts'

describe('exportSessionJsonl', () => {
  test('copies the original JSONL into the project .microcode directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'microcode-export-'))
    const sourceDirectory = join(root, 'home', '.microcode', 'sessions')
    const projectDirectory = join(root, 'project')
    const sourcePath = join(sourceDirectory, '2026-09-27T10-00-00Z_session%2Fid.jsonl')
    const original = '{"v":4,"kind":"header"}\r\n{"kind":"entry","data":{"text":"hello"}}\r\n'

    try {
      await mkdir(sourceDirectory, { recursive: true })
      await writeFile(sourcePath, original)

      const exportedPath = await exportSessionJsonl(sourcePath, projectDirectory)

      expect(exportedPath).toBe(join(projectDirectory, '.microcode', '2026-09-27T10-00-00Z_session%2Fid.jsonl'))
      expect(await readFile(exportedPath, 'utf8')).toBe(original)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
