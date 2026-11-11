allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
subprojects {
    project.evaluationDependsOn(":app")
}

// Wave G (temporary): tosspayments_webview_flutter 1.0.6 pins compileSdk 31
// but depends on androidx.window 1.2.0 (needs 34+), failing AAR metadata
// checks on modern toolchains. Bump stale plugin modules to 34 until Toss
// ships a fixed SDK. Never lowers a module that already targets higher.
subprojects {
    // :app may already be evaluated (see evaluationDependsOn above) — it
    // already targets the Flutter SDK level, so only future modules patch.
    if (!project.state.executed) {
        project.afterEvaluate {
            val androidExt = project.extensions.findByName("android")
            try {
                val getCompileSdk = androidExt?.javaClass?.methods?.firstOrNull {
                    it.name == "getCompileSdk" && it.parameterCount == 0
                }
                val current = (getCompileSdk?.invoke(androidExt) as? Int) ?: 99
                if (current < 34) {
                    val setCompileSdk = androidExt?.javaClass?.methods?.firstOrNull {
                        it.name == "setCompileSdk" && it.parameterCount == 1
                    }
                    setCompileSdk?.invoke(androidExt, 34)
                }
            } catch (_: Exception) {
                // Non-Android modules (or future AGP shapes) are left alone.
            }
        }
    }
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
