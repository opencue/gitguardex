"""Per-user Linux admission control for foreground build and test commands."""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import stat
import subprocess
import sys
import time

MIB = 1024 ** 2
GIB = 1024 * MIB
MAX_SLOTS = 4
CGROUP = Path("/sys/fs/cgroup")


def read(path):
    try:
        return Path(path).read_text()
    except OSError:
        return ""


def counters(path):
    return {key.rstrip(":"): int(value) for key, value, *_ in
            (line.split() for line in read(path).splitlines() if line.strip())
            if value.isdecimal()}


def number(path):
    value = read(path).strip()
    return int(value) if value.isdecimal() else None


def current_group():
    for line in read("/proc/self/cgroup").splitlines():
        if line.startswith("0::/"):
            group = (CGROUP / line[4:]).resolve()
            if group == CGROUP or CGROUP in group.parents:
                return group
    return None


def v1_memory_group():
    for line in read("/proc/self/cgroup").splitlines():
        _, controllers, group = line.split(":", 2)
        if "memory" in controllers.split(","):
            break
    else:
        return None
    for line in read("/proc/self/mountinfo").splitlines():
        left, separator, right = line.partition(" - ")
        if not separator:
            continue
        fs, _, options = right.split()
        if fs != "cgroup" or "memory" not in options.split(","):
            continue
        root, mount = (Path(re.sub(r"\\([0-7]{3})", lambda m: chr(int(m[1], 8)), field))
                       for field in left.split()[3:5])
        try:
            directory = (mount / Path(group).relative_to(root)).resolve()
        except ValueError:
            continue
        if (directory == mount or mount in directory.parents) and (directory / "memory.limit_in_bytes").is_file():
            return mount, directory
    return None


def cgroup_headroom(total, available):
    v1 = v1_memory_group()
    root, group = v1 or (CGROUP, current_group())
    if group is None:
        return total, available
    limit_file, usage_file = ("memory.limit_in_bytes", "memory.usage_in_bytes") if v1 else ("memory.max", "memory.current")
    for parent in (group, *group.parents):
        if not v1 or parent == group or read(parent / "memory.use_hierarchy").strip() != "0":
            limit = number(parent / limit_file)
            used = number(parent / usage_file)
            if limit is not None:
                total = min(total, limit)
                available = min(available, max(0, limit - (used or 0)))
        if parent == root:
            break
    return total, available


