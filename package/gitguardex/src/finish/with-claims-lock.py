"""Run one command under a GitGuardex advisory lock, without stealing stale locks."""
import fcntl
import os
import stat
import subprocess
import sys
import time
from contextlib import ExitStack

args = sys.argv[1:]
nonblocking = args[0] == "--try-lock"
if nonblocking:
    args = args[1:]
existing_lock = args[0] == "--existing-lock"
if existing_lock:
    args = args[1:]
lock_path, *command = args
paths = [lock_path]
if command[0] == "--and-lock":
    paths.append(command[1])
    command = command[2:]
deadline = time.monotonic() + (0 if nonblocking else 20)
with ExitStack() as locks:
    fds = []
    for index, path in enumerate(paths):
        access = os.O_RDONLY if existing_lock and index == 0 else os.O_RDWR | os.O_CREAT
        fd = os.open(path, access | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
        locks.callback(os.close, fd)
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
            raise RuntimeError("unsafe advisory lock file")
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() >= deadline:
                    raise SystemExit(75)
                time.sleep(0.1)
        fds.append(fd)
    # The worker keeps both locks even if this launcher exits first.
    env = dict(os.environ, GUARDEX_FINISH_WORKTREE_LOCK_FD=str(fds[0])) if existing_lock else None
    raise SystemExit(subprocess.run(command, pass_fds=fds, env=env).returncode)
