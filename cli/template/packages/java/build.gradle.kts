plugins {
    java
    `java-library`
    `maven-publish`
}

group = "do.{{name}}"
version = "0.1.0"

// Maven artifact configuration
publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "do.{{name}}"
            artifactId = "sdk"
            from(components["java"])

            pom {
                name.set("{{Name}}.do SDK")
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

java {
    toolchain {
        languageVersion = JavaLanguageVersion.of(21)
    }
}

repositories {
    mavenCentral()
}

dependencies {
    // Core RPC dependency
    implementation("do.rpc:sdk:0.1.0")

    // HTTP client
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // JSON serialization
    implementation("com.google.code.gson:gson:2.10.1")

    // Test dependencies
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.assertj:assertj-core:3.25.3")
}

tasks.test {
    useJUnitPlatform()
    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = true
    }
}
