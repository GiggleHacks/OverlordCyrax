import json
import os
import queue
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable


PROGRESS_RE = re.compile(r"(?<!\d)(\d{1,3})%")


def parse_scp_progress(line: str):
    match = PROGRESS_RE.search(line)
    if not match:
        return None
    return min(100, int(match.group(1)))


def build_scp_command(source: str, destination: Path):
    remote = f"root@cccbox:{source}"
    return ["scp", "-p", "-o", "BatchMode=yes", remote, str(destination)]


def verify_destination(destination: Path, expected_bytes: int):
    try:
        return destination.is_file() and destination.stat().st_size == expected_bytes
    except OSError:
        return False


class TransferState:
    def __init__(self, total_bytes: int, total_files: int):
        self.lock = threading.Lock()
        self.total_bytes = total_bytes
        self.total_files = total_files
        self.status = "READY"
        self.current_file = None
        self.current_bytes = 0
        self.current_expected = 0
        self.completed_bytes = 0
        self.files_completed = 0
        self.errors = []
        self.started_at = None
        self.finished_at = None
        self._listeners: list[Callable[[dict[str, Any]], None]] = []

    def subscribe(self, listener):
        with self.lock:
            self._listeners.append(listener)

    def snapshot(self):
        with self.lock:
            now = self.finished_at or time.time() if self.started_at else None
            elapsed = max(0.0, now - self.started_at) if now else 0.0
            bytes_copied = self.completed_bytes + self.current_bytes
            speed = bytes_copied / elapsed if elapsed else 0.0
            remaining = self.total_bytes - bytes_copied
            return {
                "status": self.status,
                "current_file": self.current_file,
                "current_bytes": self.current_bytes,
                "current_expected": self.current_expected,
                "total_bytes": self.total_bytes,
                "bytes_copied": bytes_copied,
                "total_files": self.total_files,
                "files_completed": self.files_completed,
                "errors": list(self.errors),
                "started_at": self.started_at,
                "finished_at": self.finished_at,
                "elapsed_seconds": elapsed,
                "bytes_per_second": speed,
                "eta_seconds": remaining / speed if speed > 0 else None,
            }

    def _emit(self):
        payload = self.snapshot()
        for listener in list(self._listeners):
            listener(payload)

    def start(self):
        with self.lock:
            self.status = "COPYING"
            self.started_at = time.time()
        self._emit()

    def update_file(self, name: str, current_bytes: int, expected_bytes: int):
        with self.lock:
            self.status = "COPYING"
            self.current_file = name
            self.current_bytes = current_bytes
            self.current_expected = expected_bytes
        self._emit()

    def begin_file(self, name: str, expected_bytes: int):
        with self.lock:
            self.current_file = name
            self.current_bytes = 0
            self.current_expected = expected_bytes
        self._emit()

    def complete_file(self, expected_bytes: int):
        with self.lock:
            self.completed_bytes += expected_bytes
            self.current_bytes = expected_bytes
            self.files_completed += 1
        self._emit()

    def error(self, message: str):
        with self.lock:
            self.errors.append(message)
            self.status = "ERROR"
        self._emit()

    def finish(self):
        with self.lock:
            self.finished_at = time.time()
            self.status = "DONE" if not self.errors else "ERROR"
        self._emit()


def load_manifest(path: Path):
    entries = json.loads(path.read_text(encoding="utf-8"))
    if len({entry["destination"] for entry in entries}) != len(entries):
        raise ValueError("manifest contains duplicate destination names")
    return entries


def run_transfer(manifest, destination: Path, state: TransferState, on_complete=None):
    destination.mkdir(parents=True, exist_ok=True)
    state.start()
    for entry in manifest:
        target = destination / entry["destination"]
        state.begin_file(entry["name"], entry["bytes"])
        if target.exists():
            if verify_destination(target, entry["bytes"]):
                state.complete_file(entry["bytes"])
                continue
            try:
                existing_size = target.stat().st_size
            except OSError:
                existing_size = -1
            if 0 <= existing_size < entry["bytes"]:
                target.unlink()
            else:
                state.error(f"conflict: {target}")
                continue
        command = build_scp_command(entry["source"], target)
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        output_queue = queue.Queue()

        def read_stderr():
            assert process.stderr is not None
            buffer = ""
            while True:
                char = process.stderr.read(1)
                if not char:
                    if buffer:
                        output_queue.put(buffer)
                    return
                if char in "\r\n":
                    if buffer:
                        output_queue.put(buffer)
                        buffer = ""
                else:
                    buffer += char

        threading.Thread(target=read_stderr, daemon=True).start()
        assert process.stderr is not None
        while process.poll() is None:
            try:
                while True:
                    line = output_queue.get_nowait()
                    percent = parse_scp_progress(line)
                    if percent is not None:
                        state.update_file(entry["name"], int(entry["bytes"] * percent / 100), entry["bytes"])
            except queue.Empty:
                pass
            try:
                actual_bytes = target.stat().st_size
            except OSError:
                actual_bytes = 0
            state.update_file(entry["name"], min(actual_bytes, entry["bytes"]), entry["bytes"])
            time.sleep(0.5)
        return_code = process.wait()
        if return_code != 0:
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            state.error(f"scp failed ({return_code}): {entry['name']}")
            continue
        with state.lock:
            state.status = "VERIFYING"
        state._emit()
        if not verify_destination(target, entry["bytes"]):
            try:
                target.unlink(missing_ok=True)
            except OSError:
                pass
            state.error(f"verification failed: {target}")
            continue
        state.complete_file(entry["bytes"])
    state.finish()
    if on_complete:
        on_complete(state.snapshot())
