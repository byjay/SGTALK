import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { NasFileEntry, NasFolderInfo } from '../src/shared/types';
import {
  NAS_DEFAULT_FOLDERS,
  buildNasRelativePath,
  sanitizeNasFilename,
  sanitizeNasFolder,
} from '../src/shared/nasShare';
import { isPathInsideDir } from './security';

export function getNasRootDir(): string {
  const configured = process.env.NAS_STORAGE_DIR?.trim();
  const root = configured ? path.resolve(configured) : path.resolve(process.cwd(), 'data', 'nas');
  if (!fs.existsSync(root)) {
    fs.mkdirSync(root, { recursive: true });
  }
  return root;
}

export function getConfiguredNasExternalBaseUrl(): string {
  return (process.env.NAS_EXTERNAL_BASE_URL ?? '').trim().replace(/\/+$/, '');
}

export function ensureNasSeedStructure(): void {
  const root = getNasRootDir();
  for (const folder of NAS_DEFAULT_FOLDERS) {
    const folderDir = path.resolve(root, sanitizeNasFolder(folder));
    if (isPathInsideDir(folderDir, root) && !fs.existsSync(folderDir)) {
      fs.mkdirSync(folderDir, { recursive: true });
    }
  }

  const samples: Array<{ folder: string; filename: string; content: string }> = [
    {
      folder: 'AI-데이터셋',
      filename: 'SGW_LLM_체크포인트_검증팩.tar.zst',
      content:
        'SGW Enterprise NAS Archive Manifest\nFolder: AI-데이터셋\nPackage: SGW_LLM_체크포인트_검증팩.tar.zst\nIntegrity: SHA-256 Verified\n',
    },
    {
      folder: '프로덕트개발',
      filename: 'SGW_모바일_웹확장_통합릴리즈_v2026.zip',
      content:
        'SGW Enterprise NAS Build Archive\nFolder: 프로덕트개발\nPackage: SGW_모바일_웹확장_통합릴리즈_v2026.zip\nBuild: Release 2026.11\n',
    },
    {
      folder: '전사-공유',
      filename: '2026_전사_아키텍처_리소스팩.tar',
      content:
        'SGW Enterprise NAS Shared Pack\nFolder: 전사-공유\nPackage: 2026_전사_아키텍처_리소스팩.tar\n',
    },
  ];

  for (const sample of samples) {
    const safeRel = buildNasRelativePath(sample.folder, sample.filename);
    const full = path.resolve(root, safeRel);
    if (isPathInsideDir(full, root) && !fs.existsSync(full)) {
      fs.writeFileSync(full, sample.content, 'utf-8');
    }
  }
}

