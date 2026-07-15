import json
import tempfile
import unittest
from pathlib import Path

from transfer import (
    TransferState,
    build_scp_command,
    parse_scp_progress,
    verify_destination,
)


class ScpProgressTests(unittest.TestCase):
    def test_parses_scp_progress_meter(self):
        self.assertEqual(parse_scp_progress("clip.mp4  37%  1.2GB  8.4MB/s  00:42"), 37)

    def test_ignores_non_progress_output(self):
        self.assertIsNone(parse_scp_progress("debug1: Connecting to cccbox"))

    def test_parses_completion_meter(self):
        self.assertEqual(parse_scp_progress("clip.mp4 100% 47087811658 42.0MB/s 18:41"), 100)


class TransferBehaviorTests(unittest.TestCase):
    def test_scp_command_quotes_remote_path_and_refuses_overwrite(self):
        command = build_scp_command(
            "Asia Trip/Edited Clips/clip [1080].mp4",
            Path("D:/Local/Unsorted/clip [1080].mp4"),
        )
        self.assertTrue(any("cccbox" in part for part in command))
        self.assertTrue(any("clip [1080].mp4" in part for part in command))
        self.assertFalse(any("'" in part for part in command))
        self.assertIn("-o", command)
        self.assertIn("BatchMode=yes", command)

    def test_destination_size_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            destination = Path(temp) / "clip.mp4"
            destination.write_bytes(b"1234")
            self.assertTrue(verify_destination(destination, 4))
            self.assertFalse(verify_destination(destination, 5))

    def test_state_serializes_real_progress_fields(self):
        state = TransferState(total_bytes=100, total_files=2)
        state.update_file("clip.mp4", 25, 50)
        payload = state.snapshot()
        self.assertEqual(payload["status"], "COPYING")
        self.assertEqual(payload["current_file"], "clip.mp4")
        self.assertEqual(payload["bytes_copied"], 25)
        self.assertEqual(payload["files_completed"], 0)


if __name__ == "__main__":
    unittest.main()
