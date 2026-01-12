<?php

declare(strict_types=1);

namespace DotDo\Mongo;

use Closure;
use JsonSerializable;
use Stringable;

/**
 * Sort direction for queries
 */
enum SortDirection: int
{
    case Ascending = 1;
    case Descending = -1;
}

/**
 * Write concern levels
 */
enum WriteConcern: string
{
    case Majority = 'majority';
    case Acknowledged = 'acknowledged';
    case Unacknowledged = 'unacknowledged';
    case Journaled = 'journaled';
}

/**
 * Read preference modes
 */
enum ReadPreference: string
{
    case Primary = 'primary';
    case PrimaryPreferred = 'primaryPreferred';
    case Secondary = 'secondary';
    case SecondaryPreferred = 'secondaryPreferred';
    case Nearest = 'nearest';
}

/**
 * MongoDB exception for database errors
 */
class MongoException extends \Exception
{
    public function __construct(
        string $message,
        public readonly ?string $code = null,
        public readonly ?array $details = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 0, $previous);
    }
}

/**
 * Exception for write operation errors
 */
class WriteException extends MongoException
{
    public function __construct(
        string $message,
        public readonly ?int $writeErrorsCount = null,
        public readonly array $writeErrors = [],
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 'WRITE_ERROR', ['writeErrors' => $writeErrors], $previous);
    }
}

/**
 * Exception for duplicate key errors
 */
class DuplicateKeyException extends WriteException
{
    public function __construct(
        string $message = 'Duplicate key error',
        public readonly mixed $duplicateKey = null,
        ?\Throwable $previous = null,
    ) {
        parent::__construct($message, 1, [], $previous);
    }
}

/**
 * ObjectId representation for MongoDB documents
 */
readonly class ObjectId implements Stringable, JsonSerializable
{
    private string $id;

    public function __construct(?string $id = null)
    {
        $this->id = $id ?? $this->generate();
    }

    /**
     * Generate a new ObjectId
     */
    private function generate(): string
    {
        // 12-byte ObjectId: 4 timestamp + 5 random + 3 counter
        $timestamp = dechex(time());
        $machineId = substr(md5(gethostname()), 0, 10);
        $counter = dechex(random_int(0, 16777215));

        return str_pad($timestamp, 8, '0', STR_PAD_LEFT)
            . $machineId
            . str_pad($counter, 6, '0', STR_PAD_LEFT);
    }

    public function __toString(): string
    {
        return $this->id;
    }

    public function toString(): string
    {
        return $this->id;
    }

    public function getTimestamp(): int
    {
        return hexdec(substr($this->id, 0, 8));
    }

    public function jsonSerialize(): array
    {
        return ['$oid' => $this->id];
    }

    public static function fromString(string $id): self
    {
        return new self($id);
    }

    public function equals(ObjectId $other): bool
    {
        return $this->id === $other->id;
    }
}

/**
 * Query filter builder for MongoDB-style queries
 */
class Filter implements JsonSerializable
{
    private array $conditions = [];

    private function __construct(array $conditions = [])
    {
        $this->conditions = $conditions;
    }

    /**
     * Create a new filter with equality condition
     */
    public static function eq(string $field, mixed $value): self
    {
        return new self([$field => $value]);
    }

    /**
     * Create a new filter with not-equal condition
     */
    public static function ne(string $field, mixed $value): self
    {
        return new self([$field => ['$ne' => $value]]);
    }

    /**
     * Create a new filter with greater-than condition
     */
    public static function gt(string $field, mixed $value): self
    {
        return new self([$field => ['$gt' => $value]]);
    }

    /**
     * Create a new filter with greater-than-or-equal condition
     */
    public static function gte(string $field, mixed $value): self
    {
        return new self([$field => ['$gte' => $value]]);
    }

    /**
     * Create a new filter with less-than condition
     */
    public static function lt(string $field, mixed $value): self
    {
        return new self([$field => ['$lt' => $value]]);
    }

    /**
     * Create a new filter with less-than-or-equal condition
     */
    public static function lte(string $field, mixed $value): self
    {
        return new self([$field => ['$lte' => $value]]);
    }

    /**
     * Create a new filter with in-array condition
     */
    public static function in(string $field, array $values): self
    {
        return new self([$field => ['$in' => $values]]);
    }

    /**
     * Create a new filter with not-in-array condition
     */
    public static function nin(string $field, array $values): self
    {
        return new self([$field => ['$nin' => $values]]);
    }

    /**
     * Create a new filter with exists condition
     */
    public static function exists(string $field, bool $exists = true): self
    {
        return new self([$field => ['$exists' => $exists]]);
    }

    /**
     * Create a new filter with type condition
     */
    public static function type(string $field, string $type): self
    {
        return new self([$field => ['$type' => $type]]);
    }

    /**
     * Create a new filter with regex condition
     */
    public static function regex(string $field, string $pattern, string $options = ''): self
    {
        return new self([$field => ['$regex' => $pattern, '$options' => $options]]);
    }

