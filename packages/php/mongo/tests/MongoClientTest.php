<?php

declare(strict_types=1);

namespace DotDo\Mongo\Tests;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\CoversClass;
use PHPUnit\Framework\Attributes\DataProvider;
use DotDo\Mongo\{
    MongoClient,
    MongoClientConfig,
    MongoException,
    WriteException,
    DuplicateKeyException,
    ObjectId,
    Filter,
    Update,
    Pipeline,
    Database,
    Collection,
    Cursor,
    QueryBuilder,
    FindOptions,
    InsertOptions,
    UpdateOptions,
    DeleteOptions,
    InsertResult,
    InsertManyResult,
    UpdateResult,
    DeleteResult,
    SortDirection,
    WriteConcern,
    ReadPreference,
};

#[CoversClass(MongoClient::class)]
#[CoversClass(ObjectId::class)]
#[CoversClass(Filter::class)]
#[CoversClass(Update::class)]
#[CoversClass(Pipeline::class)]
#[CoversClass(Database::class)]
#[CoversClass(Collection::class)]
#[CoversClass(Cursor::class)]
#[CoversClass(QueryBuilder::class)]
class MongoClientTest extends TestCase
{
    #[Test]
    public function objectIdGeneratesUniqueIds(): void
    {
        $id1 = new ObjectId();
        $id2 = new ObjectId();

        $this->assertNotEquals($id1->toString(), $id2->toString());
        $this->assertEquals(24, strlen($id1->toString()));
        $this->assertEquals(24, strlen($id2->toString()));
    }

    #[Test]
    public function objectIdCanBeCreatedFromString(): void
    {
        $idString = '507f1f77bcf86cd799439011';
        $id = ObjectId::fromString($idString);

        $this->assertEquals($idString, $id->toString());
        $this->assertEquals($idString, (string)$id);
    }

    #[Test]
    public function objectIdExtractsTimestamp(): void
    {
        $id = new ObjectId();
        $timestamp = $id->getTimestamp();

        // Timestamp should be recent (within last minute)
        $this->assertGreaterThan(time() - 60, $timestamp);
        $this->assertLessThanOrEqual(time(), $timestamp);
    }

    #[Test]
    public function objectIdComparison(): void
    {
        $idString = '507f1f77bcf86cd799439011';
        $id1 = ObjectId::fromString($idString);
        $id2 = ObjectId::fromString($idString);
        $id3 = new ObjectId();

        $this->assertTrue($id1->equals($id2));
        $this->assertFalse($id1->equals($id3));
    }

    #[Test]
    public function objectIdJsonSerialization(): void
    {
        $idString = '507f1f77bcf86cd799439011';
        $id = ObjectId::fromString($idString);

        $json = json_encode($id);
        $this->assertEquals('{"$oid":"507f1f77bcf86cd799439011"}', $json);
    }

    #[Test]
    public function filterEquality(): void
    {
        $filter = Filter::eq('name', 'John');
        $this->assertEquals(['name' => 'John'], $filter->toArray());
    }

    #[Test]
    public function filterComparison(): void
    {
        $this->assertEquals(['age' => ['$ne' => 30]], Filter::ne('age', 30)->toArray());
        $this->assertEquals(['age' => ['$gt' => 18]], Filter::gt('age', 18)->toArray());
        $this->assertEquals(['age' => ['$gte' => 18]], Filter::gte('age', 18)->toArray());
        $this->assertEquals(['age' => ['$lt' => 65]], Filter::lt('age', 65)->toArray());
        $this->assertEquals(['age' => ['$lte' => 65]], Filter::lte('age', 65)->toArray());
    }

    #[Test]
    public function filterInAndNin(): void
    {
        $inFilter = Filter::in('status', ['active', 'pending']);
        $this->assertEquals(['status' => ['$in' => ['active', 'pending']]], $inFilter->toArray());

        $ninFilter = Filter::nin('status', ['deleted', 'banned']);
        $this->assertEquals(['status' => ['$nin' => ['deleted', 'banned']]], $ninFilter->toArray());
    }

