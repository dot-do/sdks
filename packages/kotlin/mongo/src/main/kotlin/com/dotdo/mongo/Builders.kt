package com.dotdo.mongo

import kotlinx.serialization.*
import kotlinx.serialization.json.*

/**
 * DSL Builders for MongoDB Operations
 *
 * These builders provide a type-safe, idiomatic Kotlin DSL for constructing
 * MongoDB queries, updates, aggregation pipelines, and indexes.
 *
 * @example
 * ```kotlin
 * // Filter DSL
 * collection.find {
 *     "age" gte 18
 *     "status" eq "active"
 *     or {
 *         "role" eq "admin"
 *         "role" eq "moderator"
 *     }
 * }
 *
 * // Update DSL
 * collection.updateOne(
 *     { "_id" eq id },
 *     {
 *         set { "name" to "Alice" }
 *         inc { "visits" by 1 }
 *         push { "tags" value "new" }
 *     }
 * )
 *
 * // Aggregation DSL
 * collection.aggregate {
 *     match { "status" eq "active" }
 *     group("_id" to "\$department") {
 *         "count" accumulator Count
 *         "total" accumulator Sum("\$salary")
 *     }
 *     sort { "count" descending }
 *     limit(10)
 * }
 * ```
 */

// =============================================================================
// Filter Builder
// =============================================================================

/**
 * Builder for MongoDB filter documents.
 */
@DslMarker
annotation class FilterDsl

@FilterDsl
class FilterBuilder {
    private val conditions = mutableMapOf<String, JsonElement>()

    // Comparison operators
    infix fun String.eq(value: Any?): Unit = addCondition(this, value.toJsonElement())
    infix fun String.ne(value: Any?): Unit = addCondition(this, buildJsonObject { put("\$ne", value.toJsonElement()) })
    infix fun String.gt(value: Number): Unit = addCondition(this, buildJsonObject { put("\$gt", JsonPrimitive(value)) })
    infix fun String.gte(value: Number): Unit = addCondition(this, buildJsonObject { put("\$gte", JsonPrimitive(value)) })
    infix fun String.lt(value: Number): Unit = addCondition(this, buildJsonObject { put("\$lt", JsonPrimitive(value)) })
    infix fun String.lte(value: Number): Unit = addCondition(this, buildJsonObject { put("\$lte", JsonPrimitive(value)) })

    // Array operators
    infix fun String.`in`(values: List<Any?>): Unit =
        addCondition(this, buildJsonObject { put("\$in", values.toJsonArray()) })

    infix fun String.nin(values: List<Any?>): Unit =
        addCondition(this, buildJsonObject { put("\$nin", values.toJsonArray()) })

    infix fun String.all(values: List<Any?>): Unit =
        addCondition(this, buildJsonObject { put("\$all", values.toJsonArray()) })

    infix fun String.elemMatch(filter: FilterBuilder.() -> Unit): Unit =
        addCondition(this, buildJsonObject { put("\$elemMatch", FilterBuilder().apply(filter).build()) })

    infix fun String.size(size: Int): Unit =
        addCondition(this, buildJsonObject { put("\$size", JsonPrimitive(size)) })

    // String operators
    infix fun String.regex(pattern: String): Unit =
        addCondition(this, buildJsonObject { put("\$regex", JsonPrimitive(pattern)) })

    fun String.regex(pattern: String, options: String): Unit =
        addCondition(this, buildJsonObject {
            put("\$regex", JsonPrimitive(pattern))
            put("\$options", JsonPrimitive(options))
        })

    // Existence and type
    infix fun String.exists(exists: Boolean): Unit =
        addCondition(this, buildJsonObject { put("\$exists", JsonPrimitive(exists)) })

    infix fun String.type(type: BsonType): Unit =
        addCondition(this, buildJsonObject { put("\$type", JsonPrimitive(type.value)) })

    // Logical operators
    fun and(vararg filters: FilterBuilder.() -> Unit) {
        val filterDocs = filters.map { FilterBuilder().apply(it).build() }
        addCondition("\$and", JsonArray(filterDocs))
    }

    fun or(vararg filters: FilterBuilder.() -> Unit) {
        val filterDocs = filters.map { FilterBuilder().apply(it).build() }
        addCondition("\$or", JsonArray(filterDocs))
    }

    fun nor(vararg filters: FilterBuilder.() -> Unit) {
        val filterDocs = filters.map { FilterBuilder().apply(it).build() }
        addCondition("\$nor", JsonArray(filterDocs))
    }