    /**
     * Create a new filter with text search
     */
    public static function text(string $search, ?string $language = null): self
    {
        $textQuery = ['$search' => $search];
        if ($language !== null) {
            $textQuery['$language'] = $language;
        }
        return new self(['$text' => $textQuery]);
    }

    /**
     * Create a new filter with array element match
     */
    public static function elemMatch(string $field, array $conditions): self
    {
        return new self([$field => ['$elemMatch' => $conditions]]);
    }

    /**
     * Create a new filter with array size condition
     */
    public static function size(string $field, int $size): self
    {
        return new self([$field => ['$size' => $size]]);
    }

    /**
     * Create a new filter with all-in-array condition
     */
    public static function all(string $field, array $values): self
    {
        return new self([$field => ['$all' => $values]]);
    }

    /**
     * Create a filter from an array of conditions
     */
    public static function fromArray(array $conditions): self
    {
        return new self($conditions);
    }

    /**
     * Combine filters with AND logic
     */
    public function and(Filter ...$filters): self
    {
        $allConditions = [$this->conditions];
        foreach ($filters as $filter) {
            $allConditions[] = $filter->conditions;
        }

        return new self(['$and' => $allConditions]);
    }

    /**
     * Combine filters with OR logic
     */
    public function or(Filter ...$filters): self
    {
        $allConditions = [$this->conditions];
        foreach ($filters as $filter) {
            $allConditions[] = $filter->conditions;
        }

        return new self(['$or' => $allConditions]);
    }

    /**
     * Negate this filter
     */
    public function not(): self
    {
        return new self(['$not' => $this->conditions]);
    }

    /**
     * Combine filters with NOR logic
     */
    public function nor(Filter ...$filters): self
    {
        $allConditions = [$this->conditions];
        foreach ($filters as $filter) {
            $allConditions[] = $filter->conditions;
        }

        return new self(['$nor' => $allConditions]);
    }

    public function toArray(): array
    {
        return $this->conditions;
    }

    public function jsonSerialize(): array
    {
        return $this->conditions;
    }
}

/**
 * Update builder for MongoDB-style updates
 */
class Update implements JsonSerializable
{
    private array $operations = [];

    private function __construct(array $operations = [])
    {
        $this->operations = $operations;
    }

    /**
     * Set field values
     */
    public static function set(array $fields): self
    {
        return new self(['$set' => $fields]);
    }

    /**
     * Unset fields
     */
    public static function unset(string ...$fields): self
    {
        $unsetFields = array_fill_keys($fields, '');
        return new self(['$unset' => $unsetFields]);
    }

    /**
     * Increment field values
     */
    public static function inc(array $fields): self
    {
        return new self(['$inc' => $fields]);
    }

    /**
     * Multiply field values
     */
    public static function mul(array $fields): self
    {
        return new self(['$mul' => $fields]);
    }

    /**
     * Set minimum value
     */
    public static function min(array $fields): self
    {
        return new self(['$min' => $fields]);
    }

    /**
     * Set maximum value
     */
    public static function max(array $fields): self
    {
        return new self(['$max' => $fields]);
    }

    /**
     * Rename fields
     */
    public static function rename(array $fields): self
    {
        return new self(['$rename' => $fields]);
    }

    /**
     * Set field on insert only
     */
    public static function setOnInsert(array $fields): self
    {
        return new self(['$setOnInsert' => $fields]);
    }

    /**
     * Set current date
     */
    public static function currentDate(string ...$fields): self
    {
        $currentDateFields = array_fill_keys($fields, true);
        return new self(['$currentDate' => $currentDateFields]);
    }

    /**
     * Push to array
     */
    public static function push(string $field, mixed $value): self
    {
        return new self(['$push' => [$field => $value]]);
    }

    /**
     * Push multiple values to array
     */
    public static function pushAll(string $field, array $values): self
    {
        return new self(['$push' => [$field => ['$each' => $values]]]);
    }

    /**
     * Add to set (unique values only)
     */
    public static function addToSet(string $field, mixed $value): self
    {
        return new self(['$addToSet' => [$field => $value]]);
    }

    /**
     * Pop from array
     */
    public static function pop(string $field, int $position = 1): self
    {
        return new self(['$pop' => [$field => $position]]);
    }

    /**
     * Pull from array
     */
    public static function pull(string $field, mixed $value): self
    {
        return new self(['$pull' => [$field => $value]]);
    }

    /**
     * Pull all matching values from array
     */
    public static function pullAll(string $field, array $values): self
    {
        return new self(['$pullAll' => [$field => $values]]);
    }

    /**
     * Combine with another update
     */
    public function merge(Update $other): self
    {
        $merged = $this->operations;

        foreach ($other->operations as $operator => $fields) {
            if (isset($merged[$operator])) {
                $merged[$operator] = array_merge($merged[$operator], $fields);
            } else {
                $merged[$operator] = $fields;
            }
        }

        return new self($merged);
    }

    public function toArray(): array
    {
        return $this->operations;
    }

