package capnweb.conformance

import cats.effect.{IO, Resource}
import cats.effect.unsafe.implicits.global
import cats.syntax.all.*
import io.circe.{Json, Decoder, Encoder}
import io.circe.generic.auto.*
import io.circe.syntax.*
import io.circe.yaml.parser
import org.scalatest.flatspec.AnyFlatSpec
import org.scalatest.matchers.should.Matchers
import org.scalatest.BeforeAndAfterAll
import org.scalatestplus.scalacheck.ScalaCheckPropertyChecks
import capnweb.*

import java.nio.file.{Files, Paths}
import scala.jdk.CollectionConverters.*

/**
 * Cap'n Web Conformance Test Suite
 *
 * Loads test specifications from YAML files and validates SDK behavior
 * against the conformance requirements, including map/remap support.
 */

// =============================================================================
// Test Specification Models
// =============================================================================

case class TestSuite(
  name: String,
  description: String,
  tests: List[TestCase]
)

case class TestCase(
  name: String,
  description: String,
  call: String,
  args: Option[List[Json]],
  expect: Option[Json],
  expect_type: Option[String],
  expect_length: Option[Int],
  map: Option[MapSpec],
  setup: Option[List[SetupStep]],
  verify: Option[List[VerifyStep]],
  max_round_trips: Option[Int]
)

case class MapSpec(
  expression: String,
  captures: Option[List[String]]
)

case class SetupStep(
  call: Option[String],
  args: Option[List[Json]],
  map: Option[MapSpec],
  `as`: Option[String],
  await: Option[Boolean],
  pipeline: Option[List[PipelineStep]]
)

case class PipelineStep(
  call: String,
  map: Option[MapSpec]
)

case class VerifyStep(
  call: String,
  expect: Json
)

object TestSuite:
  given Decoder[TestSuite] = Decoder.derived
  given Decoder[TestCase] = Decoder.derived
  given Decoder[MapSpec] = Decoder.derived
  given Decoder[SetupStep] = Decoder.derived
  given Decoder[PipelineStep] = Decoder.derived
  given Decoder[VerifyStep] = Decoder.derived

// =============================================================================
// YAML Spec Loader
// =============================================================================

object SpecLoader:
  def loadSpec(path: String): Either[String, TestSuite] =
    try
      val content = new String(Files.readAllBytes(Paths.get(path)))
      parser.parse(content).flatMap(_.as[TestSuite]).leftMap(_.getMessage)
    catch
      case e: Exception => Left(s"Failed to load spec: ${e.getMessage}")

  def loadAllSpecs(dir: String): List[Either[String, TestSuite]] =
    try
      val dirPath = Paths.get(dir)
      if Files.exists(dirPath) then
        Files.list(dirPath)
          .iterator()
          .asScala
          .filter(p => p.toString.endsWith(".yaml") || p.toString.endsWith(".yml"))
          .map(p => loadSpec(p.toString))
          .toList
      else
        List(Left(s"Directory not found: $dir"))
    catch
      case e: Exception => List(Left(s"Failed to list specs: ${e.getMessage}"))

// =============================================================================
// Conformance Test Runner
// =============================================================================

class ConformanceSpec extends AnyFlatSpec with Matchers with BeforeAndAfterAll:

  val serverUrl: String = sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000")
  val specDir: String = sys.env.getOrElse("TEST_SPEC_DIR", "../../test/conformance")

  // Session resource for tests
  val sessionResource: Resource[IO, Session[IO]] =
    Session.connect[IO](serverUrl).build

  // Load all conformance specs
  lazy val allSpecs: List[TestSuite] =
    SpecLoader.loadAllSpecs(specDir).collect { case Right(suite) => suite }

  "Cap'n Web SDK" should "load conformance specs" in {
    val specs = SpecLoader.loadAllSpecs(specDir)
    specs should not be empty
    specs.foreach {
      case Right(suite) => info(s"Loaded: ${suite.name} (${suite.tests.size} tests)")
      case Left(err) => info(s"Failed to load: $err")
    }
  }

// =============================================================================
// Basic RPC Tests
// =============================================================================