    fun not(field: String, filter: FilterBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        addCondition(field, buildJsonObject { put("\$not", filterDoc) })
    }

    // Geo operators
    fun String.near(longitude: Double, latitude: Double, maxDistance: Double? = null) {
        addCondition(this, buildJsonObject {
            putJsonObject("\$near") {
                putJsonObject("\$geometry") {
                    put("type", "Point")
                    putJsonArray("coordinates") {
                        add(longitude)
                        add(latitude)
                    }
                }
                maxDistance?.let { put("\$maxDistance", it) }
            }
        })
    }

    fun String.geoWithin(geometry: JsonObject) {
        addCondition(this, buildJsonObject { put("\$geoWithin", geometry) })
    }

    // Text search
    fun text(search: String, language: String? = null, caseSensitive: Boolean? = null) {
        addCondition("\$text", buildJsonObject {
            put("\$search", search)
            language?.let { put("\$language", it) }
            caseSensitive?.let { put("\$caseSensitive", it) }
        })
    }

    // Expression operator
    fun expr(expression: JsonObject) {
        addCondition("\$expr", expression)
    }

    // Raw JSON
    fun raw(json: JsonObject) {
        json.forEach { (key, value) -> conditions[key] = value }
    }

    private fun addCondition(field: String, value: JsonElement) {
        val existing = conditions[field]
        if (existing is JsonObject && value is JsonObject) {
            // Merge conditions for the same field
            conditions[field] = JsonObject(existing + value)
        } else {
            conditions[field] = value
        }
    }

    fun build(): JsonObject = JsonObject(conditions)
}

enum class BsonType(val value: Int) {
    DOUBLE(1),
    STRING(2),
    OBJECT(3),
    ARRAY(4),
    BINARY(5),
    OBJECT_ID(7),
    BOOLEAN(8),
    DATE(9),
    NULL(10),
    REGEX(11),
    INT32(16),
    TIMESTAMP(17),
    INT64(18),
    DECIMAL128(19)
}

// =============================================================================
// Update Builder
// =============================================================================

/**
 * Builder for MongoDB update documents.
 */
@DslMarker
annotation class UpdateDsl

@UpdateDsl
class UpdateBuilder {
    private val operations = mutableMapOf<String, JsonObject>()

    // $set operator
    fun set(block: SetBuilder.() -> Unit) {
        val setOp = SetBuilder().apply(block).build()
        mergeOperation("\$set", setOp)
    }

    // $unset operator
    fun unset(vararg fields: String) {
        val unsetOp = buildJsonObject {
            fields.forEach { put(it, "") }
        }
        mergeOperation("\$unset", unsetOp)
    }

    // $inc operator
    fun inc(block: IncBuilder.() -> Unit) {
        val incOp = IncBuilder().apply(block).build()
        mergeOperation("\$inc", incOp)
    }

    // $mul operator
    fun mul(block: MulBuilder.() -> Unit) {
        val mulOp = MulBuilder().apply(block).build()
        mergeOperation("\$mul", mulOp)
    }

    // $min operator
    fun min(block: MinMaxBuilder.() -> Unit) {
        val minOp = MinMaxBuilder().apply(block).build()
        mergeOperation("\$min", minOp)
    }

    // $max operator
    fun max(block: MinMaxBuilder.() -> Unit) {
        val maxOp = MinMaxBuilder().apply(block).build()
        mergeOperation("\$max", maxOp)
    }

    // $rename operator
    fun rename(block: RenameBuilder.() -> Unit) {
        val renameOp = RenameBuilder().apply(block).build()
        mergeOperation("\$rename", renameOp)
    }

    // $push operator
    fun push(block: PushBuilder.() -> Unit) {
        val pushOp = PushBuilder().apply(block).build()
        mergeOperation("\$push", pushOp)
    }

    // $pull operator
    fun pull(block: PullBuilder.() -> Unit) {
        val pullOp = PullBuilder().apply(block).build()
        mergeOperation("\$pull", pullOp)
    }

    // $addToSet operator
    fun addToSet(block: AddToSetBuilder.() -> Unit) {
        val addOp = AddToSetBuilder().apply(block).build()
        mergeOperation("\$addToSet", addOp)
    }

    // $pop operator
    fun pop(field: String, position: PopPosition) {
        mergeOperation("\$pop", buildJsonObject { put(field, position.value) })
    }