    public function jsonSerialize(): array
    {
        return $this->operations;
    }
}

/**
 * Aggregation pipeline builder
 */
class Pipeline implements JsonSerializable
{
    /** @var array<int, array> */
    private array $stages = [];

    /**
     * Add a $match stage
     */
    public function match(Filter|array $filter): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$match' => $filter instanceof Filter ? $filter->toArray() : $filter];
        return $clone;
    }

    /**
     * Add a $project stage
     */
    public function project(array $projection): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$project' => $projection];
        return $clone;
    }

    /**
     * Add a $group stage
     */
    public function group(string|array $id, array $accumulators = []): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$group' => array_merge(['_id' => $id], $accumulators)];
        return $clone;
    }

    /**
     * Add a $sort stage
     */
    public function sort(array $sort): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$sort' => $sort];
        return $clone;
    }

    /**
     * Add a $limit stage
     */
    public function limit(int $limit): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$limit' => $limit];
        return $clone;
    }

    /**
     * Add a $skip stage
     */
    public function skip(int $skip): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$skip' => $skip];
        return $clone;
    }

    /**
     * Add a $unwind stage
     */
    public function unwind(string $path, bool $preserveNullAndEmpty = false): self
    {
        $clone = clone $this;
        if ($preserveNullAndEmpty) {
            $clone->stages[] = ['$unwind' => ['path' => $path, 'preserveNullAndEmptyArrays' => true]];
        } else {
            $clone->stages[] = ['$unwind' => $path];
        }
        return $clone;
    }

    /**
     * Add a $lookup stage
     */
    public function lookup(string $from, string $localField, string $foreignField, string $as): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$lookup' => [
            'from' => $from,
            'localField' => $localField,
            'foreignField' => $foreignField,
            'as' => $as,
        ]];
        return $clone;
    }

    /**
     * Add a $addFields stage
     */
    public function addFields(array $fields): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$addFields' => $fields];
        return $clone;
    }

    /**
     * Add a $count stage
     */
    public function count(string $field = 'count'): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$count' => $field];
        return $clone;
    }

    /**
     * Add a $facet stage
     */
    public function facet(array $facets): self
    {
        $clone = clone $this;
        $processedFacets = [];
        foreach ($facets as $name => $pipeline) {
            $processedFacets[$name] = $pipeline instanceof Pipeline
                ? $pipeline->toArray()
                : $pipeline;
        }
        $clone->stages[] = ['$facet' => $processedFacets];
        return $clone;
    }

    /**
     * Add a $bucket stage
     */
    public function bucket(string $groupBy, array $boundaries, mixed $default, array $output): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$bucket' => [
            'groupBy' => $groupBy,
            'boundaries' => $boundaries,
            'default' => $default,
            'output' => $output,
        ]];
        return $clone;
    }

    /**
     * Add a $sample stage
     */
    public function sample(int $size): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$sample' => ['size' => $size]];
        return $clone;
    }

    /**
     * Add a $out stage
     */
    public function out(string $collection): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$out' => $collection];
        return $clone;
    }

    /**
     * Add a $merge stage
     */
    public function mergeInto(string $collection, array $options = []): self
    {
        $clone = clone $this;
        $clone->stages[] = ['$merge' => array_merge(['into' => $collection], $options)];
        return $clone;
    }

    public function toArray(): array
    {
        return $this->stages;
    }

    public function jsonSerialize(): array
    {
        return $this->stages;
    }
}

/**
 * Query options for find operations
 */
readonly class FindOptions
{
    public function __construct(
        public ?array $projection = null,
        public ?array $sort = null,
        public ?int $limit = null,
        public ?int $skip = null,
        public ?string $hint = null,
        public ?int $maxTimeMS = null,
        public ?bool $allowDiskUse = null,
        public ?ReadPreference $readPreference = null,
        public ?array $collation = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'projection' => $this->projection,
            'sort' => $this->sort,
            'limit' => $this->limit,
            'skip' => $this->skip,
            'hint' => $this->hint,
            'maxTimeMS' => $this->maxTimeMS,
            'allowDiskUse' => $this->allowDiskUse,
            'readPreference' => $this->readPreference?->value,
            'collation' => $this->collation,
        ], fn($v) => $v !== null);
    }
}

/**
 * Options for insert operations
 */
readonly class InsertOptions
{
    public function __construct(
        public ?bool $ordered = null,
        public ?WriteConcern $writeConcern = null,
        public ?bool $bypassDocumentValidation = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'ordered' => $this->ordered,
            'writeConcern' => $this->writeConcern?->value,
            'bypassDocumentValidation' => $this->bypassDocumentValidation,
        ], fn($v) => $v !== null);
    }
}

/**
 * Options for update operations
 */
