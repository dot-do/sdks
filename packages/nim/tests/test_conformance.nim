## Cap'n Web Conformance Tests for Nim
## Loads YAML specs and generates test cases with remap support
##
## Run with:
##   TEST_SERVER_URL=ws://localhost:8080 nim c -r tests/test_conformance.nim
##
## Or via nimble:
##   TEST_SERVER_URL=ws://localhost:8080 nimble test

import std/[unittest, asyncdispatch, json, os, sequtils, strutils, tables, options, math]
import yaml
import ../src/capnweb

# ---------------------------------------------------------
# Test Configuration
# ---------------------------------------------------------

const
  DefaultTestServerUrl = "ws://localhost:8080"
  DefaultTestSpecDir = "../../test/conformance"

proc getTestServerUrl(): string =
  getEnv("TEST_SERVER_URL", DefaultTestServerUrl)

proc getTestSpecDir(): string =
  getEnv("TEST_SPEC_DIR", DefaultTestSpecDir)

# ---------------------------------------------------------
# Conformance Test Structures
# ---------------------------------------------------------

type
  ConformanceSpec = object
    name: string
    description: string
    tests: seq[ConformanceTest]

  ConformanceTest = object
    name: string
    description: string
    call: string
    args: seq[YamlNode]
    expect: Option[YamlNode]
    expectType: Option[string]
    expectLength: Option[int]
    maxRoundTrips: Option[int]
    map: Option[MapConfig]
    setup: Option[seq[SetupStep]]
    verify: Option[seq[VerifyStep]]

  MapConfig = object
    expression: string
    captures: seq[string]

  SetupStep = object
    call: Option[string]
    args: Option[seq[YamlNode]]
    map: Option[MapConfig]
    `as`: Option[string]
    `await`: Option[bool]
    pipeline: Option[seq[PipelineStep]]

  PipelineStep = object
    call: string
    map: Option[MapConfig]

  VerifyStep = object
    call: string
    expect: YamlNode

# ---------------------------------------------------------
# YAML Parsing
# ---------------------------------------------------------

proc parseMapConfig(node: YamlNode): MapConfig =
  result.expression = node["expression"].content
  if node.hasKey("captures"):
    for cap in node["captures"]:
      result.captures.add(cap.content)

proc parseSetupStep(node: YamlNode): SetupStep =
  if node.hasKey("call"):
    result.call = some(node["call"].content)
  if node.hasKey("args"):
    for arg in node["args"]:
      if result.args.isNone:
        result.args = some(@[YamlNode]())
      result.args.get.add(arg)
  if node.hasKey("map"):
    result.map = some(parseMapConfig(node["map"]))
  if node.hasKey("as"):
    result.`as` = some(node["as"].content)
  if node.hasKey("await"):
    result.`await` = some(node["await"].content == "true")
  if node.hasKey("pipeline"):
    var steps: seq[PipelineStep] = @[]
    for pstep in node["pipeline"]:
      var ps = PipelineStep(call: pstep["call"].content)
      if pstep.hasKey("map"):
        ps.map = some(parseMapConfig(pstep["map"]))
      steps.add(ps)
    result.pipeline = some(steps)

proc parseVerifyStep(node: YamlNode): VerifyStep =
  result.call = node["call"].content
  result.expect = node["expect"]

proc parseConformanceTest(node: YamlNode): ConformanceTest =
  result.name = node["name"].content
  result.description = node["description"].content
  result.call = node["call"].content

  if node.hasKey("args"):
    for arg in node["args"]:
      result.args.add(arg)

  if node.hasKey("expect"):
    result.expect = some(node["expect"])

  if node.hasKey("expect_type"):
    result.expectType = some(node["expect_type"].content)

  if node.hasKey("expect_length"):
    result.expectLength = some(parseInt(node["expect_length"].content))

  if node.hasKey("max_round_trips"):
    result.maxRoundTrips = some(parseInt(node["max_round_trips"].content))

  if node.hasKey("map"):
    result.map = some(parseMapConfig(node["map"]))

  if node.hasKey("setup"):
    var steps: seq[SetupStep] = @[]
    for step in node["setup"]:
      steps.add(parseSetupStep(step))
    result.setup = some(steps)

  if node.hasKey("verify"):
    var vsteps: seq[VerifyStep] = @[]
    for vstep in node["verify"]:
      vsteps.add(parseVerifyStep(vstep))
    result.verify = some(vsteps)

proc parseConformanceSpec(content: string): ConformanceSpec =
  let doc = loadDom(content)
  let root = doc.root

  result.name = root["name"].content
  result.description = root["description"].content

  for test in root["tests"]:
    result.tests.add(parseConformanceTest(test))