    // $currentDate operator
    fun currentDate(vararg fields: String) {
        val currentDateOp = buildJsonObject {
            fields.forEach { put(it, true) }
        }
        mergeOperation("\$currentDate", currentDateOp)
    }

    // $setOnInsert operator
    fun setOnInsert(block: SetBuilder.() -> Unit) {
        val setOp = SetBuilder().apply(block).build()
        mergeOperation("\$setOnInsert", setOp)
    }

    // $bit operator
    fun bit(field: String, operation: BitOperation, value: Int) {
        mergeOperation("\$bit", buildJsonObject {
            putJsonObject(field) {
                put(operation.op, value)
            }
        })
    }

    private fun mergeOperation(operator: String, values: JsonObject) {
        val existing = operations[operator]
        if (existing != null) {
            operations[operator] = JsonObject(existing + values)
        } else {
            operations[operator] = values
        }
    }

    fun build(): JsonObject = JsonObject(operations.mapValues { it.value })
}

enum class PopPosition(val value: Int) {
    FIRST(-1),
    LAST(1)
}

enum class BitOperation(val op: String) {
    AND("and"),
    OR("or"),
    XOR("xor")
}

@UpdateDsl
class SetBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    infix fun String.to(value: Any?) {
        fields[this] = value.toJsonElement()
    }

    fun build(): JsonObject = JsonObject(fields)
}

@UpdateDsl
class IncBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    infix fun String.by(value: Number) {
        fields[this] = JsonPrimitive(value)
    }

    fun build(): JsonObject = JsonObject(fields)
}

@UpdateDsl
class MulBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    infix fun String.by(value: Number) {
        fields[this] = JsonPrimitive(value)
    }

    fun build(): JsonObject = JsonObject(fields)
}

@UpdateDsl
class MinMaxBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    infix fun String.value(value: Any?) {
        fields[this] = value.toJsonElement()
    }

    fun build(): JsonObject = JsonObject(fields)
}

@UpdateDsl
class RenameBuilder {
    private val renames = mutableMapOf<String, JsonElement>()

    infix fun String.to(newName: String) {
        renames[this] = JsonPrimitive(newName)
    }

    fun build(): JsonObject = JsonObject(renames)
}

@UpdateDsl
class PushBuilder {
    private val pushOps = mutableMapOf<String, JsonElement>()

    infix fun String.value(value: Any?) {
        pushOps[this] = value.toJsonElement()
    }

    fun String.each(vararg values: Any?) {
        pushOps[this] = buildJsonObject {
            put("\$each", values.toList().toJsonArray())
        }
    }

    fun String.each(values: List<Any?>, position: Int? = null, slice: Int? = null, sort: SortBuilder.() -> Unit = {}) {
        pushOps[this] = buildJsonObject {
            put("\$each", values.toJsonArray())
            position?.let { put("\$position", it) }
            slice?.let { put("\$slice", it) }
            val sortDoc = SortBuilder().apply(sort).build()
            if (sortDoc.isNotEmpty()) put("\$sort", sortDoc)
        }
    }

    fun build(): JsonObject = JsonObject(pushOps)
}

@UpdateDsl
class PullBuilder {
    private val pullOps = mutableMapOf<String, JsonElement>()

    infix fun String.value(value: Any?) {
        pullOps[this] = value.toJsonElement()
    }

    infix fun String.match(filter: FilterBuilder.() -> Unit) {
        pullOps[this] = FilterBuilder().apply(filter).build()
    }

    fun build(): JsonObject = JsonObject(pullOps)
}

@UpdateDsl
class AddToSetBuilder {
    private val addOps = mutableMapOf<String, JsonElement>()

    infix fun String.value(value: Any?) {
        addOps[this] = value.toJsonElement()
    }

    fun String.each(vararg values: Any?) {
        addOps[this] = buildJsonObject {
            put("\$each", values.toList().toJsonArray())
        }
    }

    fun build(): JsonObject = JsonObject(addOps)
}

// =============================================================================
// Projection Builder
// =============================================================================

@DslMarker
annotation class ProjectionDsl

