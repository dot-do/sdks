<?php

declare(strict_types=1);

namespace DotDo\Kafka\Tests;

use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\Test;
use PHPUnit\Framework\Attributes\CoversClass;
use DotDo\Kafka\{
    KafkaClient,
    KafkaClientConfig,
    KafkaException,
    ProducerException,
    ConsumerException,
    SerializationException,
    Headers,
    Record,
    RecordMetadata,
    TopicPartition,
    OffsetAndMetadata,
    PartitionInfo,
    TopicDescription,
    MemberDescription,
    ConsumerGroupDescription,
    Producer,
    ProducerConfig,
    Consumer,
    ConsumerConfig,
    AdminClient,
    RebalanceListener,
    NoOpRebalanceListener,
    CompressionType,
    Acks,
    OffsetReset,
    IsolationLevel,
    AssignmentStrategy,
};

#[CoversClass(KafkaClient::class)]
#[CoversClass(Headers::class)]
#[CoversClass(Record::class)]
#[CoversClass(Producer::class)]
#[CoversClass(Consumer::class)]
#[CoversClass(AdminClient::class)]
class KafkaClientTest extends TestCase
{
    #[Test]
    public function headersAddAndGet(): void
    {
        $headers = new Headers();
        $headers->add('Content-Type', 'application/json');
        $headers->add('X-Custom', 'value1');
        $headers->add('X-Custom', 'value2');

        $this->assertEquals('application/json', $headers->getFirst('Content-Type'));
        $this->assertEquals(['application/json'], $headers->get('Content-Type'));
        $this->assertEquals(['value1', 'value2'], $headers->get('X-Custom'));
    }

    #[Test]
    public function headersSetReplacesValues(): void
    {
        $headers = new Headers();
        $headers->add('X-Header', 'value1');
        $headers->add('X-Header', 'value2');
        $headers->set('X-Header', 'replaced');

        $this->assertEquals(['replaced'], $headers->get('X-Header'));
        $this->assertEquals('replaced', $headers->getFirst('X-Header'));
    }

    #[Test]
    public function headersHasAndRemove(): void
    {
        $headers = new Headers(['X-Header' => 'value']);

        $this->assertTrue($headers->has('X-Header'));
        $this->assertFalse($headers->has('Missing'));

        $headers->remove('X-Header');
        $this->assertFalse($headers->has('X-Header'));
    }

    #[Test]
    public function headersArrayAccess(): void
    {
        $headers = new Headers();
        $headers['Content-Type'] = 'application/json';

        $this->assertTrue(isset($headers['Content-Type']));
        $this->assertEquals('application/json', $headers['Content-Type']);

        unset($headers['Content-Type']);
        $this->assertFalse(isset($headers['Content-Type']));
    }

    #[Test]
    public function headersIterable(): void
    {
        $headers = new Headers([
            'Header1' => 'value1',
            'Header2' => 'value2',
        ]);

        $keys = [];
        foreach ($headers as $key => $values) {
            $keys[] = $key;
        }

        $this->assertEquals(['Header1', 'Header2'], $keys);
    }

    #[Test]
    public function headersCountable(): void
    {
        $headers = new Headers([
            'Header1' => 'value1',
            'Header2' => 'value2',
        ]);

        $this->assertCount(2, $headers);
    }

    #[Test]
    public function headersJsonSerialization(): void
    {
        $headers = new Headers([
            'Content-Type' => 'application/json',
        ]);

        $json = json_encode($headers);
        $this->assertEquals('{"Content-Type":["application\/json"]}', $json);
    }

    #[Test]
    public function recordCreate(): void
    {
        $headers = new Headers(['X-Custom' => 'test']);
        $record = Record::create(
            topic: 'my-topic',
            value: 'Hello, Kafka!',
            key: 'my-key',
            partition: 0,
            headers: $headers,
        );

        $this->assertEquals('my-topic', $record->topic);
        $this->assertEquals('Hello, Kafka!', $record->value);
        $this->assertEquals('my-key', $record->key);
        $this->assertEquals(0, $record->partition);
        $this->assertEquals('test', $record->header('X-Custom'));
        $this->assertGreaterThan(0, $record->timestamp);
    }