    #[Test]
    public function filterExists(): void
    {
        $exists = Filter::exists('email');
        $this->assertEquals(['email' => ['$exists' => true]], $exists->toArray());

        $notExists = Filter::exists('deletedAt', false);
        $this->assertEquals(['deletedAt' => ['$exists' => false]], $notExists->toArray());
    }

    #[Test]
    public function filterRegex(): void
    {
        $filter = Filter::regex('name', '^John', 'i');
        $this->assertEquals(['name' => ['$regex' => '^John', '$options' => 'i']], $filter->toArray());
    }

    #[Test]
    public function filterTextSearch(): void
    {
        $filter = Filter::text('search query');
        $this->assertEquals(['$text' => ['$search' => 'search query']], $filter->toArray());

        $filterWithLang = Filter::text('recherche', 'french');
        $this->assertEquals(['$text' => ['$search' => 'recherche', '$language' => 'french']], $filterWithLang->toArray());
    }

    #[Test]
    public function filterArrayOperators(): void
    {
        $elemMatch = Filter::elemMatch('scores', ['$gte' => 80]);
        $this->assertEquals(['scores' => ['$elemMatch' => ['$gte' => 80]]], $elemMatch->toArray());

        $size = Filter::size('tags', 3);
        $this->assertEquals(['tags' => ['$size' => 3]], $size->toArray());

        $all = Filter::all('tags', ['php', 'mongodb']);
        $this->assertEquals(['tags' => ['$all' => ['php', 'mongodb']]], $all->toArray());
    }

    #[Test]
    public function filterLogicalOperators(): void
    {
        $filter1 = Filter::eq('status', 'active');
        $filter2 = Filter::gt('age', 18);

        $and = $filter1->and($filter2);
        $this->assertEquals([
            '$and' => [
                ['status' => 'active'],
                ['age' => ['$gt' => 18]],
            ],
        ], $and->toArray());

        $or = $filter1->or($filter2);
        $this->assertEquals([
            '$or' => [
                ['status' => 'active'],
                ['age' => ['$gt' => 18]],
            ],
        ], $or->toArray());

        $nor = $filter1->nor($filter2);
        $this->assertEquals([
            '$nor' => [
                ['status' => 'active'],
                ['age' => ['$gt' => 18]],
            ],
        ], $nor->toArray());
    }

    #[Test]
    public function filterFromArray(): void
    {
        $filter = Filter::fromArray(['status' => 'active', 'type' => 'user']);
        $this->assertEquals(['status' => 'active', 'type' => 'user'], $filter->toArray());
    }

    #[Test]
    public function updateSet(): void
    {
        $update = Update::set(['name' => 'John', 'age' => 30]);
        $this->assertEquals(['$set' => ['name' => 'John', 'age' => 30]], $update->toArray());
    }

    #[Test]
    public function updateUnset(): void
    {
        $update = Update::unset('deletedAt', 'tempField');
        $this->assertEquals(['$unset' => ['deletedAt' => '', 'tempField' => '']], $update->toArray());
    }

    #[Test]
    public function updateNumeric(): void
    {
        $inc = Update::inc(['counter' => 1, 'views' => 5]);
        $this->assertEquals(['$inc' => ['counter' => 1, 'views' => 5]], $inc->toArray());

        $mul = Update::mul(['price' => 1.1]);
        $this->assertEquals(['$mul' => ['price' => 1.1]], $mul->toArray());

        $min = Update::min(['lowest' => 10]);
        $this->assertEquals(['$min' => ['lowest' => 10]], $min->toArray());

        $max = Update::max(['highest' => 100]);
        $this->assertEquals(['$max' => ['highest' => 100]], $max->toArray());
    }

