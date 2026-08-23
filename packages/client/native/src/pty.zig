// Flat, FFI-trivial pseudo-terminal over libc forkpty(3). Exposes exactly what
// the embedded Agent-tab terminal needs: spawn a child on a PTY, non-blocking
// read of its output, write, resize, and reap. Handles are small ints into a
// fixed table so bun:ffi only ever passes ints and byte pointers, never structs.
//
// Packed-argument contract (avoids shell parsing and per-token FFI marshalling):
//   argv_packed: "arg0\0arg1\0...\0"  - NUL-separated, terminated by an empty
//                                       token (a trailing extra NUL).
//   env_packed:  "K=V\0K=V\0...\0"    - same shape; empty means inherit parent.
//   cwd:         a plain C string, or empty to keep the parent's directory.

const std = @import("std");
const builtin = @import("builtin");

const c = @cImport({
    @cInclude("unistd.h");
    @cInclude("fcntl.h");
    @cInclude("errno.h");
    @cInclude("signal.h");
    @cInclude("stdlib.h");
    @cInclude("string.h");
    @cInclude("termios.h");
    @cInclude("sys/ioctl.h");
    @cInclude("sys/wait.h");
    if (builtin.os.tag == .macos) @cInclude("util.h") else @cInclude("pty.h");
});

extern var environ: [*c][*c]u8;

const MAX_SESSIONS = 64;
const MAX_TOKENS = 1024;

const PtySession = struct {
    in_use: bool = false,
    master_fd: c_int = -1,
    pid: c.pid_t = 0,
    reaped: bool = false,
    exit_code: c_int = 0,
};

var sessions = [_]PtySession{.{}} ** MAX_SESSIONS;

// Split a double-NUL-terminated packed buffer into a NULL-terminated array of
// pointers into that same buffer. Returns the token count, or -1 on overflow.
fn splitPacked(packed_buffer: [*c]u8, out: [][*c]u8) c_int {
    var count: usize = 0;
    var cursor: [*c]u8 = packed_buffer;
    while (cursor[0] != 0) {
        if (count >= out.len - 1) return -1;
        out[count] = cursor;
        count += 1;
        cursor += c.strlen(cursor) + 1;
    }
    out[count] = null;
    return @intCast(count);
}

// Reap the child once, recording its exit status. WNOHANG unless `block`.
fn reapSession(session: *PtySession, block: bool) void {
    if (session.reaped) return;
    var status: c_int = 0;
    const result = c.waitpid(session.pid, &status, if (block) 0 else c.WNOHANG);
    if (result != session.pid) return;
    session.reaped = true;
    if (c.WIFEXITED(status)) {
        session.exit_code = c.WEXITSTATUS(status);
    } else if (c.WIFSIGNALED(status)) {
        session.exit_code = 128 + c.WTERMSIG(status);
    } else {
        session.exit_code = -1;
    }
}

fn sessionOf(handle: c_int) ?*PtySession {
    if (handle < 0 or handle >= MAX_SESSIONS) return null;
    const session = &sessions[@intCast(handle)];
    if (!session.in_use) return null;
    return session;
}

// Spawn `argv_packed` on a fresh PTY sized cols x rows, in cwd, with env_packed
// (or the parent's env when empty). Returns a session handle, or -1 on failure.
export fn cueloop_pty_spawn(argv_packed: [*c]u8, cwd: [*c]const u8, env_packed: [*c]u8, cols: c_int, rows: c_int) c_int {
    var handle: c_int = -1;
    for (0..MAX_SESSIONS) |index| {
        if (!sessions[index].in_use) {
            handle = @intCast(index);
            break;
        }
    }
    if (handle < 0) return -1;

    var argv: [MAX_TOKENS][*c]u8 = undefined;
    if (splitPacked(argv_packed, &argv) < 1) return -1;

    var envp: [MAX_TOKENS][*c]u8 = undefined;
    const have_env = env_packed != null and env_packed[0] != 0;
    if (have_env and splitPacked(env_packed, &envp) < 0) return -1;

    var winsize = std.mem.zeroes(c.struct_winsize);
    winsize.ws_col = @intCast(cols);
    winsize.ws_row = @intCast(rows);

    var master_fd: c_int = -1;
    const pid = c.forkpty(&master_fd, null, null, &winsize);
    if (pid < 0) return -1;

    if (pid == 0) {
        // Child: adopt cwd/env then exec; _exit on any failure so a broken child never runs JS.
        if (cwd != null and cwd[0] != 0) {
            if (c.chdir(cwd) != 0) c._exit(127);
        }
        if (have_env) environ = &envp;
        _ = c.execvp(argv[0], &argv);
        c._exit(127);
    }

    // Parent: non-blocking master so reads can poll without stalling the loop.
    const flags = c.fcntl(master_fd, c.F_GETFL, @as(c_int, 0));
    _ = c.fcntl(master_fd, c.F_SETFL, flags | c.O_NONBLOCK);

    sessions[@intCast(handle)] = .{
        .in_use = true,
        .master_fd = master_fd,
        .pid = pid,
        .reaped = false,
        .exit_code = 0,
    };
    return handle;
}

export fn cueloop_pty_write(handle: c_int, data: [*c]const u8, len: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    const written = c.write(session.master_fd, data, @intCast(len));
    return @intCast(written);
}

// Non-blocking read of child output. Returns bytes read (>0), 0 when nothing is
// available yet, -2 once the child has exited and its output is drained, or -1.
export fn cueloop_pty_read(handle: c_int, buf: [*c]u8, len: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    const bytes_read = c.read(session.master_fd, buf, @intCast(len));
    if (bytes_read > 0) return @intCast(bytes_read);
    if (bytes_read == 0) {
        reapSession(session, true);
        return -2; // EOF: slave closed
    }
    const err = std.c._errno().*;
    if (err == c.EAGAIN or err == c.EWOULDBLOCK) {
        reapSession(session, false);
        return if (session.reaped) -2 else 0; // exited with no more output vs still running
    }
    if (err == c.EIO) {
        reapSession(session, true);
        return -2; // Linux: slave gone
    }
    return -1;
}

export fn cueloop_pty_resize(handle: c_int, cols: c_int, rows: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    var winsize = std.mem.zeroes(c.struct_winsize);
    winsize.ws_col = @intCast(cols);
    winsize.ws_row = @intCast(rows);
    return c.ioctl(session.master_fd, c.TIOCSWINSZ, &winsize);
}

export fn cueloop_pty_kill(handle: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    return c.kill(session.pid, c.SIGTERM);
}

export fn cueloop_pty_get_pid(handle: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    return @intCast(session.pid);
}

export fn cueloop_pty_get_exit_code(handle: c_int) c_int {
    const session = sessionOf(handle) orelse return -1;
    reapSession(session, true);
    return session.exit_code;
}

export fn cueloop_pty_close(handle: c_int) void {
    const session = sessionOf(handle) orelse return;
    // Close the master first (hangs up the child), then block to reap it: after the
    // SIGTERM from kill() plus this SIGHUP a well-behaved child exits at once, so the
    // wait returns promptly and never leaves a zombie.
    if (session.master_fd >= 0) _ = c.close(session.master_fd);
    reapSession(session, true);
    session.in_use = false;
    session.master_fd = -1;
}
