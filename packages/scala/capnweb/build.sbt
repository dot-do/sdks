ThisBuild / scalaVersion := "3.3.3"
ThisBuild / organization := "com.dotdo"
ThisBuild / version := "0.1.0-SNAPSHOT"

lazy val root = (project in file("."))
  .settings(
    name := "capnweb",

    // Core dependencies
    libraryDependencies ++= Seq(
      // Effect system - Cats Effect 3
      "org.typelevel" %% "cats-effect" % "3.5.4",
      "org.typelevel" %% "cats-core" % "2.10.0",

      // JSON handling
      "io.circe" %% "circe-core" % "0.14.7",
      "io.circe" %% "circe-generic" % "0.14.7",
      "io.circe" %% "circe-parser" % "0.14.7",
      "io.circe" %% "circe-yaml" % "0.15.1",

      // HTTP client - sttp with Cats Effect backend
      "com.softwaremill.sttp.client3" %% "core" % "3.9.5",
      "com.softwaremill.sttp.client3" %% "cats" % "3.9.5",
      "com.softwaremill.sttp.client3" %% "circe" % "3.9.5",

      // Testing
      "org.scalatest" %% "scalatest" % "3.2.18" % Test,
      "org.scalatest" %% "scalatest-flatspec" % "3.2.18" % Test,
      "org.typelevel" %% "cats-effect-testing-scalatest" % "1.5.0" % Test,
      "org.scalatestplus" %% "scalacheck-1-17" % "3.2.18.0" % Test,
      "org.scalacheck" %% "scalacheck" % "1.17.0" % Test,
    ),

    // Scala 3 settings
    scalacOptions ++= Seq(
      "-deprecation",
      "-feature",
      "-unchecked",
      "-Xfatal-warnings",
      "-language:implicitConversions",
      "-language:higherKinds",
    ),

    // Test settings
    Test / fork := true,
    Test / parallelExecution := false,
    Test / envVars ++= Map(
      "TEST_SERVER_URL" -> sys.env.getOrElse("TEST_SERVER_URL", "http://localhost:3000"),
      "TEST_SPEC_DIR" -> sys.env.getOrElse("TEST_SPEC_DIR", "../../test/conformance"),
    ),
  )

// Assembly settings for fat JAR
assembly / assemblyMergeStrategy := {
  case PathList("META-INF", xs @ _*) => MergeStrategy.discard
  case "reference.conf" => MergeStrategy.concat
  case x => MergeStrategy.first
}
