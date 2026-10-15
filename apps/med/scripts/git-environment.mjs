/**
 * Removes every GIT_* variable from this process's environment.
 *
 * Git reads GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, GIT_COMMON_DIR, and the
 * other GIT_* variables before its working directory. `git bisect run` and Git
 * hooks set them for the checkout, so a `git init` in a scratch directory
 * would write to the checkout's repository. Call this before a script starts
 * Git or the Med host, which both inherit the environment.
 */
export function removeGitEnvironment() {
  for (const name of Object.keys(process.env))
    if (name.startsWith("GIT_")) delete process.env[name];
}
