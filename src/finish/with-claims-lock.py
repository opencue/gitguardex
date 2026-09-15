"""Run one command under a GitGuardex advisory lock, without stealing stale locks."""
import fcntl
import os
import stat
import subprocess
import sys
import time

args = sys.argv[1:]
nonblocking = args[0] == "--try-lock"
if nonblocking:
    args = args[1:]
lock_path, *command = args
fd = os.open(lock_path, os.O_RDWR | os.O_CREAT | os.O_NOFOLLOW, 0o600)
try:
    if not stat.S_ISREG(os.fstat(fd).st_mode) or os.fstat(fd).st_nlink != 1:
        raise RuntimeError("unsafe advisory lock file")
    deadline = time.monotonic() + (0 if nonblocking else 20)
    while True:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            break
        except BlockingIOError:
            if time.monotonic() >= deadline:
                raise SystemExit(75)
            time.sleep(0.1)
    raise SystemExit(subprocess.run(command, pass_fds=(fd,)).returncode)
finally:
    os.close(fd)
