import { Disclosure } from "./Disclosure";
import type { ObservationView } from "./view-types";
import styles from "./Workspace.module.css";

const previewEntryLimit = 8;
const excerptCharacterLimit = 4000;
const excerptLineLimit = 60;

function EntryList({
  entries,
}: {
  entries: readonly { name: string; type: "file" | "directory" }[];
}) {
  return (
    <ul className={styles.fileList}>
      {entries.map((entry, index) => (
        <li key={`${entry.name}-${index}`}>
          <code>
            {entry.name}{entry.type === "directory" ? "/" : ""}
          </code>
          {entry.type === "directory" && (
            <span className={styles.srOnly}>（目錄）</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export function Observation({ observation }: { observation: ObservationView }) {
  const excerpt =
    observation.kind === "read_file"
      ? observation.excerpt
          .slice(0, excerptCharacterLimit)
          .split("\n")
          .slice(0, excerptLineLimit)
          .join("\n")
      : "";
  const shortened =
    observation.truncated ||
    (observation.kind === "read_file" && excerpt.length < observation.excerpt.length);

  return (
    <div className={styles.observation}>
      <p className={styles.stepLabel}>觀察結果</p>
      {observation.kind === "list_files" ? (
        <>
          <p className={styles.observationSummary}>
            找到 {observation.count} 個項目
          </p>
          <EntryList entries={observation.entries.slice(0, previewEntryLimit)} />
          {observation.entries.length > previewEntryLimit && (
            <Disclosure
              label={`查看其餘項目（${observation.entries.length - previewEntryLimit} 個）`}
            >
              <div
                className={styles.scrollContent}
                tabIndex={0}
                aria-label="其餘目錄項目"
              >
                <EntryList entries={observation.entries.slice(previewEntryLimit)} />
              </div>
            </Disclosure>
          )}
        </>
      ) : (
        <>
          <p className={styles.observationSummary}>讀取成功</p>
          <p className={styles.technicalMetadata}>
            {observation.bytes.toLocaleString("en-US")} B ·{" "}
            {observation.lines.toLocaleString("en-US")} {observation.lines === 1 ? "line" : "lines"}
          </p>
          {excerpt && (
            <Disclosure label="查看內容節錄">
              <pre className={styles.codeBlock} tabIndex={0} aria-label="檔案內容節錄">
                <code>{excerpt}</code>
              </pre>
            </Disclosure>
          )}
        </>
      )}
      {shortened && <p className={styles.secondaryText}>為方便閱讀，顯示內容已截短。</p>}
    </div>
  );
}
