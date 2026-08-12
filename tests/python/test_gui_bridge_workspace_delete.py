import tempfile
import unittest
from pathlib import Path

from app.gui.bridge import BridgeRuntime


class WorkspaceDeleteSafetyTests(unittest.TestCase):
    def setUp(self):
        self._temp_dir = tempfile.TemporaryDirectory()
        self.base_dir = Path(self._temp_dir.name)
        self.workspace_root = self.base_dir / "workspace"
        self.workspace_root.mkdir()
        self.runtime = BridgeRuntime(base_dir=self.base_dir)
        self.runtime.workspace_root = self.workspace_root

    def tearDown(self):
        self._temp_dir.cleanup()

    def _symlink_or_skip(self, link_path, target_path):
        try:
            link_path.symlink_to(target_path, target_is_directory=target_path.is_dir())
        except (NotImplementedError, OSError) as error:
            self.skipTest(f"symlink creation is not available: {error}")

    def test_workspace_delete_deletes_regular_file(self):
        target = self.workspace_root / "delete_me.txt"
        target.write_text("delete", encoding="utf-8")

        result = self.runtime._handle_workspace_delete({
            "scope": "root",
            "rel_path": "delete_me.txt",
        })

        self.assertTrue(result["deleted"])
        self.assertEqual(result["kind"], "file")
        self.assertFalse(target.exists())

    def test_workspace_delete_rejects_path_escape(self):
        outside = self.base_dir / "outside.txt"
        outside.write_text("keep", encoding="utf-8")

        with self.assertRaises(ValueError):
            self.runtime._handle_workspace_delete({
                "scope": "root",
                "rel_path": "../outside.txt",
            })

        self.assertTrue(outside.exists())
        self.assertEqual(outside.read_text(encoding="utf-8"), "keep")

    def test_workspace_delete_rejects_symlink_target(self):
        real_file = self.workspace_root / "real.txt"
        real_file.write_text("keep", encoding="utf-8")
        symlink = self.workspace_root / "link.txt"
        self._symlink_or_skip(symlink, real_file)

        with self.assertRaises(PermissionError):
            self.runtime._handle_workspace_delete({
                "scope": "root",
                "rel_path": "link.txt",
            })

        self.assertTrue(symlink.exists())
        self.assertTrue(real_file.exists())
        self.assertEqual(real_file.read_text(encoding="utf-8"), "keep")

    def test_workspace_delete_rejects_symlink_path_component(self):
        real_dir = self.workspace_root / "real_dir"
        real_dir.mkdir()
        real_file = real_dir / "real.txt"
        real_file.write_text("keep", encoding="utf-8")
        symlink_dir = self.workspace_root / "link_dir"
        self._symlink_or_skip(symlink_dir, real_dir)

        with self.assertRaises(PermissionError):
            self.runtime._handle_workspace_delete({
                "scope": "root",
                "rel_path": "link_dir/real.txt",
            })

        self.assertTrue(real_file.exists())
        self.assertEqual(real_file.read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()
