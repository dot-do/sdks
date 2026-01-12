plugins {
    java
    `java-library`
    `maven-publish`
}

group = "com.dotdo"
version = "0.1.0"

// Maven artifact configuration
publishing {
    publications {
        create<MavenPublication>("maven") {
            groupId = "com.dotdo"
            artifactId = "core"
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
    // Internal dependencies
    api(project(":rpc"))
    api(project(":capnweb"))

    // Core SDK dependencies
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
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