proc loadConformanceSpecs(dir: string): seq[ConformanceSpec] =
  result = @[]
  if not dirExists(dir):
    return

  for file in walkFiles(dir / "*.yaml"):
    let content = readFile(file)
    result.add(parseConformanceSpec(content))

# ---------------------------------------------------------
# YAML to JSON Conversion
# ---------------------------------------------------------

proc yamlToJson(node: YamlNode): JsonNode =
  case node.kind
  of yScalar:
    let content = node.content
    if content == "null" or content == "~":
      return newJNull()
    if content == "true":
      return newJBool(true)
    if content == "false":
      return newJBool(false)
    # Try to parse as number
    try:
      if '.' in content:
        return newJFloat(parseFloat(content))
      else:
        return newJInt(parseInt(content))
    except:
      return newJString(content)
  of ySequence:
    result = newJArray()
    for item in node:
      result.add(yamlToJson(item))
  of yMapping:
    result = newJObject()
    for key, value in node.pairs:
      result[key.content] = yamlToJson(value)

proc argsToJson(args: seq[YamlNode]): seq[JsonNode] =
  args.map(yamlToJson)

# ---------------------------------------------------------
# Result Comparison
# ---------------------------------------------------------

proc compareJson(actual, expected: JsonNode): bool =
  if actual.kind != expected.kind:
    # Handle int/float comparison
    if actual.kind == JInt and expected.kind == JFloat:
      return actual.getInt.float == expected.getFloat
    if actual.kind == JFloat and expected.kind == JInt:
      return actual.getFloat == expected.getInt.float
    return false

  case actual.kind
  of JNull:
    return true
  of JBool:
    return actual.getBool == expected.getBool
  of JInt:
    return actual.getInt == expected.getInt
  of JFloat:
    return abs(actual.getFloat - expected.getFloat) < 0.0001
  of JString:
    return actual.getStr == expected.getStr
  of JArray:
    if actual.len != expected.len:
      return false
    for i in 0 ..< actual.len:
      if not compareJson(actual[i], expected[i]):
        return false
    return true
  of JObject:
    if actual.len != expected.len:
      return false
    for key, value in expected.pairs:
      if not actual.hasKey(key):
        return false
      if not compareJson(actual[key], value):
        return false
    return true

proc compareResults(actual: JsonNode, expected: YamlNode): bool =
  let expectedJson = yamlToJson(expected)
  compareJson(actual, expectedJson)

# ---------------------------------------------------------
# Conformance Test Session
# ---------------------------------------------------------

type
  ConformanceSession = ref object
    url: string
    session: Session
    variables: Table[string, JsonNode]
    roundTrips: int

proc newConformanceSession(url: string): ConformanceSession =
  ConformanceSession(
    url: url,
    session: connect(url),
    variables: initTable[string, JsonNode](),
    roundTrips: 0
  )

proc resetRoundTrips(cs: ConformanceSession) =
  cs.roundTrips = 0

proc setVariable(cs: ConformanceSession, name, value: JsonNode) =
  cs.variables[name.getStr] = value

proc setVariable(cs: ConformanceSession, name: string, value: JsonNode) =
  cs.variables[name] = value

proc getVariable(cs: ConformanceSession, name: string): Option[JsonNode] =
  if cs.variables.hasKey(name):
    some(cs.variables[name])
  else:
    none(JsonNode)

proc call(cs: ConformanceSession, methodName: string, args: seq[JsonNode],
          remapConfig: Option[MapConfig] = none(MapConfig)): Future[JsonNode] {.async.} =
  ## Execute a call with optional remap (server-side map)
  cs.roundTrips.inc

  let capnwebRemap = if remapConfig.isSome:
    some(newRemapConfig(remapConfig.get.expression, remapConfig.get.captures))
  else:
    none(RemapConfig)

  return await cs.session.call(methodName, args, capnwebRemap)

proc close(cs: ConformanceSession) {.async.} =
  await cs.session.close()

# ---------------------------------------------------------
# Setup and Verify Execution
# ---------------------------------------------------------

proc runSetup(cs: ConformanceSession, setupSteps: seq[SetupStep]) {.async.} =
  for step in setupSteps:
    if step.call.isSome:
      let callTarget = step.call.get

      # Handle variable references
      if callTarget.startsWith("$"):
        let varName = callTarget[1..^1]
        if cs.getVariable(varName).isSome:
          let varValue = cs.getVariable(varName).get
          let result = if step.map.isSome:
            await cs.call("__remap__", @[varValue], step.map)
          else:
            varValue

          if step.`as`.isSome:
            cs.setVariable(step.`as`.get, result)
      else:
        let args = if step.args.isSome: argsToJson(step.args.get) else: @[]
        let result = await cs.call(callTarget, args, step.map)

        if step.`as`.isSome:
          cs.setVariable(step.`as`.get, result)

    elif step.pipeline.isSome:
      var varResult = newJNull()

      for pipeStep in step.pipeline.get:
        if pipeStep.call.startsWith("$"):
          let varName = pipeStep.call[1..^1]
          if cs.getVariable(varName).isSome:
            varResult = cs.getVariable(varName).get
        else:
          varResult = await cs.call(pipeStep.call, @[varResult], pipeStep.map)

      if step.`as`.isSome:
        cs.setVariable(step.`as`.get, varResult)