    #[Test]
    public function recordJson(): void
    {
        $record = Record::json('events', ['type' => 'user.created', 'userId' => 123]);

        $this->assertEquals('events', $record->topic);
        $this->assertJson($record->value);

        $decoded = $record->valueAsJson();
        $this->assertEquals('user.created', $decoded['type']);
        $this->assertEquals(123, $decoded['userId']);
    }

    #[Test]
    public function recordValueAsJsonThrowsOnInvalidJson(): void
    {
        $record = new Record('topic', 'not-json');

        $this->expectException(SerializationException::class);
        $record->valueAsJson();
    }

    #[Test]
    public function recordJsonSerializable(): void
    {
        $record = Record::create(
            topic: 'my-topic',
            value: 'test-value',
            key: 'test-key',
            partition: 1,
        );

        $json = json_encode($record);
        $decoded = json_decode($json, true);

        $this->assertEquals('my-topic', $decoded['topic']);
        $this->assertEquals('test-value', $decoded['value']);
        $this->assertEquals('test-key', $decoded['key']);
        $this->assertEquals(1, $decoded['partition']);
    }

    #[Test]
    public function recordMetadataProperties(): void
    {
        $metadata = new RecordMetadata(
            topic: 'my-topic',
            partition: 2,
            offset: 12345,
            timestamp: 1234567890000,
            serializedKeySize: 8,
            serializedValueSize: 100,
        );

        $this->assertEquals('my-topic', $metadata->topic);
        $this->assertEquals(2, $metadata->partition);
        $this->assertEquals(12345, $metadata->offset);
        $this->assertEquals(1234567890000, $metadata->timestamp);
        $this->assertEquals(8, $metadata->serializedKeySize);
        $this->assertEquals(100, $metadata->serializedValueSize);
    }

    #[Test]
    public function topicPartitionCreation(): void
    {
        $tp = new TopicPartition('my-topic', 3);

        $this->assertEquals('my-topic', $tp->topic);
        $this->assertEquals(3, $tp->partition);
        $this->assertEquals('my-topic-3', (string)$tp);
    }

    #[Test]
    public function topicPartitionJsonSerialization(): void
    {
        $tp = new TopicPartition('my-topic', 3);

        $json = json_encode($tp);
        $decoded = json_decode($json, true);

        $this->assertEquals('my-topic', $decoded['topic']);
        $this->assertEquals(3, $decoded['partition']);
    }

    #[Test]
    public function offsetAndMetadataCreation(): void
    {
        $offset = new OffsetAndMetadata(12345, 'consumer-metadata');

        $this->assertEquals(12345, $offset->offset);
        $this->assertEquals('consumer-metadata', $offset->metadata);
    }

    #[Test]
    public function partitionInfoProperties(): void
    {
        $info = new PartitionInfo(
            topic: 'my-topic',
            partition: 0,
            leader: 1,
            replicas: [1, 2, 3],
            inSyncReplicas: [1, 2],
        );

        $this->assertEquals('my-topic', $info->topic);
        $this->assertEquals(0, $info->partition);
        $this->assertEquals(1, $info->leader);
        $this->assertEquals([1, 2, 3], $info->replicas);
        $this->assertEquals([1, 2], $info->inSyncReplicas);
    }

    #[Test]
    public function topicDescriptionProperties(): void
    {
        $partitions = [
            new PartitionInfo('my-topic', 0, 1, [1, 2], [1, 2]),
            new PartitionInfo('my-topic', 1, 2, [1, 2], [1, 2]),
            new PartitionInfo('my-topic', 2, 3, [1, 2], [1, 2]),
        ];

        $description = new TopicDescription('my-topic', false, $partitions);

        $this->assertEquals('my-topic', $description->name);
        $this->assertFalse($description->isInternal);
        $this->assertEquals(3, $description->partitionCount());
    }

