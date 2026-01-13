// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { expect, it, describe, beforeEach } from "vitest";
import { serialize, deserialize } from "../../src/index.js";

/**
 * RED Phase Tests: Custom Type Registry
 *
 * Issue: dot-do-capnweb-ki9
 *
 * These tests define the expected API for extensible serialization.
 * Currently, Evaluator/Devaluator have hard-coded switch statements
 * with no plugin mechanism for custom types.
 *
 * Expected API:
 * - TypeRegistry.register(typeName, serializer, deserializer)
 * - TypeRegistry.unregister(typeName)
 * - TypeRegistry.has(typeName)
 * - serialize/deserialize should use registered types
 */

// Import the TypeRegistry that doesn't exist yet - this will cause import errors
// which is expected in the RED phase
import { TypeRegistry } from "../../src/type-registry.js";

// Custom types for testing
class Point {
  constructor(public x: number, public y: number) {}

  static fromJSON(data: { x: number; y: number }): Point {
    return new Point(data.x, data.y);
  }

  toJSON(): { x: number; y: number } {
    return { x: this.x, y: this.y };
  }
}

class Vector3 {
  constructor(public x: number, public y: number, public z: number) {}

  static fromArray(arr: [number, number, number]): Vector3 {
    return new Vector3(arr[0], arr[1], arr[2]);
  }

  toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }
}

class CustomId {
  constructor(public prefix: string, public value: number) {}

  toString(): string {
    return `${this.prefix}-${this.value}`;
  }

  static parse(str: string): CustomId {
    const [prefix, value] = str.split("-");
    return new CustomId(prefix, parseInt(value, 10));
  }
}

describe("TypeRegistry - register custom type serializer", () => {
  beforeEach(() => {
    // Reset registry before each test
    TypeRegistry.clear();
  });

  it("registers a custom type serializer", () => {
    const serializer = (value: Point) => ({ x: value.x, y: value.y });

    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: serializer,
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    expect(TypeRegistry.has("Point")).toBe(true);
  });

  it("serializes a registered custom type", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const point = new Point(10, 20);
    const serialized = serialize(point);

    // Should serialize using the custom type format
    expect(serialized).toContain('"Point"');
    expect(serialized).toContain("10");
    expect(serialized).toContain("20");
  });

  it("serializes nested objects containing custom types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const data = {
      name: "origin",
      location: new Point(0, 0),
    };

    const serialized = serialize(data);
    expect(serialized).toContain('"Point"');
  });

  it("serializes arrays containing custom types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const points = [new Point(1, 2), new Point(3, 4)];
    const serialized = serialize(points);

    // Should contain Point type markers for both
    const matches = serialized.match(/"Point"/g);
    expect(matches?.length).toBe(2);
  });
});

describe("TypeRegistry - register custom type deserializer", () => {
  beforeEach(() => {
    TypeRegistry.clear();
  });

  it("deserializes a registered custom type", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    // Manually construct serialized format (assuming ["typeName", data] format)
    const serialized = '["Point",{"x":10,"y":20}]';
    const result = deserialize(serialized);

    expect(result).toBeInstanceOf(Point);
    expect((result as Point).x).toBe(10);
    expect((result as Point).y).toBe(20);
  });

  it("deserializes nested custom types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const original = {
      name: "test",
      location: new Point(5, 15),
    };

    const serialized = serialize(original);
    const result = deserialize(serialized) as typeof original;

    expect(result.name).toBe("test");
    expect(result.location).toBeInstanceOf(Point);
    expect(result.location.x).toBe(5);
    expect(result.location.y).toBe(15);
  });

  it("throws for unregistered custom type in deserialization", () => {
    // Attempt to deserialize a custom type that hasn't been registered
    const serialized = '["UnknownType",{"data":"test"}]';

    expect(() => deserialize(serialized)).toThrow(/unknown special value/);
  });
});

