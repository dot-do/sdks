// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe } from "vitest"
import { serialize, deserialize } from "../src/index.js"

/**
 * Comprehensive unit tests for serialization (serialize.ts)
 * Tests serialization round-trips for primitives, objects, arrays, Maps, Sets, and special types
 */

describe("serialize - primitives", () => {
  it("serializes and deserializes null", () => {
    const value = null;
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes boolean true", () => {
    const value = true;
    const serialized = serialize(value);
    expect(deserialize(serialized)).toBe(value);
  });

  it("serializes and deserializes boolean false", () => {
    const value = false;
    const serialized = serialize(value);
    expect(deserialize(serialized)).toBe(value);
  });

  it("serializes and deserializes positive integers", () => {
    const values = [0, 1, 42, 123456789];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes negative integers", () => {
    const values = [-1, -42, -123456789];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes floating point numbers", () => {
    const values = [0.5, 1.5, 3.14159, -2.718, 1e10, 1e-10];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes special number values", () => {
    // Infinity
    expect(deserialize(serialize(Infinity))).toBe(Infinity);
    expect(serialize(Infinity)).toBe('["inf"]');

    // Negative Infinity
    expect(deserialize(serialize(-Infinity))).toBe(-Infinity);
    expect(serialize(-Infinity)).toBe('["-inf"]');

    // NaN
    expect(deserialize(serialize(NaN))).toBeNaN();
    expect(serialize(NaN)).toBe('["nan"]');
  });

  it("serializes and deserializes strings", () => {
    const values = ["", "hello", "hello world", "unicode: \u00e9\u00e0\u00fc", "emoji: test"];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes strings with special characters", () => {
    const values = [
      "line1\nline2",
      "tab\there",
      'quote"here',
      "backslash\\here",
      "\u0000null\u0000byte"
    ];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes undefined", () => {
    const serialized = serialize(undefined);
    expect(serialized).toBe('["undefined"]');
    expect(deserialize(serialized)).toBe(undefined);
  });
});

