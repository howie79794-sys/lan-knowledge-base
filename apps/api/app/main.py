from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.core.paths import ensure_data_dirs
from app.db.session import init_db
from app.modules.agent.router import router as agent_router
from app.modules.documents.router import router as documents_router
from app.modules.parse_jobs.router import router as parse_jobs_router


def create_app() -> FastAPI:
    ensure_data_dirs()
    init_db()
    app = FastAPI(
        title="局域网知识库 API",
        version="0.1.0",
        description="局域网内部资料管理和 Agent 读取 API。",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allow_origins),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(documents_router)
    app.include_router(parse_jobs_router)
    app.include_router(agent_router)

    @app.get("/api/v1/health", tags=["system"])
    def health():
        return {"ok": True, "service": "lan-knowledge-base-api"}

    return app


app = create_app()