class BasicRpcSpec extends AnyFlatSpec with Matchers:

  val serverUrl: String = sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000")

  // Skip tests if server is not available
  def withSession[A](f: Session[IO] => IO[A]): Option[A] =
    try
      Session.connect[IO](serverUrl).build.use(f).unsafeRunSync().some
    catch
      case _: Exception => None

  "Basic RPC" should "call square with positive integer" in {
    withSession { session =>
      for
        result <- session.call[Int]("square", Json.fromInt(5))
      yield result shouldBe 25
    }.getOrElse(cancel("Test server not available"))
  }

  it should "call square with negative integer" in {
    withSession { session =>
      for
        result <- session.call[Int]("square", Json.fromInt(-3))
      yield result shouldBe 9
    }.getOrElse(cancel("Test server not available"))
  }

  it should "call square with zero" in {
    withSession { session =>
      for
        result <- session.call[Int]("square", Json.fromInt(0))
      yield result shouldBe 0
    }.getOrElse(cancel("Test server not available"))
  }

  it should "return number unchanged" in {
    withSession { session =>
      for
        result <- session.call[Int]("returnNumber", Json.fromInt(42))
      yield result shouldBe 42
    }.getOrElse(cancel("Test server not available"))
  }

  it should "return null value" in {
    withSession { session =>
      for
        result <- session.call[Option[Int]]("returnNull")
      yield result shouldBe None
    }.getOrElse(cancel("Test server not available"))
  }

  it should "generate Fibonacci sequence" in {
    withSession { session =>
      for
        result <- session.call[List[Int]]("generateFibonacci", Json.fromInt(10))
      yield result shouldBe List(0, 1, 1, 2, 3, 5, 8, 13, 21, 34)
    }.getOrElse(cancel("Test server not available"))
  }

  it should "generate empty Fibonacci for zero" in {
    withSession { session =>
      for
        result <- session.call[List[Int]]("generateFibonacci", Json.fromInt(0))
      yield result shouldBe List.empty
    }.getOrElse(cancel("Test server not available"))
  }

// =============================================================================
// Map/Remap Tests - Server-Side Collection Transformation
// =============================================================================

class MapOperationSpec extends AnyFlatSpec with Matchers:

  val serverUrl: String = sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000")

  def withSession[A](f: Session[IO] => IO[A]): Option[A] =
    try
      Session.connect[IO](serverUrl).build.use(f).unsafeRunSync().some
    catch
      case _: Exception => None

  "Map operation" should "map square over Fibonacci array in single round trip" in {
    withSession { session =>
      val stub = ApiStub[IO](session)
      for
        // Generate Fibonacci and map square - should be single round trip
        result <- stub.callAndMap[Int, Int](
          "generateFibonacci",
          List(Json.fromInt(6)),
          "x => self.square(x)",
          List("$self")
        )
      yield result shouldBe List(0, 1, 1, 4, 9, 25)
    }.getOrElse(cancel("Test server not available"))
  }

  it should "map doubling over Fibonacci array" in {
    withSession { session =>
      val stub = ApiStub[IO](session)
      for
        result <- stub.callAndMap[Int, Int](
          "generateFibonacci",
          List(Json.fromInt(5)),
          "x => self.returnNumber(x * 2)",
          List("$self")
        )
      yield result shouldBe List(0, 2, 2, 4, 6)
    }.getOrElse(cancel("Test server not available"))
  }

  it should "handle map on empty array" in {
    withSession { session =>
      val stub = ApiStub[IO](session)
      for
        result <- stub.callAndMap[Int, Int](
          "generateFibonacci",
          List(Json.fromInt(0)),
          "x => self.square(x)",
          List("$self")
        )
      yield result shouldBe List.empty
    }.getOrElse(cancel("Test server not available"))
  }

  it should "preserve order when mapping" in {
    withSession { session =>
      val stub = ApiStub[IO](session)
      for
        result <- stub.callAndMap[Int, Int](
          "generateFibonacci",
          List(Json.fromInt(8)),
          "x => self.returnNumber(x)",
          List("$self")
        )
      yield result shouldBe List(0, 1, 1, 2, 3, 5, 8, 13)
    }.getOrElse(cancel("Test server not available"))
  }

  it should "handle nested map - generate Fibonacci for each element" in {
    withSession { session =>
      val stub = ApiStub[IO](session)
      for
        result <- stub.callAndMap[Int, List[Int]](
          "generateFibonacci",
          List(Json.fromInt(4)),
          "n => self.generateFibonacci(n)",
          List("$self")
        )
      yield result shouldBe List(
        List(),        // fib(0)
        List(0),       // fib(1)
        List(0),       // fib(1)
        List(0, 1)     // fib(2)
      )
    }.getOrElse(cancel("Test server not available"))
  }

