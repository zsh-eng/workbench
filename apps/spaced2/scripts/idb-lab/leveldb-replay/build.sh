#!/bin/sh
# usage: build.sh <leveldb source dir> <out binary>. LevelDB 1.20 and Homebrew's snappy.
src=$1; out=$2
here=$(dirname "$0")
files=$(ls "$src"/db/*.cc "$src"/table/*.cc "$src"/util/*.cc "$src"/port/port_posix.cc "$src"/port/port_posix_sse.cc "$src"/helpers/memenv/memenv.cc | grep -v -E '_test\.cc|/testharness|/testutil|db_bench|leveldbutil|/util/env_posix_test|/c\.cc')
clang++ -std=c++17 -O2 -w -DOS_MACOSX -DLEVELDB_PLATFORM_POSIX -DLEVELDB_ATOMIC_PRESENT -DSNAPPY -D_LIBCPP_ENABLE_CXX17_REMOVED_FEATURES \
  -I"$src" -I"$src/include" -I/opt/homebrew/include -L/opt/homebrew/lib \
  $files "$here/replay.cc" -lsnappy -o "$out"