    #[Test]
    public function updateArrayOperators(): void
    {
        $push = Update::push('tags', 'new-tag');
        $this->assertEquals(['$push' => ['tags' => 'new-tag']], $push->toArray());

        $pushAll = Update::pushAll('tags', ['tag1', 'tag2']);
        $this->assertEquals(['$push' => ['tags' => ['$each' => ['tag1', 'tag2']]]], $pushAll->toArray());

        $addToSet = Update::addToSet('tags', 'unique-tag');
        $this->assertEquals(['$addToSet' => ['tags' => 'unique-tag']], $addToSet->toArray());

        $pull = Update::pull('tags', 'remove-tag');
        $this->assertEquals(['$pull' => ['tags' => 'remove-tag']], $pull->toArray());

        $pullAll = Update::pullAll('tags', ['tag1', 'tag2']);
        $this->assertEquals(['$pullAll' => ['tags' => ['tag1', 'tag2']]], $pullAll->toArray());

        $pop = Update::pop('tags', 1);
        $this->assertEquals(['$pop' => ['tags' => 1]], $pop->toArray());
    }

    #[Test]
    public function updateMerge(): void
    {
        $update1 = Update::set(['name' => 'John']);
        $update2 = Update::inc(['counter' => 1]);

        $merged = $update1->merge($update2);

        $expected = [
            '$set' => ['name' => 'John'],
            '$inc' => ['counter' => 1],
        ];
        $this->assertEquals($expected, $merged->toArray());
    }

    #[Test]
    public function updateRename(): void
    {
        $update = Update::rename(['oldName' => 'newName']);
        $this->assertEquals(['$rename' => ['oldName' => 'newName']], $update->toArray());
    }

    #[Test]
    public function updateCurrentDate(): void
    {
        $update = Update::currentDate('updatedAt', 'lastModified');
        $this->assertEquals(['$currentDate' => ['updatedAt' => true, 'lastModified' => true]], $update->toArray());
    }

    #[Test]
    public function pipelineMatch(): void
    {
        $pipeline = (new Pipeline())->match(Filter::eq('status', 'active'));
        $this->assertEquals([['$match' => ['status' => 'active']]], $pipeline->toArray());
    }

    #[Test]
    public function pipelineProject(): void
    {
        $pipeline = (new Pipeline())->project(['name' => 1, 'email' => 1, '_id' => 0]);
        $this->assertEquals([['$project' => ['name' => 1, 'email' => 1, '_id' => 0]]], $pipeline->toArray());
    }