readonly class UpdateOptions
{
    public function __construct(
        public ?bool $upsert = null,
        public ?WriteConcern $writeConcern = null,
        public ?bool $bypassDocumentValidation = null,
        public ?array $arrayFilters = null,
        public ?array $collation = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'upsert' => $this->upsert,
            'writeConcern' => $this->writeConcern?->value,
            'bypassDocumentValidation' => $this->bypassDocumentValidation,
            'arrayFilters' => $this->arrayFilters,
            'collation' => $this->collation,
        ], fn($v) => $v !== null);
    }
}

/**
 * Options for delete operations
 */
readonly class DeleteOptions
{
    public function __construct(
        public ?WriteConcern $writeConcern = null,
        public ?array $collation = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'writeConcern' => $this->writeConcern?->value,
            'collation' => $this->collation,
        ], fn($v) => $v !== null);
    }
}

/**
 * Result of an insert operation
 */
readonly class InsertResult
{
    public function __construct(
        public bool $acknowledged,
        public ObjectId|string $insertedId,
    ) {}
}

/**
 * Result of an insert many operation
 */
readonly class InsertManyResult
{
    public function __construct(
        public bool $acknowledged,
        public array $insertedIds,
        public int $insertedCount,
    ) {}
}

/**
 * Result of an update operation
 */
readonly class UpdateResult
{
    public function __construct(
        public bool $acknowledged,
        public int $matchedCount,
        public int $modifiedCount,
        public mixed $upsertedId = null,
    ) {}

    public function wasUpserted(): bool
    {
        return $this->upsertedId !== null;
    }
}

/**
 * Result of a delete operation
 */
readonly class DeleteResult
{
    public function __construct(
        public bool $acknowledged,
        public int $deletedCount,
    ) {}
}

/**
 * Cursor for iterating over query results
 *
 * @template T
 */
class Cursor implements \Iterator, \Countable
{
    private int $position = 0;
    private array $documents = [];
    private bool $executed = false;

    /**
     * @param Closure(): array<T> $executor
     */
    public function __construct(
        private readonly Closure $executor,
        private readonly ?string $cursorId = null,
    ) {}

    /**
     * Execute the query and load documents
     */
    private function execute(): void
    {
        if (!$this->executed) {
            $this->documents = ($this->executor)();
            $this->executed = true;
        }
    }

    /**
     * Get all documents as an array
     *
     * @return array<T>
     */
    public function toArray(): array
    {
        $this->execute();
        return $this->documents;
    }

    /**
     * Get the first document or null
     *
     * @return T|null
     */
    public function first(): mixed
    {
        $this->execute();
        return $this->documents[0] ?? null;
    }

    /**
     * Map over all documents
     *
     * @template U
     * @param Closure(T): U $callback
     * @return array<U>
     */
    public function map(Closure $callback): array
    {
        $this->execute();
        return array_map($callback, $this->documents);
    }

    /**
     * Filter documents
     *
     * @param Closure(T): bool $predicate
     * @return array<T>
     */
    public function filter(Closure $predicate): array
    {
        $this->execute();
        return array_values(array_filter($this->documents, $predicate));
    }

    /**
     * Reduce documents to a single value
     *
     * @template U
     * @param Closure(U, T): U $callback
     * @param U $initial
     * @return U
     */
    public function reduce(Closure $callback, mixed $initial = null): mixed
    {
        $this->execute();
        return array_reduce($this->documents, $callback, $initial);
    }

    // Iterator implementation
    public function current(): mixed
    {
        $this->execute();
        return $this->documents[$this->position] ?? null;
    }

    public function key(): int
    {
        return $this->position;
    }

    public function next(): void
    {
        $this->position++;
    }

    public function rewind(): void
    {
        $this->execute();
        $this->position = 0;
    }

    public function valid(): bool
    {
        $this->execute();
        return isset($this->documents[$this->position]);
    }

    public function count(): int
    {
        $this->execute();
        return count($this->documents);
    }

    public function getCursorId(): ?string
    {
        return $this->cursorId;
    }
}

/**
 * Collection interface for MongoDB operations
 */
class Collection
{
    public function __construct(
        private readonly MongoClient $client,
        private readonly string $database,
        private readonly string $name,
    ) {}

    /**
     * Get the collection name
     */
    public function getName(): string
    {
        return $this->name;
    }

    /**
     * Get the database name
     */
    public function getDatabase(): string
    {
        return $this->database;
    }

    /**
     * Get the full namespace (database.collection)
     */
    public function getNamespace(): string
    {
        return "{$this->database}.{$this->name}";
    }

    /**
     * Find documents matching a filter
     *
     * @template T
     * @return Cursor<T>
     */
    public function find(Filter|array $filter = [], ?FindOptions $options = null): Cursor
    {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;
        $optionsArray = $options?->toArray() ?? [];

        return new Cursor(
            executor: fn() => $this->client->execute('find', [
                'database' => $this->database,
                'collection' => $this->name,
                'filter' => $filterArray,
                'options' => $optionsArray,
            ]),
        );
    }

