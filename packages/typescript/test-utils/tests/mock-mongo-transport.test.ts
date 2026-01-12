/**
 * Tests for MockMongoTransport
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MockMongoTransport } from '../src/mock-mongo-transport.js';

describe('MockMongoTransport', () => {
  let transport: MockMongoTransport;

  beforeEach(() => {
    transport = new MockMongoTransport();
  });

  afterEach(async () => {
    await transport.close();
  });

  describe('insert operations', () => {
    it('should insert one document', async () => {
      const result = await transport.call('insertOne', 'testdb', 'users', { name: 'John', age: 30 });
      expect(result).toEqual({
        acknowledged: true,
        insertedId: expect.any(String),
      });
    });

    it('should insert many documents', async () => {
      const result = await transport.call('insertMany', 'testdb', 'users', [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ]);
      expect(result).toEqual({
        acknowledged: true,
        insertedCount: 2,
        insertedIds: expect.any(Object),
      });
    });

    it('should preserve custom _id', async () => {
      const result = await transport.call('insertOne', 'testdb', 'users', { _id: 'custom-id', name: 'John' });
      expect(result).toEqual({
        acknowledged: true,
        insertedId: 'custom-id',
      });
    });
  });

  describe('find operations', () => {
    beforeEach(async () => {
      await transport.call('insertMany', 'testdb', 'users', [
        { name: 'John', age: 30, city: 'NYC' },
        { name: 'Jane', age: 25, city: 'LA' },
        { name: 'Bob', age: 35, city: 'NYC' },
      ]);
    });

    it('should find all documents', async () => {
      const result = await transport.call('find', 'testdb', 'users', {});
      expect(result).toHaveLength(3);
    });

    it('should find documents with filter', async () => {
      const result = await transport.call('find', 'testdb', 'users', { city: 'NYC' });
      expect(result).toHaveLength(2);
    });

    it('should find documents with comparison operators', async () => {
      const result = await transport.call('find', 'testdb', 'users', { age: { $gt: 25 } });
      expect(result).toHaveLength(2);
    });

    it('should find documents with $and', async () => {
      const result = await transport.call('find', 'testdb', 'users', {
        $and: [{ city: 'NYC' }, { age: { $gte: 35 } }],
      });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Bob');
    });

    it('should find documents with $or', async () => {
      const result = await transport.call('find', 'testdb', 'users', {
        $or: [{ name: 'John' }, { name: 'Bob' }],
      });
      expect(result).toHaveLength(2);
    });

    it('should apply limit', async () => {
      const result = await transport.call('find', 'testdb', 'users', {}, { limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('should apply skip', async () => {
      const result = await transport.call('find', 'testdb', 'users', {}, { skip: 1 });
      expect(result).toHaveLength(2);
    });

    it('should apply sort', async () => {
      const result = await transport.call('find', 'testdb', 'users', {}, { sort: { age: -1 } });
      expect(result[0].name).toBe('Bob');
      expect(result[2].name).toBe('Jane');
    });

    it('should apply projection', async () => {
      const result = await transport.call('find', 'testdb', 'users', {}, { projection: { name: 1 } });
      expect(result[0]).toHaveProperty('name');
      expect(result[0]).toHaveProperty('_id');
      expect(result[0]).not.toHaveProperty('age');
    });
  });

  describe('update operations', () => {
    beforeEach(async () => {
      await transport.call('insertMany', 'testdb', 'users', [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ]);
    });

    it('should update one document with $set', async () => {
      const result = await transport.call('updateOne', 'testdb', 'users', { name: 'John' }, { $set: { age: 31 } });
      expect(result).toEqual({
        acknowledged: true,
        matchedCount: 1,
        modifiedCount: 1,
      });

      const updated = await transport.call('find', 'testdb', 'users', { name: 'John' });
      expect(updated[0].age).toBe(31);
    });

    it('should update with $inc', async () => {
      await transport.call('updateOne', 'testdb', 'users', { name: 'John' }, { $inc: { age: 5 } });
      const updated = await transport.call('find', 'testdb', 'users', { name: 'John' });
      expect(updated[0].age).toBe(35);
    });

    it('should update many documents', async () => {
      await transport.call('insertOne', 'testdb', 'users', { name: 'Jack', age: 30 });
      const result = await transport.call('updateMany', 'testdb', 'users', { age: 30 }, { $set: { status: 'active' } });
      expect(result.matchedCount).toBe(2);
    });

    it('should upsert when document not found', async () => {
      const result = await transport.call(
        'updateOne',
        'testdb',
        'users',
        { name: 'NewUser' },
        { $set: { age: 20 } },
        { upsert: true }
      );
      expect(result.upsertedId).toBeDefined();
      expect(result.upsertedCount).toBe(1);
    });
  });

  describe('delete operations', () => {
    beforeEach(async () => {
      await transport.call('insertMany', 'testdb', 'users', [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
        { name: 'Bob', age: 30 },
      ]);
    });

    it('should delete one document', async () => {
      const result = await transport.call('deleteOne', 'testdb', 'users', { name: 'John' });
      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 1,
      });
    });

    it('should delete many documents', async () => {
      const result = await transport.call('deleteMany', 'testdb', 'users', { age: 30 });
      expect(result).toEqual({
        acknowledged: true,
        deletedCount: 2,
      });
    });

    it('should return deletedCount 0 when no match', async () => {
      const result = await transport.call('deleteOne', 'testdb', 'users', { name: 'NotExist' });
      expect(result.deletedCount).toBe(0);
    });
  });

  describe('count operations', () => {
    beforeEach(async () => {
      await transport.call('insertMany', 'testdb', 'users', [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
        { name: 'Bob', age: 30 },
      ]);
    });

    it('should count all documents', async () => {
      const result = await transport.call('countDocuments', 'testdb', 'users', {});
      expect(result).toBe(3);
    });

    it('should count with filter', async () => {
      const result = await transport.call('countDocuments', 'testdb', 'users', { age: 30 });
      expect(result).toBe(2);
    });

    it('should return estimated count', async () => {
      const result = await transport.call('estimatedDocumentCount', 'testdb', 'users');
      expect(result).toBe(3);
    });
  });

  describe('aggregation', () => {
    beforeEach(async () => {
      await transport.call('insertMany', 'testdb', 'sales', [
        { product: 'A', amount: 100 },
        { product: 'B', amount: 200 },
        { product: 'A', amount: 150 },
      ]);
    });

    it('should aggregate with $match', async () => {
      const result = await transport.call('aggregate', 'testdb', 'sales', [{ $match: { product: 'A' } }]);
      expect(result).toHaveLength(2);
    });

    it('should aggregate with $group', async () => {
      const result = await transport.call('aggregate', 'testdb', 'sales', [
        { $group: { _id: '$product', total: { $sum: '$amount' } } },
      ]);
      expect(result).toHaveLength(2);
      const productA = result.find((r: { _id: string }) => r._id === 'A');
      expect(productA.total).toBe(250);
    });

    it('should aggregate with $count', async () => {
      const result = await transport.call('aggregate', 'testdb', 'sales', [{ $count: 'total' }]);
      expect(result[0].total).toBe(3);
    });
  });

  describe('collection management', () => {
    it('should create collection', async () => {
      const result = await transport.call('createCollection', 'testdb', 'newcoll');
      expect(result).toEqual({ ok: 1 });
    });

    it('should list collections', async () => {
      await transport.call('insertOne', 'testdb', 'coll1', { x: 1 });
      await transport.call('insertOne', 'testdb', 'coll2', { x: 1 });
      const result = await transport.call('listCollections', 'testdb');
      expect(result).toHaveLength(2);
    });

    it('should drop collection', async () => {
      await transport.call('insertOne', 'testdb', 'todrop', { x: 1 });
      await transport.call('dropCollection', 'testdb', 'todrop');
      const result = await transport.call('listCollections', 'testdb');
      expect(result).toHaveLength(0);
    });
  });

  describe('seedData', () => {
    it('should seed test data', async () => {
      transport.seedData('testdb', 'users', [
        { name: 'John', age: 30 },
        { name: 'Jane', age: 25 },
      ]);

      const result = await transport.call('find', 'testdb', 'users', {});
      expect(result).toHaveLength(2);
    });
  });

  describe('clearData', () => {
    it('should clear all data', async () => {
      await transport.call('insertOne', 'db1', 'coll1', { x: 1 });
      await transport.call('insertOne', 'db2', 'coll2', { x: 1 });

      transport.clearData();

      const result = await transport.call('listDatabases');
      expect(result.databases).toHaveLength(0);
    });
  });
});