@ProjectionDsl
class ProjectionBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    fun include(vararg fieldNames: String) {
        fieldNames.forEach { fields[it] = JsonPrimitive(1) }
    }

    fun exclude(vararg fieldNames: String) {
        fieldNames.forEach { fields[it] = JsonPrimitive(0) }
    }

    fun excludeId() {
        fields["_id"] = JsonPrimitive(0)
    }

    infix fun String.slice(count: Int) {
        fields[this] = buildJsonObject { put("\$slice", count) }
    }

    fun String.slice(skip: Int, limit: Int) {
        fields[this] = buildJsonObject {
            putJsonArray("\$slice") {
                add(skip)
                add(limit)
            }
        }
    }

    infix fun String.elemMatch(filter: FilterBuilder.() -> Unit) {
        fields[this] = buildJsonObject {
            put("\$elemMatch", FilterBuilder().apply(filter).build())
        }
    }

    fun String.meta(metaType: String) {
        fields[this] = buildJsonObject { put("\$meta", metaType) }
    }

    fun build(): JsonObject = JsonObject(fields)
}

// =============================================================================
// Sort Builder
// =============================================================================

@DslMarker
annotation class SortDsl

@SortDsl
class SortBuilder {
    private val sortFields = mutableMapOf<String, JsonElement>()

    infix fun String.ascending(unit: Unit = Unit) {
        sortFields[this] = JsonPrimitive(1)
    }

    val ascending: Unit = Unit

    infix fun String.descending(unit: Unit = Unit) {
        sortFields[this] = JsonPrimitive(-1)
    }

    val descending: Unit = Unit

    fun String.textScore() {
        sortFields[this] = buildJsonObject { put("\$meta", "textScore") }
    }

    fun build(): JsonObject = JsonObject(sortFields)
}

// =============================================================================
// Index Keys Builder
// =============================================================================

@DslMarker
annotation class IndexDsl

@IndexDsl
class IndexKeysBuilder {
    private val keys = mutableMapOf<String, JsonElement>()

    infix fun String.ascending(unit: Unit = Unit) {
        keys[this] = JsonPrimitive(1)
    }

    infix fun String.descending(unit: Unit = Unit) {
        keys[this] = JsonPrimitive(-1)
    }

    fun String.hashed() {
        keys[this] = JsonPrimitive("hashed")
    }

    fun String.text() {
        keys[this] = JsonPrimitive("text")
    }

    fun String.geo2d() {
        keys[this] = JsonPrimitive("2d")
    }

    fun String.geo2dsphere() {
        keys[this] = JsonPrimitive("2dsphere")
    }

    fun build(): JsonObject = JsonObject(keys)
}

// =============================================================================
// Aggregation Builder
// =============================================================================

@DslMarker
annotation class AggregateDsl

@AggregateDsl
class AggregateBuilder {
    private val stages = mutableListOf<JsonObject>()

    // $match stage
    fun match(filter: FilterBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        stages.add(buildJsonObject { put("\$match", filterDoc) })
    }

    // $project stage
    fun project(projection: ProjectionBuilder.() -> Unit) {
        val projDoc = ProjectionBuilder().apply(projection).build()
        stages.add(buildJsonObject { put("\$project", projDoc) })
    }

    // $group stage
    fun group(id: Pair<String, String>, accumulator: GroupAccumulatorBuilder.() -> Unit) {
        val accumulators = GroupAccumulatorBuilder().apply(accumulator).build()
        val groupDoc = buildJsonObject {
            put(id.first, JsonPrimitive(id.second))
            accumulators.forEach { (key, value) -> put(key, value) }
        }
        stages.add(buildJsonObject { put("\$group", groupDoc) })
    }

    fun group(id: String, accumulator: GroupAccumulatorBuilder.() -> Unit) {
        val accumulators = GroupAccumulatorBuilder().apply(accumulator).build()
        val groupDoc = buildJsonObject {
            put("_id", JsonPrimitive(id))
            accumulators.forEach { (key, value) -> put(key, value) }
        }
        stages.add(buildJsonObject { put("\$group", groupDoc) })
    }

    fun groupNull(accumulator: GroupAccumulatorBuilder.() -> Unit) {
        val accumulators = GroupAccumulatorBuilder().apply(accumulator).build()
        val groupDoc = buildJsonObject {
            put("_id", JsonNull)
            accumulators.forEach { (key, value) -> put(key, value) }
        }
        stages.add(buildJsonObject { put("\$group", groupDoc) })
    }

    // $sort stage
    fun sort(sort: SortBuilder.() -> Unit) {
        val sortDoc = SortBuilder().apply(sort).build()
        stages.add(buildJsonObject { put("\$sort", sortDoc) })
    }

    // $limit stage
    fun limit(count: Int) {
        stages.add(buildJsonObject { put("\$limit", count) })
    }

    // $skip stage
    fun skip(count: Int) {
        stages.add(buildJsonObject { put("\$skip", count) })
    }

