plugins {
    java
    `java-library`
    `maven-publish`
}

group = "do.capnweb"
version = "0.1.0"

// Maven artifact configuration
publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "do.capnweb"
            artifactId = "sdk"
            from(components["java"])
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
    // Core SDK dependencies
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.google.code.gson:gson:2.10.1")

    // Test dependencies
    testImplementation(platform("org.junit:junit-bom:5.10.2"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testImplementation("org.junit.jupiter:junit-jupiter-params")
    testImplementation("org.yaml:snakeyaml:2.2")
    testImplementation("org.assertj:assertj-core:3.25.3")
}

tasks.test {
    useJUnitPlatform()

    // Pass environment variables to tests
    environment("TEST_SERVER_URL", System.getenv("TEST_SERVER_URL") ?: "http://localhost:8787")
    environment("TEST_SPEC_DIR", System.getenv("TEST_SPEC_DIR") ?: "")

    testLogging {
        events("passed", "skipped", "failed")
        showStandardStreams = true
    }
}
