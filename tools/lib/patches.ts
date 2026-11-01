// Sets of JSON documents by path, and the reverse patches that turn one set into an older one:
// how heroes-assets keeps every build without storing what didn't change.
import jsonPatch, { type Operation } from 'fast-json-patch';

/** JSON documents by path. */
export type Documents = Map<string, unknown>;

/**
 * How to get from one set of documents to another, by path: the operations for a document both
 * have, the whole document for one only the target has, null for one only the source has.
 */
export type DocumentsPatch = Record<string, Operation[] | { readonly full: unknown } | null>;

/** The patch that turns `from` into `to`; documents that are the same are left out. */
export function diff(from: Documents, to: Documents): DocumentsPatch {
  const patch: DocumentsPatch = {};
  for (const [path, doc] of to) {
    if (!from.has(path)) patch[path] = { full: doc };
    else {
      const operations = jsonPatch.compare(from.get(path) as object, doc as object);
      if (operations.length) patch[path] = operations;
    }
  }
  for (const path of from.keys()) if (!to.has(path)) patch[path] = null;
  return patch;
}

/** The documents a patch turns `from` into (`from` itself is left as it was). */
export function apply(from: Documents, patch: DocumentsPatch): Documents {
  const to: Documents = new Map(from);
  for (const [path, change] of Object.entries(patch)) {
    if (change === null) to.delete(path);
    else if (Array.isArray(change)) {
      const doc = structuredClone(to.get(path));
      to.set(path, jsonPatch.applyPatch(doc, change, true, true).newDocument);
    } else to.set(path, change.full);
  }
  return to;
}
