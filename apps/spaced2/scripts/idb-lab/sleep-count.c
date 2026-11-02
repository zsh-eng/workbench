// Counts nanosleep calls by requested length, in each process it is loaded
// into, and writes a line a second to $IDB_LAB_SLEEP_LOG.<pid>:
//   seconds, 1 ms sleeps so far, ms actually slept in them, other sleeps.
// clang -dynamiclib -O2 -o sleep-count.dylib sleep-count.c
// Then launch the browser with DYLD_INSERT_LIBRARIES=sleep-count.dylib.
#include <dlfcn.h>
#include <pthread.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <unistd.h>

static atomic_ulong one_ms_calls, one_ms_ns, other_calls;
static atomic_flag started = ATOMIC_FLAG_INIT;

static unsigned long now_ns(void) {
  struct timespec t;
  clock_gettime(CLOCK_MONOTONIC, &t);
  return (unsigned long)t.tv_sec * 1000000000UL + t.tv_nsec;
}

static void *writer(void *unused) {
  (void)unused;
  const char *base = getenv("IDB_LAB_SLEEP_LOG");
  if (!base) return NULL;
  char path[1024];
  snprintf(path, sizeof path, "%s.%d", base, getpid());
  unsigned long start = now_ns();
  for (;;) {
    sleep(1);
    unsigned long calls = atomic_load(&one_ms_calls);
    if (calls == 0) continue;
    FILE *file = fopen(path, "a");
    if (!file) continue;
    fprintf(file, "%.1f %lu %.1f %lu\n", (now_ns() - start) / 1e9, calls,
            atomic_load(&one_ms_ns) / 1e6, atomic_load(&other_calls));
    fclose(file);
  }
}

static int counted_nanosleep(const struct timespec *wanted,
                             struct timespec *left) {
  if (!atomic_flag_test_and_set(&started)) {
    pthread_t thread;
    pthread_create(&thread, NULL, writer, NULL);
    pthread_detach(thread);
  }
  unsigned long before = now_ns();
  int result = nanosleep(wanted, left);
  unsigned long slept = now_ns() - before;
  if (wanted->tv_sec == 0 && wanted->tv_nsec == 1000000) {
    atomic_fetch_add(&one_ms_calls, 1);
    atomic_fetch_add(&one_ms_ns, slept);
  } else {
    atomic_fetch_add(&other_calls, 1);
  }
  return result;
}

__attribute__((used, section("__DATA,__interpose"))) static struct {
  const void *replacement;
  const void *original;
} interposers[] = {{(const void *)counted_nanosleep, (const void *)nanosleep}};
