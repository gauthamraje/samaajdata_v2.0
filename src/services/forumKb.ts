/**
 * Forum / Knowledge Base: successful citizen-led solutions (from forum_kb.txt).
 */

export interface ForumSolution {
  id: string;
  title: string;
  description: string;
}

const FORUM_KB_URL = "/data/forum_kb.txt";

function parseForumKb(text: string): ForumSolution[] {
  const solutions: ForumSolution[] = [];
  const blocks = text.split(/\n(?=TOPIC:)/i).filter((b) => b.trim());
  let id = 0;
  for (const block of blocks) {
    if (!/^TOPIC:/i.test(block)) continue;
    const match = block.match(/^TOPIC:\s*(.+?)\n([\s\S]*)$/);
    const title = match ? match[1].trim() : block.replace(/^TOPIC:\s*/i, "").trim();
    const description = match ? match[2].trim() : "";
    if (title.length < 2) continue;
    id += 1;
    solutions.push({
      id: `forum-${id}`,
      title,
      description: description || title,
    });
  }
  return solutions;
}

export async function fetchForumSolutions(): Promise<ForumSolution[]> {
  const res = await fetch(FORUM_KB_URL);
  if (!res.ok) return [];
  const text = await res.text();
  return parseForumKb(text);
}
