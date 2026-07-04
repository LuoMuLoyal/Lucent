import type { INestApplication } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname } from 'node:path';
import type { NextFunction, Request, Response } from 'express';

import type { AdminAsset } from '../types/adminjs.types';

export function registerAdminStaticAssets(
  app: INestApplication,
  rootPath: string,
  assets: AdminAsset[],
): void {
  assets.forEach((asset) => {
    app.use(
      `${rootPath}${asset.path}`,
      (req: Request, res: Response, next: NextFunction) => {
        void sendAdminStaticAsset(req, res, asset).catch((error: unknown) => {
          next(error instanceof Error ? error : new Error(String(error)));
        });
      },
    );
  });
}

async function sendAdminStaticAsset(
  req: Request,
  res: Response,
  asset: AdminAsset,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.sendStatus(405);
    return;
  }

  const assetStats = await stat(asset.src);
  res.type(extname(asset.src));
  res.setHeader('Content-Length', String(assetStats.size));

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(asset.src);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  });
}
