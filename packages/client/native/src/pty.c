// A flat, FFI-trivial pseudo-terminal over libc forkpty(3) - the code cueloop
// owns in place of the third-party bun-pty package. It exposes exactly what the
// embedded Agent-tab terminal needs: spawn a child on a PTY, non-blocking read
// of its output, write, resize, and reap. Handles are small ints into a fixed
// table so bun:ffi only ever passes ints and byte pointers (never structs).
//
// Packed-argument contract (avoids shell parsing and per-token FFI marshalling):
//   argv_packed: "arg0\0arg1\0...\0"  - NUL-separated, terminated by an empty
//                                       token (a trailing extra NUL).
//   env_packed:  "K=V\0K=V\0...\0"    - same shape; empty means inherit parent.
//   cwd:         a plain C string, or empty to keep the parent's directory.

#include <stdint.h>
#include <stddef.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <fcntl.h>
#include <errno.h>
#include <signal.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

extern char **environ;

#define MAX_SESSIONS 64
#define MAX_TOKENS 1024

typedef struct {
  int in_use;
  int master_fd;
  pid_t pid;
  int reaped;
  int exit_code;
} PtySession;

static PtySession sessions[MAX_SESSIONS];

// Split a double-NUL-terminated packed buffer into a NULL-terminated array of
// pointers into that same buffer. Returns the token count, or -1 on overflow.
static int split_packed(char *packed, char **out, int max) {
  int count = 0;
  char *cursor = packed;
  while (*cursor != '\0') {
    if (count >= max - 1) return -1;
    out[count++] = cursor;
    cursor += strlen(cursor) + 1;
  }
  out[count] = NULL;
  return count;
}

// Reap the child once, recording its exit status. WNOHANG unless `block`.
static void reap_session(PtySession *s, int block) {
  if (s->reaped) return;
  int status = 0;
  pid_t result = waitpid(s->pid, &status, block ? 0 : WNOHANG);
  if (result != s->pid) return;
  s->reaped = 1;
  if (WIFEXITED(status)) s->exit_code = WEXITSTATUS(status);
  else if (WIFSIGNALED(status)) s->exit_code = 128 + WTERMSIG(status);
  else s->exit_code = -1;
}

// Spawn `argv_packed` on a fresh PTY sized cols x rows, in cwd, with env_packed
// (or the parent's env when empty). Returns a session handle, or -1 on failure.
int cueloop_pty_spawn(char *argv_packed, const char *cwd, char *env_packed,
                      int cols, int rows) {
  int handle = -1;
  for (int i = 0; i < MAX_SESSIONS; i++) {
    if (!sessions[i].in_use) { handle = i; break; }
  }
  if (handle < 0) return -1;

  char *argv[MAX_TOKENS];
  if (split_packed(argv_packed, argv, MAX_TOKENS) < 1) return -1;

  char *envp[MAX_TOKENS];
  int have_env = env_packed != NULL && env_packed[0] != '\0';
  if (have_env && split_packed(env_packed, envp, MAX_TOKENS) < 0) return -1;

  struct winsize ws = {0};
  ws.ws_col = (unsigned short)cols;
  ws.ws_row = (unsigned short)rows;

  int master_fd = -1;
  pid_t pid = forkpty(&master_fd, NULL, NULL, &ws);
  if (pid < 0) return -1;

  if (pid == 0) {
    // Child: adopt the requested cwd/env, then become the target program. On any
    // failure exec never returns, so _exit keeps a broken child from running JS.
    if (cwd && cwd[0] != '\0') { if (chdir(cwd) != 0) _exit(127); }
    if (have_env) environ = envp;  // execvp resolves PATH from environ
    execvp(argv[0], argv);
    _exit(127);
  }

  // Parent: non-blocking master so reads can poll without stalling the loop.
  int flags = fcntl(master_fd, F_GETFL, 0);
  fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

  sessions[handle].in_use = 1;
  sessions[handle].master_fd = master_fd;
  sessions[handle].pid = pid;
  sessions[handle].reaped = 0;
  sessions[handle].exit_code = 0;
  return handle;
}

static PtySession *session_of(int handle) {
  if (handle < 0 || handle >= MAX_SESSIONS || !sessions[handle].in_use) return NULL;
  return &sessions[handle];
}

int cueloop_pty_write(int handle, const uint8_t *data, int len) {
  PtySession *s = session_of(handle);
  if (!s) return -1;
  ssize_t written = write(s->master_fd, data, (size_t)len);
  return (int)written;
}

// Non-blocking read of child output. Returns bytes read (>0), 0 when nothing is
// available yet, -2 once the child has exited and its output is drained, or -1.
int cueloop_pty_read(int handle, uint8_t *buf, int len) {
  PtySession *s = session_of(handle);
  if (!s) return -1;
  ssize_t n = read(s->master_fd, buf, (size_t)len);
  if (n > 0) return (int)n;
  if (n == 0) { reap_session(s, 1); return -2; }  // EOF: slave closed
  if (errno == EAGAIN || errno == EWOULDBLOCK) {
    reap_session(s, 0);
    return s->reaped ? -2 : 0;  // exited with no more output vs still running
  }
  if (errno == EIO) { reap_session(s, 1); return -2; }  // Linux: slave gone
  return -1;
}

int cueloop_pty_resize(int handle, int cols, int rows) {
  PtySession *s = session_of(handle);
  if (!s) return -1;
  struct winsize ws = {0};
  ws.ws_col = (unsigned short)cols;
  ws.ws_row = (unsigned short)rows;
  return ioctl(s->master_fd, TIOCSWINSZ, &ws);
}

int cueloop_pty_kill(int handle) {
  PtySession *s = session_of(handle);
  if (!s) return -1;
  return kill(s->pid, SIGTERM);
}

int cueloop_pty_get_pid(int handle) {
  PtySession *s = session_of(handle);
  return s ? (int)s->pid : -1;
}

int cueloop_pty_get_exit_code(int handle) {
  PtySession *s = session_of(handle);
  if (!s) return -1;
  reap_session(s, 1);
  return s->exit_code;
}

void cueloop_pty_close(int handle) {
  PtySession *s = session_of(handle);
  if (!s) return;
  if (s->master_fd >= 0) close(s->master_fd);
  reap_session(s, 0);
  s->in_use = 0;
  s->master_fd = -1;
}
