ThisBuild / scalaVersion := "3.3.3"
ThisBuild / organization := "do.rpc"
ThisBuild / version := "0.4.0"

lazy val root = (project in file("."))
  .settings(
    name := "sdk",

    // Core dependencies
    libraryDependencies ++= Seq(
      // Effect system - Cats Effect 3
      "org.typelevel" %% "cats-effect" % "3.5.4",
      "org.typelevel" %% "cats-core" % "2.10.0",

      // JSON handling
      "io.circe" %% "circe-core" % "0.14.7",
      "io.circe" %% "circe-generic" % "0.14.7",
      "io.circe" %% "circe-parser" % "0.14.7",

      // HTTP client - sttp with Cats Effect backend
      "com.softwaremill.sttp.client3" %% "core" % "3.9.5",
      "com.softwaremill.sttp.client3" %% "cats" % "3.9.5",
      "com.softwaremill.sttp.client3" %% "circe" % "3.9.5",

      // Testing
      "org.scalatest" %% "scalatest" % "3.2.18" % Test,
      "org.typelevel" %% "cats-effect-testing-scalatest" % "1.5.0" % Test,
    ),

    // Scala 3 settings
    scalacOptions ++= Seq(
      "-deprecation",
      "-feature",
      "-unchecked",
      "-language:implicitConversions",
      "-language:higherKinds",
    ),
  )
