ThisBuild / version := "0.1.0"
ThisBuild / scalaVersion := "3.3.1"
ThisBuild / organization := "do.{{name}}"

lazy val root = (project in file("."))
  .settings(
    name := "{{name}}-do",
    description := "{{description}}",

    libraryDependencies ++= Seq(
      // Core RPC dependency
      "do.rpc" %% "sdk" % "0.1.0",

      // HTTP client
      "com.softwaremill.sttp.client3" %% "core" % "3.9.2",
      "com.softwaremill.sttp.client3" %% "async-http-client-backend-cats" % "3.9.2",

      // JSON
      "io.circe" %% "circe-core" % "0.14.6",
      "io.circe" %% "circe-generic" % "0.14.6",
      "io.circe" %% "circe-parser" % "0.14.6",

      // Cats Effect
      "org.typelevel" %% "cats-effect" % "3.5.3",

      // Test dependencies
      "org.scalatest" %% "scalatest" % "3.2.17" % Test,
      "org.scalatestplus" %% "mockito-4-11" % "3.2.17.0" % Test
    ),

    // Publishing settings
    publishMavenStyle := true,
    licenses := Seq("MIT" -> url("https://opensource.org/licenses/MIT")),
    homepage := Some(url("https://{{name}}.do")),
    scmInfo := Some(
      ScmInfo(
        url("https://github.com/dot-do/{{name}}"),
        "scm:git:git://github.com/dot-do/{{name}}.git"
      )
    ),
    developers := List(
      Developer(
        id = "dotdo",
        name = "DotDo Team",
        email = "team@dotdo.dev",
        url = url("https://dotdo.dev")
      )
    )
  )
