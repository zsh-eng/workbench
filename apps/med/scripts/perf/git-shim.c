// The budget's git shim (scripts/perf/host.mjs compiles it). It runs the real
// Git, REAL_GIT, then appends one line to $MED_GIT_LOG:
//   start_ns end_ns user_us sys_us status cwd <TAB> args
// The times are wall-clock nanoseconds; user and system time are Git's own.
#include <fcntl.h>
#include <spawn.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
extern char **environ;
#ifndef REAL_GIT
#define REAL_GIT "/usr/bin/git"
#endif
static long long now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_REALTIME, &t);
  return (long long)t.tv_sec * 1000000000LL + t.tv_nsec;
}
int main(int argc, char **argv) {
  long long start = now_ns();
  argv[0] = REAL_GIT;
  pid_t pid;
  if (posix_spawn(&pid, REAL_GIT, NULL, NULL, argv, environ) != 0) {
    perror("git shim");
    return 127;
  }
  int status = 0;
  struct rusage usage;
  while (wait4(pid, &status, 0, &usage) < 0) {
  }
  long long end = now_ns();
  const char *log = getenv("MED_GIT_LOG");
  if (log && *log) {
    char line[16384];
    size_t n = 0;
    char cwd[4096];
    if (!getcwd(cwd, sizeof cwd)) strcpy(cwd, "?");
    n += snprintf(line + n, sizeof line - n, "%lld %lld %ld %ld %d %s\t", start, end,
                  (long)(usage.ru_utime.tv_sec * 1000000 + usage.ru_utime.tv_usec),
                  (long)(usage.ru_stime.tv_sec * 1000000 + usage.ru_stime.tv_usec),
                  WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status), cwd);
    for (int i = 1; i < argc && n < sizeof line - 2; i++) {
      for (const char *c = argv[i]; *c && n < sizeof line - 4; c++) {
        if (*c == '\n' || *c == '\t' || *c == '\\') {
          line[n++] = '\\';
          line[n++] = *c == '\n' ? 'n' : *c == '\t' ? 't' : '\\';
        } else
          line[n++] = *c;
      }
      if (i + 1 < argc) line[n++] = ' ';
    }
    line[n++] = '\n';
    int fd = open(log, O_WRONLY | O_APPEND | O_CREAT, 0600);
    if (fd >= 0) {
      write(fd, line, n);
      close(fd);
    }
  }
  return WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
}