    #[Test]
    public function memberDescriptionProperties(): void
    {
        $assignment = [
            new TopicPartition('topic1', 0),
            new TopicPartition('topic1', 1),
        ];

        $member = new MemberDescription(
            memberId: 'member-123',
            clientId: 'client-1',
            host: '/127.0.0.1',
            assignment: $assignment,
        );

        $this->assertEquals('member-123', $member->memberId);
        $this->assertEquals('client-1', $member->clientId);
        $this->assertEquals('/127.0.0.1', $member->host);
        $this->assertCount(2, $member->assignment);
    }

    #[Test]
    public function consumerGroupDescriptionProperties(): void
    {
        $members = [
            new MemberDescription('member-1', 'client-1', '/host1', []),
            new MemberDescription('member-2', 'client-2', '/host2', []),
        ];

        $group = new ConsumerGroupDescription(
            groupId: 'my-group',
            state: 'Stable',
            coordinator: 'broker-1:9092',
            partitionAssignor: 'range',
            members: $members,
        );

        $this->assertEquals('my-group', $group->groupId);
        $this->assertEquals('Stable', $group->state);
        $this->assertEquals('broker-1:9092', $group->coordinator);
        $this->assertEquals('range', $group->partitionAssignor);
        $this->assertCount(2, $group->members);
    }

    #[Test]
    public function producerConfigDefaults(): void
    {
        $config = new ProducerConfig();
        $array = $config->toArray();

        $this->assertEmpty($array); // All optional, defaults handled by server
    }

    #[Test]
    public function producerConfigCustom(): void
    {
        $config = new ProducerConfig(
            acks: Acks::All,
            batchSize: 32768,
            lingerMs: 10,
            compression: CompressionType::Lz4,
            retries: 5,
            enableIdempotence: true,
            transactionalId: 'my-transaction',
        );

        $array = $config->toArray();

        $this->assertEquals(-1, $array['acks']);
        $this->assertEquals(32768, $array['batch.size']);
        $this->assertEquals(10, $array['linger.ms']);
        $this->assertEquals('lz4', $array['compression.type']);
        $this->assertEquals(5, $array['retries']);
        $this->assertTrue($array['enable.idempotence']);
        $this->assertEquals('my-transaction', $array['transactional.id']);
    }

    #[Test]
    public function consumerConfigRequired(): void
    {
        $config = new ConsumerConfig(groupId: 'my-group');
        $array = $config->toArray();

        $this->assertEquals('my-group', $array['group.id']);
    }

    #[Test]
    public function consumerConfigCustom(): void
    {
        $config = new ConsumerConfig(
            groupId: 'my-group',
            groupInstanceId: 'instance-1',
            autoOffsetReset: OffsetReset::Earliest,
            enableAutoCommit: false,
            autoCommitIntervalMs: 5000,
            sessionTimeoutMs: 30000,
            heartbeatIntervalMs: 3000,
            maxPollRecords: 500,
            fetchMinBytes: 1024,
            fetchMaxWaitMs: 500,
            isolationLevel: IsolationLevel::ReadCommitted,
            partitionAssignment: AssignmentStrategy::RoundRobin,
        );

        $array = $config->toArray();

        $this->assertEquals('my-group', $array['group.id']);
        $this->assertEquals('instance-1', $array['group.instance.id']);
        $this->assertEquals('earliest', $array['auto.offset.reset']);
        $this->assertFalse($array['enable.auto.commit']);
        $this->assertEquals(5000, $array['auto.commit.interval.ms']);
        $this->assertEquals(30000, $array['session.timeout.ms']);
        $this->assertEquals(3000, $array['heartbeat.interval.ms']);
        $this->assertEquals(500, $array['max.poll.records']);
        $this->assertEquals(1024, $array['fetch.min.bytes']);
        $this->assertEquals(500, $array['fetch.max.wait.ms']);
        $this->assertEquals('read_committed', $array['isolation.level']);
        $this->assertEquals('roundrobin', $array['partition.assignment.strategy']);
    }

    #[Test]
    public function kafkaClientConfigDefaults(): void
    {
        $config = new KafkaClientConfig();

        $this->assertEquals('localhost:9092', $config->bootstrapServers);
        $this->assertEquals(30, $config->timeout);
    }

