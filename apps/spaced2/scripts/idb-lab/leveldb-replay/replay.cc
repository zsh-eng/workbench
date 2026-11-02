// Replays the LevelDB writes of an IndexedDB restore, as Chromium 147's
// BackingStore and LevelDBScopes make them (content/browser/indexed_db,
// components/services/storage/indexed_db/scopes), with synthetic rows:
// the key layout, the two flushes of each put, the undo log, and the cleanup
// of each transaction on another thread. LevelDB's log says what it did,
// which an off-the-record store does not show. See ../run.ts.
//
// Build: see build.sh. Run: replay rows.tsv [--flag value...]
#include <unistd.h>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstdio>
#include <cstring>
#include <deque>
#include <fstream>
#include <iostream>
#include <map>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#include "helpers/memenv/memenv.h"
#include "leveldb/cache.h"
#include "leveldb/db.h"
#include "leveldb/env.h"
#include "leveldb/filter_policy.h"
#include "leveldb/write_batch.h"

using std::string;
using Clock = std::chrono::steady_clock;

static std::atomic<long> sleeps{0};
static std::atomic<long> slept_us{0};

// Counts LevelDB's 1 ms write delays.
class CountingEnv : public leveldb::EnvWrapper {
 public:
  explicit CountingEnv(leveldb::Env* base) : EnvWrapper(base) {}
  void SleepForMicroseconds(int micros) override {
    auto start = Clock::now();
    target()->SleepForMicroseconds(micros);
    sleeps++;
    slept_us += std::chrono::duration_cast<std::chrono::microseconds>(
                    Clock::now() - start)
                    .count();
  }
};

class FileLogger : public leveldb::Logger {
 public:
  explicit FileLogger(const string& path)
      : file_(fopen(path.c_str(), "w")), start_(Clock::now()) {}
  void Logv(const char* format, va_list ap) override {
    if (!file_) return;
    double t =
        std::chrono::duration<double>(Clock::now() - start_).count();
    fprintf(file_, "%.3f ", t);
    vfprintf(file_, format, ap);
    fputc('\n', file_);
    fflush(file_);
  }

 private:
  FILE* file_;
  Clock::time_point start_;
};

struct Row {
  int store;
  string type;
  double timestamp;
  string id;
  string value;
};

static string Prefix(int store, int index) {
  string out(4, '\0');
  out[1] = 1;
  out[2] = static_cast<char>(store);
  out[3] = static_cast<char>(index);
  return out;
}

static void VarInt(string* out, uint64_t value) {
  do {
    unsigned char byte = value & 0x7f;
    value >>= 7;
    if (value) byte |= 0x80;
    out->push_back(byte);
  } while (value);
}

// An IDB string key: a type byte, the length, then UTF-16.
static string StringKey(const string& text) {
  string out(1, '\x01');
  VarInt(&out, text.size());
  for (char c : text) {
    out.push_back('\0');
    out.push_back(c);
  }
  return out;
}

static string NumberKey(double value) {
  string out(1, '\x03');
  uint64_t bits;
  memcpy(&bits, &value, 8);
  for (int i = 7; i >= 0; i--) out.push_back((bits >> (8 * i)) & 0xff);
  return out;
}

static const string kScopes("\0\0\0\0\x32", 5);

static string BigEndian(uint64_t value) {
  string out;
  for (int i = 7; i >= 0; i--) out.push_back((value >> (8 * i)) & 0xff);
  return out;
}

struct Options {
  string env = "mem";
  string dir = "/replay";
  string log;
  size_t write_buffer = 64 << 10;
  size_t batch = 500;
  long gap_at = -1;
  long gap_every = 0;
  int gap_store = 4;
  int idle_ms = 0;
  int think_us = 60;
  int indexes = 2;
  bool priority = true;
  bool outbox = true;
  bool stats = false;
  long sample_every = 5000;
};

class Replay {
 public:
  Replay(leveldb::DB* db, const Options& options)
      : db_(db), options_(options), cleaner_([this] { CleanLoop(); }) {
    for (int store = 0; store < 8; store++) version_[store] = 1;
  }
  ~Replay() {
    {
      std::lock_guard<std::mutex> lock(mutex_);
      stop_ = true;
    }
    wake_.notify_all();
    cleaner_.join();
  }

  void Lookup(const string& key) {
    string value;
    db_->Get(leveldb::ReadOptions(), key, &value);
  }

  void Begin() {
    scope_++;
    undo_ = ~0ull >> 1;
    undo_mode_ = false;
  }

  void Flush() {
    if (pending_.empty()) return;
    leveldb::WriteBatch batch;
    if (!undo_mode_) {
      undo_mode_ = true;
      batch.Put(Meta(), "locks-of-this-scope-and-its-object-stores");
    }
    for (auto& [key, value] : pending_) {
      string old;
      leveldb::Status status = db_->Get(leveldb::ReadOptions(), key, &old);
      string task = status.ok() ? "p" + key + old : "d" + key;
      batch.Put(Undo(undo_--), task);
      batch.Put(key, value);
    }
    pending_.clear();
    db_->Write(leveldb::WriteOptions(), &batch);
  }

