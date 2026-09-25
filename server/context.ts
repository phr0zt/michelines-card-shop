import type { Db } from './db';
import type { Auth } from './lib/auth';
import type { JobRunner } from './services/ai/jobs';
import type { ImageStore } from './services/images';

export interface AppContext {
  db: Db;
  images: ImageStore;
  jobs: JobRunner;
  auth: Auth;
}
