import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve, sep } from 'node:path';

import { Logger } from '@nestjs/common';

import {
  CONSOLE_CONTENT_TYPES,
  CONSOLE_IMMUTABLE_CACHE_CONTROL,
  CONSOLE_INDEX_CACHE_CONTROL,
} from '../constants/console.constants.js';

export interface ConsoleAsset {
  body: Buffer;
  contentType: string;
  cacheControl: string;
}

const INDEX_FILE = 'index.html';
const ASSET_DIRECTORY = 'assets';

/**
 * Reads the built administration SPA from disk for the `/admin` route.
 *
 * Every request path is resolved inside the configured root: a path that
 * escapes the root, contains a NUL byte, or fails to decode is rejected before
 * any filesystem access. Unknown extension-less paths fall back to
 * `index.html` so client-side routes survive a page refresh.
 */
export class ConsoleAssetsService {
  private readonly logger = new Logger(ConsoleAssetsService.name);

  constructor(private readonly rootDir: string) {}

  get root(): string {
    return this.rootDir;
  }

  /** True when the SPA build is present (its entry point exists). */
  async hasEntryPoint(): Promise<boolean> {
    return (await this.readAsset(join(this.rootDir, INDEX_FILE))) !== null;
  }

  /**
   * Resolves a request path (`''`, `'assets/x.js'`, `'users/42'`, …) to an
   * asset. Returns `null` when nothing should be served for it.
   */
  async read(requestPath: string): Promise<ConsoleAsset | null> {
    const relativePath = this.normalize(requestPath);
    if (relativePath === null) {
      return null;
    }

    const filePath = this.resolveInsideRoot(relativePath);
    if (filePath === null) {
      return null;
    }

    const asset = await this.readAsset(filePath);
    if (asset !== null) {
      return asset;
    }

    // SPA client-side route: no extension to serve, so hand back the shell.
    if (relativePath === '' || extname(relativePath) === '') {
      return this.readAsset(join(this.rootDir, INDEX_FILE));
    }

    return null;
  }

  /**
   * Normalizes a raw request path to a root-relative path, or `null` when it is
   * not a safe candidate (traversal, encoded separator, NUL byte, bad escape).
   */
  private normalize(requestPath: string): string | null {
    let decoded: string;
    try {
      decoded = decodeURIComponent(requestPath);
    } catch (error) {
      this.logger.warn(
        `Rejected admin console path that failed URI decoding: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }

    if (decoded.includes('\0') || decoded.includes('\\')) {
      return null;
    }

    const segments = decoded.replace(/^\/+/, '').split('/');
    if (segments.some((segment) => segment === '..')) {
      return null;
    }

    return segments
      .filter((segment) => segment !== '' && segment !== '.')
      .join('/');
  }

  private resolveInsideRoot(relativePath: string): string | null {
    const filePath = resolve(this.rootDir, relativePath);
    if (
      filePath !== this.rootDir &&
      !filePath.startsWith(`${this.rootDir}${sep}`)
    ) {
      return null;
    }
    return filePath;
  }

  private async readAsset(filePath: string): Promise<ConsoleAsset | null> {
    try {
      const stats = await stat(filePath);
      if (!stats.isFile()) {
        return null;
      }
      const body = await readFile(filePath);
      return {
        body,
        contentType:
          CONSOLE_CONTENT_TYPES[extname(filePath).toLowerCase()] ??
          'application/octet-stream',
        cacheControl: this.cacheControlFor(filePath),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      // A read failure other than "missing" is an operator problem (permissions,
      // truncated volume): log it instead of masking it as a 404.
      this.logger.error(
        `Failed to read admin console asset ${filePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private cacheControlFor(filePath: string): string {
    const relative = filePath
      .slice(this.rootDir.length + 1)
      .split(sep)
      .join('/');
    if (relative.startsWith(`${ASSET_DIRECTORY}/`)) {
      return CONSOLE_IMMUTABLE_CACHE_CONTROL;
    }
    return CONSOLE_INDEX_CACHE_CONTROL;
  }
}