  void Put(const Row& row, const string& key) {
    int store = row.store;
    string last = string("\0\x01\0\0\x32", 5);
    last.push_back(static_cast<char>(store));
    last.push_back('\x01');
    Flush();  // GetNewVersionNumber reads through the transaction.
    string value;
    db_->Get(leveldb::ReadOptions(), last, &value);
    uint64_t version = ++version_[store];
    string encoded;
    VarInt(&encoded, version);
    pending_.emplace_back(last, encoded);
    pending_.emplace_back(Prefix(store, 1) + key, encoded + row.value);
    Flush();  // PutExternalObjectsIfNeeded reads the blob entry.
    db_->Get(leveldb::ReadOptions(), Prefix(store, 3) + key, &value);
    pending_.emplace_back(Prefix(store, 2) + key, encoded);
    string entry;
    VarInt(&entry, version);
    entry += key;
    if (options_.indexes > 0) {
      string index = Prefix(store, 30) + StringKey(row.type);
      VarInt(&index, 0);
      pending_.emplace_back(index + key, entry);
    }
    if (options_.indexes > 1) {
      string index = Prefix(store, 31) + NumberKey(row.timestamp);
      VarInt(&index, 0);
      pending_.emplace_back(index + key, entry);
    }
  }

  void Commit() {
    if (undo_mode_) pending_.emplace_back(Meta(), "");
    Flush();
    std::lock_guard<std::mutex> lock(mutex_);
    work_.push_back(scope_);
    wake_.notify_one();
  }

  void Drain() {
    std::unique_lock<std::mutex> lock(mutex_);
    done_.wait(lock, [this] { return work_.empty() && !cleaning_; });
  }

 private:
  string Meta(uint64_t scope = 0) const {
    return kScopes + '\x00' + BigEndian(scope ? scope : scope_);
  }
  string Undo(uint64_t sequence) const {
    return kScopes + '\x01' + BigEndian(scope_) + BigEndian(sequence);
  }

  // CleanupScopeTask: delete the undo log, then the metadata.
  void CleanLoop() {
    for (;;) {
      uint64_t scope;
      {
        std::unique_lock<std::mutex> lock(mutex_);
        wake_.wait(lock, [this] { return stop_ || !work_.empty(); });
        if (work_.empty()) return;
        scope = work_.front();
        work_.pop_front();
        cleaning_ = true;
      }
      leveldb::ReadOptions read;
      read.fill_cache = false;
      std::unique_ptr<leveldb::Iterator> it(db_->NewIterator(read));
      string prefix = kScopes + '\x01' + BigEndian(scope);
      leveldb::WriteBatch batch;
      size_t bytes = 0;
      for (it->Seek(prefix); it->Valid() && it->key().starts_with(prefix);
           it->Next()) {
        batch.Delete(it->key());
        bytes += it->key().size() + 12;
        if (bytes > (1 << 20)) {
          db_->Write(leveldb::WriteOptions(), &batch);
          batch.Clear();
          bytes = 0;
        }
      }
      it.reset();
      batch.Delete(Meta(scope));
      db_->Write(leveldb::WriteOptions(), &batch);
      {
        std::lock_guard<std::mutex> lock(mutex_);
        cleaning_ = false;
      }
      done_.notify_all();
    }
  }

  leveldb::DB* db_;
  Options options_;
  uint64_t scope_ = 0, undo_ = 0;
  bool undo_mode_ = false;
  uint64_t version_[8];
  std::vector<std::pair<string, string>> pending_;
  std::mutex mutex_;
  std::condition_variable wake_, done_;
  std::deque<uint64_t> work_;
  bool stop_ = false, cleaning_ = false;
  std::thread cleaner_;
};

static void Spin(int micros) {
  auto until = Clock::now() + std::chrono::microseconds(micros);
  while (Clock::now() < until) {
  }
}