describe("serialize - bigint", () => {
  it("serializes and deserializes positive bigints", () => {
    const values = [0n, 1n, 123n, 9007199254740991n, 999999999999999999999999999999n];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("serializes and deserializes negative bigints", () => {
    const values = [-1n, -123n, -9007199254740991n, -999999999999999999999999999999n];
    for (const value of values) {
      const serialized = serialize(value);
      expect(deserialize(serialized)).toBe(value);
    }
  });

  it("uses the correct format for bigint", () => {
    expect(serialize(123n)).toBe('["bigint","123"]');
  });
});

describe("serialize - dates", () => {
  it("serializes and deserializes dates", () => {
    const values = [
      new Date(0),
      new Date(1234567890123),
      new Date("2024-01-15T12:00:00Z"),
      new Date(-1234567890123) // Before epoch
    ];
    for (const value of values) {
      const serialized = serialize(value);
      const deserialized = deserialize(serialized) as Date;
      expect(deserialized.getTime()).toBe(value.getTime());
    }
  });

  it("uses the correct format for dates", () => {
    expect(serialize(new Date(1234))).toBe('["date",1234]');
  });
});

describe("serialize - binary data (Uint8Array)", () => {
  it("serializes and deserializes empty Uint8Array", () => {
    const value = new Uint8Array([]);
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as Uint8Array;
    expect(deserialized).toBeInstanceOf(Uint8Array);
    expect(Array.from(deserialized)).toStrictEqual([]);
  });

  it("serializes and deserializes Uint8Array with data", () => {
    const value = new Uint8Array([1, 2, 3, 255, 0, 128]);
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as Uint8Array;
    expect(deserialized).toBeInstanceOf(Uint8Array);
    expect(Array.from(deserialized)).toStrictEqual([1, 2, 3, 255, 0, 128]);
  });

  it("serializes and deserializes text as bytes", () => {
    const text = "hello!";
    const value = new TextEncoder().encode(text);
    const serialized = serialize(value);
    expect(serialized).toBe('["bytes","aGVsbG8h"]');
    const deserialized = deserialize(serialized) as Uint8Array;
    expect(new TextDecoder().decode(deserialized)).toBe(text);
  });
});

describe("serialize - errors", () => {
  it("serializes and deserializes Error", () => {
    const value = new Error("test message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as Error;
    expect(deserialized).toBeInstanceOf(Error);
    expect(deserialized.message).toBe("test message");
  });

  it("serializes and deserializes TypeError", () => {
    const value = new TypeError("type error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as TypeError;
    expect(deserialized).toBeInstanceOf(TypeError);
    expect(deserialized.message).toBe("type error message");
  });

  it("serializes and deserializes RangeError", () => {
    const value = new RangeError("range error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as RangeError;
    expect(deserialized).toBeInstanceOf(RangeError);
    expect(deserialized.message).toBe("range error message");
  });

  it("serializes and deserializes ReferenceError", () => {
    const value = new ReferenceError("reference error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as ReferenceError;
    expect(deserialized).toBeInstanceOf(ReferenceError);
    expect(deserialized.message).toBe("reference error message");
  });

  it("serializes and deserializes SyntaxError", () => {
    const value = new SyntaxError("syntax error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as SyntaxError;
    expect(deserialized).toBeInstanceOf(SyntaxError);
    expect(deserialized.message).toBe("syntax error message");
  });

  it("serializes and deserializes URIError", () => {
    const value = new URIError("uri error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as URIError;
    expect(deserialized).toBeInstanceOf(URIError);
    expect(deserialized.message).toBe("uri error message");
  });

  it("serializes and deserializes EvalError", () => {
    const value = new EvalError("eval error message");
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as EvalError;
    expect(deserialized).toBeInstanceOf(EvalError);
    expect(deserialized.message).toBe("eval error message");
  });
});

describe("serialize - objects", () => {
  it("serializes and deserializes empty objects", () => {
    const value = {};
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes simple objects", () => {
    const value = { foo: 123, bar: "hello" };
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes nested objects", () => {
    const value = {
      level1: {
        level2: {
          value: 42
        }
      }
    };
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes objects with various value types", () => {
    const value = {
      nullVal: null,
      boolVal: true,
      numVal: 42,
      strVal: "hello",
      undefinedVal: undefined,
      bigintVal: 123n,
      dateVal: new Date(1234),
      bytesVal: new Uint8Array([1, 2, 3])
    };
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as any;
    expect(deserialized.nullVal).toBe(null);
    expect(deserialized.boolVal).toBe(true);
    expect(deserialized.numVal).toBe(42);
    expect(deserialized.strVal).toBe("hello");
    expect(deserialized.undefinedVal).toBe(undefined);
    expect(deserialized.bigintVal).toBe(123n);
    expect(deserialized.dateVal.getTime()).toBe(1234);
    expect(Array.from(deserialized.bytesVal)).toStrictEqual([1, 2, 3]);
  });
});

describe("serialize - arrays", () => {
  it("serializes and deserializes empty arrays", () => {
    const value: unknown[] = [];
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes arrays with primitives", () => {
    const value = [1, 2, 3, "hello", true, null];
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes nested arrays", () => {
    const value = [[1, 2], [3, 4], [[5, 6]]];
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("serializes and deserializes arrays with objects", () => {
    const value = [{ a: 1 }, { b: 2 }];
    const serialized = serialize(value);
    expect(deserialize(serialized)).toStrictEqual(value);
  });

  it("wraps literal arrays in an outer array for escaping", () => {
    // An array is serialized as [[contents]] to distinguish from special values
    expect(serialize([123])).toBe("[[123]]");
    expect(serialize([[123, 456]])).toBe("[[[[123,456]]]]");
  });
});

describe("serialize - complex nested structures", () => {
  it("serializes and deserializes deeply nested structures", () => {
    const value = {
      users: [
        { name: "Alice", age: 30, active: true },
        { name: "Bob", age: 25, active: false }
      ],
      metadata: {
        created: new Date(1000000),
        tags: ["important", "reviewed"],
        counts: {
          views: 100n,
          likes: 50n
        }
      },
      data: new Uint8Array([1, 2, 3, 4, 5])
    };
    const serialized = serialize(value);
    const deserialized = deserialize(serialized) as any;

    expect(deserialized.users).toStrictEqual(value.users);
    expect(deserialized.metadata.created.getTime()).toBe(1000000);
    expect(deserialized.metadata.tags).toStrictEqual(["important", "reviewed"]);
    expect(deserialized.metadata.counts.views).toBe(100n);
    expect(deserialized.metadata.counts.likes).toBe(50n);
    expect(Array.from(deserialized.data)).toStrictEqual([1, 2, 3, 4, 5]);
  });
});

describe("serialize - error cases", () => {
  it("throws for non-serializable values", () => {
    class CustomClass {
      value = 42;
      toString() { return "CustomClass"; }
    }
    expect(() => serialize(new CustomClass())).toThrow(TypeError);
  });

  it("throws for circular references", () => {
    const obj: any = { a: 1 };
    obj.self = obj;
    expect(() => serialize(obj)).toThrow(
      "Serialization exceeded maximum allowed depth. (Does the message contain cycles?)"
    );
  });

  it("throws for deeply nested structures exceeding max depth", () => {
    // Create a structure with depth > 64
    let value: any = { inner: null };
    let current = value;
    for (let i = 0; i < 70; i++) {
      current.inner = { inner: null };
      current = current.inner;
    }
    expect(() => serialize(value)).toThrow(
      "Serialization exceeded maximum allowed depth. (Does the message contain cycles?)"
    );
  });

  it("throws for symbols", () => {
    expect(() => serialize(Symbol("test"))).toThrow(TypeError);
  });

  it("throws for functions", () => {
    // Functions can only be serialized in RPC context with stubs
    expect(() => serialize(() => {})).toThrow(
      "Can't serialize RPC stubs in this context."
    );
  });
});

describe("deserialize - error cases", () => {
  it("throws for invalid JSON", () => {
    expect(() => deserialize('{"unclosed": ')).toThrow();
  });

  it("throws for unknown special values", () => {
    expect(() => deserialize('["unknown_type", "param"]')).toThrow(
      'unknown special value: ["unknown_type","param"]'
    );
  });

  it("throws for malformed date", () => {
    expect(() => deserialize('["date"]')).toThrow();
    expect(() => deserialize('["date","string"]')).toThrow();
  });

  it("throws for malformed error", () => {
    expect(() => deserialize('["error"]')).toThrow();
    expect(() => deserialize('["error","TypeError"]')).toThrow(); // missing message
  });

  it("throws for malformed bigint", () => {
    expect(() => deserialize('["bigint"]')).toThrow();
    expect(() => deserialize('["bigint",123]')).toThrow(); // must be string
  });

  it("throws for malformed bytes", () => {
    expect(() => deserialize('["bytes"]')).toThrow();
    expect(() => deserialize('["bytes",123]')).toThrow(); // must be string
  });

  it("throws for malformed undefined", () => {
    expect(() => deserialize('["undefined","extra"]')).toThrow();
  });
});

describe("serialize - round-trip integrity", () => {
  it("maintains type identity through round-trip", () => {
    const testCases = [
      { type: "null", value: null },
      { type: "boolean", value: true },
      { type: "number", value: 42 },
      { type: "string", value: "hello" },
      { type: "bigint", value: 123n },
      { type: "undefined", value: undefined },
    ];

    for (const { type, value } of testCases) {
      const result = deserialize(serialize(value));
      expect(typeof result).toBe(typeof value);
      if (typeof value === "bigint") {
        expect(result).toBe(value);
      } else {
        expect(result).toStrictEqual(value);
      }
    }
  });

  it("preserves object property order through round-trip", () => {
    const value = { z: 1, a: 2, m: 3 };
    const result = deserialize(serialize(value)) as any;
    expect(Object.keys(result)).toStrictEqual(Object.keys(value));
  });

  it("preserves array order through round-trip", () => {
    const value = [5, 3, 1, 4, 2];
    const result = deserialize(serialize(value));
    expect(result).toStrictEqual(value);
  });
});
