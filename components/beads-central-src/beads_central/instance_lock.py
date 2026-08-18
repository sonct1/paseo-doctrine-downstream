from __future__ import annotations

import os
from pathlib import Path


class InstanceLockError(RuntimeError):
    pass


class InstanceLock:
    """Process-wide advisory lock protecting the v1 single-replica invariant."""

    def __init__(self, path: Path):
        self.path = path
        self._file = None

    def acquire(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        f = self.path.open("a+")
        try:
            if os.name == "nt":
                import msvcrt

                f.seek(0)
                # Ensure there is one byte available to lock.
                if f.read(1) == "":
                    f.write("0")
                    f.flush()
                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(f.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (BlockingIOError, OSError) as exc:
            f.close()
            raise InstanceLockError(
                f"another Beads Central process already owns data directory {self.path.parent}"
            ) from exc
        self._file = f

    def release(self) -> None:
        f = self._file
        if f is None:
            return
        try:
            if os.name == "nt":
                import msvcrt

                f.seek(0)
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl

                fcntl.flock(f.fileno(), fcntl.LOCK_UN)
        finally:
            f.close()
            self._file = None