export function resolveNasFilePath(nasRelativePath: string): {
  fullPath: string;
  folder: string;
  filename: string;
  size: number;
} | null {
  const root = getNasRootDir();
  const segments = String(nasRelativePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  if (segments.length < 2) return null;
  const filename = sanitizeNasFilename(segments[segments.length - 1]);
  const folder = sanitizeNasFolder(segments.slice(0, -1).join('/'));
  if (!filename) return null;

  const normalizedRel = `${folder}/${filename}`;
  const fullPath = path.resolve(root, normalizedRel);
  if (!isPathInsideDir(fullPath, root) || !fs.existsSync(fullPath)) {
    return null;
  }
  const stat = fs.statSync(fullPath);
  if (!stat.isFile()) return null;
  return {
    fullPath,
    folder,
    filename,
    size: stat.size,
  };
}

export function listNasFolders(): NasFolderInfo[] {
  ensureNasSeedStructure();
  const root = getNasRootDir();
  const entries = fs.readdirSync(root, { withFileTypes: true });
  const folders: NasFolderInfo[] = [];

  for (const dirEntry of entries) {
    if (!dirEntry.isDirectory()) continue;
    const folderName = sanitizeNasFolder(dirEntry.name);
    const folderPath = path.resolve(root, folderName);
    if (!isPathInsideDir(folderPath, root)) continue;

    const files: NasFileEntry[] = [];
    const subEntries = fs.readdirSync(folderPath, { withFileTypes: true });
    for (const fileEntry of subEntries) {
      if (!fileEntry.isFile()) continue;
      const safeName = sanitizeNasFilename(fileEntry.name);
      if (!safeName) continue;
      const fileFull = path.resolve(folderPath, safeName);
      if (!isPathInsideDir(fileFull, folderPath)) continue;
      const stat = fs.statSync(fileFull);
      files.push({
        filename: safeName,
        folder: folderName,
        relativePath: `${folderName}/${safeName}`,
        size: stat.size,
        updatedAt: stat.mtime.toISOString(),
      });
    }
    files.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    folders.push({ folder: folderName, files });
  }

  return folders.sort((a, b) => a.folder.localeCompare(b.folder, 'ko'));
}

export function copyBufferToNasFolder(input: {
  folder: string;
  filename: string;
  buffer: Buffer;
}): {
  folder: string;
  filename: string;
  relativePath: string;
  fullPath: string;
  size: number;
} | null {
  ensureNasSeedStructure();
  const root = getNasRootDir();
  const folder = sanitizeNasFolder(input.folder);
  const filename = sanitizeNasFilename(input.filename);
  if (!filename) return null;

  const folderDir = path.resolve(root, folder);
  if (!isPathInsideDir(folderDir, root)) return null;
  if (!fs.existsSync(folderDir)) {
    fs.mkdirSync(folderDir, { recursive: true });
  }

  const relativePath = `${folder}/${filename}`;
  const fullPath = path.resolve(root, relativePath);
  if (!isPathInsideDir(fullPath, folderDir)) return null;

  const tmpPath = `${fullPath}.${crypto.randomUUID().slice(0, 6)}.tmp`;
  fs.writeFileSync(tmpPath, input.buffer);
  fs.renameSync(tmpPath, fullPath);

  return {
    folder,
    filename,
    relativePath,
    fullPath,
    size: input.buffer.length,
  };
}

export function copyExistingFileToNasFolder(input: {
  sourceAbsPath: string;
  allowedSourceRoots: string[];
  targetFolder: string;
  targetFilename: string;
}): {
  folder: string;
  filename: string;
  relativePath: string;
  fullPath: string;
  size: number;
} | null {
  ensureNasSeedStructure();
  const root = getNasRootDir();
  const resolvedSource = path.resolve(input.sourceAbsPath);
  const sourceAllowed = input.allowedSourceRoots.some((allowedRoot) =>
    isPathInsideDir(resolvedSource, path.resolve(allowedRoot)),
  );
  if (!sourceAllowed || !fs.existsSync(resolvedSource)) {
    return null;
  }
  const srcStat = fs.statSync(resolvedSource);
  if (!srcStat.isFile()) return null;

  const folder = sanitizeNasFolder(input.targetFolder);
  const filename = sanitizeNasFilename(input.targetFilename);
  if (!filename) return null;

  const folderDir = path.resolve(root, folder);
  if (!isPathInsideDir(folderDir, root)) return null;
  if (!fs.existsSync(folderDir)) {
    fs.mkdirSync(folderDir, { recursive: true });
  }

  const relativePath = `${folder}/${filename}`;
  const fullPath = path.resolve(root, relativePath);
  if (!isPathInsideDir(fullPath, folderDir)) return null;

  if (resolvedSource !== fullPath) {
    const tmpPath = `${fullPath}.${crypto.randomUUID().slice(0, 6)}.tmp`;
    fs.copyFileSync(resolvedSource, tmpPath);
    fs.renameSync(tmpPath, fullPath);
  }

  const stat = fs.statSync(fullPath);
  return {
    folder,
    filename,
    relativePath,
    fullPath,
    size: stat.size,
  };
}

export function ensureNasPackageFile(input: {
  targetFolder: string;
  filename: string;
  sourceNasRelativePath?: string;
  declaredSizeBytes?: number;
}): {
  folder: string;
  filename: string;
  relativePath: string;
  fullPath: string;
  diskSize: number;
} | null {
  ensureNasSeedStructure();
  const root = getNasRootDir();
  const folder = sanitizeNasFolder(input.targetFolder);
  const filename = sanitizeNasFilename(input.filename);
  if (!filename) return null;

  if (input.sourceNasRelativePath) {
    const src = resolveNasFilePath(input.sourceNasRelativePath);
    if (src) {
      const copied = copyExistingFileToNasFolder({
        sourceAbsPath: src.fullPath,
        allowedSourceRoots: [root],
        targetFolder: folder,
        targetFilename: filename,
      });
      if (copied) {
        return {
          folder: copied.folder,
          filename: copied.filename,
          relativePath: copied.relativePath,
          fullPath: copied.fullPath,
          diskSize: copied.size,
        };
      }
    }
  }

  const existing = resolveNasFilePath(`${folder}/${filename}`);
  if (existing) {
    return {
      folder: existing.folder,
      filename: existing.filename,
      relativePath: `${existing.folder}/${existing.filename}`,
      fullPath: existing.fullPath,
      diskSize: existing.size,
    };
  }

  const manifestText = [
    'SGW Internal NAS Staged Archive Descriptor',
    `Folder: ${folder}`,
    `Filename: ${filename}`,
    `DeclaredBytes: ${input.declaredSizeBytes ?? 0}`,
    `CreatedAt: ${new Date().toISOString()}`,
    '',
  ].join('\n');

  const created = copyBufferToNasFolder({
    folder,
    filename,
    buffer: Buffer.from(manifestText, 'utf-8'),
  });
  if (!created) return null;
  return {
    folder: created.folder,
    filename: created.filename,
    relativePath: created.relativePath,
    fullPath: created.fullPath,
    diskSize: created.size,
  };
}
