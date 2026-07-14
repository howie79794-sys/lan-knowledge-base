from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
import zipfile

from app.modules.documents.service import (
    _is_ignored_zip_metadata,
    _read_markdown_text,
    _short_storage_segment,
    _zip_member_source_path,
)


class MarkdownBundleImportTest(unittest.TestCase):
    def test_recovers_unflagged_utf8_chinese_filename(self):
        original = "贷款模块文档/001_贷款管理整体介绍.md"
        member = zipfile.ZipInfo(original.encode("utf-8").decode("cp437"))
        member.flag_bits = 0

        self.assertEqual(_zip_member_source_path(member).as_posix(), original)

    def test_recovers_unflagged_gb18030_chinese_filename(self):
        original = "贷款模块文档/001_贷款管理整体介绍.md"
        member = zipfile.ZipInfo(original.encode("gb18030").decode("cp437"))
        member.flag_bits = 0

        self.assertEqual(_zip_member_source_path(member).as_posix(), original)

    def test_ignores_macos_and_desktop_metadata(self):
        ignored = [
            Path("__MACOSX/贷款模块文档/._001_贷款管理整体介绍.md"),
            Path("贷款模块文档/._001_贷款管理整体介绍.md"),
            Path("贷款模块文档/.DS_Store"),
            Path("贷款模块文档/Thumbs.db"),
        ]
        for path in ignored:
            self.assertTrue(_is_ignored_zip_metadata(path), path)
        self.assertFalse(_is_ignored_zip_metadata(Path("贷款模块文档/001_贷款管理整体介绍.md")))

    def test_reads_utf8_and_gb18030_markdown(self):
        with TemporaryDirectory() as temp_dir:
            utf8_path = Path(temp_dir) / "utf8.md"
            gb_path = Path(temp_dir) / "gb.md"
            content = "# 贷款管理整体介绍\n\n正文"
            utf8_path.write_bytes(content.encode("utf-8"))
            gb_path.write_bytes(content.encode("gb18030"))

            self.assertEqual(_read_markdown_text(utf8_path, utf8_path.name), content)
            self.assertEqual(_read_markdown_text(gb_path, gb_path.name), content)

    def test_shortens_overlong_storage_segment(self):
        original = "截图" * 130 + ".png"
        shortened = _short_storage_segment(original)

        self.assertLessEqual(len(shortened.encode("utf-8")), 180)
        self.assertTrue(shortened.endswith(".png"))


if __name__ == "__main__":
    unittest.main()