    #[Test]
    public function kafkaClientConfigCustom(): void
    {
        $config = new KafkaClientConfig(
            bootstrapServers: 'broker1:9092,broker2:9092',
            clientId: 'my-client',
            timeout: 60,
            securityProtocol: 'SASL_SSL',
            saslMechanism: 'SCRAM-SHA-256',
            saslUsername: 'user',
            saslPassword: 'password',
        );

        $array = $config->toArray();

        $this->assertEquals('broker1:9092,broker2:9092', $array['bootstrap.servers']);
        $this->assertEquals('my-client', $array['client.id']);
        $this->assertEquals(60000, $array['request.timeout.ms']);
        $this->assertEquals('SASL_SSL', $array['security.protocol']);
        $this->assertEquals('SCRAM-SHA-256', $array['sasl.mechanism']);
        $this->assertEquals('user', $array['sasl.username']);
        $this->assertEquals('password', $array['sasl.password']);
    }

    #[Test]
    public function kafkaClientCreation(): void
    {
        $client = KafkaClient::connect('localhost:9092');

        $this->assertTrue($client->isConnected());
        $this->assertInstanceOf(KafkaClientConfig::class, $client->getConfig());

        $client->close();
        $this->assertFalse($client->isConnected());
    }

    #[Test]
    public function kafkaClientProducerCreation(): void
    {
        $client = KafkaClient::connect('localhost:9092');

        $producer = $client->producer();
        $this->assertInstanceOf(Producer::class, $producer);
        $this->assertFalse($producer->isClosed());

        $producer->close();
        $this->assertTrue($producer->isClosed());

        $client->close();
    }

    #[Test]
    public function kafkaClientConsumerCreation(): void
    {
        $client = KafkaClient::connect('localhost:9092');

        // String group ID
        $consumer1 = $client->consumer('my-group');
        $this->assertInstanceOf(Consumer::class, $consumer1);

        // ConsumerConfig
        $consumer2 = $client->consumer(new ConsumerConfig(groupId: 'my-group-2'));
        $this->assertInstanceOf(Consumer::class, $consumer2);

        $consumer1->close();
        $consumer2->close();
        $client->close();
    }

    #[Test]
    public function kafkaClientAdminCreation(): void
    {
        $client = KafkaClient::connect('localhost:9092');

        $admin = $client->admin();
        $this->assertInstanceOf(AdminClient::class, $admin);

        $client->close();
    }

    #[Test]
    public function producerSendRecord(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $producer = $client->producer();

        $record = Record::create('my-topic', 'Hello, Kafka!', 'my-key');
        $metadata = $producer->send($record);

        $this->assertInstanceOf(RecordMetadata::class, $metadata);
        $this->assertEquals('my-topic', $metadata->topic);
        $this->assertGreaterThanOrEqual(0, $metadata->partition);
        $this->assertGreaterThanOrEqual(0, $metadata->offset);

        $producer->close();
        $client->close();
    }

    #[Test]
    public function producerConvenienceMethods(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $producer = $client->producer();

        // produce()
        $metadata1 = $producer->produce('my-topic', 'Simple message', 'key1');
        $this->assertInstanceOf(RecordMetadata::class, $metadata1);

        // produceJson()
        $metadata2 = $producer->produceJson('events', ['type' => 'test']);
        $this->assertInstanceOf(RecordMetadata::class, $metadata2);

        $producer->close();
        $client->close();
    }

    #[Test]
    public function producerSendBatch(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $producer = $client->producer();

        $records = [
            Record::create('my-topic', 'Message 1', 'key1'),
            Record::create('my-topic', 'Message 2', 'key2'),
            Record::create('my-topic', 'Message 3', 'key3'),
        ];

        $results = $producer->sendBatch($records);

        $this->assertCount(3, $results);
        foreach ($results as $metadata) {
            $this->assertInstanceOf(RecordMetadata::class, $metadata);
        }

        $producer->close();
        $client->close();
    }

    #[Test]
    public function producerClosedThrowsException(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $producer = $client->producer();
        $producer->close();

        $this->expectException(ProducerException::class);
        $this->expectExceptionMessage('Producer has been closed');

        $producer->produce('topic', 'value');
    }

