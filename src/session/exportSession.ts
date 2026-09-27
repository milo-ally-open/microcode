import { copyFile, mkdir } from 'node:fs/promises'
import { basename, join } from 'node:path'

/** Copy a session's original JSONL log into the project's .microcode directory. */
export async function exportSessionJsonl(sourcePath: string, projectDirectory: string): Promise<string> {
  const destinationDirectory = join(projectDirectory, '.microcode')
  const destinationPath = join(destinationDirectory, basename(sourcePath))

  await mkdir(destinationDirectory, { recursive: true })
  await copyFile(sourcePath, destinationPath)

  return destinationPath
}