    /**
     * Find a single document
     *
     * @template T
     * @return T|null
     */
    public function findOne(Filter|array $filter = [], ?FindOptions $options = null): mixed
    {
        $options = $options ?? new FindOptions();
        $cursor = $this->find($filter, new FindOptions(
            projection: $options->projection,
            sort: $options->sort,
            limit: 1,
            skip: $options->skip,
            hint: $options->hint,
            maxTimeMS: $options->maxTimeMS,
            readPreference: $options->readPreference,
            collation: $options->collation,
        ));

        return $cursor->first();
    }

    /**
     * Find a document by its _id
     *
     * @template T
     * @return T|null
     */
    public function findById(ObjectId|string $id): mixed
    {
        $idValue = $id instanceof ObjectId ? ['$oid' => $id->toString()] : $id;
        return $this->findOne(Filter::eq('_id', $idValue));
    }

    /**
     * Insert a single document
     */
    public function insertOne(array $document, ?InsertOptions $options = null): InsertResult
    {
        // Generate _id if not present
        if (!isset($document['_id'])) {
            $document['_id'] = new ObjectId();
        }

        $result = $this->client->execute('insertOne', [
            'database' => $this->database,
            'collection' => $this->name,
            'document' => $document,
            'options' => $options?->toArray() ?? [],
        ]);

        return new InsertResult(
            acknowledged: $result['acknowledged'] ?? true,
            insertedId: $document['_id'],
        );
    }

    /**
     * Insert multiple documents
     */
    public function insertMany(array $documents, ?InsertOptions $options = null): InsertManyResult
    {
        // Generate _ids if not present
        $insertedIds = [];
        foreach ($documents as $i => $doc) {
            if (!isset($doc['_id'])) {
                $documents[$i]['_id'] = new ObjectId();
            }
            $insertedIds[] = $documents[$i]['_id'];
        }

        $result = $this->client->execute('insertMany', [
            'database' => $this->database,
            'collection' => $this->name,
            'documents' => $documents,
            'options' => $options?->toArray() ?? [],
        ]);

        return new InsertManyResult(
            acknowledged: $result['acknowledged'] ?? true,
            insertedIds: $insertedIds,
            insertedCount: count($documents),
        );
    }

    /**
     * Update a single document
     */
    public function updateOne(
        Filter|array $filter,
        Update|array $update,
        ?UpdateOptions $options = null,
    ): UpdateResult {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;
        $updateArray = $update instanceof Update ? $update->toArray() : $update;

        $result = $this->client->execute('updateOne', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'update' => $updateArray,
            'options' => $options?->toArray() ?? [],
        ]);