    #[Test]
    public function consumerSubscribeAndPoll(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');

        $consumer->subscribe(['my-topic']);

        $records = $consumer->poll(100);
        $this->assertIsArray($records);
        // In stub implementation, returns empty array

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerUnsubscribe(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');

        $consumer->subscribe(['my-topic']);
        $consumer->unsubscribe();

        // Should not throw
        $this->assertTrue(true);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerAssignPartitions(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');

        $partitions = [
            new TopicPartition('my-topic', 0),
            new TopicPartition('my-topic', 1),
        ];

        $consumer->assign($partitions);

        // Should not throw
        $this->assertTrue(true);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerCommitOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->subscribe(['my-topic']);

        // Sync commit
        $consumer->commitSync();

        // Async commit
        $consumer->commitAsync();

        // Commit specific offsets
        $consumer->commitOffsets([
            'my-topic-0' => new OffsetAndMetadata(100, 'test'),
        ]);

        // Should not throw
        $this->assertTrue(true);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerSeekOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->subscribe(['my-topic']);

        $tp = new TopicPartition('my-topic', 0);

        $consumer->seek($tp, 100);
        $consumer->seekToBeginning([$tp]);
        $consumer->seekToEnd([$tp]);

        // Should not throw
        $this->assertTrue(true);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerPauseAndResume(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->subscribe(['my-topic']);

        $tp = new TopicPartition('my-topic', 0);

        $consumer->pause([$tp]);
        $paused = $consumer->paused();
        $this->assertIsArray($paused);

        $consumer->resume([$tp]);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerClosedThrowsException(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->close();

        $this->expectException(ConsumerException::class);
        $this->expectExceptionMessage('Consumer has been closed');

        $consumer->subscribe(['topic']);
    }

    #[Test]
    public function consumerIterator(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->subscribe(['my-topic']);

        // Iterator interface works (stub returns empty)
        foreach ($consumer as $record) {
            $this->assertInstanceOf(Record::class, $record);
        }

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function consumerConsumeCallback(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $consumer = $client->consumer('test-group');
        $consumer->subscribe(['my-topic']);

        $processed = [];
        $consumer->consume(
            handler: function (Record $record) use (&$processed) {
                $processed[] = $record;
            },
            maxRecords: 10,
            timeoutMs: 100,
        );

        // In stub, no records returned
        $this->assertIsArray($processed);

        $consumer->close();
        $client->close();
    }

    #[Test]
    public function noOpRebalanceListener(): void
    {
        $listener = new NoOpRebalanceListener();

        // Should not throw
        $listener->onPartitionsAssigned([]);
        $listener->onPartitionsRevoked([]);
        $listener->onPartitionsLost([]);

        $this->assertTrue(true);
    }

    #[Test]
    public function adminTopicOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $admin = $client->admin();

        // Create topic
        $admin->createTopic('new-topic', partitions: 3, replicationFactor: 2);

        // List topics
        $topics = $admin->listTopics();
        $this->assertIsArray($topics);

        // Describe topics
        $descriptions = $admin->describeTopics(['my-topic']);
        $this->assertIsArray($descriptions);

        // Delete topics
        $admin->deleteTopics(['old-topic']);

        $client->close();
    }

    #[Test]
    public function adminConsumerGroupOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $admin = $client->admin();

        // List consumer groups
        $groups = $admin->listConsumerGroups();
        $this->assertIsArray($groups);

        // Describe consumer groups
        $descriptions = $admin->describeConsumerGroups(['my-group']);
        $this->assertIsArray($descriptions);

        // List offsets
        $offsets = $admin->listConsumerGroupOffsets('my-group');
        $this->assertIsArray($offsets);

        // Alter offsets
        $admin->alterConsumerGroupOffsets('my-group', [
            'topic-0' => new OffsetAndMetadata(100),
        ]);

        // Delete consumer groups
        $admin->deleteConsumerGroups(['old-group']);

        $client->close();
    }

    #[Test]
    public function adminClusterOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $admin = $client->admin();

        $cluster = $admin->describeCluster();
        $this->assertIsArray($cluster);

        $client->close();
    }

    #[Test]
    public function adminPartitionOperations(): void
    {
        $client = KafkaClient::connect('localhost:9092');
        $admin = $client->admin();

        // Create partitions
        $admin->createPartitions('my-topic', 6);

        // Should not throw
        $this->assertTrue(true);

        $client->close();
    }

    #[Test]
    public function compressionTypeEnum(): void
    {
        $this->assertEquals('none', CompressionType::None->value);
        $this->assertEquals('gzip', CompressionType::Gzip->value);
        $this->assertEquals('snappy', CompressionType::Snappy->value);
        $this->assertEquals('lz4', CompressionType::Lz4->value);
        $this->assertEquals('zstd', CompressionType::Zstd->value);
    }

    #[Test]
    public function acksEnum(): void
    {
        $this->assertEquals(0, Acks::None->value);
        $this->assertEquals(1, Acks::Leader->value);
        $this->assertEquals(-1, Acks::All->value);
    }

    #[Test]
    public function offsetResetEnum(): void
    {
        $this->assertEquals('earliest', OffsetReset::Earliest->value);
        $this->assertEquals('latest', OffsetReset::Latest->value);
        $this->assertEquals('none', OffsetReset::None->value);
    }

    #[Test]
    public function isolationLevelEnum(): void
    {
        $this->assertEquals('read_uncommitted', IsolationLevel::ReadUncommitted->value);
        $this->assertEquals('read_committed', IsolationLevel::ReadCommitted->value);
    }

    #[Test]
    public function assignmentStrategyEnum(): void
    {
        $this->assertEquals('range', AssignmentStrategy::Range->value);
        $this->assertEquals('roundrobin', AssignmentStrategy::RoundRobin->value);
        $this->assertEquals('sticky', AssignmentStrategy::Sticky->value);
        $this->assertEquals('cooperative-sticky', AssignmentStrategy::CooperativeSticky->value);
    }

    #[Test]
    public function kafkaExceptionProperties(): void
    {
        $exception = new KafkaException(
            message: 'Test error',
            errorCode: 'TIMEOUT',
            details: ['broker' => 'localhost'],
        );

        $this->assertEquals('Test error', $exception->getMessage());
        $this->assertEquals('TIMEOUT', $exception->errorCode);
        $this->assertEquals(['broker' => 'localhost'], $exception->details);
    }

    #[Test]
    public function producerExceptionProperties(): void
    {
        $exception = new ProducerException(
            message: 'Failed to produce',
            topic: 'my-topic',
            partition: 2,
        );

        $this->assertEquals('Failed to produce', $exception->getMessage());
        $this->assertEquals('my-topic', $exception->topic);
        $this->assertEquals(2, $exception->partition);
    }

    #[Test]
    public function consumerExceptionProperties(): void
    {
        $exception = new ConsumerException(
            message: 'Consumer error',
            groupId: 'my-group',
        );

        $this->assertEquals('Consumer error', $exception->getMessage());
        $this->assertEquals('my-group', $exception->groupId);
    }

    #[Test]
    public function serializationExceptionProperties(): void
    {
        $exception = new SerializationException('Failed to serialize');

        $this->assertEquals('Failed to serialize', $exception->getMessage());
        $this->assertEquals('SERIALIZATION_ERROR', $exception->errorCode);
    }

    #[Test]
    public function helperFunctions(): void
    {
        $headers = \DotDo\Kafka\headers(['X-Header' => 'value']);
        $this->assertInstanceOf(Headers::class, $headers);
        $this->assertEquals('value', $headers->getFirst('X-Header'));

        $record = \DotDo\Kafka\record('topic', 'value', 'key');
        $this->assertInstanceOf(Record::class, $record);
        $this->assertEquals('topic', $record->topic);
        $this->assertEquals('value', $record->value);
        $this->assertEquals('key', $record->key);

        $tp = \DotDo\Kafka\partition('topic', 3);
        $this->assertInstanceOf(TopicPartition::class, $tp);
        $this->assertEquals('topic', $tp->topic);
        $this->assertEquals(3, $tp->partition);
    }
}
