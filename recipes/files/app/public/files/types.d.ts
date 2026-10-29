// Types for @core/files (app/public/files/). The comments at the top of module.js say what each does.

export interface FileRecord {
  id: string;
  name: string;
  type: string;
  size: number;
  w?: number;
  h?: number;
  thumb?: boolean;
  taken?: number;
  place?: { lat: number; lng: number };
  state: 'local' | 'stored';
  _deleted?: boolean;
  [extra: string]: unknown;
}

export interface Job {
  id: string;
  scope: string;
  op: 'put' | 'delete';
  parts?: ('file' | 'thumb')[];
  tries: number;
  at: number;
  stuck?: string;
  rec?: FileRecord;
}

export interface BlobCache {
  get(key: string): Promise<Blob | null>;
  set(key: string, blob: Blob): Promise<void>;
  del(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ImageOptions {
  maxDim?: number;
  thumbDim?: number;
  type?: string;
  quality?: number;
}

export interface FilesOptions {
  collection: string;
  scope?: (user: { uid: string }) => string;
  maxBytes?: number;
  image?: ImageOptions;
  exif?: boolean | { place?: boolean };
  url?: string;
  fetch?: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
  cache?: BlobCache;
  token?: (force: boolean) => Promise<string>;
  now?: () => number;
  win?: Window | null;
}

export interface FilesApi {
  add(file: Blob, o?: { scope?: string; extra?: Record<string, unknown> }): Promise<{ id: string; record: FileRecord }>;
  url(id: string, o?: { scope?: string; thumb?: boolean }): Promise<string>;
  blob(id: string, o?: { scope?: string; thumb?: boolean }): Promise<Blob>;
  remove(idOrRecord: string | FileRecord, o?: { scope?: string }): Promise<void>;
  jobs(): Job[];
  retry(id?: string): void;
  discard(id: string): void;
  kick(): Promise<void>;
}
