// The files recipe's data side (recipes/files.json): the @core/files module for the engine, every item's files grouped
// by item, and the delete that takes an item's files with it. cloud.js reaches it through data-modules.js.
import { files } from '@core/files';

const FILES = 'files';

/** @typedef {import('@core/files').FileRecord & { item: string, _deleted?: boolean }} Attachment */

/** @type {import('./data-modules.js').FilesData} */
export const filesData = {
  coll: FILES,
  // the records sync in FILES, the bytes go to /api/files (shared by the space, like the items); the date a photo was
  // taken is kept, its place is not
  engine: space => files({ collection: FILES, scope: () => space, exif: true }),
  watch: (app, space, onFiles) => app.sync.watch(space, FILES, (/** @type {Attachment[]} */ list) => {
    /** @type {Map<string, Attachment[]>} */
    const by = new Map();
    for (const f of list) if (!f._deleted && f.item) by.set(f.item, [...(by.get(f.item) || []), f]);
    onFiles(by);
  }),
  async removeAll(app, attached) { for (const f of /** @type {Attachment[]} */ (attached)) await app.files.remove(f); },
};