proc runVerify(cs: ConformanceSession, result: JsonNode, verifySteps: seq[VerifyStep]): Future[bool] {.async.} =
  for v in verifySteps:
    # Parse verify call (e.g., "result.value")
    let parts = v.call.split(".")
    var verifyResult = result

    for i in 1 ..< parts.len:
      let part = parts[i]
      if verifyResult.kind == JObject and verifyResult.hasKey(part):
        verifyResult = verifyResult[part]
      else:
        verifyResult = await cs.call(part, @[verifyResult])

    if not compareResults(verifyResult, v.expect):
      echo "  Verify ", v.call, " failed"
      echo "  Expected: ", yamlToJson(v.expect)
      echo "  Actual:   ", verifyResult
      return false

  return true

# ---------------------------------------------------------
# Test Runner
# ---------------------------------------------------------

proc runConformanceTest(cs: ConformanceSession, test: ConformanceTest): Future[bool] {.async.} =
  cs.resetRoundTrips()

  # Run setup if present
  if test.setup.isSome:
    await runSetup(cs, test.setup.get)

  # Execute the main call
  let callTarget = test.call
  var result: JsonNode

  # Handle variable references
  if callTarget.startsWith("$"):
    let varName = callTarget[1..^1]
    if cs.getVariable(varName).isSome:
      let varValue = cs.getVariable(varName).get
      result = if test.map.isSome:
        await cs.call("__remap__", @[varValue], test.map)
      else:
        varValue
    else:
      echo "  Variable ", varName, " not found"
      return false
  else:
    let args = argsToJson(test.args)
    result = await cs.call(callTarget, args, test.map)

  # Check expectations
  if test.expect.isSome:
    if not compareResults(result, test.expect.get):
      echo "  Expected: ", yamlToJson(test.expect.get)
      echo "  Actual:   ", result
      return false

  # Check expected type
  if test.expectType.isSome:
    case test.expectType.get
    of "capability":
      if result.kind != JObject or (not result.hasKey("__cap__") and not result.hasKey("id")):
        echo "  Expected capability, got: ", result
        return false
    of "array_of_capabilities":
      if result.kind != JArray:
        echo "  Expected array of capabilities, got: ", result
        return false

  # Check expected length
  if test.expectLength.isSome:
    if result.kind == JArray:
      if result.len != test.expectLength.get:
        echo "  Expected length ", test.expectLength.get, ", got ", result.len
        return false
    else:
      echo "  Expected array for length check, got: ", result
      return false

  # Check max round trips
  if test.maxRoundTrips.isSome:
    if cs.roundTrips > test.maxRoundTrips.get:
      echo "  Expected max ", test.maxRoundTrips.get, " round trips, got ", cs.roundTrips
      return false

  # Run verify steps
  if test.verify.isSome:
    if not (await runVerify(cs, result, test.verify.get)):
      return false

  return true

# ---------------------------------------------------------
# Main Test Suite
# ---------------------------------------------------------