        return new UpdateResult(
            acknowledged: $result['acknowledged'] ?? true,
            matchedCount: $result['matchedCount'] ?? 0,
            modifiedCount: $result['modifiedCount'] ?? 0,
            upsertedId: $result['upsertedId'] ?? null,
        );
    }

    /**
     * Update multiple documents
     */
    public function updateMany(
        Filter|array $filter,
        Update|array $update,
        ?UpdateOptions $options = null,
    ): UpdateResult {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;
        $updateArray = $update instanceof Update ? $update->toArray() : $update;

        $result = $this->client->execute('updateMany', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'update' => $updateArray,
            'options' => $options?->toArray() ?? [],
        ]);

        return new UpdateResult(
            acknowledged: $result['acknowledged'] ?? true,
            matchedCount: $result['matchedCount'] ?? 0,
            modifiedCount: $result['modifiedCount'] ?? 0,
            upsertedId: $result['upsertedId'] ?? null,
        );
    }

    /**
     * Replace a single document
     */
    public function replaceOne(
        Filter|array $filter,
        array $replacement,
        ?UpdateOptions $options = null,
    ): UpdateResult {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('replaceOne', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'replacement' => $replacement,
            'options' => $options?->toArray() ?? [],
        ]);

        return new UpdateResult(
            acknowledged: $result['acknowledged'] ?? true,
            matchedCount: $result['matchedCount'] ?? 0,
            modifiedCount: $result['modifiedCount'] ?? 0,
            upsertedId: $result['upsertedId'] ?? null,
        );
    }

    /**
     * Delete a single document
     */
    public function deleteOne(Filter|array $filter, ?DeleteOptions $options = null): DeleteResult
    {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('deleteOne', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'options' => $options?->toArray() ?? [],
        ]);

        return new DeleteResult(
            acknowledged: $result['acknowledged'] ?? true,
            deletedCount: $result['deletedCount'] ?? 0,
        );
    }

    /**
     * Delete multiple documents
     */
    public function deleteMany(Filter|array $filter, ?DeleteOptions $options = null): DeleteResult
    {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('deleteMany', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'options' => $options?->toArray() ?? [],
        ]);

        return new DeleteResult(
            acknowledged: $result['acknowledged'] ?? true,
            deletedCount: $result['deletedCount'] ?? 0,
        );
    }

    /**
     * Count documents matching a filter
     */
    public function countDocuments(Filter|array $filter = []): int
    {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('countDocuments', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
        ]);

        return $result['count'] ?? 0;
    }

    /**
     * Get an estimated document count (fast, uses metadata)
     */
    public function estimatedDocumentCount(): int
    {
        $result = $this->client->execute('estimatedDocumentCount', [
            'database' => $this->database,
            'collection' => $this->name,
        ]);

        return $result['count'] ?? 0;
    }

    /**
     * Get distinct values for a field
     */
    public function distinct(string $field, Filter|array $filter = []): array
    {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('distinct', [
            'database' => $this->database,
            'collection' => $this->name,
            'field' => $field,
            'filter' => $filterArray,
        ]);

        return $result['values'] ?? [];
    }

    /**
     * Run an aggregation pipeline
     */
    public function aggregate(Pipeline|array $pipeline): Cursor
    {
        $pipelineArray = $pipeline instanceof Pipeline ? $pipeline->toArray() : $pipeline;

        return new Cursor(
            executor: fn() => $this->client->execute('aggregate', [
                'database' => $this->database,
                'collection' => $this->name,
                'pipeline' => $pipelineArray,
            ]),
        );
    }

    /**
     * Find and update a document atomically
     */
    public function findOneAndUpdate(
        Filter|array $filter,
        Update|array $update,
        array $options = [],
    ): ?array {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;
        $updateArray = $update instanceof Update ? $update->toArray() : $update;

        $result = $this->client->execute('findOneAndUpdate', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'update' => $updateArray,
            'options' => $options,
        ]);

        return $result['value'] ?? null;
    }

    /**
     * Find and replace a document atomically
     */
    public function findOneAndReplace(
        Filter|array $filter,
        array $replacement,
        array $options = [],
    ): ?array {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('findOneAndReplace', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'replacement' => $replacement,
            'options' => $options,
        ]);

        return $result['value'] ?? null;
    }

    /**
     * Find and delete a document atomically
     */
    public function findOneAndDelete(
        Filter|array $filter,
        array $options = [],
    ): ?array {
        $filterArray = $filter instanceof Filter ? $filter->toArray() : $filter;

        $result = $this->client->execute('findOneAndDelete', [
            'database' => $this->database,
            'collection' => $this->name,
            'filter' => $filterArray,
            'options' => $options,
        ]);

        return $result['value'] ?? null;
    }

    /**
     * Create an index
     */
    public function createIndex(array $keys, array $options = []): string
    {
        $result = $this->client->execute('createIndex', [
            'database' => $this->database,
            'collection' => $this->name,
            'keys' => $keys,
            'options' => $options,
        ]);

        return $result['name'] ?? '';
    }

    /**
     * Create multiple indexes
     */
    public function createIndexes(array $indexes): array
    {
        $result = $this->client->execute('createIndexes', [
            'database' => $this->database,
            'collection' => $this->name,
            'indexes' => $indexes,
        ]);

        return $result['names'] ?? [];
    }

    /**
     * Drop an index
     */
    public function dropIndex(string $name): void
    {
        $this->client->execute('dropIndex', [
            'database' => $this->database,
            'collection' => $this->name,
            'name' => $name,
        ]);
    }

    /**
     * Drop all indexes
     */
    public function dropIndexes(): void
    {
        $this->client->execute('dropIndexes', [
            'database' => $this->database,
            'collection' => $this->name,
        ]);
    }

    /**
     * List all indexes
     */
    public function listIndexes(): array
    {
        $result = $this->client->execute('listIndexes', [
            'database' => $this->database,
            'collection' => $this->name,
        ]);

        return $result['indexes'] ?? [];
    }

    /**
     * Drop the collection
     */
    public function drop(): void
    {
        $this->client->execute('dropCollection', [
            'database' => $this->database,
            'collection' => $this->name,
        ]);
    }

    /**
     * Rename the collection
     */
    public function rename(string $newName, bool $dropTarget = false): void
    {
        $this->client->execute('renameCollection', [
            'database' => $this->database,
            'collection' => $this->name,
            'newName' => $newName,
            'dropTarget' => $dropTarget,
        ]);
    }

    /**
     * Start a fluent query builder
     */
    public function where(Filter|array $filter): QueryBuilder
    {
        return new QueryBuilder($this, $filter);
    }
}

/**
 * Fluent query builder for collections
 */
class QueryBuilder
{
    private Filter|array $filter;
    private ?array $projection = null;
    private ?array $sort = null;
    private ?int $limit = null;
    private ?int $skip = null;

    public function __construct(
        private readonly Collection $collection,
        Filter|array $filter,
    ) {
        $this->filter = $filter;
    }

    /**
     * Add projection (field selection)
     */
    public function select(array $fields): self
    {
        $clone = clone $this;
        $clone->projection = $fields;
        return $clone;
    }

    /**
     * Add sort order
     */
    public function orderBy(string $field, SortDirection $direction = SortDirection::Ascending): self
    {
        $clone = clone $this;
        $clone->sort = $clone->sort ?? [];
        $clone->sort[$field] = $direction->value;
        return $clone;
    }

    /**
     * Add sort descending
     */
    public function orderByDesc(string $field): self
    {
        return $this->orderBy($field, SortDirection::Descending);
    }