describe("TypeRegistry - round-trip custom types", () => {
  beforeEach(() => {
    TypeRegistry.clear();
  });

  it("round-trips a Point through serialize/deserialize", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const original = new Point(42, 84);
    const serialized = serialize(original);
    const result = deserialize(serialized);

    expect(result).toBeInstanceOf(Point);
    expect((result as Point).x).toBe(42);
    expect((result as Point).y).toBe(84);
  });

  it("round-trips a Vector3 through serialize/deserialize", () => {
    TypeRegistry.register("Vector3", {
      check: (value: unknown): value is Vector3 => value instanceof Vector3,
      serialize: (value: Vector3) => value.toArray(),
      deserialize: (data: [number, number, number]) => Vector3.fromArray(data),
    });

    const original = new Vector3(1, 2, 3);
    const serialized = serialize(original);
    const result = deserialize(serialized);

    expect(result).toBeInstanceOf(Vector3);
    expect((result as Vector3).x).toBe(1);
    expect((result as Vector3).y).toBe(2);
    expect((result as Vector3).z).toBe(3);
  });

  it("round-trips CustomId with string serialization", () => {
    TypeRegistry.register("CustomId", {
      check: (value: unknown): value is CustomId => value instanceof CustomId,
      serialize: (value: CustomId) => value.toString(),
      deserialize: (data: string) => CustomId.parse(data),
    });

    const original = new CustomId("USER", 12345);
    const serialized = serialize(original);
    const result = deserialize(serialized);

    expect(result).toBeInstanceOf(CustomId);
    expect((result as CustomId).prefix).toBe("USER");
    expect((result as CustomId).value).toBe(12345);
  });

  it("round-trips multiple custom types in the same object", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    TypeRegistry.register("Vector3", {
      check: (value: unknown): value is Vector3 => value instanceof Vector3,
      serialize: (value: Vector3) => value.toArray(),
      deserialize: (data: [number, number, number]) => Vector3.fromArray(data),
    });

    const original = {
      point2d: new Point(1, 2),
      point3d: new Vector3(3, 4, 5),
      label: "test",
    };

    const serialized = serialize(original);
    const result = deserialize(serialized) as typeof original;

    expect(result.point2d).toBeInstanceOf(Point);
    expect(result.point2d.x).toBe(1);
    expect(result.point2d.y).toBe(2);
    expect(result.point3d).toBeInstanceOf(Vector3);
    expect(result.point3d.x).toBe(3);
    expect(result.point3d.y).toBe(4);
    expect(result.point3d.z).toBe(5);
    expect(result.label).toBe("test");
  });

  it("round-trips deeply nested custom types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const original = {
      level1: {
        level2: {
          level3: {
            point: new Point(100, 200),
          },
        },
      },
    };

    const serialized = serialize(original);
    const result = deserialize(serialized) as typeof original;

    expect(result.level1.level2.level3.point).toBeInstanceOf(Point);
    expect(result.level1.level2.level3.point.x).toBe(100);
    expect(result.level1.level2.level3.point.y).toBe(200);
  });

  it("round-trips array of custom types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    const original = [new Point(1, 1), new Point(2, 2), new Point(3, 3)];
    const serialized = serialize(original);
    const result = deserialize(serialized) as Point[];

    expect(result).toHaveLength(3);
    expect(result[0]).toBeInstanceOf(Point);
    expect(result[0].x).toBe(1);
    expect(result[1]).toBeInstanceOf(Point);
    expect(result[1].x).toBe(2);
    expect(result[2]).toBeInstanceOf(Point);
    expect(result[2].x).toBe(3);
  });
});