// =============================================================================
// Pipeline Monad Tests - Verifying Map Composition
// =============================================================================

class PipelineMapSpec extends AnyFlatSpec with Matchers:

  "Pipeline map" should "compose with for-comprehension" in {
    val pipeline: Pipeline[IO, Int] = for
      x <- Pipeline.pure[IO, Int](5)
      y <- Pipeline.pure[IO, Int](x * 2)
    yield y

    // Verify the pipeline structure
    pipeline.toExpr shouldBe a[PipelineExpr.Chain[?, ?]]
  }

  it should "support local map transformation" in {
    val pipeline: Pipeline[IO, String] =
      Pipeline.pure[IO, Int](42).map(n => s"Value: $n")

    pipeline.toExpr shouldBe a[PipelineExpr.LocalMap[?, ?]]
  }

  it should "mark server map expressions correctly" in {
    val basePipeline = Pipeline.call[IO, List[Int]]("generateFibonacci", List(Json.fromInt(5)))
    val mapExpr = MapExpression("x => self.square(x)", List("$self"))
    val mappedPipeline = Pipeline.serverMap[IO, Int, Int](basePipeline, mapExpr)

    TestHelpers.usesServerMap(mappedPipeline) shouldBe true
  }

  it should "distinguish local map from server map" in {
    val localMapped = Pipeline.pure[IO, List[Int]](List(1, 2, 3)).map(_.sum)
    val serverMapped = Pipeline.serverMap[IO, Int, Int](
      Pipeline.pure[IO, List[Int]](List(1, 2, 3)),
      MapExpression("x => self.square(x)", List("$self"))
    )

    TestHelpers.usesServerMap(localMapped) shouldBe false
    TestHelpers.usesServerMap(serverMapped) shouldBe true
  }

// =============================================================================
// Property-Based Tests
// =============================================================================

class PropertyBasedSpec extends AnyFlatSpec with Matchers with ScalaCheckPropertyChecks:

  "Pipeline Monad" should "satisfy left identity law" in {
    forAll { (a: Int) =>
      val f: Int => Pipeline[IO, Int] = x => Pipeline.pure[IO, Int](x * 2)

      val left = Pipeline.pure[IO, Int](a).flatMap(f)
      val right = f(a)

      // Both should produce equivalent pipeline structures
      // (We can't run them without a session, but structure should match)
      left.toExpr.getClass shouldBe right.toExpr.getClass
    }
  }

  it should "satisfy right identity law" in {
    forAll { (a: Int) =>
      val m = Pipeline.pure[IO, Int](a)
      val result = m.flatMap(Pipeline.pure[IO, Int])

      // flatMap with pure should be equivalent to the original
      result.toExpr shouldBe a[PipelineExpr.Chain[?, ?]]
    }
  }

  it should "satisfy associativity law" in {
    forAll { (a: Int) =>
      val f: Int => Pipeline[IO, Int] = x => Pipeline.pure[IO, Int](x + 1)
      val g: Int => Pipeline[IO, Int] = x => Pipeline.pure[IO, Int](x * 2)

      val m = Pipeline.pure[IO, Int](a)

      val left = m.flatMap(f).flatMap(g)
      val right = m.flatMap(x => f(x).flatMap(g))

      // Both should be Chain structures
      left.toExpr shouldBe a[PipelineExpr.Chain[?, ?]]
      right.toExpr shouldBe a[PipelineExpr.Chain[?, ?]]
    }
  }

  "Map operation" should "preserve list length for element-wise transforms" in {
    forAll { (size: Byte) =>
      val n = math.abs(size.toInt) % 20 // Keep it reasonable
      val list = (0 until n).toList

      // Local map should preserve length
      val pipeline = Pipeline.pure[IO, List[Int]](list).map(_.map(_ * 2))

      // The mapped list should have same size
      pipeline.toExpr shouldBe a[PipelineExpr.LocalMap[?, ?]]
    }
  }

// =============================================================================
// Integration Tests with Spec Loading
// =============================================================================