int main(int argc, char** argv) {
  if (argc < 2) {
    fprintf(stderr, "usage: replay rows.tsv [--flag value]\n");
    return 64;
  }
  Options o;
  for (int i = 2; i + 1 < argc; i += 2) {
    string flag = argv[i], value = argv[i + 1];
    if (flag == "--env") o.env = value;
    else if (flag == "--dir") o.dir = value;
    else if (flag == "--log") o.log = value;
    else if (flag == "--write-buffer") o.write_buffer = std::stoul(value);
    else if (flag == "--batch") o.batch = std::stoul(value);
    else if (flag == "--gap-at") o.gap_at = std::stol(value);
    else if (flag == "--gap-every") o.gap_every = std::stol(value);
    else if (flag == "--gap-store") o.gap_store = std::stoi(value);
    else if (flag == "--idle-ms") o.idle_ms = std::stoi(value);
    else if (flag == "--think-us") o.think_us = std::stoi(value);
    else if (flag == "--indexes") o.indexes = std::stoi(value);
    else if (flag == "--priority") o.priority = value == "1";
    else if (flag == "--outbox") o.outbox = value == "1";
    else if (flag == "--stats") o.stats = value == "1";
    else if (flag == "--sample-every") o.sample_every = std::stol(value);
  }

  std::vector<Row> rows;
  {
    std::ifstream in(argv[1]);
    string line;
    std::vector<Row> second;
    while (std::getline(in, line)) {
      std::stringstream fields(line);
      Row row;
      string store, stamp;
      std::getline(fields, store, '\t');
      std::getline(fields, row.type, '\t');
      std::getline(fields, stamp, '\t');
      std::getline(fields, row.id, '\t');
      std::getline(fields, row.value);
      row.store = std::stoi(store);
      row.timestamp = std::stod(stamp);
      if (o.priority && row.store == 2) second.push_back(std::move(row));
      else rows.push_back(std::move(row));
    }
    rows.insert(rows.end(), second.begin(), second.end());
  }

  leveldb::Env* base = leveldb::Env::Default();
  std::unique_ptr<leveldb::Env> memory;
  if (o.env == "mem") {
    memory.reset(leveldb::NewMemEnv(base));
    base = memory.get();
  }
  CountingEnv env(base);
  leveldb::Options options;
  options.env = &env;
  options.create_if_missing = true;
  options.write_buffer_size = o.write_buffer;
  options.max_open_files = o.env == "mem" ? 50000 : 80;
  options.compression = leveldb::kSnappyCompression;
  options.filter_policy = leveldb::NewBloomFilterPolicy(10);
  // Chromium's in-memory block cache keeps nothing.
  options.block_cache = leveldb::NewLRUCache(o.env == "mem" ? 1 : 8 << 20);
  FileLogger logger(o.log.empty() ? "/dev/null" : o.log);
  options.info_log = &logger;
  leveldb::DB* db = nullptr;
  leveldb::Status status = leveldb::DB::Open(options, o.dir, &db);
  if (!status.ok()) {
    std::cerr << status.ToString() << "\n";
    return 1;
  }

  auto start = Clock::now();
  auto seconds = [&] {
    return std::chrono::duration<double>(Clock::now() - start).count();
  };
  auto sample = [&](long done) {
    string files[4];
    for (int level = 0; level < 4; level++)
      db->GetProperty("leveldb.num-files-at-level" + std::to_string(level),
                      &files[level]);
    printf("%7ld rows %7.2fs files %s %s %s %s sleeps %ld\n", done, seconds(),
           files[0].c_str(), files[1].c_str(), files[2].c_str(),
           files[3].c_str(), sleeps.load());
  };

  {
    Replay replay(db, o);
    auto small = [&](int store, const string& name) {
      Row row{store, "meta", 0, name, "{\"key\":\"" + name + "\"}"};
      replay.Begin();
      replay.Put(row, StringKey(name));
      replay.Commit();
    };
    for (const char* name : {"syncState", "owner", "clientId"}) small(4, name);

    long next_gap = o.gap_at < 0 ? -1 : o.gap_at;
    long next_sample = o.sample_every;
    size_t at = 0;
    while (at < rows.size()) {
      if (next_gap >= 0 && static_cast<long>(at) >= next_gap) {
        if (o.idle_ms) replay.Drain();
        if (o.idle_ms) usleep(o.idle_ms * 1000);
        if (o.gap_store >= 0) small(o.gap_store, "cardsRestored");
        next_gap = o.gap_every ? next_gap + o.gap_every : -1;
      }
      size_t end = std::min(rows.size(), at + o.batch);
      replay.Begin();
      if (o.outbox)
        for (size_t i = at; i < end; i++)
          replay.Lookup(Prefix(3, 1) + StringKey(rows[i].id + "#outbox"));
      for (size_t i = at; i < end; i++) {
        replay.Put(rows[i], StringKey(rows[i].id));
        if (o.think_us) Spin(o.think_us);
      }
      replay.Commit();
      at = end;
      if (o.sample_every && static_cast<long>(at) >= next_sample) {
        sample(at);
        next_sample += o.sample_every;
      }
    }
    replay.Drain();
  }
  double total = seconds();
  printf("done %zu rows in %.2f s; %ld write delays, %.2f s asleep\n",
         rows.size(), total, sleeps.load(), slept_us.load() / 1e6);
  if (o.stats) {
    string stats;
    db->GetProperty("leveldb.stats", &stats);
    std::cout << stats;
  }
  delete db;
  return 0;
}