    /**
     * Limit results
     */
    public function limit(int $limit): self
    {
        $clone = clone $this;
        $clone->limit = $limit;
        return $clone;
    }

    /**
     * Alias for limit
     */
    public function take(int $count): self
    {
        return $this->limit($count);
    }

    /**
     * Skip results
     */
    public function skip(int $skip): self
    {
        $clone = clone $this;
        $clone->skip = $skip;
        return $clone;
    }

    /**
     * Alias for skip
     */
    public function offset(int $offset): self
    {
        return $this->skip($offset);
    }

    /**
     * Execute the query and get all results
     */
    public function get(): Cursor
    {
        return $this->collection->find($this->filter, new FindOptions(
            projection: $this->projection,
            sort: $this->sort,
            limit: $this->limit,
            skip: $this->skip,
        ));
    }

    /**
     * Get the first result
     */
    public function first(): mixed
    {
        return $this->limit(1)->get()->first();
    }

    /**
     * Count matching documents
     */
    public function count(): int
    {
        return $this->collection->countDocuments($this->filter);
    }

    /**
     * Check if any documents match
     */
    public function exists(): bool
    {
        return $this->count() > 0;
    }

    /**
     * Update matching documents
     */
    public function update(Update|array $update): UpdateResult
    {
        return $this->collection->updateMany($this->filter, $update);
    }

    /**
     * Delete matching documents
     */
    public function delete(): DeleteResult
    {
        return $this->collection->deleteMany($this->filter);
    }
}

/**
 * Database interface
 */
class Database
{
    public function __construct(
        private readonly MongoClient $client,
        private readonly string $name,
    ) {}

    /**
     * Get the database name
     */
    public function getName(): string
    {
        return $this->name;
    }

    /**
     * Get a collection
     */
    public function collection(string $name): Collection
    {
        return new Collection($this->client, $this->name, $name);
    }

    /**
     * Magic getter for collection access
     */
    public function __get(string $name): Collection
    {
        return $this->collection($name);
    }

    /**
     * List all collections in this database
     */
    public function listCollections(): array
    {
        $result = $this->client->execute('listCollections', [
            'database' => $this->name,
        ]);

        return $result['collections'] ?? [];
    }

    /**
     * Create a new collection
     */
    public function createCollection(string $name, array $options = []): Collection
    {
        $this->client->execute('createCollection', [
            'database' => $this->name,
            'collection' => $name,
            'options' => $options,
        ]);

        return $this->collection($name);
    }

    /**
     * Drop a collection
     */
    public function dropCollection(string $name): void
    {
        $this->client->execute('dropCollection', [
            'database' => $this->name,
            'collection' => $name,
        ]);
    }

    /**
     * Drop this database
     */
    public function drop(): void
    {
        $this->client->execute('dropDatabase', [
            'database' => $this->name,
        ]);
    }

    /**
     * Run a command
     */
    public function command(array $command): array
    {
        return $this->client->execute('runCommand', [
            'database' => $this->name,
            'command' => $command,
        ]);
    }

    /**
     * Get database statistics
     */
    public function stats(): array
    {
        return $this->command(['dbStats' => 1]);
    }
}

/**
 * MongoDB client configuration
 */
readonly class MongoClientConfig
{
    public function __construct(
        public string $url = 'mongodb://localhost:27017',
        public ?string $database = null,
        public int $timeout = 30,
        public int $maxPoolSize = 10,
        public int $minPoolSize = 1,
        public ?string $authSource = null,
        public ?string $replicaSet = null,
        public ?ReadPreference $readPreference = null,
        public ?WriteConcern $writeConcern = null,
        public bool $retryWrites = true,
        public bool $retryReads = true,
        public ?string $appName = null,
    ) {}

    public function toArray(): array
    {
        return array_filter([
            'url' => $this->url,
            'database' => $this->database,
            'timeout' => $this->timeout,
            'maxPoolSize' => $this->maxPoolSize,
            'minPoolSize' => $this->minPoolSize,
            'authSource' => $this->authSource,
            'replicaSet' => $this->replicaSet,
            'readPreference' => $this->readPreference?->value,
            'writeConcern' => $this->writeConcern?->value,
            'retryWrites' => $this->retryWrites,
            'retryReads' => $this->retryReads,
            'appName' => $this->appName,
        ], fn($v) => $v !== null);
    }
}

/**
 * MongoDB Client for the .do Platform
 *
 * Provides MongoDB-compatible operations through Cap'n Web RPC.
 *
 * Example usage:
 * ```php
 * $client = MongoClient::connect('mongodb://localhost:27017');
 *
 * // Get a database and collection
 * $db = $client->database('myapp');
 * $users = $db->users; // Magic property access
 *
 * // Insert a document
 * $result = $users->insertOne([
 *     'name' => 'John Doe',
 *     'email' => 'john@example.com',
 * ]);
 *
 * // Query documents
 * $cursor = $users->find(Filter::eq('status', 'active'));
 * foreach ($cursor as $doc) {
 *     echo $doc['name'];
 * }
 *
 * // Fluent query builder
 * $active = $users
 *     ->where(Filter::eq('status', 'active'))
 *     ->orderByDesc('createdAt')
 *     ->limit(10)
 *     ->get();
 * ```
 */
