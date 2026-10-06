import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pydantic import ValidationError

from codex_decisions_router.cli import configured_router, load_object
from codex_decisions_router.models import Policy
from helpers import live_policy


class CLISafetyTests(unittest.TestCase):
    def test_offline_never_reads_key_or_constructs_http_provider(self):
        with patch("codex_decisions_router.cli.os.environ.get", side_effect=AssertionError("key lookup forbidden")), \
                patch("codex_decisions_router.cli.DecisionsHTTPProvider", side_effect=AssertionError("HTTP forbidden")):
            self.assertEqual(configured_router(None).mode, "offline")
            with self.assertRaises(ValueError):
                configured_router(None, enable_live=True)

    def test_live_requires_explicit_policy_and_process_opt_in_before_key_lookup(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            path.write_text(live_policy().model_dump_json())
            with patch("codex_decisions_router.cli.os.environ.get", side_effect=AssertionError("key lookup forbidden")):
                with self.assertRaises(ValueError):
                    configured_router(str(path), enable_live=False)
            with patch("codex_decisions_router.cli.os.environ.get", return_value=None):
                with self.assertRaises(ValueError) as caught:
                    configured_router(str(path), enable_live=True)
                self.assertEqual(str(caught.exception), "live_auth_missing")

    def test_policy_file_bounds_and_duplicate_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "policy.json"
            for value in ('{"mode":"offline","mode":"live"}', "x" * 16385):
                path.write_text(value)
                with self.assertRaises(Exception):
                    load_object(str(path))
        for value in (True, "1", 1.0, 0, 2):
            with self.assertRaises(ValidationError):
                Policy(schema_version=value)
