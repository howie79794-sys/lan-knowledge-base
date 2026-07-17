from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from app.db import session
from app.modules.wiki import service


class WikiContextTest(unittest.TestCase):
    def _insert_page(self, page_id: str, title: str, content: str, updated_at: str) -> None:
        with session.db_session() as conn:
            conn.execute(
                """
                INSERT INTO wiki_pages (
                    id, page_type, title, purpose, source_document_id, summary, content,
                    keywords, compile_method, status, created_at, updated_at
                ) VALUES (?, 'document_summary', ?, '产品社区文档', NULL, ?, ?, ?, 'smart', 'ready', ?, ?)
                """,
                (page_id, title, content[:100], content, "交易明细,银企互联" if "交易明细" in title else "账户余额,银企互联", updated_at, updated_at),
            )

    def test_context_handles_equal_scores_and_can_omit_content(self):
        with TemporaryDirectory() as temp_dir:
            sqlite_path = str(Path(temp_dir) / "wiki.sqlite3")
            with patch.object(session, "settings", SimpleNamespace(sqlite_path=sqlite_path)):
                session.init_db()
                self._insert_page("wiki_1", "交易明细查询", "用于查询银行账户交易明细。", "2026-07-17T10:00:00+00:00")
                self._insert_page("wiki_2", "交易明细同步", "用于同步银行账户交易明细。", "2026-07-17T10:00:00+00:00")
                self._insert_page("wiki_3", "账户余额查询", "用于查询银行账户余额。", "2026-07-17T11:00:00+00:00")
                with session.db_session() as conn:
                    conn.execute("INSERT OR REPLACE INTO wiki_pages SELECT * FROM wiki_pages WHERE id = ?", ("wiki_1",))
                    self.assertEqual(conn.execute("SELECT COUNT(*) FROM wiki_pages_fts WHERE page_id = ?", ("wiki_1",)).fetchone()[0], 1)

                result = service.wiki_context("交易明细", purpose="产品社区文档", limit=8, include_content=False)

                self.assertEqual([page["id"] for page in result["pages"]], ["wiki_1", "wiki_2"])
                self.assertTrue(all("content" not in page for page in result["pages"]))
                self.assertEqual(result["sources"], [])

                with_content = service.wiki_context("交易明细", purpose="产品社区文档", include_content=True)
                self.assertIn("content", with_content["pages"][0])

                with session.db_session() as conn:
                    self.assertTrue(service.wiki_fts_available(conn))

    def test_context_rejects_unknown_purpose(self):
        with self.assertRaises(HTTPException) as captured:
            service.wiki_context("交易明细", purpose="不存在的分类")
        self.assertEqual(captured.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
