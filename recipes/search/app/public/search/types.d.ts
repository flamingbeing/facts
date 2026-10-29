/** a record to index: it needs a string `id`; the rest is the app's */
export type Record_ = Record<string, unknown>;

export type Hit = { id: string; score: number; fields: string[] } & Record<string, unknown>;

export type Options = {
  /** the record fields that are indexed (text, or arrays of text) */
  fields: string[];
  /** a weight per field; a hit in a heavier field ranks higher */
  boost?: Record<string, number>;
  /** fields copied onto each hit, so a result list needs no second lookup */
  store?: string[];
  /** app-defined filters: `is:`, `has:`, `after:`. They run on the record, not the index */
  operators?: Record<string, (record: Record_, value: string) => boolean>;
  /** a record's sort key for lists with no words in the query (largest first); default `updatedAt` */
  newest?: (record: Record_) => number;
  /** runs once MiniSearch is in, when a search ran before it was (with plain-text matching): search again */
  onReady?: () => void;
};

export type Search = {
  /** add or replace each record */
  feed(records: Record_[]): void;
  update(record: Record_): void;
  remove(id: string): void;
  clear(): void;
  readonly size: number;
  /** loads MiniSearch and builds the index (call it when the search box gets focus) */
  prepare(): Promise<void>;
  /** ranked hits; `unknown` lists misspelt operators with a suggestion */
  search(q: string, opts?: { limit?: number }): { hits: Hit[]; unknown: { op: string; suggest: string }[] };
};

export type CreateSearch = (options: Options) => Search;