    #[Test]
    public function pipelineGroup(): void
    {
        $pipeline = (new Pipeline())->group('$status', [
            'count' => ['$sum' => 1],
            'avgAge' => ['$avg' => '$age'],
        ]);

        $expected = [
            ['$group' => [
                '_id' => '$status',
                'count' => ['$sum' => 1],
                'avgAge' => ['$avg' => '$age'],
            ]],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function pipelineSortLimitSkip(): void
    {
        $pipeline = (new Pipeline())
            ->sort(['createdAt' => -1])
            ->skip(10)
            ->limit(5);

        $expected = [
            ['$sort' => ['createdAt' => -1]],
            ['$skip' => 10],
            ['$limit' => 5],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function pipelineLookup(): void
    {
        $pipeline = (new Pipeline())->lookup('users', 'authorId', '_id', 'author');

        $expected = [
            ['$lookup' => [
                'from' => 'users',
                'localField' => 'authorId',
                'foreignField' => '_id',
                'as' => 'author',
            ]],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function pipelineUnwind(): void
    {
        $pipeline = (new Pipeline())->unwind('$tags');
        $this->assertEquals([['$unwind' => '$tags']], $pipeline->toArray());

        $pipelinePreserve = (new Pipeline())->unwind('$tags', true);
        $this->assertEquals([['$unwind' => ['path' => '$tags', 'preserveNullAndEmptyArrays' => true]]], $pipelinePreserve->toArray());
    }

    #[Test]
    public function pipelineAddFields(): void
    {
        $pipeline = (new Pipeline())->addFields([
            'fullName' => ['$concat' => ['$firstName', ' ', '$lastName']],
        ]);

        $expected = [
            ['$addFields' => [
                'fullName' => ['$concat' => ['$firstName', ' ', '$lastName']],
            ]],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function pipelineCount(): void
    {
        $pipeline = (new Pipeline())->count('total');
        $this->assertEquals([['$count' => 'total']], $pipeline->toArray());
    }

    #[Test]
    public function pipelineSample(): void
    {
        $pipeline = (new Pipeline())->sample(5);
        $this->assertEquals([['$sample' => ['size' => 5]]], $pipeline->toArray());
    }

    #[Test]
    public function pipelineOut(): void
    {
        $pipeline = (new Pipeline())->out('outputCollection');
        $this->assertEquals([['$out' => 'outputCollection']], $pipeline->toArray());
    }

    #[Test]
    public function pipelineMergeInto(): void
    {
        $pipeline = (new Pipeline())->mergeInto('targetCollection', ['on' => '_id', 'whenMatched' => 'replace']);

        $expected = [
            ['$merge' => [
                'into' => 'targetCollection',
                'on' => '_id',
                'whenMatched' => 'replace',
            ]],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function pipelineImmutable(): void
    {
        $pipeline1 = new Pipeline();
        $pipeline2 = $pipeline1->match(['status' => 'active']);
        $pipeline3 = $pipeline2->limit(10);

        $this->assertEquals([], $pipeline1->toArray());
        $this->assertEquals([['$match' => ['status' => 'active']]], $pipeline2->toArray());
        $this->assertEquals([
            ['$match' => ['status' => 'active']],
            ['$limit' => 10],
        ], $pipeline3->toArray());
    }

    #[Test]
    public function pipelineFacet(): void
    {
        $pipeline = (new Pipeline())->facet([
            'categoryCounts' => (new Pipeline())->group('$category', ['count' => ['$sum' => 1]]),
            'statusCounts' => (new Pipeline())->group('$status', ['count' => ['$sum' => 1]]),
        ]);

        $expected = [
            ['$facet' => [
                'categoryCounts' => [['$group' => ['_id' => '$category', 'count' => ['$sum' => 1]]]],
                'statusCounts' => [['$group' => ['_id' => '$status', 'count' => ['$sum' => 1]]]],
            ]],
        ];
        $this->assertEquals($expected, $pipeline->toArray());
    }

    #[Test]
    public function cursorIteration(): void
    {
        $documents = [
            ['_id' => '1', 'name' => 'Alice'],
            ['_id' => '2', 'name' => 'Bob'],
            ['_id' => '3', 'name' => 'Charlie'],
        ];

        $cursor = new Cursor(fn() => $documents);

        $result = [];
        foreach ($cursor as $doc) {
            $result[] = $doc;
        }

        $this->assertEquals($documents, $result);
    }

    #[Test]
    public function cursorToArray(): void
    {
        $documents = [
            ['_id' => '1', 'name' => 'Alice'],
            ['_id' => '2', 'name' => 'Bob'],
        ];

        $cursor = new Cursor(fn() => $documents);
        $this->assertEquals($documents, $cursor->toArray());
    }

    #[Test]
    public function cursorFirst(): void
    {
        $documents = [
            ['_id' => '1', 'name' => 'Alice'],
            ['_id' => '2', 'name' => 'Bob'],
        ];

        $cursor = new Cursor(fn() => $documents);
        $this->assertEquals(['_id' => '1', 'name' => 'Alice'], $cursor->first());

        $emptyCursor = new Cursor(fn() => []);
        $this->assertNull($emptyCursor->first());
    }

    #[Test]
    public function cursorMap(): void
    {
        $documents = [
            ['_id' => '1', 'name' => 'Alice'],
            ['_id' => '2', 'name' => 'Bob'],
        ];

        $cursor = new Cursor(fn() => $documents);
        $names = $cursor->map(fn($doc) => $doc['name']);

        $this->assertEquals(['Alice', 'Bob'], $names);
    }

    #[Test]
    public function cursorFilter(): void
    {
        $documents = [
            ['_id' => '1', 'name' => 'Alice', 'age' => 25],
            ['_id' => '2', 'name' => 'Bob', 'age' => 17],
            ['_id' => '3', 'name' => 'Charlie', 'age' => 30],
        ];

        $cursor = new Cursor(fn() => $documents);
        $adults = $cursor->filter(fn($doc) => $doc['age'] >= 18);

        $this->assertCount(2, $adults);
        $this->assertEquals('Alice', $adults[0]['name']);
        $this->assertEquals('Charlie', $adults[1]['name']);
    }

    #[Test]
    public function cursorReduce(): void
    {
        $documents = [
            ['_id' => '1', 'value' => 10],
            ['_id' => '2', 'value' => 20],
            ['_id' => '3', 'value' => 30],
        ];

        $cursor = new Cursor(fn() => $documents);
        $sum = $cursor->reduce(fn($acc, $doc) => $acc + $doc['value'], 0);

        $this->assertEquals(60, $sum);
    }

    #[Test]
    public function cursorCount(): void
    {
        $documents = [
            ['_id' => '1'],
            ['_id' => '2'],
            ['_id' => '3'],
        ];

        $cursor = new Cursor(fn() => $documents);
        $this->assertCount(3, $cursor);
    }

    #[Test]
    public function findOptionsConfiguration(): void
    {
        $options = new FindOptions(
            projection: ['name' => 1, 'email' => 1],
            sort: ['createdAt' => -1],
            limit: 10,
            skip: 5,
            hint: 'name_1',
            maxTimeMS: 5000,
            allowDiskUse: true,
            readPreference: ReadPreference::Secondary,
            collation: ['locale' => 'en'],
        );

        $array = $options->toArray();

        $this->assertEquals(['name' => 1, 'email' => 1], $array['projection']);
        $this->assertEquals(['createdAt' => -1], $array['sort']);
        $this->assertEquals(10, $array['limit']);
        $this->assertEquals(5, $array['skip']);
        $this->assertEquals('name_1', $array['hint']);
        $this->assertEquals(5000, $array['maxTimeMS']);
        $this->assertTrue($array['allowDiskUse']);
        $this->assertEquals('secondary', $array['readPreference']);
        $this->assertEquals(['locale' => 'en'], $array['collation']);
    }

    #[Test]
    public function insertOptionsConfiguration(): void
    {
        $options = new InsertOptions(
            ordered: false,
            writeConcern: WriteConcern::Majority,
            bypassDocumentValidation: true,
        );

        $array = $options->toArray();

        $this->assertFalse($array['ordered']);
        $this->assertEquals('majority', $array['writeConcern']);
        $this->assertTrue($array['bypassDocumentValidation']);
    }

    #[Test]
    public function updateOptionsConfiguration(): void
    {
        $options = new UpdateOptions(
            upsert: true,
            writeConcern: WriteConcern::Acknowledged,
            bypassDocumentValidation: false,
            arrayFilters: [['elem.score' => ['$gte' => 80]]],
            collation: ['locale' => 'en'],
        );

        $array = $options->toArray();

        $this->assertTrue($array['upsert']);
        $this->assertEquals('acknowledged', $array['writeConcern']);
        $this->assertFalse($array['bypassDocumentValidation']);
        $this->assertEquals([['elem.score' => ['$gte' => 80]]], $array['arrayFilters']);
        $this->assertEquals(['locale' => 'en'], $array['collation']);
    }

    #[Test]
    public function insertResultProperties(): void
    {
        $id = new ObjectId();
        $result = new InsertResult(
            acknowledged: true,
            insertedId: $id,
        );

        $this->assertTrue($result->acknowledged);
        $this->assertSame($id, $result->insertedId);
    }

    #[Test]
    public function insertManyResultProperties(): void
    {
        $ids = [new ObjectId(), new ObjectId(), new ObjectId()];
        $result = new InsertManyResult(
            acknowledged: true,
            insertedIds: $ids,
            insertedCount: 3,
        );

        $this->assertTrue($result->acknowledged);
        $this->assertCount(3, $result->insertedIds);
        $this->assertEquals(3, $result->insertedCount);
    }

    #[Test]
    public function updateResultProperties(): void
    {
        $result = new UpdateResult(
            acknowledged: true,
            matchedCount: 5,
            modifiedCount: 3,
            upsertedId: null,
        );

        $this->assertTrue($result->acknowledged);
        $this->assertEquals(5, $result->matchedCount);
        $this->assertEquals(3, $result->modifiedCount);
        $this->assertFalse($result->wasUpserted());

        $upsertResult = new UpdateResult(
            acknowledged: true,
            matchedCount: 0,
            modifiedCount: 0,
            upsertedId: new ObjectId(),
        );

        $this->assertTrue($upsertResult->wasUpserted());
    }

    #[Test]
    public function deleteResultProperties(): void
    {
        $result = new DeleteResult(
            acknowledged: true,
            deletedCount: 7,
        );

        $this->assertTrue($result->acknowledged);
        $this->assertEquals(7, $result->deletedCount);
    }

    #[Test]
    public function mongoClientConfigDefaults(): void
    {
        $config = new MongoClientConfig();

        $this->assertEquals('mongodb://localhost:27017', $config->url);
        $this->assertEquals(30, $config->timeout);
        $this->assertEquals(10, $config->maxPoolSize);
        $this->assertEquals(1, $config->minPoolSize);
        $this->assertTrue($config->retryWrites);
        $this->assertTrue($config->retryReads);
    }

    #[Test]
    public function mongoClientConfigCustom(): void
    {
        $config = new MongoClientConfig(
            url: 'mongodb://myhost:27018',
            database: 'mydb',
            timeout: 60,
            maxPoolSize: 20,
            authSource: 'admin',
            replicaSet: 'rs0',
            readPreference: ReadPreference::SecondaryPreferred,
            writeConcern: WriteConcern::Majority,
            appName: 'MyApp',
        );

        $this->assertEquals('mongodb://myhost:27018', $config->url);
        $this->assertEquals('mydb', $config->database);
        $this->assertEquals(60, $config->timeout);
        $this->assertEquals(20, $config->maxPoolSize);
        $this->assertEquals('admin', $config->authSource);
        $this->assertEquals('rs0', $config->replicaSet);
        $this->assertEquals(ReadPreference::SecondaryPreferred, $config->readPreference);
        $this->assertEquals(WriteConcern::Majority, $config->writeConcern);
        $this->assertEquals('MyApp', $config->appName);
    }

    #[Test]
    public function mongoClientCreation(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');

        $this->assertTrue($client->isConnected());
        $this->assertInstanceOf(MongoClientConfig::class, $client->getConfig());

        $client->close();
        $this->assertFalse($client->isConnected());
    }

    #[Test]
    public function mongoClientDatabaseAccess(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');

        $db = $client->database('testdb');
        $this->assertInstanceOf(Database::class, $db);
        $this->assertEquals('testdb', $db->getName());

        // Magic getter access
        $db2 = $client->mydb;
        $this->assertInstanceOf(Database::class, $db2);
        $this->assertEquals('mydb', $db2->getName());

        $client->close();
    }

    #[Test]
    public function databaseCollectionAccess(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');
        $db = $client->database('testdb');

        $collection = $db->collection('users');
        $this->assertInstanceOf(Collection::class, $collection);
        $this->assertEquals('users', $collection->getName());
        $this->assertEquals('testdb', $collection->getDatabase());
        $this->assertEquals('testdb.users', $collection->getNamespace());

        // Magic getter access
        $collection2 = $db->posts;
        $this->assertInstanceOf(Collection::class, $collection2);
        $this->assertEquals('posts', $collection2->getName());

        $client->close();
    }

    #[Test]
    public function collectionFindReturnssCursor(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');
        $collection = $client->database('testdb')->collection('users');

        $cursor = $collection->find(Filter::eq('status', 'active'));
        $this->assertInstanceOf(Cursor::class, $cursor);

        $cursor2 = $collection->find(['status' => 'active']);
        $this->assertInstanceOf(Cursor::class, $cursor2);

        $client->close();
    }

    #[Test]
    public function queryBuilderFluent(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');
        $collection = $client->database('testdb')->collection('users');

        $query = $collection
            ->where(Filter::eq('status', 'active'))
            ->select(['name' => 1, 'email' => 1])
            ->orderByDesc('createdAt')
            ->limit(10)
            ->skip(5);

        $this->assertInstanceOf(QueryBuilder::class, $query);

        $cursor = $query->get();
        $this->assertInstanceOf(Cursor::class, $cursor);

        $client->close();
    }

    #[Test]
    public function queryBuilderImmutable(): void
    {
        $client = MongoClient::connect('mongodb://localhost:27017');
        $collection = $client->database('testdb')->collection('users');

        $query1 = $collection->where(Filter::eq('status', 'active'));
        $query2 = $query1->limit(10);
        $query3 = $query2->orderByDesc('createdAt');

        // Each should be independent
        $this->assertNotSame($query1, $query2);
        $this->assertNotSame($query2, $query3);

        $client->close();
    }

    #[Test]
    public function sortDirectionEnum(): void
    {
        $this->assertEquals(1, SortDirection::Ascending->value);
        $this->assertEquals(-1, SortDirection::Descending->value);
    }

    #[Test]
    public function writeConcernEnum(): void
    {
        $this->assertEquals('majority', WriteConcern::Majority->value);
        $this->assertEquals('acknowledged', WriteConcern::Acknowledged->value);
        $this->assertEquals('unacknowledged', WriteConcern::Unacknowledged->value);
        $this->assertEquals('journaled', WriteConcern::Journaled->value);
    }

    #[Test]
    public function readPreferenceEnum(): void
    {
        $this->assertEquals('primary', ReadPreference::Primary->value);
        $this->assertEquals('primaryPreferred', ReadPreference::PrimaryPreferred->value);
        $this->assertEquals('secondary', ReadPreference::Secondary->value);
        $this->assertEquals('secondaryPreferred', ReadPreference::SecondaryPreferred->value);
        $this->assertEquals('nearest', ReadPreference::Nearest->value);
    }

    #[Test]
    public function mongoExceptionProperties(): void
    {
        $exception = new MongoException(
            message: 'Test error',
            code: 'CONN_ERROR',
            details: ['host' => 'localhost'],
        );

        $this->assertEquals('Test error', $exception->getMessage());
        $this->assertEquals('CONN_ERROR', $exception->code);
        $this->assertEquals(['host' => 'localhost'], $exception->details);
    }

    #[Test]
    public function writeExceptionProperties(): void
    {
        $exception = new WriteException(
            message: 'Write failed',
            writeErrorsCount: 2,
            writeErrors: [
                ['index' => 0, 'code' => 11000, 'message' => 'Duplicate key'],
                ['index' => 1, 'code' => 121, 'message' => 'Validation failed'],
            ],
        );

        $this->assertEquals('Write failed', $exception->getMessage());
        $this->assertEquals(2, $exception->writeErrorsCount);
        $this->assertCount(2, $exception->writeErrors);
    }

    #[Test]
    public function duplicateKeyExceptionProperties(): void
    {
        $exception = new DuplicateKeyException(
            message: 'Duplicate key error',
            duplicateKey: ['email' => 'test@example.com'],
        );

        $this->assertEquals('Duplicate key error', $exception->getMessage());
        $this->assertEquals(['email' => 'test@example.com'], $exception->duplicateKey);
    }

    #[Test]
    public function helperFunctions(): void
    {
        $filter = \DotDo\Mongo\filter(['status' => 'active']);
        $this->assertInstanceOf(Filter::class, $filter);
        $this->assertEquals(['status' => 'active'], $filter->toArray());

        $pipeline = \DotDo\Mongo\pipeline();
        $this->assertInstanceOf(Pipeline::class, $pipeline);
        $this->assertEquals([], $pipeline->toArray());

        $id = \DotDo\Mongo\objectId();
        $this->assertInstanceOf(ObjectId::class, $id);

        $specificId = \DotDo\Mongo\objectId('507f1f77bcf86cd799439011');
        $this->assertEquals('507f1f77bcf86cd799439011', $specificId->toString());
    }
}
