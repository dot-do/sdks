/**
 * MockMongoTransport - A MongoDB-specific mock transport with in-memory storage
 *
 * This provides a full in-memory MongoDB implementation for testing MongoDB SDK code
 * without needing a real database connection.
 */

import { MockRpcTransport } from './mock-rpc-transport.js';
import type { Document } from './types.js';

/**
 * MongoDB-specific mock transport with in-memory storage
 */
export class MockMongoTransport extends MockRpcTransport {
  private _data: Map<string, Map<string, Document[]>> = new Map();
  private _nextId = 1;

  constructor() {
    super();
    this._registerMongoHandlers();
  }

  /**
   * Register MongoDB-specific method handlers
   */
  private _registerMongoHandlers(): void {
    // Insert operations
    this.on('insertOne', (dbName: unknown, collName: unknown, doc: unknown) => {
      const collection = this._getOrCreateCollection(String(dbName), String(collName));
      const document = doc as Document;
      const id = document._id ?? `id_${this._nextId++}`;
      collection.push({ ...document, _id: id });
      return { acknowledged: true, insertedId: id };
    });

    this.on('insertMany', (dbName: unknown, collName: unknown, docs: unknown) => {
      const collection = this._getOrCreateCollection(String(dbName), String(collName));
      const documents = docs as Document[];
      const insertedIds: Record<number, string> = {};
      documents.forEach((doc, i) => {
        const id = doc._id ?? `id_${this._nextId++}`;
        collection.push({ ...doc, _id: id });
        insertedIds[i] = String(id);
      });
      return { acknowledged: true, insertedCount: documents.length, insertedIds };
    });

    // Find operations
    this.on('find', (dbName: unknown, collName: unknown, filter: unknown, options: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = (filter as Document) ?? {};
      const opts = (options as Document) ?? {};
      let results = collection.filter(doc => this._matchesFilter(doc, filterDoc));

      if (opts.sort) {
        results = this._sortDocs(results, opts.sort as Record<string, 1 | -1>);
      }
      if (opts.skip) {
        results = results.slice(opts.skip as number);
      }
      if (opts.limit !== undefined) {
        results = results.slice(0, opts.limit as number);
      }
      if (opts.projection) {
        results = results.map(doc => this._applyProjection(doc, opts.projection as Record<string, 0 | 1>));
      }

      return results;
    });

    // Update operations
    this.on('updateOne', (dbName: unknown, collName: unknown, filter: unknown, update: unknown, options: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter as Document;
      const updateDoc = update as Document;
      const opts = (options as Document) ?? {};
      const index = collection.findIndex(doc => this._matchesFilter(doc, filterDoc));

      if (index === -1) {
        if (opts.upsert) {
          const id = `id_${this._nextId++}`;
          const newDoc = { _id: id, ...this._applyUpdate({}, updateDoc) };
          collection.push(newDoc);
          return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: id, upsertedCount: 1 };
        }
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0 };
      }

      collection[index] = this._applyUpdate(collection[index], updateDoc);
      return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
    });

    this.on('updateMany', (dbName: unknown, collName: unknown, filter: unknown, update: unknown, options: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter as Document;
      const updateDoc = update as Document;
      const opts = (options as Document) ?? {};
      let matchedCount = 0;
      let modifiedCount = 0;

      collection.forEach((doc, i) => {
        if (this._matchesFilter(doc, filterDoc)) {
          matchedCount++;
          const updated = this._applyUpdate(doc, updateDoc);
          if (JSON.stringify(updated) !== JSON.stringify(doc)) {
            collection[i] = updated;
            modifiedCount++;
          }
        }
      });

      if (matchedCount === 0 && opts.upsert) {
        const id = `id_${this._nextId++}`;
        const newDoc = { _id: id, ...this._applyUpdate({}, updateDoc) };
        collection.push(newDoc);
        return { acknowledged: true, matchedCount: 0, modifiedCount: 0, upsertedId: id, upsertedCount: 1 };
      }

      return { acknowledged: true, matchedCount, modifiedCount };
    });

    // Delete operations
    this.on('deleteOne', (dbName: unknown, collName: unknown, filter: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter as Document;
      const index = collection.findIndex(doc => this._matchesFilter(doc, filterDoc));

      if (index === -1) {
        return { acknowledged: true, deletedCount: 0 };
      }

      collection.splice(index, 1);
      return { acknowledged: true, deletedCount: 1 };
    });

    this.on('deleteMany', (dbName: unknown, collName: unknown, filter: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = filter as Document;
      const toDelete: number[] = [];

      collection.forEach((doc, i) => {
        if (this._matchesFilter(doc, filterDoc)) {
          toDelete.push(i);
        }
      });

      // Delete in reverse order to maintain indices
      for (let i = toDelete.length - 1; i >= 0; i--) {
        collection.splice(toDelete[i], 1);
      }

      return { acknowledged: true, deletedCount: toDelete.length };
    });

    // Count operations
    this.on('countDocuments', (dbName: unknown, collName: unknown, filter: unknown, options: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      const filterDoc = (filter as Document) ?? {};
      const opts = (options as Document) ?? {};
      let results = collection.filter(doc => this._matchesFilter(doc, filterDoc));

      if (opts.skip) {
        results = results.slice(opts.skip as number);
      }
      if (opts.limit) {
        results = results.slice(0, opts.limit as number);
      }

      return results.length;
    });

    this.on('estimatedDocumentCount', (dbName: unknown, collName: unknown) => {
      const collection = this._getCollection(String(dbName), String(collName));
      return collection.length;
    });

    // Aggregation
    this.on('aggregate', (dbName: unknown, collName: unknown, pipeline: unknown) => {
      let results = [...this._getCollection(String(dbName), String(collName))];
      const stages = pipeline as Document[];

      for (const stage of stages) {
        if (stage.$match) {
          results = results.filter(doc => this._matchesFilter(doc, stage.$match as Document));
        } else if (stage.$limit) {
          results = results.slice(0, stage.$limit as number);
        } else if (stage.$skip) {
          results = results.slice(stage.$skip as number);
        } else if (stage.$sort) {
          results = this._sortDocs(results, stage.$sort as Record<string, 1 | -1>);
        } else if (stage.$project) {
          results = results.map(doc => this._applyProjection(doc, stage.$project as Record<string, 0 | 1>));
        } else if (stage.$count) {
          results = [{ [stage.$count as string]: results.length }];
        } else if (stage.$group) {
          results = this._groupDocs(results, stage.$group as Document);
        }
      }

      return results;
    });

    // Collection management
    this.on('createCollection', (dbName: unknown, collName: unknown) => {
      this._getOrCreateCollection(String(dbName), String(collName));
      return { ok: 1 };
    });

    this.on('dropCollection', (dbName: unknown, collName: unknown) => {
      const db = this._data.get(String(dbName));
      if (db) {
        db.delete(String(collName));
      }
      return true;
    });

    this.on('dropDatabase', (dbName: unknown) => {
      this._data.delete(String(dbName));
      return true;
    });

    this.on('listCollections', (dbName: unknown) => {
      const db = this._data.get(String(dbName));
      if (!db) return [];
      return Array.from(db.keys()).map(name => ({ name, type: 'collection' }));
    });

    this.on('listDatabases', () => {
      const databases = Array.from(this._data.keys()).map(name => ({
        name,
        sizeOnDisk: 0,
        empty: (this._data.get(name)?.size ?? 0) === 0,
      }));
      return { databases, totalSize: 0 };
    });

    // Index operations (stubs)
    this.on('createIndex', () => 'index_name');
    this.on('createIndexes', () => ['index_1', 'index_2']);
    this.on('dropIndex', () => undefined);
    this.on('dropIndexes', () => undefined);
    this.on('listIndexes', () => [{ v: 2, key: { _id: 1 }, name: '_id_' }]);

    // Server operations
    this.on('serverStatus', () => ({ host: 'localhost', version: '1.0.0', ok: 1 }));
    this.on('adminCommand', () => ({ ok: 1 }));
    this.on('runCommand', (_dbName: unknown, command: unknown) => {
      const cmd = command as Document;
      if (cmd.dbStats) {
        return { db: _dbName, collections: 0, objects: 0, avgObjSize: 0, dataSize: 0, storageSize: 0, indexes: 0, indexSize: 0, ok: 1 };
      }
      return { ok: 1 };
    });
  }

  /**
   * Get all data (for debugging)
   */
  getData(): Map<string, Map<string, Document[]>> {
    return this._data;
  }

  /**
   * Clear all data
   */
  clearData(): void {
    this._data.clear();
    this._nextId = 1;
  }

  /**
   * Seed data for testing
   */
  seedData(dbName: string, collName: string, documents: Document[]): void {
    const collection = this._getOrCreateCollection(dbName, collName);
    documents.forEach(doc => {
      const id = doc._id ?? `id_${this._nextId++}`;
      collection.push({ ...doc, _id: id });
    });
  }

  // Private helper methods

  private _getOrCreateDb(name: string): Map<string, Document[]> {
    let db = this._data.get(name);
    if (!db) {
      db = new Map();
      this._data.set(name, db);
    }
    return db;
  }

  private _getOrCreateCollection(dbName: string, collName: string): Document[] {
    const db = this._getOrCreateDb(dbName);
    let collection = db.get(collName);
    if (!collection) {
      collection = [];
      db.set(collName, collection);
    }
    return collection;
  }

  private _getCollection(dbName: string, collName: string): Document[] {
    return this._getOrCreateCollection(dbName, collName);
  }

  private _matchesFilter(doc: Document, filter: Document): boolean {
    if (!filter || Object.keys(filter).length === 0) {
      return true;
    }

    for (const [key, value] of Object.entries(filter)) {
      // Handle special operators
      if (key === '$and') {
        if (!Array.isArray(value)) return false;
        if (!value.every((f: Document) => this._matchesFilter(doc, f))) return false;
        continue;
      }
      if (key === '$or') {
        if (!Array.isArray(value)) return false;
        if (!value.some((f: Document) => this._matchesFilter(doc, f))) return false;
        continue;
      }

      const docValue = this._getFieldValue(doc, key);

      // Handle operator objects
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const operators = value as Record<string, unknown>;
        let allMatch = true;

        for (const [op, opValue] of Object.entries(operators)) {
          if (!op.startsWith('$')) {
            if (!this._compareValues(docValue, value)) {
              allMatch = false;
              break;
            }
            continue;
          }

          switch (op) {
            case '$eq':
              if (!this._compareValues(docValue, opValue)) allMatch = false;
              break;
            case '$ne':
              if (this._compareValues(docValue, opValue)) allMatch = false;
              break;
            case '$gt':
              if (docValue === undefined || docValue === null || (docValue as number) <= (opValue as number)) allMatch = false;
              break;
            case '$gte':
              if (docValue === undefined || docValue === null || (docValue as number) < (opValue as number)) allMatch = false;
              break;
            case '$lt':
              if (docValue === undefined || docValue === null || (docValue as number) >= (opValue as number)) allMatch = false;
              break;
            case '$lte':
              if (docValue === undefined || docValue === null || (docValue as number) > (opValue as number)) allMatch = false;
              break;
            case '$in':
              if (!Array.isArray(opValue) || !opValue.some(v => this._compareValues(docValue, v))) allMatch = false;
              break;
            case '$nin':
              if (!Array.isArray(opValue) || opValue.some(v => this._compareValues(docValue, v))) allMatch = false;
              break;
            case '$exists':
              if ((opValue && docValue === undefined) || (!opValue && docValue !== undefined)) allMatch = false;
              break;
            case '$regex': {
              const pattern = typeof opValue === 'string' ? opValue : String(opValue);
              const flags = operators.$options as string | undefined;
              const regex = new RegExp(pattern, flags);
              if (typeof docValue !== 'string' || !regex.test(docValue)) allMatch = false;
              break;
            }
          }

          if (!allMatch) break;
        }

        if (!allMatch) return false;
      } else {
        // Direct value comparison
        if (!this._compareValues(docValue, value)) {
          return false;
        }
      }
    }

    return true;
  }

  private _getFieldValue(doc: Document, path: string): unknown {
    const parts = path.split('.');
    let value: unknown = doc;

    for (const part of parts) {
      if (value === null || value === undefined) return undefined;
      if (typeof value !== 'object') return undefined;
      value = (value as Record<string, unknown>)[part];
    }

    return value;
  }

  private _setFieldValue(doc: Document, path: string, value: unknown): void {
    const parts = path.split('.');
    let current: Record<string, unknown> = doc;

    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (current[part] === undefined || current[part] === null) {
        current[part] = {};
      }
      current = current[part] as Record<string, unknown>;
    }

    current[parts[parts.length - 1]] = value;
  }

  private _compareValues(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (a === undefined || b === undefined) return a === b;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((v, i) => this._compareValues(v, b[i]));
    }

    if (typeof a === 'object' && typeof b === 'object') {
      const keysA = Object.keys(a as object);
      const keysB = Object.keys(b as object);
      if (keysA.length !== keysB.length) return false;
      return keysA.every(key => this._compareValues((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
    }

    return false;
  }

  private _sortDocs(docs: Document[], sort: Record<string, 1 | -1>): Document[] {
    return [...docs].sort((a, b) => {
      for (const [key, direction] of Object.entries(sort)) {
        const aVal = this._getFieldValue(a, key);
        const bVal = this._getFieldValue(b, key);

        if (aVal === bVal) continue;
        if (aVal === undefined || aVal === null) return direction;
        if (bVal === undefined || bVal === null) return -direction;

        if (aVal < bVal) return -direction;
        if (aVal > bVal) return direction;
      }
      return 0;
    });
  }

  private _applyProjection(doc: Document, projection: Record<string, 0 | 1>): Document {
    const hasInclusion = Object.values(projection).some(v => v === 1);

    if (hasInclusion) {
      const result: Document = projection._id !== 0 ? { _id: doc._id } : {};
      for (const [key, value] of Object.entries(projection)) {
        if (value === 1) {
          result[key] = this._getFieldValue(doc, key);
        }
      }
      return result;
    }

    // Exclusion only
    const result = { ...doc };
    for (const [key, value] of Object.entries(projection)) {
      if (value === 0) {
        delete result[key];
      }
    }
    return result;
  }

  private _applyUpdate(doc: Document, update: Document): Document {
    const result = { ...doc };

    if (update.$set) {
      for (const [key, value] of Object.entries(update.$set as Record<string, unknown>)) {
        this._setFieldValue(result, key, value);
      }
    }

    if (update.$unset) {
      for (const key of Object.keys(update.$unset as Record<string, unknown>)) {
        delete result[key];
      }
    }

    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc as Record<string, number>)) {
        const current = this._getFieldValue(result, key);
        this._setFieldValue(result, key, (typeof current === 'number' ? current : 0) + value);
      }
    }

    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push as Record<string, unknown>)) {
        let current = this._getFieldValue(result, key);
        if (!Array.isArray(current)) {
          current = [];
          this._setFieldValue(result, key, current);
        }
        (current as unknown[]).push(value);
      }
    }

    if (update.$addToSet) {
      for (const [key, value] of Object.entries(update.$addToSet as Record<string, unknown>)) {
        let current = this._getFieldValue(result, key);
        if (!Array.isArray(current)) {
          current = [];
          this._setFieldValue(result, key, current);
        }
        const arr = current as unknown[];
        if (!arr.some(v => this._compareValues(v, value))) {
          arr.push(value);
        }
      }
    }

    if (update.$pull) {
      for (const [key, value] of Object.entries(update.$pull as Record<string, unknown>)) {
        const current = this._getFieldValue(result, key);
        if (Array.isArray(current)) {
          const filtered = current.filter(item => !this._compareValues(item, value));
          this._setFieldValue(result, key, filtered);
        }
      }
    }

    return result;
  }

  private _groupDocs(docs: Document[], groupSpec: Document): Document[] {
    const groups = new Map<string, { key: unknown; docs: Document[] }>();

    for (const doc of docs) {
      const keyValue = groupSpec._id === null ? null : this._evaluateExpression(doc, groupSpec._id);
      const keyStr = JSON.stringify(keyValue);

      if (!groups.has(keyStr)) {
        groups.set(keyStr, { key: keyValue, docs: [] });
      }
      groups.get(keyStr)!.docs.push(doc);
    }

    const results: Document[] = [];

    for (const [, { key, docs: groupDocs }] of groups) {
      const result: Document = { _id: key };

      for (const [field, spec] of Object.entries(groupSpec)) {
        if (field === '_id') continue;

        if (typeof spec === 'object' && spec !== null) {
          const accSpec = spec as Record<string, unknown>;

          if ('$sum' in accSpec) {
            if (accSpec.$sum === 1) {
              result[field] = groupDocs.length;
            } else {
              result[field] = groupDocs.reduce((sum, d) => sum + (this._evaluateExpression(d, accSpec.$sum) as number), 0);
            }
          } else if ('$avg' in accSpec) {
            const values = groupDocs.map(d => this._evaluateExpression(d, accSpec.$avg) as number);
            result[field] = values.reduce((a, b) => a + b, 0) / values.length;
          } else if ('$min' in accSpec) {
            result[field] = Math.min(...groupDocs.map(d => this._evaluateExpression(d, accSpec.$min) as number));
          } else if ('$max' in accSpec) {
            result[field] = Math.max(...groupDocs.map(d => this._evaluateExpression(d, accSpec.$max) as number));
          } else if ('$first' in accSpec) {
            result[field] = groupDocs.length > 0 ? this._evaluateExpression(groupDocs[0], accSpec.$first) : null;
          } else if ('$last' in accSpec) {
            result[field] = groupDocs.length > 0 ? this._evaluateExpression(groupDocs[groupDocs.length - 1], accSpec.$last) : null;
          }
        }
      }

      results.push(result);
    }

    return results;
  }

  private _evaluateExpression(doc: Document, expr: unknown): unknown {
    if (expr === null) return null;

    if (typeof expr === 'string') {
      if (expr.startsWith('$')) {
        return this._getFieldValue(doc, expr.substring(1));
      }
      return expr;
    }

    return expr;
  }
}
