import { ArrowLeft, BookOpen, Copy, ExternalLink, Image, Pin, RefreshCcw, Search, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { fetchWorkGuide, fetchWorkGuides, type WorkGuideDetail, type WorkGuideSummary, workGuideAssetUrl } from "../api/client";
import { copyText } from "../utils/clipboard";

export function WorkGuidesPage() {
  const [guides, setGuides] = useState<WorkGuideSummary[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [selectedCategory, setSelectedCategory] = useState("");
  const [query, setQuery] = useState("");
  const [selectedSlug, setSelectedSlug] = useState<string | null>(() => guideSlugFromUrl());
  const [detail, setDetail] = useState<WorkGuideDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [previewImage, setPreviewImage] = useState<{ src: string; alt: string } | null>(null);

  async function loadGuides() {
    setLoading(true);
    setMessage("");
    try {
      const data = await fetchWorkGuides({ q: query.trim(), category: selectedCategory });
      setGuides(data.guides);
      setCategories(data.categories);
      if (selectedCategory && !data.categories.includes(selectedCategory)) setSelectedCategory("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "读取工作指引失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(loadGuides, 180);
    return () => window.clearTimeout(timer);
  }, [query, selectedCategory]);

  useEffect(() => {
    if (!selectedSlug) {
      setDetail(null);
      return;
    }
    setLoading(true);
    fetchWorkGuide(selectedSlug)
      .then(setDetail)
      .catch((error) => {
        setMessage(error instanceof Error ? error.message : "读取工作指引正文失败。");
        setSelectedSlug(null);
        clearGuideFromUrl();
      })
      .finally(() => setLoading(false));
  }, [selectedSlug]);

  function openGuide(slug: string) {
    setSelectedSlug(slug);
    setMessage("");
    const url = new URL(window.location.href);
    url.searchParams.set("workGuide", slug);
    url.hash = "";
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeGuide() {
    setSelectedSlug(null);
    setDetail(null);
    setPreviewImage(null);
    clearGuideFromUrl();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function copyGuideLink() {
    if (!detail) return;
    const url = new URL(window.location.href);
    url.searchParams.set("workGuide", detail.slug);
    url.hash = "";
    const copied = await copyText(url.toString());
    setMessage(copied ? "工作指引链接已复制。" : "浏览器限制了自动复制，请手动复制地址栏链接。");
  }

  if (selectedSlug) {
    return (
      <GuideDetail
        detail={detail}
        loading={loading}
        message={message}
        onBack={closeGuide}
        onCopyLink={copyGuideLink}
        onPreviewImage={setPreviewImage}
        previewImage={previewImage}
        onClosePreview={() => setPreviewImage(null)}
      />
    );
  }

  return (
    <section className="workspace workGuidesPage">
      <div className="sectionHeader guidePageHeader">
        <div>
          <h2>工作指引</h2>
          <p>集中查看当前有效的工作规范、操作流程和常见问题。</p>
        </div>
        <div className="guideHeaderMeta">
          <span>共 {guides.length} 份</span>
          <button className="iconButton" onClick={loadGuides} disabled={loading} title="重新扫描工作指引目录">
            <RefreshCcw size={17} />
          </button>
        </div>
      </div>

      <div className="guideToolbar">
        <label className="searchBox guideSearchBox">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索标题、概要或正文" />
        </label>
        <div className="guideCategoryFilters" aria-label="工作指引分类">
          <button className={!selectedCategory ? "active" : ""} onClick={() => setSelectedCategory("")}>
            全部
          </button>
          {categories.map((category) => (
            <button key={category} className={selectedCategory === category ? "active" : ""} onClick={() => setSelectedCategory(category)}>
              {category}
            </button>
          ))}
        </div>
      </div>

      {message && <div className="notice">{message}</div>}
      {loading && <div className="loadingLine">正在读取工作指引...</div>}

      {guides.length ? (
        <div className="guideCardGrid">
          {guides.map((guide) => (
            <button key={guide.slug} className="guideCard" onClick={() => openGuide(guide.slug)}>
              <div className="guideCardTop">
                <BookOpen size={19} />
                <div className="guideBadges">
                  {guide.pinned && <Pin size={14} aria-label="置顶" />}
                  {isRecentlyUpdated(guide.updated_at) && <span className="recentBadge">最近更新</span>}
                </div>
              </div>
              <strong>{guide.title}</strong>
              <p>{guide.summary}</p>
              <div className="guideCardFooter">
                <div className="guideCategoryList">
                  {guide.categories.slice(0, 2).map((category) => (
                    <span key={category}>{category}</span>
                  ))}
                  {guide.categories.length > 2 && <span>+{guide.categories.length - 2}</span>}
                </div>
                <time>{formatGuideDate(guide.updated_at)}</time>
              </div>
            </button>
          ))}
        </div>
      ) : (
        !loading && (
          <div className="emptyState guideEmptyState">
            <BookOpen size={30} />
            <p>{query || selectedCategory ? "没有找到符合条件的工作指引。" : "工作指引目录还是空的，请先放入 Markdown 文档。"}</p>
            <small>目录位置：F:\kb-data\work-guides</small>
          </div>
        )
      )}
    </section>
  );
}

function GuideDetail({
  detail,
  loading,
  message,
  onBack,
  onCopyLink,
  onPreviewImage,
  previewImage,
  onClosePreview
}: {
  detail: WorkGuideDetail | null;
  loading: boolean;
  message: string;
  onBack: () => void;
  onCopyLink: () => void;
  onPreviewImage: (image: { src: string; alt: string }) => void;
  previewImage: { src: string; alt: string } | null;
  onClosePreview: () => void;
}) {
  const headings = useMemo(() => extractHeadings(detail?.content ?? ""), [detail?.content]);
  let headingIndex = 0;

  if (!detail) {
    return (
      <section className="workspace guideDetailPage">
        <button className="secondaryButton guideBackButton" onClick={onBack}>
          <ArrowLeft size={16} />
          返回工作指引
        </button>
        {message && <div className="notice">{message}</div>}
        <div className="emptyState">
          <BookOpen size={30} />
          <p>{loading ? "正在打开工作指引..." : "这份工作指引暂时无法读取。"}</p>
        </div>
      </section>
    );
  }

  const heading = (level: 1 | 2 | 3, children: React.ReactNode) => {
    const current = headings[headingIndex++];
    const Tag = `h${level}` as const;
    return <Tag id={current?.id}>{children}</Tag>;
  };

  return (
    <section className="workspace guideDetailPage">
      <div className="guideDetailActions">
        <button className="secondaryButton guideBackButton" onClick={onBack}>
          <ArrowLeft size={16} />
          返回工作指引
        </button>
        <button className="secondaryButton" onClick={onCopyLink}>
          <Copy size={16} />
          复制文档链接
        </button>
      </div>

      {message && <div className="notice">{message}</div>}

      <header className="guideDocumentHeader">
        <div className="guideCategoryList">
          {detail.categories.map((category) => (
            <span key={category}>{category}</span>
          ))}
        </div>
        <h2>{detail.title}</h2>
        <p>{detail.summary}</p>
        <dl className="guideMetadata">
          {detail.version && (
            <div>
              <dt>版本</dt>
              <dd>{detail.version}</dd>
            </div>
          )}
          {detail.effective_date && (
            <div>
              <dt>生效日期</dt>
              <dd>{formatGuideDate(detail.effective_date)}</dd>
            </div>
          )}
          <div>
            <dt>更新时间</dt>
            <dd>{formatGuideDate(detail.updated_at)}</dd>
          </div>
        </dl>
      </header>

      <div className={headings.length > 1 ? "guideDetailLayout" : "guideDetailLayout noToc"}>
        <article className="guideMarkdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              h1: ({ children }) => heading(1, children),
              h2: ({ children }) => heading(2, children),
              h3: ({ children }) => heading(3, children),
              img: ({ src, alt }) => {
                const imageSource = workGuideAssetUrl(detail.slug, src);
                if (!imageSource) return null;
                return (
                  <span
                    className="guideImageButton"
                    role="button"
                    tabIndex={0}
                    onClick={() => onPreviewImage({ src: imageSource, alt: alt || "工作指引图片" })}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") onPreviewImage({ src: imageSource, alt: alt || "工作指引图片" });
                    }}
                  >
                    <img src={imageSource} alt={alt || "工作指引图片"} loading="lazy" />
                    <span>
                      <Image size={14} />
                      点击查看原图
                    </span>
                  </span>
                );
              },
              a: ({ href, children }) => (
                <a href={href} target="_blank" rel="noreferrer">
                  {children}
                  <ExternalLink size={13} />
                </a>
              )
            }}
          >
            {detail.content}
          </ReactMarkdown>
        </article>

        {headings.length > 1 && (
          <aside className="guideToc" aria-label="文档目录">
            <strong>本文目录</strong>
            <nav>
              {headings.map((item) => (
                <a key={item.id} className={`level${item.level}`} href={`#${item.id}`}>
                  {item.title}
                </a>
              ))}
            </nav>
          </aside>
        )}
      </div>

      {previewImage && (
        <div className="guideImagePreview" role="dialog" aria-modal="true" aria-label="查看工作指引原图" onClick={onClosePreview}>
          <button className="iconButton" onClick={onClosePreview} title="关闭图片预览">
            <X size={18} />
          </button>
          <img src={previewImage.src} alt={previewImage.alt} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </section>
  );
}

function guideSlugFromUrl() {
  return new URLSearchParams(window.location.search).get("workGuide");
}

function clearGuideFromUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("workGuide");
  url.hash = "";
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function extractHeadings(content: string) {
  let index = 0;
  return content
    .split(/\r?\n/)
    .map((line) => line.match(/^(#{1,3})\s+(.+?)\s*#*$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      id: `guide-section-${++index}`,
      level: match[1].length,
      title: match[2].replace(/[`*_~\[\]]/g, "").trim()
    }));
}

function formatGuideDate(value: string) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(parsed);
}

function isRecentlyUpdated(value: string) {
  const timestamp = new Date(value).getTime();
  if (Number.isNaN(timestamp)) return false;
  const difference = Date.now() - timestamp;
  return difference >= 0 && difference <= 7 * 24 * 60 * 60 * 1000;
}