def policy(total, available, active):
    # ponytail: one conservative estimate per job; add job-specific weights only
    # if measured workloads consistently need different admission thresholds.
    max_jobs = min(MAX_SLOTS, max(1, total // (8 * GIB))) if total else 0
    reserve = max(total // 8, min(512 * MIB, total // 4))
    job = min(2 * GIB, total // 4)
    additional = min(max_jobs - active, (available - reserve) // max(1, job) - active)
    return {
        "maxJobs": max_jobs,
        "activeJobs": active,
        "admissibleJobs": max(0, additional),
        "reserveBytes": reserve,
        "estimatedJobBytes": job,
        "memoryHighBytes": min(4 * GIB, total // 2),
    }


def snapshot(active):
    mem = counters("/proc/meminfo")
    host_total = mem.get("MemTotal", 0) * 1024
    host_available = mem.get("MemAvailable", 0) * 1024
    total, available = cgroup_headroom(host_total, host_available)
    return {
        "supported": True,
        "enabled": os.environ.get("GUARDEX_HEAVY_QUEUE") != "0",
        "hostTotalBytes": host_total,
        "hostAvailableBytes": host_available,
        "totalBytes": total,
        "availableBytes": available,
        "swapTotalBytes": mem.get("SwapTotal", 0) * 1024,
        "swapFreeBytes": mem.get("SwapFree", 0) * 1024,
        **policy(total, available, active),
    }


def queue_dir():
    uid = os.getuid()
    runtime = Path(f"/run/user/{uid}")
    if check_directory(runtime):
        return runtime / "gitguardex-heavy"
    # Use the account's home, not the caller's HOME. Prefer it over shared /tmp.
    try:
        home = Path(pwd.getpwuid(uid).pw_dir)
        if home.is_absolute():
            info = home.stat()
            if stat.S_ISDIR(info.st_mode) and info.st_uid == uid and not info.st_mode & 0o022:
                return home / ".cache" / "gitguardex-heavy"
    except (KeyError, OSError):
        pass
    # Unmapped UIDs still share a queue; creation rejects foreign-owned paths.
    return Path(f"/tmp/gitguardex-heavy-{uid}")


def check_directory(directory, create=False):
    if create:
        directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    try:
        info = directory.lstat()
    except FileNotFoundError:
        return False
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise RuntimeError(f"unsafe queue directory: {directory}")
    return True


def try_lock(path, create=False):
    flags = (os.O_RDWR | os.O_CREAT) if create else os.O_RDONLY
    try:
        fd = os.open(path, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600)
    except FileNotFoundError:
        if not create:
            return None, False
        raise
    try:
        info = os.fstat(fd)
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_uid != os.getuid():
            raise RuntimeError(f"unsafe queue lock: {path}")
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return fd, False
    except BlockingIOError:
        os.close(fd)
        return None, True
    except BaseException:
        os.close(fd)
        raise


@contextlib.contextmanager
def inspect_slots(directory, create=False):
    with contextlib.ExitStack() as stack:
        slots = []
        for index in range(MAX_SLOTS):
            fd, busy = try_lock(directory / f"slot-{index}", create)
            if fd is not None:
                if create:
                    stack.callback(os.close, fd)
                else:
                    os.close(fd)
                    fd = None
            slots.append((fd, busy))
        yield slots


def admit(directory):
    guard, _ = try_lock(directory / "admission", create=True)
    if guard is None:
        return None
    try:
        with inspect_slots(directory, create=True) as slots:
            plan = snapshot(sum(busy for _, busy in slots))
            if plan["admissibleJobs"]:
                # dup keeps the same kernel lock after the probe releases its fd.
                fd = next(fd for fd, _ in slots if fd is not None)
                return os.dup(fd), plan["memoryHighBytes"]
    finally:
        os.close(guard)
    return None


def user_manager_group():
    uid = os.getuid()
    return CGROUP / f"user.slice/user-{uid}.slice/user@{uid}.service"


def worker_slice():
    if os.environ.get("GUARDEX_HEAVY_SCOPE") == "0" or not (CGROUP / "cgroup.controllers").is_file():
        return None
    # Only move out of ordinary user scopes. Stay under the same parent slice
    # and don't escape memory limits on the caller's scope itself.
    group = current_group()
    if group is None or not group.name.endswith(".scope"):
        return None
    parent = group.parent
    if parent.parent != user_manager_group() or parent.name not in ("app.slice", "session.slice"):
        return None
    if any(read(group / f"memory.{field}").strip() != "max" for field in ("max", "high")):
        return None
    if not shutil.which("systemd-run") or not shutil.which("systemctl"):
        return None
    try:
        ready = subprocess.run(
            ["systemctl", "--user", "show", "--property=Version", "--value"], stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=2,
        ).returncode == 0
        return parent / parent.name.replace(".slice", "-gxheavy.slice") if ready else None
    except (OSError, subprocess.TimeoutExpired):
        return None


def supervise(command, seconds, pass_fds, *, new_session):
    interrupted = False
    with subprocess.Popen(command, start_new_session=new_session, pass_fds=pass_fds) as child:
        def send(signum):
            with contextlib.suppress(ProcessLookupError):
                (os.killpg if new_session else os.kill)(child.pid, signum)

        def forward(signum, _frame):
            nonlocal interrupted
            interrupted = True
            send(signum)

        previous = {signum: signal.signal(signum, forward)
                    for signum in (signal.SIGINT, signal.SIGTERM, signal.SIGHUP)}
        try:
            status = child.wait(timeout=seconds)
            return status, interrupted
        except subprocess.TimeoutExpired:
            send(signal.SIGKILL)
            print(f"[gx] Heavy job timed out after {seconds}s of execution.", file=sys.stderr)
            return 124, interrupted
        finally:
            for signum, handler in previous.items():
                signal.signal(signum, handler)


def exit_status(status):
    return status if status >= 0 else 128 - status


def run_scope(command, seconds, scope, high, slot_fd):
    # Scope setup and the command can fail with the same exit code. Only the
    # in-scope wrapper can attest that it has taken responsibility for the job.
    reader, writer = os.pipe2(os.O_CLOEXEC | os.O_NONBLOCK)
    try:
        scoped = ["systemd-run", "--user", "--scope", "--quiet", f"--slice={scope.name}",
                  "--description=GitGuardex heavy job", "-p", f"MemoryHigh={high}", "--",
                  sys.executable, os.path.abspath(__file__), "scoped", str(writer),
                  "" if seconds is None else str(seconds), str(slot_fd), *command]
        try:
            status, interrupted = supervise(scoped, None, (slot_fd, writer), new_session=False)
        except (FileNotFoundError, PermissionError):
            return None
        if interrupted or status < 0:
            return exit_status(status)
        with contextlib.suppress(BlockingIOError):
            if os.read(reader, 1):
                return exit_status(status)
        return None
    finally:
        os.close(reader)
        os.close(writer)


def execute(command, seconds, scope=None, high=None, slot_fd=None):
    if scope:
        status = run_scope(command, seconds, scope, high, slot_fd)
        if status is not None:
            return status
    if seconds is not None:
        # Keep the slot locked if the supervisor dies while the child is running.
        pass_fds = () if slot_fd is None else (slot_fd,)
        status, _ = supervise(command, seconds, pass_fds, new_session=True)
        return exit_status(status)
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    os.execvp(command[0], command)


def run(command, seconds=None):
    if os.environ.get("GUARDEX_HEAVY_QUEUE") == "0" or os.environ.get("GUARDEX_HEAVY_ACTIVE") == "1":
        return execute(command, seconds)
    directory = queue_dir()
    check_directory(directory, create=True)
    timeout = int(os.environ.get("GUARDEX_HEAVY_WAIT_SECONDS", "120"))
    if timeout < 0:
        raise ValueError("GUARDEX_HEAVY_WAIT_SECONDS must be a non-negative integer")
    deadline = time.monotonic() + timeout
    warned = False
    while True:
        admission = admit(directory)
        if admission is not None:
            fd, high = admission
            os.set_inheritable(fd, True)
            os.environ["GUARDEX_HEAVY_ACTIVE"] = "1"
            return execute(command, seconds, worker_slice(), high, fd)
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            with inspect_slots(directory) as slots:
                plan = snapshot(sum(busy for _, busy in slots))
            active = plan["activeJobs"]
            needed = max(0, plan["reserveBytes"] + plan["estimatedJobBytes"] * (active + 1)
                         - plan["availableBytes"])
            detail = f"{active}/{plan['maxJobs']} slots occupied"
            if needed:
                detail += f"; needs {needed / GIB:.1f} GiB more available RAM"
            print(f"[gx] Heavy job not started before timeout ({detail}). Run gx mem-doctor.", file=sys.stderr)
            return 75
        if not warned:
            print("[gx] Waiting for a heavy-job slot and available RAM…", file=sys.stderr)
            warned = True
        time.sleep(min(1, remaining))


def diagnose():
    directory = queue_dir()
    with inspect_slots(directory) if check_directory(directory) else contextlib.nullcontext([]) as slots:
        report = snapshot(sum(busy for _, busy in slots))
    pressure = read("/proc/pressure/memory")
    group = worker_slice()
    report.update(
        pressureAvg10={line.split()[0]: float(line.split()[1].split("=")[1])
                       for line in pressure.splitlines()},
        scopeAvailable=group is not None,
        scopeSlice=group.name if group else None,
        scopeMemoryCurrentBytes=number(group / "memory.current") if group else None,
        scopeMemoryPeakBytes=number(group / "memory.peak") if group else None,
        scopeMemoryEvents=counters(group / "memory.events") if group else {},
    )
    print(json.dumps(report))


def main(args):
    if args == ["diagnose"]:
        diagnose()
    elif args == ["profile"]:
        print(json.dumps(snapshot(0)))
    elif len(args) >= 4 and args[0] == "--run-timeout" and args[2] == "--":
        return run(args[3:], int(args[1]))
    elif len(args) >= 5 and args[0] == "scoped":
        ready, seconds, slot_fd = args[1:4]
        os.write(int(ready), b"1")
        os.close(int(ready))
        return execute(args[4:], int(seconds) if seconds else None, slot_fd=int(slot_fd))
    elif len(args) >= 2 and args[0] == "--":
        return run(args[1:])
    else:
        raise ValueError("expected diagnose, profile or -- <command>")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except KeyboardInterrupt:
        sys.exit(130)
    except FileNotFoundError as error:
        print(f"[gx] {error}", file=sys.stderr)
        sys.exit(127)
    except PermissionError as error:
        print(f"[gx] {error}", file=sys.stderr)
        sys.exit(126)
    except (OSError, RuntimeError, ValueError) as error:
        print(f"[gx] {error}", file=sys.stderr)
        sys.exit(1)