describe("TypeRegistry - type conflicts handling", () => {
  beforeEach(() => {
    TypeRegistry.clear();
  });

  it("throws when registering a type with reserved name", () => {
    // Built-in types should not be overridable
    const reservedNames = [
      "bigint",
      "date",
      "bytes",
      "error",
      "undefined",
      "inf",
      "-inf",
      "nan",
      "import",
      "export",
      "promise",
      "pipeline",
      "remap",
    ];

    for (const name of reservedNames) {
      expect(() =>
        TypeRegistry.register(name, {
          check: () => false,
          serialize: (v: unknown) => v,
          deserialize: (v: unknown) => v,
        })
      ).toThrow(/reserved|cannot override|built-in/i);
    }
  });

  it("throws when registering duplicate type name", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    expect(() =>
      TypeRegistry.register("Point", {
        check: (value: unknown): value is Point => value instanceof Point,
        serialize: (value: Point) => [value.x, value.y],
        deserialize: (data: [number, number]) => new Point(data[0], data[1]),
      })
    ).toThrow(/already registered|duplicate/i);
  });

  it("allows re-registration with force option", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    // Force re-registration should not throw
    expect(() =>
      TypeRegistry.register(
        "Point",
        {
          check: (value: unknown): value is Point => value instanceof Point,
          serialize: (value: Point) => [value.x, value.y],
          deserialize: (data: [number, number]) => new Point(data[0], data[1]),
        },
        { force: true }
      )
    ).not.toThrow();
  });

  it("unregisters a custom type", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    expect(TypeRegistry.has("Point")).toBe(true);

    TypeRegistry.unregister("Point");

    expect(TypeRegistry.has("Point")).toBe(false);
  });

  it("throws when serializing unregistered custom type", () => {
    // Point is not registered
    const point = new Point(1, 2);

    expect(() => serialize(point)).toThrow(/Cannot serialize value/);
  });

  it("first registered type wins when multiple types match", () => {
    // Create a base class and subclass scenario
    class Shape {
      type = "shape";
    }
    class Circle extends Shape {
      type = "circle";
      constructor(public radius: number) {
        super();
      }
    }

    // Register Shape first
    TypeRegistry.register("Shape", {
      check: (value: unknown): value is Shape => value instanceof Shape,
      serialize: (value: Shape) => ({ type: value.type }),
      deserialize: (data: { type: string }) => {
        const s = new Shape();
        s.type = data.type;
        return s;
      },
    });

    // Register Circle second - but Shape check will match first
    TypeRegistry.register("Circle", {
      check: (value: unknown): value is Circle => value instanceof Circle,
      serialize: (value: Circle) => ({ type: value.type, radius: value.radius }),
      deserialize: (data: { type: string; radius: number }) => new Circle(data.radius),
    });

    const circle = new Circle(5);
    const serialized = serialize(circle);

    // Should serialize as Shape (first registered that matches)
    // unless priority is specified
    expect(serialized).toContain('"Shape"');
  });

  it("respects priority when multiple types could match", () => {
    class Shape {
      type = "shape";
    }
    class Circle extends Shape {
      type = "circle";
      constructor(public radius: number) {
        super();
      }
    }

    // Register Shape with low priority
    TypeRegistry.register(
      "Shape",
      {
        check: (value: unknown): value is Shape => value instanceof Shape,
        serialize: (value: Shape) => ({ type: value.type }),
        deserialize: (data: { type: string }) => {
          const s = new Shape();
          s.type = data.type;
          return s;
        },
      },
      { priority: 0 }
    );

    // Register Circle with high priority
    TypeRegistry.register(
      "Circle",
      {
        check: (value: unknown): value is Circle => value instanceof Circle,
        serialize: (value: Circle) => ({ type: value.type, radius: value.radius }),
        deserialize: (data: { type: string; radius: number }) => new Circle(data.radius),
      },
      { priority: 10 }
    );

    const circle = new Circle(5);
    const serialized = serialize(circle);

    // Should serialize as Circle due to higher priority
    expect(serialized).toContain('"Circle"');
  });

  it("handles serialization errors gracefully", () => {
    TypeRegistry.register("ErrorType", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: () => {
        throw new Error("Serialization failed");
      },
      deserialize: () => new Point(0, 0),
    });

    const point = new Point(1, 2);

    expect(() => serialize(point)).toThrow("Serialization failed");
  });

  it("handles deserialization errors gracefully", () => {
    TypeRegistry.register("ErrorType", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: () => {
        throw new Error("Deserialization failed");
      },
    });

    const serialized = '["ErrorType",{"x":1,"y":2}]';

    expect(() => deserialize(serialized)).toThrow("Deserialization failed");
  });
});

describe("TypeRegistry - API completeness", () => {
  beforeEach(() => {
    TypeRegistry.clear();
  });

  it("lists all registered types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    TypeRegistry.register("Vector3", {
      check: (value: unknown): value is Vector3 => value instanceof Vector3,
      serialize: (value: Vector3) => value.toArray(),
      deserialize: (data: [number, number, number]) => Vector3.fromArray(data),
    });

    const types = TypeRegistry.list();
    expect(types).toContain("Point");
    expect(types).toContain("Vector3");
    expect(types.length).toBe(2);
  });

  it("clears all registered types", () => {
    TypeRegistry.register("Point", {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    });

    TypeRegistry.clear();

    expect(TypeRegistry.has("Point")).toBe(false);
    expect(TypeRegistry.list().length).toBe(0);
  });

  it("gets registered type definition", () => {
    const definition = {
      check: (value: unknown): value is Point => value instanceof Point,
      serialize: (value: Point) => ({ x: value.x, y: value.y }),
      deserialize: (data: { x: number; y: number }) => new Point(data.x, data.y),
    };

    TypeRegistry.register("Point", definition);

    const retrieved = TypeRegistry.get("Point");
    expect(retrieved).toBeDefined();
    expect(retrieved?.serialize).toBe(definition.serialize);
    expect(retrieved?.deserialize).toBe(definition.deserialize);
  });

  it("returns undefined for unregistered type", () => {
    const retrieved = TypeRegistry.get("NonExistent");
    expect(retrieved).toBeUndefined();
  });
});