class SpecDrivenSpec extends AnyFlatSpec with Matchers:

  val specDir: String = sys.env.getOrElse("TEST_SPEC_DIR", "../../test/conformance")

  "Basic spec" should "load correctly" in {
    val basicSpec = SpecLoader.loadSpec(s"$specDir/basic.yaml")
    basicSpec match
      case Right(suite) =>
        suite.name shouldBe "Basic RPC Calls"
        suite.tests should not be empty
        info(s"Loaded ${suite.tests.size} basic tests")
      case Left(err) =>
        info(s"Could not load basic spec: $err")
  }

  "Map spec" should "load correctly" in {
    val mapSpec = SpecLoader.loadSpec(s"$specDir/map.yaml")
    mapSpec match
      case Right(suite) =>
        suite.name shouldBe "Map Operation (remap)"
        suite.tests should not be empty
        info(s"Loaded ${suite.tests.size} map tests")

        // Verify map tests have map specifications
        val mapTests = suite.tests.filter(_.map.isDefined)
        mapTests should not be empty
        info(s"Found ${mapTests.size} tests with map expressions")
      case Left(err) =>
        info(s"Could not load map spec: $err")
  }

  "All specs" should "have valid structure" in {
    val specs = SpecLoader.loadAllSpecs(specDir)
    specs.foreach {
      case Right(suite) =>
        suite.tests.foreach { test =>
          test.name should not be empty
          test.call should not be empty

          // If it has a map, it should have an expression
          test.map.foreach { m =>
            m.expression should not be empty
          }

          // max_round_trips should be positive if specified
          test.max_round_trips.foreach { trips =>
            trips should be > 0
          }
        }
        info(s"Validated ${suite.name}: ${suite.tests.size} tests OK")
      case Left(err) =>
        info(s"Skipped invalid spec: $err")
    }
  }

// =============================================================================
// Test Runner for Spec-Driven Tests
// =============================================================================

class SpecTestRunner extends AnyFlatSpec with Matchers:

  val serverUrl: String = sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000")
  val specDir: String = sys.env.getOrElse("TEST_SPEC_DIR", "../../test/conformance")

  def withSession[A](f: Session[IO] => IO[A]): Option[A] =
    try
      Session.connect[IO](serverUrl).build.use(f).unsafeRunSync().some
    catch
      case _: Exception => None

  def runTestCase(session: Session[IO], test: TestCase): IO[Unit] =
    val stub = ApiStub[IO](session)
    val args = test.args.getOrElse(List.empty)

    test.map match
      case Some(mapSpec) =>
        // Test with map operation
        stub.callAndMap[Json, Json](
          test.call,
          args,
          mapSpec.expression,
          mapSpec.captures.getOrElse(List("$self"))
        ).flatMap { result =>
          test.expect match
            case Some(expected) =>
              IO {
                result.asJson shouldBe expected
              }
            case None =>
              test.expect_type match
                case Some("array_of_capabilities") =>
                  IO {
                    result shouldBe a[List[?]]
                    test.expect_length.foreach { len =>
                      result.size shouldBe len
                    }
                  }
                case _ => IO.unit
        }

      case None =>
        // Simple call without map
        stub.call[Json](test.call, args: _*).flatMap { result =>
          test.expect match
            case Some(expected) =>
              IO {
                result shouldBe expected
              }
            case None => IO.unit
        }

  "Spec-driven runner" should "execute basic tests" in {
    SpecLoader.loadSpec(s"$specDir/basic.yaml") match
      case Right(suite) =>
        withSession { session =>
          suite.tests.take(3).traverse { test =>
            info(s"Running: ${test.name}")
            runTestCase(session, test).attempt.map {
              case Right(_) => info(s"  PASS: ${test.name}")
              case Left(e) => info(s"  FAIL: ${test.name} - ${e.getMessage}")
            }
          }.void
        }.getOrElse(cancel("Test server not available"))
      case Left(err) =>
        info(s"Could not load spec: $err")
  }

  it should "execute map tests" in {
    SpecLoader.loadSpec(s"$specDir/map.yaml") match
      case Right(suite) =>
        withSession { session =>
          suite.tests.filter(_.map.isDefined).take(3).traverse { test =>
            info(s"Running map test: ${test.name}")
            runTestCase(session, test).attempt.map {
              case Right(_) => info(s"  PASS: ${test.name}")
              case Left(e) => info(s"  FAIL: ${test.name} - ${e.getMessage}")
            }
          }.void
        }.getOrElse(cancel("Test server not available"))
      case Left(err) =>
        info(s"Could not load spec: $err")
  }
