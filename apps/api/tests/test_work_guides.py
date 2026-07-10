from pathlib import Path
from types import SimpleNamespace
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from app.modules.work_guides import service


class WorkGuideServiceTest(unittest.TestCase):
    def test_dynamic_categories_search_and_assets(self):
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            guide_dir = root / "资金计划填报规范"
            guide_dir.mkdir()
            (guide_dir / "index.md").write_text(
                """---
title: 资金计划填报规范
summary: 填报口径和审批步骤
categories:
  - 操作流程
  - 资金管理
updated_at: 2026-07-10
status: active
---

# 资金计划填报规范

这里是资金计划正文。
""",
                encoding="utf-8",
            )
            (guide_dir / "页面.png").write_bytes(b"png")
            (root / "旧规范.md").write_text(
                """---
title: 旧规范
category: 历史制度
status: archived
---

# 旧规范
""",
                encoding="utf-8",
            )

            with patch.object(service, "settings", SimpleNamespace(work_guides_dir=str(root))):
                result = service.list_work_guides()
                self.assertEqual(result["total"], 1)
                self.assertEqual(result["categories"], ["操作流程", "资金管理"])
                self.assertEqual(result["guides"][0]["slug"], "资金计划填报规范")

                filtered = service.list_work_guides(q="审批", category="操作流程")
                self.assertEqual(filtered["total"], 1)

                detail = service.get_work_guide("资金计划填报规范")
                self.assertIn("这里是资金计划正文", detail["content"])
                self.assertEqual(service.work_guide_asset_path("资金计划填报规范", "页面.png"), (guide_dir / "页面.png").resolve())

                with self.assertRaises(FileNotFoundError):
                    service.work_guide_asset_path("资金计划填报规范", "../旧规范.md")


if __name__ == "__main__":
    unittest.main()