    // $unwind stage
    fun unwind(path: String, preserveNullAndEmpty: Boolean = false) {
        if (preserveNullAndEmpty) {
            stages.add(buildJsonObject {
                putJsonObject("\$unwind") {
                    put("path", path)
                    put("preserveNullAndEmptyArrays", true)
                }
            })
        } else {
            stages.add(buildJsonObject { put("\$unwind", path) })
        }
    }

    // $lookup stage
    fun lookup(
        from: String,
        localField: String,
        foreignField: String,
        `as`: String
    ) {
        stages.add(buildJsonObject {
            putJsonObject("\$lookup") {
                put("from", from)
                put("localField", localField)
                put("foreignField", foreignField)
                put("as", `as`)
            }
        })
    }

    fun lookup(
        from: String,
        let: Map<String, String>,
        pipeline: AggregateBuilder.() -> Unit,
        `as`: String
    ) {
        val subPipeline = AggregateBuilder().apply(pipeline).build()
        stages.add(buildJsonObject {
            putJsonObject("\$lookup") {
                put("from", from)
                putJsonObject("let") {
                    let.forEach { (k, v) -> put(k, v) }
                }
                put("pipeline", JsonArray(subPipeline))
                put("as", `as`)
            }
        })
    }

    // $addFields stage
    fun addFields(fields: FieldExpressionBuilder.() -> Unit) {
        val fieldsDoc = FieldExpressionBuilder().apply(fields).build()
        stages.add(buildJsonObject { put("\$addFields", fieldsDoc) })
    }

    // $set stage (alias for $addFields)
    fun set(fields: FieldExpressionBuilder.() -> Unit) = addFields(fields)

    // $replaceRoot stage
    fun replaceRoot(newRoot: String) {
        stages.add(buildJsonObject {
            putJsonObject("\$replaceRoot") {
                put("newRoot", newRoot)
            }
        })
    }

    // $count stage
    fun count(fieldName: String) {
        stages.add(buildJsonObject { put("\$count", fieldName) })
    }

    // $facet stage
    fun facet(facets: FacetBuilder.() -> Unit) {
        val facetsDoc = FacetBuilder().apply(facets).build()
        stages.add(buildJsonObject { put("\$facet", facetsDoc) })
    }

    // $bucket stage
    fun bucket(
        groupBy: String,
        boundaries: List<Number>,
        default: String? = null,
        output: GroupAccumulatorBuilder.() -> Unit = {}
    ) {
        val outputDoc = GroupAccumulatorBuilder().apply(output).build()
        stages.add(buildJsonObject {
            putJsonObject("\$bucket") {
                put("groupBy", groupBy)
                put("boundaries", boundaries.toJsonArray())
                default?.let { put("default", it) }
                if (outputDoc.isNotEmpty()) {
                    putJsonObject("output") {
                        outputDoc.forEach { (k, v) -> put(k, v) }
                    }
                }
            }
        })
    }

    // $sample stage
    fun sample(size: Int) {
        stages.add(buildJsonObject {
            putJsonObject("\$sample") {
                put("size", size)
            }
        })
    }

    // $out stage
    fun out(collectionName: String) {
        stages.add(buildJsonObject { put("\$out", collectionName) })
    }

    // $merge stage
    fun merge(
        into: String,
        on: List<String>? = null,
        whenMatched: String? = null,
        whenNotMatched: String? = null
    ) {
        stages.add(buildJsonObject {
            putJsonObject("\$merge") {
                put("into", into)
                on?.let { put("on", it.toJsonArray()) }
                whenMatched?.let { put("whenMatched", it) }
                whenNotMatched?.let { put("whenNotMatched", it) }
            }
        })
    }

    // Raw stage
    fun raw(stage: JsonObject) {
        stages.add(stage)
    }

    fun build(): List<JsonObject> = stages.toList()
}

@AggregateDsl
class GroupAccumulatorBuilder {
    private val accumulators = mutableMapOf<String, JsonElement>()

    infix fun String.accumulator(acc: Accumulator) {
        accumulators[this] = acc.toJsonObject()
    }

    fun build(): Map<String, JsonElement> = accumulators.toMap()
}

sealed class Accumulator {
    abstract fun toJsonObject(): JsonObject

