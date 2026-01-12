plugins {
    kotlin("jvm") version "1.9.22"
    kotlin("plugin.serialization") version "1.9.22"
    `java-library`
    `maven-publish`
}

group = "do.{{name}}"
version = "0.1.0"

kotlin {
    jvmToolchain(21)
}

repositories {
    mavenCentral()
}

dependencies {
    // Core RPC dependency
    implementation("do.rpc:sdk:0.1.0")

    // Kotlin coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.8.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.6.2")

    // HTTP client for RPC transport
    implementation("io.ktor:ktor-client-core:2.3.7")
    implementation("io.ktor:ktor-client-cio:2.3.7")
    implementation("io.ktor:ktor-client-websockets:2.3.7")
    implementation("io.ktor:ktor-client-content-negotiation:2.3.7")
    implementation("io.ktor:ktor-serialization-kotlinx-json:2.3.7")

    // Test dependencies
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.0")
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
}

tasks.test {
    useJUnitPlatform()
}

publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "do.{{name}}"
            artifactId = "sdk"
            from(components["java"])

            pom {
                name.set("{{Name}}.do SDK for Kotlin")
                description.set("{{description}}")
                url.set("https://{{name}}.do")

                licenses {
                    license {
                        name.set("MIT License")
                        url.set("https://opensource.org/licenses/MIT")
                    }
                }

                developers {
                    developer {
                        id.set("dotdo")
                        name.set("DotDo Team")
                        email.set("team@dotdo.dev")
                    }
                }

                scm {
                    connection.set("scm:git:git://github.com/dot-do/{{name}}.git")
                    developerConnection.set("scm:git:ssh://github.com/dot-do/{{name}}.git")
                    url.set("https://github.com/dot-do/{{name}}")
                }
            }
        }
    }
}