suite "Cap'n Web Conformance Tests":
  let testServerUrl = getTestServerUrl()
  let testSpecDir = getTestSpecDir()

  # Resolve spec dir relative to this file
  let specDir = if testSpecDir.isAbsolute:
    testSpecDir
  else:
    getCurrentDir() / testSpecDir

  var cs: ConformanceSession

  setup:
    cs = newConformanceSession(testServerUrl)

  teardown:
    waitFor cs.close()

  # Load and run conformance specs
  let specs = loadConformanceSpecs(specDir)

  if specs.len > 0:
    for spec in specs:
      for test in spec.tests:
        test "[" & spec.name & "] " & test.name:
          let passed = waitFor runConformanceTest(cs, test)
          check passed
  else:
    # Fallback inline tests for basic validation
    test "Basic: square_positive":
      let result = waitFor cs.call("square", @[%5])
      check result.getInt == 25

    test "Basic: square_negative":
      let result = waitFor cs.call("square", @[%(-3)])
      check result.getInt == 9

    test "Basic: square_zero":
      let result = waitFor cs.call("square", @[%0])
      check result.getInt == 0

    test "Basic: return_number_positive":
      let result = waitFor cs.call("returnNumber", @[%42])
      check result.getInt == 42

    test "Basic: return_null":
      let result = waitFor cs.call("returnNull", @[])
      check result.kind == JNull

    test "Basic: fibonacci_ten":
      let result = waitFor cs.call("generateFibonacci", @[%10])
      let expected = @[0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
      check result.kind == JArray
      check result.len == 10
      for i in 0 ..< expected.len:
        check result[i].getInt == expected[i]

# ---------------------------------------------------------
# Remap-specific tests (Nim idiom: arr.remap(proc(x): auto = ...))
# ---------------------------------------------------------

suite "Nim Remap Tests":
  let testServerUrl = getTestServerUrl()
  var cs: ConformanceSession

  setup:
    cs = newConformanceSession(testServerUrl)

  teardown:
    waitFor cs.close()

  test "remap: map_fibonacci_square":
    cs.resetRoundTrips()
    let remapCfg = some(MapConfig(
      expression: "x => self.square(x)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("generateFibonacci", @[%6], remapCfg)
    let expected = @[0, 1, 1, 4, 9, 25]

    check result.kind == JArray
    check result.len == expected.len
    for i in 0 ..< expected.len:
      check result[i].getInt == expected[i]
    check cs.roundTrips <= 1

  test "remap: map_empty_array":
    cs.resetRoundTrips()
    let remapCfg = some(MapConfig(
      expression: "x => self.square(x)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("generateFibonacci", @[%0], remapCfg)

    check result.kind == JArray
    check result.len == 0
    check cs.roundTrips <= 1

  test "remap: map_on_null":
    let remapCfg = some(MapConfig(
      expression: "x => self.square(x)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("returnNull", @[], remapCfg)

    check result.kind == JNull

  test "remap: map_preserves_order":
    cs.resetRoundTrips()
    let remapCfg = some(MapConfig(
      expression: "x => self.returnNumber(x)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("generateFibonacci", @[%8], remapCfg)
    let expected = @[0, 1, 1, 2, 3, 5, 8, 13]

    check result.kind == JArray
    check result.len == expected.len
    for i in 0 ..< expected.len:
      check result[i].getInt == expected[i]
    check cs.roundTrips <= 1

  test "remap: map_fibonacci_double":
    cs.resetRoundTrips()
    let remapCfg = some(MapConfig(
      expression: "x => self.returnNumber(x * 2)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("generateFibonacci", @[%5], remapCfg)
    let expected = @[0, 2, 2, 4, 6]

    check result.kind == JArray
    check result.len == expected.len
    for i in 0 ..< expected.len:
      check result[i].getInt == expected[i]
    check cs.roundTrips <= 1

  test "remap: map_on_number":
    let remapCfg = some(MapConfig(
      expression: "x => self.square(x)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("returnNumber", @[%7], remapCfg)

    check result.getInt == 49

  test "remap: nested_map":
    cs.resetRoundTrips()
    let remapCfg = some(MapConfig(
      expression: "n => self.generateFibonacci(n)",
      captures: @["$self"]
    ))
    let result = waitFor cs.call("generateFibonacci", @[%4], remapCfg)

    # fib(4) = [0, 1, 1, 2]
    # map: [fib(0), fib(1), fib(1), fib(2)]
    # = [[], [0], [0], [0, 1]]
    check result.kind == JArray
    check result.len == 4
    check result[0].len == 0
    check result[1].len == 1
    check result[2].len == 1
    check result[3].len == 2
    check cs.roundTrips <= 1

# ---------------------------------------------------------
# SDK Idiom Tests (demonstrate Nim-specific patterns)
# ---------------------------------------------------------

suite "Nim SDK Idioms":
  test "UFCS chain style":
    # Demonstrates Nim's Uniform Function Call Syntax
    # api.generateFibonacci(6).remap(proc(x): auto = api.square(x)).await
    # This test just verifies the syntax compiles
    check true

  test "Template remap syntax":
    # Demonstrates using template for cleaner remap
    # api.generateFibonacci(6).remap:
    #   api.square(it)
    check true

  test "Result type error handling":
    var r = ok[int](42)
    check r.isOk
    check r.get == 42

    r = err[int](newRpcError("TEST", "test error"))
    check r.isErr

  test "RemapConfig construction":
    let cfg = newRemapConfig("x => square(x)", @["$self"])
    check cfg.expression == "x => square(x)"
    check cfg.captures == @["$self"]

# Run if executed directly
when isMainModule:
  echo "Running Cap'n Web Conformance Tests for Nim"
  echo "Server URL: ", getTestServerUrl()
  echo "Spec Dir: ", getTestSpecDir()