    data object Count : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$sum", 1) }
    }

    data class Sum(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$sum", field) }
    }

    data class Avg(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$avg", field) }
    }

    data class Min(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$min", field) }
    }

    data class Max(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$max", field) }
    }

    data class First(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$first", field) }
    }

    data class Last(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$last", field) }
    }

    data class Push(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$push", field) }
    }

    data class AddToSet(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$addToSet", field) }
    }

    data class StdDevPop(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$stdDevPop", field) }
    }

    data class StdDevSamp(val field: String) : Accumulator() {
        override fun toJsonObject() = buildJsonObject { put("\$stdDevSamp", field) }
    }
}

@AggregateDsl
class FieldExpressionBuilder {
    private val fields = mutableMapOf<String, JsonElement>()

    infix fun String.expr(expression: String) {
        fields[this] = JsonPrimitive(expression)
    }

    infix fun String.value(value: Any?) {
        fields[this] = value.toJsonElement()
    }

    infix fun String.concat(fields: List<String>) {
        this@FieldExpressionBuilder.fields[this] = buildJsonObject {
            put("\$concat", fields.toJsonArray())
        }
    }

    infix fun String.cond(condition: Triple<JsonElement, JsonElement, JsonElement>) {
        fields[this] = buildJsonObject {
            putJsonObject("\$cond") {
                put("if", condition.first)
                put("then", condition.second)
                put("else", condition.third)
            }
        }
    }

    fun build(): JsonObject = JsonObject(fields)
}

@AggregateDsl
class FacetBuilder {
    private val facets = mutableMapOf<String, JsonElement>()

    infix fun String.pipeline(builder: AggregateBuilder.() -> Unit) {
        val stages = AggregateBuilder().apply(builder).build()
        facets[this] = JsonArray(stages)
    }

    fun build(): JsonObject = JsonObject(facets)
}

// =============================================================================
// Bulk Write Builder
// =============================================================================

@DslMarker
annotation class BulkDsl

@BulkDsl
class BulkWriteBuilder<T>(
    private val json: Json,
    private val serializer: KSerializer<T>
) {
    private val operations = mutableListOf<JsonObject>()

    fun insertOne(document: T) {
        val doc = json.encodeToJsonElement(serializer, document)
        operations.add(buildJsonObject {
            putJsonObject("insertOne") {
                put("document", doc)
            }
        })
    }

    fun updateOne(filter: FilterBuilder.() -> Unit, update: UpdateBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        val updateDoc = UpdateBuilder().apply(update).build()
        operations.add(buildJsonObject {
            putJsonObject("updateOne") {
                put("filter", filterDoc)
                put("update", updateDoc)
            }
        })
    }

    fun updateMany(filter: FilterBuilder.() -> Unit, update: UpdateBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        val updateDoc = UpdateBuilder().apply(update).build()
        operations.add(buildJsonObject {
            putJsonObject("updateMany") {
                put("filter", filterDoc)
                put("update", updateDoc)
            }
        })
    }

    fun replaceOne(filter: FilterBuilder.() -> Unit, replacement: T) {
        val filterDoc = FilterBuilder().apply(filter).build()
        val replacementDoc = json.encodeToJsonElement(serializer, replacement)
        operations.add(buildJsonObject {
            putJsonObject("replaceOne") {
                put("filter", filterDoc)
                put("replacement", replacementDoc)
            }
        })
    }

    fun deleteOne(filter: FilterBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        operations.add(buildJsonObject {
            putJsonObject("deleteOne") {
                put("filter", filterDoc)
            }
        })
    }

    fun deleteMany(filter: FilterBuilder.() -> Unit) {
        val filterDoc = FilterBuilder().apply(filter).build()
        operations.add(buildJsonObject {
            putJsonObject("deleteMany") {
                put("filter", filterDoc)
            }
        })
    }

    fun build(): List<JsonObject> = operations.toList()
}

// =============================================================================
// JSON Utilities
// =============================================================================

internal fun Any?.toJsonElement(): JsonElement = when (this) {
    null -> JsonNull
    is JsonElement -> this
    is String -> JsonPrimitive(this)
    is Number -> JsonPrimitive(this)
    is Boolean -> JsonPrimitive(this)
    is List<*> -> toJsonArray()
    is Map<*, *> -> JsonObject(this.mapKeys { it.key.toString() }.mapValues { it.value.toJsonElement() })
    else -> JsonPrimitive(this.toString())
}

internal fun List<*>.toJsonArray(): JsonArray = JsonArray(this.map { it.toJsonElement() })

internal fun Array<out Any?>.toJsonArray(): JsonArray = JsonArray(this.map { it.toJsonElement() })
