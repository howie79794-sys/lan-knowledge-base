import { UploadCloud } from "lucide-react";
import { useState } from "react";
import type { Categories } from "../api/client";
import { uploadDocument } from "../api/client";

export function UploadPage({ categories, onUploaded }: { categories: Categories | null; onUploaded: (id: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [purpose, setPurpose] = useState("");
  const [title, setTitle] = useState("");
  const [uploader, setUploader] = useState("");
  const [project, setProject] = useState("");
  const [source, setSource] = useState("");
  const [confidentiality, setConfidentiality] = useState("internal");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!file || !purpose) {
      setMessage("请选择文件和文件作用。");
      return;
    }
    const body = new FormData();
    body.set("file", file);
    body.set("purpose", purpose);
    body.set("title", title);
    body.set("uploader_name", uploader);
    body.set("project", project);
    body.set("source", source);
    body.set("confidentiality", confidentiality);
    setBusy(true);
    setMessage("");
    try {
      const result = await uploadDocument(body);
      onUploaded(result.id);
      setFile(null);
      setTitle("");
      setMessage("上传成功，解析任务已开始。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "上传失败。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="workspace">
      <div className="sectionHeader">
        <div>
          <h2>上传资料</h2>
          <p>为每份资料补充作用分类，系统会自动识别格式并生成 Agent 可读内容。</p>
        </div>
      </div>
      <div className="uploadLayout">
        <label className="dropzone">
          <UploadCloud size={32} />
          <span>{file ? file.name : "选择或拖入文件"}</span>
          <small>支持 PDF、Word、PPT、Excel、CSV、Markdown、文本</small>
          <input
            type="file"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              if (!title && event.target.files?.[0]) setTitle(event.target.files[0].name.replace(/\.[^.]+$/, ""));
            }}
          />
        </label>
        <div className="formGrid">
          <label>
            文件作用
            <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
              <option value="">请选择</option>
              {categories?.purposes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
          <label>
            标题
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="默认使用文件名" />
          </label>
          <label>
            上传人
            <input value={uploader} onChange={(event) => setUploader(event.target.value)} placeholder="例如 庄稼轩" />
          </label>
          <label>
            项目/客户
            <input value={project} onChange={(event) => setProject(event.target.value)} placeholder="可选" />
          </label>
          <label>
            来源
            <input value={source} onChange={(event) => setSource(event.target.value)} placeholder="可选" />
          </label>
          <label>
            敏感等级
            <select value={confidentiality} onChange={(event) => setConfidentiality(event.target.value)}>
              <option value="public">公开资料</option>
              <option value="internal">内部资料</option>
              <option value="sensitive">敏感资料</option>
            </select>
          </label>
          <button className="primaryButton" onClick={submit} disabled={busy}>
            {busy ? "上传中..." : "上传并解析"}
          </button>
          {message && <div className="formMessage">{message}</div>}
        </div>
      </div>
    </section>
  );
}