class MongoClient
{
    private bool $connected = false;
    private ?string $defaultDatabase = null;

    private function __construct(
        private readonly MongoClientConfig $config,
    ) {
        $this->defaultDatabase = $config->database;
    }

    /**
     * Create a new MongoDB client
     */
    public static function create(MongoClientConfig|string $config): self
    {
        if (is_string($config)) {
            $config = new MongoClientConfig(url: $config);
        }

        $client = new self($config);
        $client->connect();

        return $client;
    }

    /**
     * Connect to MongoDB
     */
    public static function connect(string $url, array $options = []): self
    {
        $config = new MongoClientConfig(
            url: $url,
            database: $options['database'] ?? null,
            timeout: $options['timeout'] ?? 30,
            maxPoolSize: $options['maxPoolSize'] ?? 10,
            authSource: $options['authSource'] ?? null,
            replicaSet: $options['replicaSet'] ?? null,
            retryWrites: $options['retryWrites'] ?? true,
            retryReads: $options['retryReads'] ?? true,
            appName: $options['appName'] ?? null,
        );

        return self::create($config);
    }

    /**
     * Establish connection
     */
    private function connect(): void
    {
        // In a real implementation, this would establish the connection
        // through Cap'n Web RPC
        $this->connected = true;
    }

    /**
     * Get a database instance
     */
    public function database(string $name): Database
    {
        return new Database($this, $name);
    }

    /**
     * Get the default database
     */
    public function db(): Database
    {
        if ($this->defaultDatabase === null) {
            throw new MongoException('No default database specified');
        }

        return $this->database($this->defaultDatabase);
    }

    /**
     * Magic getter for database access
     */
    public function __get(string $name): Database
    {
        return $this->database($name);
    }

    /**
     * Select a database (set as default)
     */
    public function selectDatabase(string $name): Database
    {
        $this->defaultDatabase = $name;
        return $this->database($name);
    }

    /**
     * List all databases
     */
    public function listDatabases(): array
    {
        $result = $this->execute('listDatabases', []);
        return $result['databases'] ?? [];
    }

    /**
     * Drop a database
     */
    public function dropDatabase(string $name): void
    {
        $this->execute('dropDatabase', ['database' => $name]);
    }

    /**
     * Execute a command on the admin database
     */
    public function adminCommand(array $command): array
    {
        return $this->execute('runCommand', [
            'database' => 'admin',
            'command' => $command,
        ]);
    }

    /**
     * Get server status
     */
    public function serverStatus(): array
    {
        return $this->adminCommand(['serverStatus' => 1]);
    }

    /**
     * Ping the server
     */
    public function ping(): bool
    {
        try {
            $result = $this->adminCommand(['ping' => 1]);
            return ($result['ok'] ?? 0) == 1;
        } catch (\Exception) {
            return false;
        }
    }

    /**
     * Close the connection
     */
    public function close(): void
    {
        $this->connected = false;
    }

    /**
     * Check if connected
     */
    public function isConnected(): bool
    {
        return $this->connected;
    }

    /**
     * Get the connection configuration
     */
    public function getConfig(): MongoClientConfig
    {
        return $this->config;
    }

    /**
     * Execute a command via RPC
     *
     * @internal
     */
    public function execute(string $command, array $params): array
    {
        if (!$this->connected) {
            throw new MongoException('Not connected to MongoDB');
        }

        // This is a stub implementation.
        // In production, this would go through Cap'n Web RPC to the server.
        // For now, we simulate responses for testing purposes.

        return match ($command) {
            'find' => ['documents' => []],
            'insertOne' => ['acknowledged' => true],
            'insertMany' => ['acknowledged' => true, 'insertedCount' => count($params['documents'] ?? [])],
            'updateOne', 'updateMany' => ['acknowledged' => true, 'matchedCount' => 0, 'modifiedCount' => 0],
            'deleteOne', 'deleteMany' => ['acknowledged' => true, 'deletedCount' => 0],
            'countDocuments' => ['count' => 0],
            'estimatedDocumentCount' => ['count' => 0],
            'aggregate' => ['documents' => []],
            'listDatabases' => ['databases' => []],
            'listCollections' => ['collections' => []],
            'runCommand' => ['ok' => 1],
            default => [],
        };
    }
}

/**
 * Helper function to create a Filter
 */
function filter(array $conditions = []): Filter
{
    return Filter::fromArray($conditions);
}

/**
 * Helper function to create a Pipeline
 */
function pipeline(): Pipeline
{
    return new Pipeline();
}

/**
 * Helper function to create an ObjectId
 */
function objectId(?string $id = null): ObjectId
{
    return new ObjectId($id);
}
